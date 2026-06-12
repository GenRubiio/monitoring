# Design: electron-system-monitor

## 0. Context and Scope

This design realizes the green-field Electron desktop widget described in
`proposal.md` and constrained by `specs/local-metrics/spec.md` and
`specs/ssh-profiles/spec.md`. The application is a frameless, transparent,
always-on-top macOS widget that shows local and one-remote-server CPU load, RAM,
and CPU temperature, with an SSH profile manager.

The design stays inside the stated MVP scope: one active remote profile at a
time, plain-text credential storage via `electron-store` v8, no encryption,
no history/graphs, no alerting, macOS-only packaging. It does not expand scope
into Phase 2 features (`safeStorage`, key-based UI auth, multi-connection).

Locked stack: Electron Forge + Vite + TypeScript + React 18, `systeminformation`
^5, `ssh2` ^1, `electron-store` ^8 (CJS, pinned). Security defaults are
non-negotiable: `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`.

---

## 1. Architecture Decisions

### 1.1 Three-process split (main / preload / renderer)

Electron's security model and the specs both mandate that all privileged work
(OS metric reads, SSH I/O, file persistence) execute in the **main process**.
The renderer is a sandboxed React UI that holds no Node capabilities. The
**preload** script is the only bridge, exposing a narrow, named API via
`contextBridge`. This is a hard requirement from the "Secure IPC Boundary"
(local-metrics) and "IPC Validation and Security" (ssh-profiles) requirements.

```
+-----------------------------------------------------------+
|  Main process (Node, full privileges)                     |
|   index.ts            app lifecycle, window, error guards |
|   metrics-local.ts    systeminformation 2s poll loop      |
|   metrics-remote.ts   ssh2 Client lifecycle + backoff     |
|   profile-store.ts    electron-store v8 CRUD              |
|   ipc-handlers.ts     ipcMain.handle/on registrations     |
+-------------------------+---------------------------------+
                          | IPC (typed channels)
+-------------------------v---------------------------------+
|  Preload (contextIsolation bridge, no Node in renderer)   |
|   index.ts   contextBridge.exposeInMainWorld('api', {...})|
+-------------------------+---------------------------------+
                          | window.api.* (named functions)
+-------------------------v---------------------------------+
|  Renderer (React 18, sandboxed)                           |
|   App.tsx, components/*, hooks/useMetrics.ts              |
+-----------------------------------------------------------+
```

### 1.2 Push vs. request/response IPC

Two distinct interaction styles, chosen per channel semantics:

- **Push (main -> renderer)** via `webContents.send()` for the 2-second metric
  stream: `metrics:local` and `metrics:remote`. The poll timer lives in main;
  the renderer is a passive subscriber. This satisfies "Periodic Metric Refresh"
  (timer in main) and avoids renderer-driven polling races.
- **Invoke (renderer -> main, awaited)** via `ipcMain.handle` for request/response
  operations that need a return value: `ssh:test`, `profile:save`,
  `profile:delete`, `profile:list`.
- **Send (renderer -> main, fire-and-forget)** via `ipcMain.on` for
  `profile:select`, which switches the actively polled profile.

### 1.3 Channel naming and direction (authoritative contract)

| Channel | Mechanism | Direction | Payload in | Payload out |
|---|---|---|---|---|
| `metrics:local` | `webContents.send` | main -> renderer | — | `MetricsSnapshot` |
| `metrics:remote` | `webContents.send` | main -> renderer | — | `RemoteMetricsSnapshot` |
| `ssh:test` | `handle`/`invoke` | renderer -> main | `SshProfileInput` | `SshTestResult` |
| `profile:save` | `handle`/`invoke` | renderer -> main | `SshProfileInput` | `SshProfile` |
| `profile:delete` | `handle`/`invoke` | renderer -> main | `{ id: string }` | `{ ok: boolean }` |
| `profile:list` | `handle`/`invoke` | renderer -> main | — | `SshProfile[]` |
| `profile:select` | `on`/`send` | renderer -> main | `{ id: string \| null }` | — |

