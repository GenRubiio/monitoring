import type { BrowserWindow } from 'electron';
import si from 'systeminformation';
import { CH } from '../shared/channels';
import type { MetricsSnapshot } from '../shared/types';
import { readMacCpuTemperature } from './temperature-macos';

const POLL_INTERVAL_MS = 2000;

async function readCpuTemperature(): Promise<number | null> {
  const temp = await si.cpuTemperature();
  if (typeof temp.main === 'number' && !Number.isNaN(temp.main)) {
    return temp.main;
  }
  return readMacCpuTemperature();
}

// Collects one local metrics sample. Always resolves with a MetricsSnapshot;
// on failure the snapshot carries an `error` string instead of throwing, so a
// single bad tick never tears down the polling loop or kills the window.
export async function collectLocalSnapshot(): Promise<MetricsSnapshot> {
  try {
    const [load, mem, cpuTempC] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      readCpuTemperature(),
    ]);

    return {
      source: 'local',
      timestamp: Date.now(),
      cpuLoadPercent: Math.round(load.currentLoad),
      memTotalBytes: mem.total,
      // `used` is total - free and therefore includes reclaimable cache,
      // especially on macOS. `active` represents RAM currently in use while
      // excluding that cache, matching what the widget intends to display.
      memUsedBytes: mem.active,
      cpuTempC,
      error: null,
    };
  } catch (err) {
    return {
      source: 'local',
      timestamp: Date.now(),
      cpuLoadPercent: 0,
      memTotalBytes: 0,
      memUsedBytes: 0,
      cpuTempC: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Starts the 2-second local metrics poll loop. Pushes each snapshot to the
// renderer over the metrics:local channel. Returns a stop function.
export function startLocalMetricsLoop(win: BrowserWindow): () => void {
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped || win.isDestroyed()) return;
    const snapshot = await collectLocalSnapshot();
    if (!stopped && !win.isDestroyed()) {
      win.webContents.send(CH.METRICS_LOCAL, snapshot);
    }
  };

  // Emit one sample immediately so the widget shows data before the first tick.
  void tick();
  const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
