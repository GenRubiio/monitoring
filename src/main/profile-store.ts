import { randomUUID } from 'node:crypto';
import type { SshProfile, SshProfileInput } from '../shared/types';

// electron-store v8 is CommonJS-only. Import via require to avoid ESM interop
// issues. DO NOT upgrade to v10+ (ESM-only) without converting the project.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Store = require('electron-store');

interface StoreSchema {
  profiles: SshProfile[];
  activeProfileId: string | null;
}

interface StoreLike {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
}

const DEFAULT_PORT = 22;

// Normalize a port to a valid integer in 1..65535, defaulting to 22.
export function normalizePort(port: number | undefined): number {
  if (
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  ) {
    return port;
  }
  return DEFAULT_PORT;
}

export class ProfileStore {
  private store: StoreLike;

  constructor(store?: StoreLike) {
    this.store =
      store ??
      (new Store({
        name: 'config',
        defaults: { profiles: [], activeProfileId: null },
      }) as StoreLike);
  }

  // Create (no id) or update-in-place (existing id) a profile. Returns the
  // resulting persisted SshProfile with a stable id and normalized port.
  upsert(input: SshProfileInput): SshProfile {
    const profiles = this.store.get('profiles');
    const port = normalizePort(input.port);

    if (input.id) {
      const idx = profiles.findIndex((p) => p.id === input.id);
      if (idx !== -1) {
        const updated: SshProfile = {
          id: input.id,
          name: input.name,
          host: input.host,
          port,
          username: input.username,
          password: input.password,
        };
        const next = profiles.slice();
        next[idx] = updated;
        this.store.set('profiles', next);
        return updated;
      }
    }

    const created: SshProfile = {
      id: randomUUID(),
      name: input.name,
      host: input.host,
      port,
      username: input.username,
      password: input.password,
    };
    this.store.set('profiles', [...profiles, created]);
    return created;
  }

  // Remove a profile by id. Returns true if a profile was found and removed.
  remove(id: string): boolean {
    const profiles = this.store.get('profiles');
    const next = profiles.filter((p) => p.id !== id);
    if (next.length === profiles.length) {
      return false;
    }
    this.store.set('profiles', next);
    if (this.store.get('activeProfileId') === id) {
      this.store.set('activeProfileId', null);
    }
    return true;
  }

  // Return a copy of the stored profiles.
  list(): SshProfile[] {
    return this.store.get('profiles').slice();
  }

  getById(id: string): SshProfile | null {
    return this.store.get('profiles').find((p) => p.id === id) ?? null;
  }

  setActiveProfileId(id: string | null): void {
    this.store.set('activeProfileId', id);
  }

  getActiveProfileId(): string | null {
    return this.store.get('activeProfileId');
  }
}
