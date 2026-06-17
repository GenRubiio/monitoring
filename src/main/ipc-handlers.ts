import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { createSocket } from 'dgram';
import { CH } from '../shared/channels';
import type {
  SshProfile,
  SshProfileInput,
  SshTestResult,
} from '../shared/types';
import { startLocalMetricsLoop } from './metrics-local';
import { remoteMetrics, testSshConnection } from './metrics-remote';
import { ProfileStore, normalizePort } from './profile-store';

// Trigger macOS Local Network Privacy dialog so the user can grant access.
// On macOS 15+, direct TCP connections to local IPs do NOT trigger the dialog
// — only Bonjour/multicast operations do.
// IMPORTANT: bind to port 0 (random), NOT 5353. mDNSResponder already owns
// port 5353 and even with reuseAddr the bind can silently fail, which would
// prevent addMembership from ever being called and the dialog never appearing.
function triggerLocalNetworkPermission(): void {
  if (process.platform !== 'darwin') return;

  // Primary: join the mDNS multicast group AND send a minimal mDNS packet so
  // macOS can attribute the local-network request to this app bundle.
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  const close = (): void => {
    try { socket.close(); } catch { /* already closed */ }
  };
  socket.on('error', close);
  socket.bind(0, () => {   // port 0 = OS picks any available port
    try {
      socket.addMembership('224.0.0.251');
      // Sending a packet to the mDNS address reinforces the TCC attribution.
      const mdnsQuery = Buffer.from([
        0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      socket.send(mdnsQuery, 0, mdnsQuery.length, 5353, '224.0.0.251');
      setTimeout(close, 3000);
    } catch {
      close();
    }
  });

  // Secondary: UDP broadcast to the local subnet (another local-network signal)
  const broadcastSocket = createSocket({ type: 'udp4', reuseAddr: true });
  const closeBroadcast = (): void => {
    try { broadcastSocket.close(); } catch { /* already closed */ }
  };
  broadcastSocket.on('error', closeBroadcast);
  broadcastSocket.bind(0, () => {
    try {
      broadcastSocket.setBroadcast(true);
      broadcastSocket.send(Buffer.alloc(1), 0, 1, 5353, '255.255.255.255');
      setTimeout(closeBroadcast, 1000);
    } catch {
      closeBroadcast();
    }
  });

  // Tertiary: .local DNS lookup (triggers system mDNS resolver)
  const dns = require('dns') as typeof import('dns');
  dns.lookup('monitoring.local', () => { /* ignore result */ });
}

const profileStore = new ProfileStore();

// --- Validation -------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Validate an SshProfileInput. Returns a normalized object (port defaulted)
// or throws a descriptive Error. Throwing inside an async `handle` callback
// surfaces to the renderer as a rejected promise without crashing main.
function validateProfileInput(input: unknown): SshProfileInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid profile: expected an object');
  }
  const candidate = input as Record<string, unknown>;
  if (!isNonEmptyString(candidate.name)) {
    throw new Error('Invalid profile: name is required');
  }
  if (!isNonEmptyString(candidate.host)) {
    throw new Error('Invalid profile: host is required');
  }
  if (!isNonEmptyString(candidate.username)) {
    throw new Error('Invalid profile: username is required');
  }
  if (typeof candidate.password !== 'string' || candidate.password.length === 0) {
    throw new Error('Invalid profile: password is required');
  }
  if (
    candidate.port !== undefined &&
    candidate.port !== null &&
    typeof candidate.port !== 'number'
  ) {
    throw new Error('Invalid profile: port must be a number');
  }

  return {
    id: typeof candidate.id === 'string' ? candidate.id : undefined,
    name: candidate.name,
    host: candidate.host,
    port: normalizePort(
      typeof candidate.port === 'number' ? candidate.port : undefined,
    ),
    username: candidate.username,
    password: candidate.password,
  };
}

function validateDeletePayload(payload: unknown): { id: string } {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('Invalid delete payload');
  }
  const { id } = payload as Record<string, unknown>;
  if (!isNonEmptyString(id)) {
    throw new Error('Invalid delete payload: id is required');
  }
  return { id };
}

// --- Registration -----------------------------------------------------------

const POLL_INTERVAL_MS = 2000;

