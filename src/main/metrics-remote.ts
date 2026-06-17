import type { BrowserWindow } from 'electron';
import { Client } from 'ssh2';
import { CH } from '../shared/channels';
import type {
  RemoteMetricsSnapshot,
  RemoteConnectionState,
  SshProfile,
} from '../shared/types';
import {
  parseProcStat,
  parseFreeBytes,
  parseSensorsTemp,
  parseThermalZoneTemp,
  parseDfBytes,
} from './parsers';

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const PROC_STAT_SAMPLE_GAP_MS = 200;

// Single-active-profile remote metrics manager. Holds at most one live ssh2
// Client plus its backoff state. Switching profiles tears down the old client
// before starting the new one (no connection pool in the MVP).
class RemoteMetricsManager {
  private win: BrowserWindow | null = null;
  private activeProfile: SshProfile | null = null;
  private client: Client | null = null;
  private connectionState: RemoteConnectionState = 'idle';
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  // Guards against late events from a torn-down connection (a "generation"
  // counter incremented on every setActiveProfile / teardown).
  private generation = 0;

  attach(win: BrowserWindow): void {
    this.win = win;
  }

  // Switch the actively polled profile. Passing null stops polling and tears
  // down the connection.
  setActiveProfile(profile: SshProfile | null): void {
    this.teardown();
    this.activeProfile = profile;

    if (!profile) {
      this.connectionState = 'idle';
      this.push({
        cpuLoadPercent: null,
        memTotalBytes: null,
        memUsedBytes: null,
        cpuTempC: null,
        diskTotalBytes: null,
        diskUsedBytes: null,
        error: null,
      });
      return;
    }

    this.backoffMs = INITIAL_BACKOFF_MS;
    this.connectionState = 'connecting';
    this.push({
      cpuLoadPercent: null,
      memTotalBytes: null,
      memUsedBytes: null,
      cpuTempC: null,
      diskTotalBytes: null,
      diskUsedBytes: null,
      error: null,
    });
    this.ensureConnection();
  }

  // Called from the shared 2s tick. Collects only when connected.
  tick(): void {
    if (
      this.connectionState === 'connected' &&
      this.client &&
      this.activeProfile
    ) {
      void this.collectRemoteTick();
    }
  }