Channel names are centralized as string constants in a shared module
(`src/shared/channels.ts`) so main, preload, and renderer cannot drift.

### 1.4 Shared types module

A `src/shared/` directory holds framework-agnostic TypeScript types and channel
constants imported by all three process bundles. It contains no runtime Electron
or Node imports so it is safe to include in the sandboxed renderer bundle. This
prevents type duplication across the IPC boundary.

### 1.5 Single active remote profile

Per the ssh-profiles "Active Profile Selection" requirement, `metrics-remote.ts`
holds at most one live `ssh2.Client` plus its backoff state. Switching profiles
tears down the old client before starting the new one. There is no connection
pool in the MVP.

---

## 2. Data Flow

### 2.1 Local metrics (push, every 2 s)

```
setInterval(2000) in metrics-local.ts
  -> await si.currentLoad()  -> currentLoad (%)
  -> await si.mem()          -> total, used (bytes)
  -> await si.cpuTemperature() -> main (°C | null)
  -> buildMetricsSnapshot()  -> MetricsSnapshot (bytes->GB at render, temp null-safe)
  -> mainWindow.webContents.send('metrics:local', snapshot)
        -> preload onMetricsLocal(cb) listener
              -> useMetrics() React hook setState
                    -> MetricsWidget re-renders local card
```

