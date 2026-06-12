import { useEffect, useState } from 'react';
import type {
  MetricsSnapshot,
  RemoteMetricsSnapshot,
} from '../../shared/types';

export interface MetricsState {
  local: MetricsSnapshot | null;
  remote: RemoteMetricsSnapshot | null;
}

// Subscribes to the local and remote metric push channels via the preload API.
// Returns the latest snapshot of each. Disposers are returned in the effect
// cleanup so listeners do not leak across re-mounts.
export function useMetrics(): MetricsState {
  const [local, setLocal] = useState<MetricsSnapshot | null>(null);
  const [remote, setRemote] = useState<RemoteMetricsSnapshot | null>(null);

  useEffect(() => {
    const disposeLocal = window.api.onMetricsLocal(setLocal);
    const disposeRemote = window.api.onMetricsRemote(setRemote);
    return () => {
      disposeLocal();
      disposeRemote();
    };
  }, []);

  return { local, remote };
}