  private teardown(): void {
    this.generation += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.end();
      } catch {
        // ignore teardown errors
      }
      this.client = null;
    }
  }

  private ensureConnection(): void {
    const profile = this.activeProfile;
    if (!profile) return;
    const gen = this.generation;

    const client = new Client();
    this.client = client;

    client.on('ready', () => {
      if (gen !== this.generation) return;
      this.connectionState = 'connected';
      this.backoffMs = INITIAL_BACKOFF_MS;
      // eslint-disable-next-line no-console
      console.log(`[ssh] Connected to ${profile.host}:${profile.port}`);
      // Emit a first sample promptly (satisfies "within 5s of selection").
      void this.collectRemoteTick();
    });

    let failureHandled = false;
    const onFailure = (err?: Error): void => {
      if (gen !== this.generation) return;
      // The 'error' event is always followed by 'close'. Guard so only the
      // first call wins — the error message is more descriptive than 'close'.
      if (failureHandled) return;
      failureHandled = true;
      this.connectionState = 'reconnecting';
      const msg = err ? err.message : 'connection closed';
      // eslint-disable-next-line no-console
      console.error(`[ssh] Connection to ${profile.host}:${profile.port} failed: ${msg}`);
      this.push({
        cpuLoadPercent: null,
        memTotalBytes: null,
        memUsedBytes: null,
        cpuTempC: null,
        diskTotalBytes: null,
        diskUsedBytes: null,
        error: msg,
      });
      this.scheduleReconnect();
    };

    client.on('error', onFailure);
    client.on('close', () => onFailure());

    try {
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        readyTimeout: 10000,
      });
    } catch (err) {
      onFailure(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    const gen = this.generation;
    this.reconnectTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      // Drop the failed client before reconnecting.
      if (this.client) {
        try {
          this.client.removeAllListeners();
          this.client.end();
        } catch {
          // ignore
        }
        this.client = null;
      }
      this.ensureConnection();
    }, delay);
  }

  private async collectRemoteTick(): Promise<void> {
    const client = this.client;
    const profile = this.activeProfile;
    if (!client || !profile) return;
    const gen = this.generation;

    try {
      const stat1 = await this.exec(client, 'cat /proc/stat');
      await delay(PROC_STAT_SAMPLE_GAP_MS);
      if (gen !== this.generation) return;
      const stat2 = await this.exec(client, 'cat /proc/stat');
      const cpuLoadPercent = parseProcStat(stat1, stat2);

      const freeOut = await this.exec(client, 'free -b');
      const { total, used } = parseFreeBytes(freeOut);

      const cpuTempC = await this.collectTemp(client);

      const dfOut = await this.exec(client, 'df -B1 / 2>/dev/null');
      const { total: diskTotal, used: diskUsed } = parseDfBytes(dfOut);

      if (gen !== this.generation) return;
      this.push({
        cpuLoadPercent,
        memTotalBytes: total,
        memUsedBytes: used,
        cpuTempC,
        diskTotalBytes: diskTotal,
        diskUsedBytes: diskUsed,
        error: null,
      });
    } catch (err) {
      if (gen !== this.generation) return;
      this.push({
        cpuLoadPercent: null,
        memTotalBytes: null,
        memUsedBytes: null,
        cpuTempC: null,
        diskTotalBytes: null,
        diskUsedBytes: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Try `sensors` first; fall back to the thermal zone file; null if both fail.
  private async collectTemp(client: Client): Promise<number | null> {
    try {
      const sensorsOut = await this.exec(client, 'sensors 2>/dev/null');
      const fromSensors = parseSensorsTemp(sensorsOut);
      if (fromSensors !== null) return fromSensors;
    } catch {
      // ignore and fall back
    }
    try {
      const thermalOut = await this.exec(
        client,
        'cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null',
      );
      return parseThermalZoneTemp(thermalOut);
    } catch {
      return null;
    }
  }

  private exec(client: Client, command: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        let stdout = '';
        stream
          .on('close', () => resolve(stdout))
          .on('data', (data: Buffer) => {
            stdout += data.toString('utf8');
          })
          .stderr.on('data', () => {
            // stderr ignored; commands use 2>/dev/null where relevant
          });
      });
    });
  }

  private push(
    partial: Pick<
      RemoteMetricsSnapshot,
      | 'cpuLoadPercent'
      | 'memTotalBytes'
      | 'memUsedBytes'
      | 'cpuTempC'
      | 'diskTotalBytes'
      | 'diskUsedBytes'
      | 'error'
    >,
  ): void {
    if (!this.win || this.win.isDestroyed()) return;
    const snapshot: RemoteMetricsSnapshot = {
      source: 'remote',
      profileId: this.activeProfile?.id ?? null,
      connectionState: this.connectionState,
      timestamp: Date.now(),
      ...partial,
    };
    this.win.webContents.send(CH.METRICS_REMOTE, snapshot);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Module singleton: one active remote profile at a time across the app.
export const remoteMetrics = new RemoteMetricsManager();

// One-shot connection test for the ssh:test channel. Resolves with a result
// object; never throws.
export function testSshConnection(profile: {
  host: string;
  port: number;
  username: string;
  password: string;
}): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const client = new Client();
    let settled = false;
    const done = (result: { ok: boolean; error?: string }): void => {
      if (settled) return;
      settled = true;
      try {
        client.removeAllListeners();
        client.end();
      } catch {
        // ignore
      }
      resolve(result);
    };

    client.on('ready', () => done({ ok: true }));
    client.on('error', (err: Error) =>
      done({ ok: false, error: err.message }),
    );

    try {
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        readyTimeout: 10000,
      });
    } catch (err) {
      done({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
