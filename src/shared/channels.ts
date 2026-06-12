// Centralized IPC channel name constants.
//
// Imported by main, preload, and renderer bundles so channel names cannot
// drift between processes. This module contains no Electron or Node runtime
// imports and is safe for the sandboxed renderer bundle.

export const CH = {
  METRICS_LOCAL: 'metrics:local',
  METRICS_REMOTE: 'metrics:remote',
  SSH_TEST: 'ssh:test',
  PROFILE_SAVE: 'profile:save',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_LIST: 'profile:list',
  PROFILE_SELECT: 'profile:select',
} as const;

export type ChannelName = (typeof CH)[keyof typeof CH];