// Registers all IPC handlers and starts the shared metric poll loop.
// Also restores the previously active SSH profile from persisted store.
export function registerIpcHandlers(win: BrowserWindow): () => void {
  remoteMetrics.attach(win);

  // Restore the previously active SSH profile after the window is ready.
  // Deferring until 'ready-to-show' keeps the app in the foreground when macOS
  // evaluates the Local Network Privacy check, ensuring the dialog appears
  // instead of silently returning EHOSTUNREACH.
  const savedActiveId = profileStore.getActiveProfileId();
  if (savedActiveId) {
    const profile = profileStore.getById(savedActiveId);
    if (profile) {
      // eslint-disable-next-line no-console
      console.log(`[ipc] Will restore profile: ${profile.name} (${profile.username}@${profile.host}:${profile.port})`);
      // did-finish-load is more reliable than ready-to-show for transparent
      // frameless windows: it always fires once the renderer has loaded.
      win.webContents.once('did-finish-load', () => {
        // Trigger the mDNS multicast probe so macOS shows the Local Network
        // Privacy dialog before the SSH connection is attempted.
        triggerLocalNetworkPermission();
        // 2 s gives macOS time to show the TCC dialog and the user time to
        // click Allow before the first SSH attempt. Without this gap the first
        // attempt arrives while the dialog is still pending and gets EHOSTUNREACH.
        setTimeout(() => {
          // eslint-disable-next-line no-console
          console.log(`[ipc] Restoring active profile: ${profile.name}`);
          remoteMetrics.setActiveProfile(profile);
        }, 2000);
      });
    }
  }

  // Local metrics push loop (own 2s interval inside metrics-local).
  const stopLocal = startLocalMetricsLoop(win);

  // Shared 2s tick that drives remote collection only when a profile is active
  // and connected (keeps the two streams aligned, minimizes wakeups).
  const remoteTimer = setInterval(() => {
    if (win.isDestroyed()) return;
    remoteMetrics.tick();
  }, POLL_INTERVAL_MS);

  // ssh:test — one-shot connection test. Returns a result, never throws.
  ipcMain.handle(CH.SSH_TEST, async (_event, input): Promise<SshTestResult> => {
    try {
      const profile = validateProfileInput(input);
      return await testSshConnection({
        host: profile.host,
        port: profile.port ?? 22,
        username: profile.username,
        password: profile.password,
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  // profile:save — create or update. Rejects with a string on invalid input.
  ipcMain.handle(CH.PROFILE_SAVE, async (_event, input): Promise<SshProfile> => {
    try {
      const validated = validateProfileInput(input);
      return profileStore.upsert(validated);
    } catch (err) {
      throw err instanceof Error ? err.message : String(err);
    }
  });

  // profile:delete — remove by id; stop polling if the active profile is deleted.
  ipcMain.handle(
    CH.PROFILE_DELETE,
    async (_event, payload): Promise<{ ok: boolean }> => {
      try {
        const { id } = validateDeletePayload(payload);
        if (profileStore.getActiveProfileId() === id) {
          profileStore.setActiveProfileId(null);
          remoteMetrics.setActiveProfile(null);
        }
        return { ok: profileStore.remove(id) };
      } catch (err) {
        throw err instanceof Error ? err.message : String(err);
      }
    },
  );

  // profile:list — return all stored profiles.
  ipcMain.handle(CH.PROFILE_LIST, async (): Promise<SshProfile[]> => {
    return profileStore.list();
  });

  // profile:select — switch active remote target (fire-and-forget). Never throws.
  ipcMain.on(CH.PROFILE_SELECT, (_event, payload) => {
    try {
      const id =
        payload && typeof payload === 'object'
          ? (payload as { id: unknown }).id
          : undefined;
      if (id !== null && typeof id !== 'string') {
        // eslint-disable-next-line no-console
        console.warn('[ipc] profile:select received invalid id');
        return;
      }
      const profile = id ? profileStore.getById(id) : null;
      profileStore.setActiveProfileId(profile ? profile.id : null);
      remoteMetrics.setActiveProfile(profile);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ipc] profile:select error:', err);
    }
  });

  ipcMain.on(CH.WINDOW_MINIMIZE, () => {
    if (!win.isDestroyed()) win.minimize();
  });

  ipcMain.on(CH.APP_CLOSE, () => {
    app.quit();
  });

  // Opens macOS System Settings → Privacy & Security → Local Network directly.
  // Used by the renderer when EHOSTUNREACH is detected to guide the user to
  // re-enable the permission without navigating the settings manually.
  ipcMain.on(CH.OPEN_PRIVACY_SETTINGS, () => {
    void shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork',
    );
  });

  return () => {
    stopLocal();
    clearInterval(remoteTimer);
    ipcMain.removeHandler(CH.SSH_TEST);
    ipcMain.removeHandler(CH.PROFILE_SAVE);
    ipcMain.removeHandler(CH.PROFILE_DELETE);
    ipcMain.removeHandler(CH.PROFILE_LIST);
    ipcMain.removeAllListeners(CH.PROFILE_SELECT);
    ipcMain.removeAllListeners(CH.WINDOW_MINIMIZE);
    ipcMain.removeAllListeners(CH.APP_CLOSE);
    ipcMain.removeAllListeners(CH.OPEN_PRIVACY_SETTINGS);
  };
}

// Exported for unit testing the validation contract.
export const __test__ = { validateProfileInput, validateDeletePayload };
