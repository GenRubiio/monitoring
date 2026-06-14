import { app, ipcMain, type BrowserWindow } from 'electron';
import { CH } from '../shared/channels';
import type {
  SshProfile,
  SshProfileInput,
  SshTestResult,
} from '../shared/types';
import { startLocalMetricsLoop } from './metrics-local';
import { remoteMetrics, testSshConnection } from './metrics-remote';
import { ProfileStore, normalizePort } from './profile-store';

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
export function registerIpcHandlers(win: BrowserWindow): () => void {
  remoteMetrics.attach(win);

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
  };
}

// Exported for unit testing the validation contract.
export const __test__ = { validateProfileInput, validateDeletePayload };