Each tick is wrapped in try/catch. A thrown/rejected `systeminformation` call is
caught, logged, and converted into a snapshot with `error` set, then still sent
so the UI can show an error badge. The timer itself is never torn down by a
single failed tick (satisfies "Resilient Error Handling" / "Metric collection
error does not crash the UI").

### 2.2 Remote metrics (push, every 2 s, gated on active profile)

```
profile:select { id } -> metrics-remote.setActiveProfile(profile)
  -> ensureConnection(): new ssh2.Client().connect({host, port, username, password})
  -> on 'ready': start/confirm the shared 2s tick is collecting remote
  -> per tick (reusing the SAME Client):
        client.exec('cat /proc/stat') x2 sampled -> CPU %
        client.exec('free -b')                   -> RAM total/used
        client.exec(tempCommand)                 -> temp °C | null
     -> RemoteMetricsSnapshot { connectionState, ...metrics }
     -> webContents.send('metrics:remote', snapshot)
  -> on 'error'/'close': connectionState='reconnecting'
        -> send snapshot with that state
        -> scheduleReconnect() exponential backoff 1s,2s,4s... cap 30s
```

The remote poll shares the same 2-second cadence as local (one `setInterval`
that, on each tick, collects local always and remote only when a profile is
active and connected). Reusing one `setInterval` keeps the two streams aligned
and minimizes timer overhead.

CPU on Linux is computed by sampling `/proc/stat` twice with a short delay (or
two consecutive ticks) and computing the busy-delta fraction; `top -bn1` is the
fallback. RAM from `free -b`. Temperature tries `sensors` and falls back to
`/sys/class/thermal/thermal_zone0/temp` (value is millidegrees -> divide by
1000); both failing yields `null` -> "N/A" (satisfies "Remote temperature falls
back to thermal zone").

### 2.3 Profile CRUD (invoke, synchronous from UI perspective)

```
SSHPanel form submit
  -> window.api.saveProfile(input)
       -> ipcRenderer.invoke('profile:save', input)
            -> ipc-handlers validate(input)
                 -> profile-store.upsert(input) (electron-store)
                 -> returns SshProfile (with generated/existing id)
  -> UI refreshes list via window.api.listProfiles()
```

Deletion of the active profile additionally calls
`metrics-remote.setActiveProfile(null)` to tear down the connection and stop
remote pushes (satisfies "Stop Polling on Deletion of Active Profile").

---

## 3. File Changes (exact tree)

All paths relative to the project root
`/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/`. Every file below is
net-new (green-field).

```
.
├── package.json                      # deps locked per proposal §Dependency set
├── tsconfig.json                     # strict mode, "module":"CommonJS" base
├── forge.config.ts                   # Forge makers + VitePlugin entry points
├── vite.main.config.ts               # main bundle (target node, externals)
├── vite.preload.config.ts            # preload bundle
├── vite.renderer.config.ts           # renderer bundle (React plugin)
├── jest.config.ts                    # ts-jest preset, testMatch src/**/*.test.ts
├── index.html                        # renderer HTML entry mounting #root
├── src/
│   ├── shared/
│   │   ├── channels.ts               # IPC channel name constants
│   │   └── types.ts                  # MetricsSnapshot, SshProfile, IPC payloads
│   ├── main/
│   │   ├── index.ts                  # app/window lifecycle, error guards, vibrancy
│   │   ├── window.ts                 # createWidgetWindow() factory (config in §5)
│   │   ├── metrics-local.ts          # systeminformation poll + snapshot builder
│   │   ├── metrics-remote.ts         # ssh2 Client lifecycle, parsers, backoff
│   │   ├── parsers.ts                # pure parse fns (proc/stat, free, temp) — unit tested
│   │   ├── profile-store.ts          # electron-store v8 CRUD + validation
│   │   └── ipc-handlers.ts           # ipcMain.handle/on registrations + arg validation
│   ├── preload/
│   │   └── index.ts                  # contextBridge exposeInMainWorld('api', ...)
│   └── renderer/
│       ├── main.tsx                  # ReactDOM.createRoot(#root).render(<App/>)
│       ├── App.tsx                   # layout switch widget <-> profile panel
│       ├── global.d.ts               # declare window.api typing for renderer
│       ├── hooks/
│       │   └── useMetrics.ts         # subscribe to metrics:local/remote pushes
│       ├── components/
│       │   ├── MetricsWidget.tsx     # local + remote metric cards, drag region
│       │   ├── MetricCard.tsx        # single CPU/RAM/temp display unit
│       │   ├── SSHPanel.tsx          # profile add/edit/delete form
│       │   └── ProfileSelector.tsx   # active-profile dropdown
│       └── styles/
│           └── widget.css            # transparency, drag regions, card layout
└── tests/
    ├── parsers.test.ts               # CPU/RAM/temp parse unit tests
    ├── profile-store.test.ts         # CRUD unit tests (mocked electron-store)
    ├── ipc-validation.test.ts        # handler arg validation unit tests
    └── ssh.integration.test.ts       # gated by SSH_INTEGRATION env flag
```

Note: the proposal's affected-areas table lists `App.tsx`/`components/` directly
under `src/renderer/`; this design keeps the same logical layout and adds
`MetricCard.tsx`, `main.tsx`, `parsers.ts`, `window.ts`, and the `shared/`
module as cohesion refinements. `parsers.ts` is extracted from
`metrics-remote.ts` specifically so parsing logic is pure and unit-testable
without a live SSH connection (directly serving Success Criterion 12).

---

## 4. Module Contracts (TypeScript interfaces)

All interfaces live in `src/shared/types.ts` unless noted.

### 4.1 Metric snapshots

```ts
// A single metric reading, null-safe for temperature.
export interface MetricsSnapshot {
  source: 'local';
  timestamp: number;          // Date.now() at collection
  cpuLoadPercent: number;     // 0..100, rounded for display in UI
  memTotalBytes: number;      // raw bytes from si.mem().total
  memUsedBytes: number;       // raw bytes from si.mem().used
  cpuTempC: number | null;    // null => render "N/A"
  error: string | null;       // non-null when a tick failed; UI shows error badge
}

export type RemoteConnectionState =
  | 'idle'          // no active profile selected
  | 'connecting'    // first connect in progress
  | 'connected'     // ready, polling
  | 'reconnecting'  // dropped, backoff retry loop active
  | 'error';        // unrecoverable auth/host error (test surface)

export interface RemoteMetricsSnapshot {
  source: 'remote';
  profileId: string | null;        // which profile produced this; null when idle
  connectionState: RemoteConnectionState;
  timestamp: number;
  cpuLoadPercent: number | null;   // null while connecting/reconnecting
  memTotalBytes: number | null;
  memUsedBytes: number | null;
  cpuTempC: number | null;         // null => "N/A"
  error: string | null;            // descriptive error string for UI
}
```

### 4.2 SSH profiles

```ts
// Persisted shape (includes id; password plain text per MVP).
export interface SshProfile {
  id: string;            // stable uuid, generated by main on first save
  name: string;          // user-facing label
  host: string;
  port: number;          // defaults to 22 when omitted on input
  username: string;
  password: string;      // PLAIN TEXT in MVP (accepted gap; Phase 2 = safeStorage)
}

// Input from the renderer form. id absent => create; present => update in place.
export interface SshProfileInput {
  id?: string;
  name: string;
  host: string;
  port?: number;         // normalized to 22 in main when missing/invalid
  username: string;
  password: string;
}

export interface SshTestResult {
  ok: boolean;
  error?: string;        // descriptive string when ok === false
}
```

### 4.3 IPC channel constants

```ts
// src/shared/channels.ts
export const CH = {
  METRICS_LOCAL:  'metrics:local',
  METRICS_REMOTE: 'metrics:remote',
  SSH_TEST:       'ssh:test',
  PROFILE_SAVE:   'profile:save',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_LIST:   'profile:list',
  PROFILE_SELECT: 'profile:select',
} as const;
```

### 4.4 Preload-exposed API (the only renderer surface)

```ts
// Shape of window.api — declared in src/renderer/global.d.ts and implemented
// in src/preload/index.ts. NO raw ipcRenderer is exposed.
export interface MonitorApi {
  // push subscriptions; return an unsubscribe fn
  onMetricsLocal(cb: (s: MetricsSnapshot) => void): () => void;
  onMetricsRemote(cb: (s: RemoteMetricsSnapshot) => void): () => void;

  // request/response
  testConnection(input: SshProfileInput): Promise<SshTestResult>;
  saveProfile(input: SshProfileInput): Promise<SshProfile>;
  deleteProfile(id: string): Promise<{ ok: boolean }>;
  listProfiles(): Promise<SshProfile[]>;

  // fire-and-forget
  selectProfile(id: string | null): void;
}
```

The preload wraps `ipcRenderer.on` for push channels and returns a disposer that
calls `ipcRenderer.removeListener`, preventing listener leaks across React
re-mounts. It never returns the `event` object to the renderer callback (only
the validated payload), so `sender`/`ports` cannot leak across the bridge.

### 4.5 Validation contract (ipc-handlers.ts)

Every `handle`/`on` callback validates its argument before acting:

- `SshProfileInput`: `name`, `host`, `username`, `password` are non-empty
  strings; `port` is an integer in `1..65535` or absent (defaults to 22).
- `profile:delete`: `id` is a non-empty string.
- `profile:select`: payload is `{ id: string | null }`.

Invalid input causes `handle` to reject with a typed error (surfaced to the
renderer as a rejected promise) and `on` to no-op-with-log; the main process
never throws past the handler boundary (satisfies "Invalid IPC arguments are
rejected" without crashing main).

---

## 5. Window Configuration

Defined in `src/main/window.ts`, applied at `app.whenReady()`.

```ts
const win = new BrowserWindow({
  width: 280,
  height: 200,
  frame: false,            // no OS title bar/frame
  transparent: true,       // enables rounded corners + vibrancy
  alwaysOnTop: true,
  resizable: false,
  skipTaskbar: true,       // hidden from Dock/taskbar
  hasShadow: false,        // cleaner floating look on macOS
  webPreferences: {
    preload: PRELOAD_PATH,   // injected by Forge Vite plugin
    contextIsolation: true,  // REQUIRED
    nodeIntegration: false,  // REQUIRED
    sandbox: true,           // REQUIRED
  },
});

win.setAlwaysOnTop(true, 'floating');   // floating level, NOT 'screen-saver'
win.setVibrancy('hud');                 // macOS frosted-glass HUD look
win.setWindowButtonVisibility(false);   // hide traffic-light buttons (macOS)
```

- **Always-on-top level**: `'floating'` is used explicitly; `'screen-saver'` is
  forbidden by the spec so the widget stays above normal windows but not over
  fullscreen spaces.
- **Drag region**: handled entirely in CSS (no JS). The widget's outer container
  carries `-webkit-app-region: drag`; all interactive controls (selector,
  buttons, inputs) carry `-webkit-app-region: no-drag`. This satisfies both
  "User drags the widget" and "Interactive controls remain clickable".
- **Vibrancy**: `setVibrancy('hud')` paired with a semi-transparent CSS
  background (`rgba` with alpha) for the frosted look; CSS must not paint a
  fully opaque background or vibrancy is hidden.
- **Linux fallback (defensive, not packaged)**: if `transparent` cannot be
  honored (no compositor), CSS uses a solid semi-opaque fallback via a body
  class; the app must not hard-crash. Out of MVP packaging scope but coded
  defensively.

Error guards in `src/main/index.ts`:

```ts
process.on('uncaughtException', (e) => { log(e); /* keep window alive */ });
process.on('unhandledRejection', (e) => { log(e); });
```

---

## 6. UI Component Structure

```
App.tsx
 ├─ state: view = 'widget' | 'panel'
 ├─ useMetrics() -> { local: MetricsSnapshot|null, remote: RemoteMetricsSnapshot|null }
 │
 ├─ <MetricsWidget>            (view === 'widget')
 │    ├─ drag region container (-webkit-app-region: drag)
 │    ├─ <ProfileSelector>     (no-drag) active-profile dropdown + gear button
 │    ├─ Local section:
 │    │    ├─ <MetricCard label="CPU"  value={cpu%} />
 │    │    ├─ <MetricCard label="RAM"  value="used / total GB" />
 │    │    └─ <MetricCard label="Temp" value={tempC ?? "N/A"} />
 │    └─ Remote section:
 │         ├─ connection badge (connected / reconnecting / idle / error)
 │         └─ same three <MetricCard>s (values null -> "—" while connecting)
 │
 └─ <SSHPanel>                 (view === 'panel', no-drag)
      ├─ profile list with edit/delete buttons
      ├─ form: name, host, port(=22), username, password
      ├─ "Test connection" button -> window.api.testConnection -> result banner
      └─ "Save" / "Cancel" -> window.api.saveProfile / back to widget
```

- **MetricsWidget**: pure presentation of `MetricsSnapshot` /
  `RemoteMetricsSnapshot`. Owns the drag region. Bytes are converted to GB here
  (`bytes / 1024**3`, fixed to 1 decimal). Temperature renders `"N/A"` when
  `cpuTempC === null`.
- **MetricCard**: stateless `{ label, value, unit? }` display unit; keeps card
  styling in one place and is trivially testable.
- **ProfileSelector**: reads `listProfiles()`, renders a dropdown, calls
  `selectProfile(id)` on change; `selectProfile(null)` clears the target. A gear
  button toggles `view` to `'panel'`.
- **SSHPanel**: full CRUD form. On submit calls `saveProfile`; on delete calls
  `deleteProfile`. Shows test-connection result inline. Marked `no-drag` so all
  fields are usable.
- **useMetrics hook**: on mount subscribes to both push channels via
  `window.api.onMetricsLocal`/`onMetricsRemote`, stores latest snapshots in
  state, and returns the disposers in a cleanup function to avoid leaks.

---

## 7. Trade-offs (required: design.require_tradeoffs)

### 7.1 SSH library: `ssh2` vs. `node-ssh`

- **`node-ssh`** is a friendlier promise wrapper over `ssh2` with simpler
  `execCommand`. But it abstracts away the raw `Client` event lifecycle
  (`ready`/`error`/`close`) that we need for explicit connection reuse and custom
  exponential-backoff reconnection.
- **`ssh2`** gives direct control over a single persistent `Client`, its events,
  and `exec` streams — exactly what "Persistent connection reused across ticks"
  and "Reconnection With Backoff" require.
- **Decision: `ssh2`.** The MVP needs lifecycle control more than ergonomic
  sugar; the slightly more verbose code is contained in `metrics-remote.ts`.
  `node-ssh` would push reconnection logic into territory it does not expose
  cleanly.

### 7.2 Credential storage: `electron-store` v8 (CJS) vs. v10 (ESM)

- **v10+** is ESM-only and would require converting the whole project to
  `"type": "module"`, which conflicts with Electron Forge's default CJS main
  output and complicates the Vite main/preload bundling.
- **v8** is CommonJS and drops in with zero module-system churn.
- **Decision: pin `electron-store` ^8.** Mandated by spec ("MUST use v8, MUST
  NOT use v10+ in MVP"). The ESM migration is a deliberate Phase 2 item. Cost:
  we forego v10 features (none needed for MVP). Benefit: a working CJS build now.

### 7.3 Credential protection: plain text vs. `safeStorage`

- **`safeStorage`** (Keychain on macOS) is the secure answer but adds
  encrypt/decrypt round-trips, a migration path, and Linux/CI fragility
  (libsecret may be absent in headless environments).
- **Plain text** in `config.json` is readable by any same-user process — a real,
  High-severity gap.
- **Decision: plain text for MVP, documented as an explicitly accepted gap.**
  The spec defers `safeStorage` to Phase 2, and the rollback plan notes the
  migration can supplement (not delete) plain-text values, so MVP behavior stays
  recoverable. We isolate all reads/writes in `profile-store.ts` so Phase 2 only
  touches one module.

### 7.4 UI framework: React 18 vs. Svelte

- **Svelte** produces smaller bundles and less boilerplate for a tiny widget.
- **React 18** is the locked stack, has the broadest Electron+Vite tooling, and
  the team's typing/hooks model maps cleanly onto the push-subscription pattern
  (`useMetrics`).
- **Decision: React 18.** Mandated by constraints; bundle size is negligible for
  a single-window widget, and tooling maturity (Forge Vite React template,
  `@types/react`) reduces setup risk.

### 7.5 Remote CPU sampling: `/proc/stat` delta vs. `top -bn1`

- **`top -bn1`** is one command but its single-shot CPU figure is noisy/locale-
  dependent and harder to parse robustly across distros.
- **`/proc/stat` two-sample delta** is deterministic, parseable as integers, and
  needs no extra packages.
- **Decision: `/proc/stat` delta as primary, `top -bn1` as fallback.** Slightly
  more SSH round-trips but far more reliable parsing — and the parser is pure and
  unit-testable in `parsers.ts`.

### 7.6 Metric timers: one shared interval vs. two independent intervals

- **Two intervals** (local + remote) are simpler to reason about per stream but
  can drift apart and double timer overhead.
- **One shared 2 s interval** that always collects local and conditionally
  collects remote keeps streams aligned and minimizes wakeups (supports the <5%
  idle CPU non-functional target).
- **Decision: one shared interval** in main, with remote collection guarded by
  `activeProfile && connectionState === 'connected'`.

---

## 8. Rollout (local dev)

This is a green-field, local-only MVP; rollout is the developer bring-up
sequence, not a production deploy.

### 8.1 Bootstrap

```bash
cd /Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring
# Scaffold Forge + Vite + TS, then add React + runtime deps:
npx create-electron-app@latest . --template=vite-typescript   # or scaffold in place
npm install react@^18.3.0 react-dom@^18.3.0 \
            systeminformation@^5.23.0 ssh2@^1.16.0 electron-store@^8.2.0
npm install -D @types/react@^18.3.0 @types/react-dom@^18.3.0 \
            @types/node@^20 @types/ssh2@^1.15.0 \
            jest@^29 ts-jest@^29 typescript@^5.4 \
            @electron-forge/plugin-vite@^7.5.0 @electron/rebuild@^3.6.0
```

`electron-store` MUST resolve to `^8.x`; verify with `npm ls electron-store`.
Do not let it float to v10+.

### 8.2 Wire the three Vite configs + Forge

- `vite.main.config.ts`: target Node, mark `electron`, `ssh2`, `systeminformation`,
  `electron-store` as externals (do not bundle native/CJS into main).
- `vite.preload.config.ts`: build preload as CJS, externalize `electron`.
- `vite.renderer.config.ts`: enable `@vitejs/plugin-react`.
- `forge.config.ts`: register `VitePlugin` with the three config entry points and
  the maker for macOS (`@electron-forge/maker-zip` / `maker-dmg` as needed).

### 8.3 Run

```bash
npm start            # electron-forge start -> dev window with HMR
```

Verify Success Criteria 1–3 manually: frameless transparent floating window,
local CPU/RAM/temp(or N/A), values updating every 2 s.

### 8.4 SSH path verification

In the panel, add host `192.168.100.56`, user `ubuntu`, password `ubuntu`, save,
select it. Remote metrics should appear within 5 s (Criterion 5). Kill/restore
network to confirm the "reconnecting" badge and auto-resume (Criterion 6).

### 8.5 Tests

```bash
npm test                              # jest unit: parsers, profile CRUD, ipc validation
SSH_INTEGRATION=1 npm test            # also runs ssh.integration.test.ts (server must be up)
npx tsc --noEmit                      # Criterion 14: zero TS errors
```

### 8.6 Package (macOS)

```bash
npm run make                          # electron-forge make -> .app / .dmg / .zip
```

No native rebuild needed for MVP (`systeminformation` and `ssh2` are pure JS in
standard use). If macOS temperature sensors are added in Phase 2, run
`npx electron-rebuild` (Forge handles this during `make`).

---

## 9. Traceability to Specs

| Spec requirement | Design coverage |
|---|---|
| Floating Always-On-Top Window | §5 window config, `'floating'` level |
| Draggable Widget Surface | §5 CSS drag/no-drag, §6 MetricsWidget |
| Local CPU / RAM / Temp display | §2.1, §4.1 MetricsSnapshot, §6 MetricCard |
| Optional CPU temperature | `cpuTempC: number \| null` -> "N/A" (§4.1, §6) |
| Periodic Metric Refresh (2 s, main) | §1.2, §2.1, §7.6 shared interval |
| Secure IPC Boundary | §1.1, §4.4 named API, §5 webPreferences |
| Resilient Error Handling | §2.1 try/catch tick, §5 process guards |
| Profile CRUD | §2.3, §4.2, §4.5 validation |
| Credential persistence (v8, plain) | §4.2, §7.2, §7.3 |
| Active Profile Selection (single) | §1.5, §2.2 setActiveProfile |
| Connection Test | §4.4 testConnection, `ssh:test` |
| Remote Metric Collection (persistent) | §2.2, §7.1, §7.5 parsers |
| Reconnection With Backoff | §2.2 scheduleReconnect 1/2/4...30 s |
| Stop Polling on Deletion of Active | §2.3 setActiveProfile(null) on delete |
| IPC Validation and Security | §4.5, §1.1 |
```

