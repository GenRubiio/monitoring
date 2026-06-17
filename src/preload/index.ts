import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '../shared/channels';
import type {
  MetricsSnapshot,
  RemoteMetricsSnapshot,
  SshProfile,
  SshProfileInput,
  SshTestResult,
  MonitorApi,
} from '../shared/types';

// The single, narrow API surface exposed to the renderer. The raw ipcRenderer
// is never exposed, and the IPC `event` object is never forwarded to renderer
// callbacks (only the validated payload), so sender/ports cannot leak.
const api: MonitorApi = {
  onMetricsLocal(cb: (s: MetricsSnapshot) => void): () => void {
    const listener = (_event: unknown, snapshot: MetricsSnapshot): void =>
      cb(snapshot);
    ipcRenderer.on(CH.METRICS_LOCAL, listener);
    return () => ipcRenderer.removeListener(CH.METRICS_LOCAL, listener);
  },

  onMetricsRemote(cb: (s: RemoteMetricsSnapshot) => void): () => void {
    const listener = (_event: unknown, snapshot: RemoteMetricsSnapshot): void =>
      cb(snapshot);
    ipcRenderer.on(CH.METRICS_REMOTE, listener);
    return () => ipcRenderer.removeListener(CH.METRICS_REMOTE, listener);
  },

  testConnection(input: SshProfileInput): Promise<SshTestResult> {
    return ipcRenderer.invoke(CH.SSH_TEST, input);
  },

  saveProfile(input: SshProfileInput): Promise<SshProfile> {
    return ipcRenderer.invoke(CH.PROFILE_SAVE, input);
  },

  deleteProfile(id: string): Promise<{ ok: boolean }> {
    return ipcRenderer.invoke(CH.PROFILE_DELETE, { id });
  },

  listProfiles(): Promise<SshProfile[]> {
    return ipcRenderer.invoke(CH.PROFILE_LIST);
  },

  selectProfile(id: string | null): void {
    ipcRenderer.send(CH.PROFILE_SELECT, { id });
  },

  minimizeWindow(): void {
    ipcRenderer.send(CH.WINDOW_MINIMIZE);
  },

  closeApp(): void {
    ipcRenderer.send(CH.APP_CLOSE);
  },

  openPrivacySettings(): void {
    ipcRenderer.send(CH.OPEN_PRIVACY_SETTINGS);
  },
};

contextBridge.exposeInMainWorld('api', api);
