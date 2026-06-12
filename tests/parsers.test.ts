import {
  parseProcStat,
  parseFreeBytes,
  parseSensorsTemp,
  parseThermalZoneTemp,
} from '../src/main/parsers';

describe('parseProcStat', () => {
  it('computes CPU busy percentage from two samples', () => {
    // sample1: cpu user=100 nice=0 system=100 idle=800 iowait=0 -> total 1000, idle 800
    // sample2: cpu user=200 nice=0 system=200 idle=1200 iowait=0 -> total 1600, idle 1200
    // totalDelta = 600, idleDelta = 400, busy = (600-400)/600 = 33.33% -> 33
    const s1 = 'cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 100 0 100 800 0 0 0 0 0 0';
    const s2 = 'cpu  200 0 200 1200 0 0 0 0 0 0\ncpu0 200 0 200 1200 0 0 0 0 0 0';
    expect(parseProcStat(s1, s2)).toBe(33);
  });

  it('returns 100 when all delta time is busy', () => {
    const s1 = 'cpu  100 0 100 500 0 0 0 0 0 0';
    const s2 = 'cpu  300 0 300 500 0 0 0 0 0 0'; // idle unchanged, busy +400
    expect(parseProcStat(s1, s2)).toBe(100);
  });

  it('returns 0 when there is no positive total delta', () => {
    const s1 = 'cpu  100 0 100 800 0 0 0 0 0 0';
    expect(parseProcStat(s1, s1)).toBe(0);
  });
});

describe('parseFreeBytes', () => {
  it('parses total and used bytes from free -b output', () => {
    const out = [
      '               total        used        free      shared  buff/cache   available',
      'Mem:     16777216000  8388608000  2000000000   100000000  6388608000  8000000000',
      'Swap:     2147483648           0  2147483648',
    ].join('\n');
    expect(parseFreeBytes(out)).toEqual({
      total: 16777216000,
      used: 8388608000,
    });
  });

  it('returns zeros when no Mem line is present', () => {
    expect(parseFreeBytes('garbage output')).toEqual({ total: 0, used: 0 });
  });
});

describe('parseSensorsTemp', () => {
  it('extracts a temperature from sensors output', () => {
    const out = [
      'coretemp-isa-0000',
      'Package id 0:  +45.0°C  (high = +84.0°C, crit = +100.0°C)',
      'Core 0:        +43.0°C',
    ].join('\n');
    expect(parseSensorsTemp(out)).toBe(45);
  });

  it('returns null for empty or non-temperature output', () => {
    expect(parseSensorsTemp('')).toBeNull();
    expect(parseSensorsTemp('no temperature data here')).toBeNull();
  });
});

describe('parseThermalZoneTemp', () => {
  it('converts millidegrees to degrees Celsius', () => {
    expect(parseThermalZoneTemp('52000')).toBe(52);
    expect(parseThermalZoneTemp('45500\n')).toBe(45.5);
  });

  it('returns null for non-integer output', () => {
    expect(parseThermalZoneTemp('N/A')).toBeNull();
    expect(parseThermalZoneTemp('')).toBeNull();
  });
});
