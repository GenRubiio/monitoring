import type { MonitorApi } from '../shared/types';

declare global {
  interface Window {
    api: MonitorApi;
  }
}

export {};
