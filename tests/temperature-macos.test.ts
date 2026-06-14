import { parseIsmcCpuTemperature } from '../src/main/temperature-macos';

jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: jest.fn(() => '/app'),
  },
}));

describe('parseIsmcCpuTemperature', () => {
  it('prefers CPU Die Average', () => {
    const output = JSON.stringify({
      'CPU Die Average': { quantity: 46.95 },
      'CPU Performance Core 1': { quantity: 39 },
    });
    expect(parseIsmcCpuTemperature(output)).toBe(46.95);
  });

  it('averages CPU core and cluster sensors as a fallback', () => {
    const output = JSON.stringify({
      'CPU Performance Core 1': { quantity: 40 },
      'CPU Super Core 1': { quantity: 42 },
      'CPU Performance Cluster Aggregate': { quantity: 41 },
      'CPU Heatpipe': { quantity: 30 },
      'GPU 1': { quantity: 50 },
    });
    expect(parseIsmcCpuTemperature(output)).toBe(41);
  });

  it('returns null for invalid or missing readings', () => {
    expect(parseIsmcCpuTemperature('not json')).toBeNull();
    expect(parseIsmcCpuTemperature('{}')).toBeNull();
  });
});
