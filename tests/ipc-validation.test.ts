// Mock the Electron-bound modules so importing ipc-handlers does not pull in
// the real electron runtime. We only exercise the pure validation contract.
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeHandler: jest.fn(),
    removeAllListeners: jest.fn(),
  },
}));

jest.mock('electron-store', () => {
  return jest.fn().mockImplementation(() => {
    const data: Record<string, unknown> = {
      profiles: [],
      activeProfileId: null,
    };
    return {
      get: (k: string) => data[k],
      set: (k: string, v: unknown) => {
        data[k] = v;
      },
    };
  });
});

jest.mock('../src/main/metrics-local', () => ({
  startLocalMetricsLoop: jest.fn(() => jest.fn()),
}));

jest.mock('../src/main/metrics-remote', () => ({
  remoteMetrics: { attach: jest.fn(), tick: jest.fn(), setActiveProfile: jest.fn() },
  testSshConnection: jest.fn(),
}));

// eslint-disable-next-line import/first
import { __test__ } from '../src/main/ipc-handlers';

const { validateProfileInput, validateDeletePayload } = __test__;

describe('validateProfileInput', () => {
  it('rejects an empty name', () => {
    expect(() =>
      validateProfileInput({
        name: '',
        host: 'h',
        username: 'u',
        password: 'p',
      }),
    ).toThrow(/name is required/);
  });

  it('rejects a missing host', () => {
    expect(() =>
      validateProfileInput({ name: 'n', username: 'u', password: 'p' }),
    ).toThrow(/host is required/);
  });

  it('normalizes an out-of-range port to 22', () => {
    const result = validateProfileInput({
      name: 'n',
      host: 'h',
      port: 70000,
      username: 'u',
      password: 'p',
    });
    expect(result.port).toBe(22);
  });

  it('preserves a valid port', () => {
    const result = validateProfileInput({
      name: 'n',
      host: 'h',
      port: 2222,
      username: 'u',
      password: 'p',
    });
    expect(result.port).toBe(2222);
  });

  it('rejects a non-object input', () => {
    expect(() => validateProfileInput(null)).toThrow(/expected an object/);
  });
});

describe('validateDeletePayload', () => {
  it('rejects an empty id', () => {
    expect(() => validateDeletePayload({ id: '' })).toThrow(/id is required/);
  });

  it('accepts a non-empty id', () => {
    expect(validateDeletePayload({ id: 'abc' })).toEqual({ id: 'abc' });
  });
});
