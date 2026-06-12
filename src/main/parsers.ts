// Pure parsers for remote Linux command output. No SSH or Node runtime
// dependencies so they are trivially unit-testable.

// Compute CPU busy percentage from two consecutive `/proc/stat` reads.
//
// The first line of /proc/stat looks like:
//   cpu  user nice system idle iowait irq softirq steal guest guest_nice
// Busy = total - idle (idle includes idle + iowait). We compute the busy
// delta between the two samples over the total delta.
export function parseProcStat(sample1: string, sample2: string): number {
  const a = readCpuLine(sample1);
  const b = readCpuLine(sample2);
  if (!a || !b) return 0;

  const totalDelta = b.total - a.total;
  const idleDelta = b.idle - a.idle;
  if (totalDelta <= 0) return 0;

  const busyFraction = (totalDelta - idleDelta) / totalDelta;
  const percent = Math.round(busyFraction * 100);
  return Math.min(100, Math.max(0, percent));
}

function readCpuLine(
  sample: string,
): { total: number; idle: number } | null {
  // The aggregate line begins with "cpu " (two spaces in real output, but we
  // match a single leading token "cpu" followed by whitespace).
  const target = sample
    .split('\n')
    .find((l) => /^cpu\s/.test(l.trim()) && l.trim().startsWith('cpu '));
  if (!target) return null;

  const parts = target.trim().split(/\s+/).slice(1).map(Number);
  if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) return null;

  const [user, nice, system, idle, iowait = 0] = parts;
  const total = parts.reduce((sum, n) => sum + n, 0);
  return { total, idle: idle + iowait };
}

// Parse `free -b` output. The second line (after the header) holds memory:
//   Mem:  total used free shared buff/cache available
// Returns total and used in bytes.
export function parseFreeBytes(
  output: string,
): { total: number; used: number } {
  const lines = output.split('\n');
  const memLine = lines.find((l) => /^Mem:/i.test(l.trim()));
  if (!memLine) return { total: 0, used: 0 };

  const fields = memLine.trim().split(/\s+/);
  // fields[0] = "Mem:", [1] = total, [2] = used
  const total = Number(fields[1]);
  const used = Number(fields[2]);
  return {
    total: Number.isNaN(total) ? 0 : total,
    used: Number.isNaN(used) ? 0 : used,
  };
}

// Parse `sensors` output for a CPU temperature in Celsius. Looks for the first
// "+NN.N°C" style reading (commonly the Package/Core line). Returns null when
// no temperature is found.
export function parseSensorsTemp(output: string): number | null {
  if (!output) return null;
  // Prefer a Package/Core/Tdie/Tctl line if present.
  const lines = output.split('\n');
  const preferred = lines.find((l) =>
    /(package id|core 0|tdie|tctl|cpu)/i.test(l),
  );
  const candidates = preferred ? [preferred, ...lines] : lines;

  for (const line of candidates) {
    const match = line.match(/\+?(-?\d+(?:\.\d+)?)\s*°?\s*C/i);
    if (match) {
      const value = Number(match[1]);
      if (!Number.isNaN(value)) return value;
    }
  }
  return null;
}

// Parse `/sys/class/thermal/thermal_zone0/temp` output (millidegrees Celsius
// as an integer). Returns degrees Celsius, or null on failure.
export function parseThermalZoneTemp(output: string): number | null {
  const trimmed = (output ?? '').trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const milli = Number(trimmed);
  if (Number.isNaN(milli)) return null;
  return Math.round((milli / 1000) * 10) / 10;
}
