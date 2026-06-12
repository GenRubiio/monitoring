import { ProfileStore, normalizePort } from '../src/main/profile-store';
import type { SshProfile } from '../src/shared/types';

// Minimal in-memory fake of the electron-store surface the ProfileStore uses.
interface Schema {
  profiles: SshProfile[];
  activeProfileId: string | null;
}

function makeFakeStore(): {
  get<K extends keyof Schema>(key: K): Schema[K];
  set<K extends keyof Schema>(key: K, value: Schema[K]): void;
} {
  const data: Schema = { profiles: [], activeProfileId: null };
  return {
    get: (key) => data[key],
    set: (key, value) => {
      data[key] = value;
    },
  };
}

describe('normalizePort', () => {
  it('defaults to 22 when missing or out of range', () => {
    expect(normalizePort(undefined)).toBe(22);
    expect(normalizePort(0)).toBe(22);
    expect(normalizePort(70000)).toBe(22);
    expect(normalizePort(2222)).toBe(2222);
  });
});

describe('ProfileStore', () => {
  it('upsert creates a new profile with generated id and default port', () => {
    const store = new ProfileStore(makeFakeStore());
    const created = store.upsert({
      name: 'srv',
      host: '192.168.100.56',
      username: 'ubuntu',
      password: 'ubuntu',
    });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.port).toBe(22);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].host).toBe('192.168.100.56');
  });

  it('upsert updates an existing profile in place without duplicating', () => {
    const store = new ProfileStore(makeFakeStore());
    const created = store.upsert({
      name: 'srv',
      host: 'h1',
      username: 'u',
      password: 'p',
    });
    const updated = store.upsert({
      id: created.id,
      name: 'srv-renamed',
      host: 'h2',
      port: 2200,
      username: 'u',
      password: 'p',
    });
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe('srv-renamed');
    expect(updated.host).toBe('h2');
    expect(updated.port).toBe(2200);
    expect(store.list()).toHaveLength(1);
  });

  it('remove deletes by id and reports whether it existed', () => {
    const store = new ProfileStore(makeFakeStore());
    const created = store.upsert({
      name: 'srv',
      host: 'h',
      username: 'u',
      password: 'p',
    });
    expect(store.remove('nonexistent')).toBe(false);
    expect(store.remove(created.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it('remove clears the active profile id when deleting the active profile', () => {
    const store = new ProfileStore(makeFakeStore());
    const created = store.upsert({
      name: 'srv',
      host: 'h',
      username: 'u',
      password: 'p',
    });
    store.setActiveProfileId(created.id);
    store.remove(created.id);
    expect(store.getActiveProfileId()).toBeNull();
  });

  it('list returns a copy, not the internal array', () => {
    const store = new ProfileStore(makeFakeStore());
    store.upsert({ name: 'srv', host: 'h', username: 'u', password: 'p' });
    const a = store.list();
    a.pop();
    expect(store.list()).toHaveLength(1);
  });
});
