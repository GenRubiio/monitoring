import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

interface IsmcSensor {
  quantity?: unknown;
}

function validTemperature(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 150
  );
}

// Prefer the M5's aggregate die reading. If it is absent on another Apple
// Silicon model, average all available CPU core/cluster sensors instead.
export function parseIsmcCpuTemperature(output: string): number | null {
  let sensors: Record<string, IsmcSensor>;
  try {
    sensors = JSON.parse(output) as Record<string, IsmcSensor>;
  } catch {
    return null;
  }

  const dieAverage = sensors['CPU Die Average']?.quantity;
  if (validTemperature(dieAverage)) return dieAverage;

  const cpuReadings = Object.entries(sensors)
    .filter(([name]) => /^CPU (?:Performance|Super|Efficiency) (?:Core|Cluster)/i.test(name))
    .map(([, sensor]) => sensor.quantity)
    .filter(validTemperature);

  if (cpuReadings.length === 0) return null;
  return cpuReadings.reduce((sum, value) => sum + value, 0) / cpuReadings.length;
}

function ismcPath(): string {
  const resourceRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(resourceRoot, 'resources', 'native', 'ismc', 'iSMC');
}

export async function readMacCpuTemperature(): Promise<number | null> {
  if (process.platform !== 'darwin') return null;

  try {
    const { stdout } = await execFileAsync(ismcPath(), ['temp', '-o', 'json'], {
      timeout: 1500,
      maxBuffer: 1024 * 1024,
    });
    return parseIsmcCpuTemperature(stdout);
  } catch {
    return null;
  }
}
