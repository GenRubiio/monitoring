# Tasks: electron-system-monitor

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 950–1 150 (green-field; all files are net-new) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Slice 1) → PR 2 (Slice 2) → PR 3 (Slice 3) → PR 4 (Slice 4) → PR 5 (Slice 5) |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

```
Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High
```

Each slice is an independent, reviewable work unit that lands directly on `main` after the preceding slice. No feature-branch tracker is needed because each slice is self-contained and the project has no pre-existing code to protect.

---

## Dependency diagram

```
[Slice 1 — scaffold + shared] 📍 (first; no deps)
        |
[Slice 2 — main local metrics + preload bridge]
        |
[Slice 3 — main SSH profile store + remote metrics]
        |
[Slice 4 — renderer React UI]
        |
[Slice 5 — polish: error handling, reconnect, packaging]
```

---

## Slice 1 — Project scaffold + shared types + window config

**Boundary**: repo skeleton is absent; after this slice the project builds (`npm start` opens a blank window) and all shared contracts are in place.
**Estimated lines**: ~250–300
**Out of scope for this slice**: all feature logic (metrics, SSH, React UI, tests).

### Task 1.1 — [x] Bootstrap Electron Forge + Vite + TypeScript project

**Description**: Initialise the project at `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/` using Electron Forge with the `vite-typescript` template. Verify the scaffold compiles and the default window opens.

**Steps**:
1. Run `npx create-electron-app@latest . --template=vite-typescript` inside the working directory (or scaffold manually if the directory already contains files that would conflict).
2. Confirm `package.json` contains `@electron-forge/cli`, `electron`, `typescript`, `vite`, and the `@electron-forge/plugin-vite` entries.
3. Run `npm start` — the Forge dev window must open without errors.

**Files to create/modify**:
- `package.json` — add / pin runtime + dev deps per locked dependency set in `proposal.md §Dependency set`
- `tsconfig.json` — set `strict: true`, `module: CommonJS`, `target: ES2020`, `esModuleInterop: true`
- `forge.config.ts` — register `VitePlugin` with three entry points (main / preload / renderer)
- `vite.main.config.ts` — target `node`, externalize `electron`, `ssh2`, `systeminformation`, `electron-store`
- `vite.preload.config.ts` — build format `cjs`, externalize `electron`
- `vite.renderer.config.ts` — enable `@vitejs/plugin-react`
- `index.html` — renderer HTML entry mounting `<div id="root">`
- `jest.config.ts` — `ts-jest` preset, `testMatch: ['tests/**/*.test.ts']`

**Estimated lines**: ~120–150

**Spec traceability**:
- proposal §Dependency set (locked deps)
- local-metrics: Secure IPC Boundary (webPreferences wired in this task)
- Success Criterion 14 (zero TS errors — tsconfig strict mode)
- Success Criterion 15 (contextIsolation/nodeIntegration/sandbox set at window creation level, confirmed in Task 1.3)

**Dependencies**: none

---

### Task 1.2 — [x] Create `src/shared/` contracts (types + channel constants)

**Description**: Write the two shared modules that every other module imports. These files contain no runtime Electron or Node imports and are safe for all three process bundles.

**Files to create**:
- `src/shared/channels.ts` — `CH` constant object with all seven IPC channel name strings (`metrics:local`, `metrics:remote`, `ssh:test`, `profile:save`, `profile:delete`, `profile:list`, `profile:select`)
- `src/shared/types.ts` — `MetricsSnapshot`, `RemoteConnectionState`, `RemoteMetricsSnapshot`, `SshProfile`, `SshProfileInput`, `SshTestResult`, `MonitorApi` interfaces exactly as specified in design §4.1–4.4

**Estimated lines**: ~70–90

**Spec traceability**:
- design §1.3 (channel naming contract)
- design §4.1 (MetricsSnapshot, RemoteMetricsSnapshot)
- design §4.2 (SshProfile, SshProfileInput, SshTestResult)
- design §4.3 (IPC channel constants)
- design §4.4 (MonitorApi)

**Dependencies**: Task 1.1 (tsconfig must be in place for TS to resolve)

---

### Task 1.3 — [x] `src/main/window.ts` + `src/main/index.ts` (window lifecycle, error guards)

**Description**: Implement the BrowserWindow factory and the app lifecycle entry point. The window opens; the renderer shows the placeholder `index.html`.

**Files to create**:
- `src/main/window.ts` — `createWidgetWindow()` returning a `BrowserWindow` configured exactly per design §5 (`frame: false`, `transparent: true`, `alwaysOnTop: true`, `resizable: false`, `skipTaskbar: true`, `hasShadow: false`, `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: PRELOAD_PATH }`). Call `win.setAlwaysOnTop(true, 'floating')`, `win.setVibrancy('hud')`, `win.setWindowButtonVisibility(false)`.
- `src/main/index.ts` — `app.whenReady()` call to `createWidgetWindow()`, `process.on('uncaughtException', ...)`, `process.on('unhandledRejection', ...)` guards per design §5. Standard macOS `activate` / `window-all-closed` lifecycle.

**Estimated lines**: ~60–80

**Spec traceability**:
- local-metrics: Floating Always-On-Top Window (all three scenarios)
- local-metrics: Secure IPC Boundary — Security defaults preserved scenario (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`)
- local-metrics: Resilient Error Handling (process guards)
- Success Criteria 1, 2, 10, 15

**Dependencies**: Task 1.1, Task 1.2

---

## Slice 2 — Main process: local metrics IPC + preload bridge

**Boundary**: local CPU/RAM/temp values flow from main to renderer every 2 s; the preload bridge is complete; the renderer can subscribe via `window.api`.
**Estimated lines**: ~200–250
**Out of scope for this slice**: SSH/remote metrics, React UI components.

### Task 2.1 — [x] `src/main/metrics-local.ts` (systeminformation poll)

**Description**: Implement the 2-second poll loop that collects local metrics using `systeminformation` and pushes snapshots via `webContents.send()`.

**Implementation notes**:
- Import `CH` from `src/shared/channels.ts` for the channel name.
- Export `startLocalMetricsLoop(win: BrowserWindow): () => void` — starts `setInterval(2000)`, returns a stop fn.
- Each tick: `await si.currentLoad()`, `await si.mem()`, `await si.cpuTemperature()` — wrap entirely in `try/catch`; on error, set `error` field on snapshot and still send (never rethrow past the tick).
- Build `MetricsSnapshot` per design §4.1: `source: 'local'`, `timestamp: Date.now()`, `cpuLoadPercent` from `currentLoad.currentLoad`, `memTotalBytes`/`memUsedBytes` from `mem.total`/`mem.used`, `cpuTempC: cpuTemperature.main ?? null`.

**Files to create**:
- `src/main/metrics-local.ts`

**Estimated lines**: ~60–75

**Spec traceability**:
- local-metrics: Local CPU Load Display
- local-metrics: Local RAM Display
- local-metrics: Optional Local CPU Temperature Display (both scenarios)
- local-metrics: Periodic Metric Refresh (timer in main, push via `metrics:local`)
- local-metrics: Resilient Error Handling — Metric collection error does not crash the UI

**Dependencies**: Slice 1 complete

---

### Task 2.2 — [x] `src/preload/index.ts` (contextBridge API)

**Description**: Expose the `MonitorApi` via `contextBridge.exposeInMainWorld('api', {...})`. This is the only surface the renderer will ever see.

**Implementation notes**:
- `onMetricsLocal(cb)`: calls `ipcRenderer.on(CH.METRICS_LOCAL, (_event, s) => cb(s))`, returns a disposer that calls `ipcRenderer.removeListener`.
- `onMetricsRemote(cb)`: same pattern for `CH.METRICS_REMOTE`.
- `testConnection(input)`: `ipcRenderer.invoke(CH.SSH_TEST, input)`.
- `saveProfile(input)`: `ipcRenderer.invoke(CH.PROFILE_SAVE, input)`.
- `deleteProfile(id)`: `ipcRenderer.invoke(CH.PROFILE_DELETE, { id })`.
- `listProfiles()`: `ipcRenderer.invoke(CH.PROFILE_LIST)`.
- `selectProfile(id)`: `ipcRenderer.send(CH.PROFILE_SELECT, { id })`.
- The raw `ipcRenderer` object MUST NOT be exposed. The `event` object MUST NOT be passed to callbacks.

**Files to create**:
- `src/preload/index.ts`

**Estimated lines**: ~50–65

**Spec traceability**:
- local-metrics: Secure IPC Boundary — Renderer cannot access system APIs directly; Security defaults preserved
- ssh-profiles: IPC Validation and Security — SSH logic stays in the main process
- design §4.4 (MonitorApi shape)

**Dependencies**: Task 1.2 (types + channel constants)

---

### Task 2.3 — [x] Wire `ipc-handlers.ts` for local metrics and register in `index.ts`

**Description**: Create `src/main/ipc-handlers.ts` with `registerIpcHandlers(win)`. For this slice, only register the local-metrics push start (by calling `startLocalMetricsLoop`). The SSH/profile handlers will be added in Slice 3.

**Implementation notes**:
- `registerIpcHandlers(win: BrowserWindow)` — exported function called from `index.ts` after window is created.
- In this slice it calls `startLocalMetricsLoop(win)`.
- Extend `src/main/index.ts` to import and call `registerIpcHandlers(win)`.

**Files to create/modify**:
- `src/main/ipc-handlers.ts` (create)
- `src/main/index.ts` (modify — add `registerIpcHandlers` call)

**Estimated lines**: ~25–35

**Spec traceability**:
- local-metrics: Periodic Metric Refresh
- local-metrics: Secure IPC Boundary

**Dependencies**: Task 2.1, Task 2.2

---

### Task 2.4 — [x] Renderer entry + minimal `useMetrics` hook + placeholder `App.tsx`

**Description**: Add the minimum renderer scaffolding so that `window.api.onMetricsLocal` can be exercised and verified in the browser console during dev.

**Files to create**:
- `src/renderer/main.tsx` — `ReactDOM.createRoot(document.getElementById('root')!).render(<App />)`
- `src/renderer/global.d.ts` — `declare global { interface Window { api: MonitorApi } }` using the `MonitorApi` type from `src/shared/types.ts`
- `src/renderer/hooks/useMetrics.ts` — subscribes on mount to `window.api.onMetricsLocal` and `window.api.onMetricsRemote`, stores latest snapshots in state, returns disposers in cleanup; returns `{ local, remote }` state
- `src/renderer/App.tsx` — placeholder: renders raw `JSON.stringify` of the `local` snapshot so the data flow is visually verifiable; full UI comes in Slice 4

**Estimated lines**: ~50–65

**Spec traceability**:
- local-metrics: Periodic Metric Refresh — widget updates on each push
- local-metrics: Secure IPC Boundary — renderer accesses metrics only through named API
- design §4.4 (MonitorApi)

**Dependencies**: Task 2.2, Task 2.3

---

## Slice 3 — Main process: SSH profile store + remote metrics IPC

**Boundary**: all seven IPC channels are registered and functional; SSH profiles persist; remote metrics flow via `metrics:remote` for an active profile.
**Estimated lines**: ~280–340
**Out of scope for this slice**: React UI components, CSS.

### Task 3.1 — [x] `src/main/profile-store.ts` (electron-store v8 CRUD)

**Description**: Wrap `electron-store` v8 to provide `upsert`, `remove`, and `list` operations for `SshProfile` records. Pure data layer with no IPC coupling.

**Implementation notes**:
- `new Store<{ profiles: SshProfile[] }>({ name: 'config', defaults: { profiles: [] } })`.
- `upsert(input: SshProfileInput): SshProfile` — if `input.id` exists, update in place; otherwise generate a new UUID (`crypto.randomUUID()`), normalise `port` to 22 when missing or out of range, return the full `SshProfile`.
- `remove(id: string): boolean` — delete by id, return `true` if found.
- `list(): SshProfile[]` — return a copy of the array.
- Do NOT import from `electron-store` v10+. Pin: `require('electron-store')`.

**Files to create**:
- `src/main/profile-store.ts`

**Estimated lines**: ~60–75

**Spec traceability**:
- ssh-profiles: SSH Profile Creation, Editing, and Deletion (create, edit, delete scenarios)
- ssh-profiles: Credential Persistence — Profiles survive a restart; CommonJS-compatible store version
- Success Criteria 7, 8

**Dependencies**: Slice 1 complete (types available)

---

### Task 3.2 — [x] `src/main/parsers.ts` (pure Linux metric parsers)

**Description**: Pure functions that parse text output from remote Linux commands into metric values. Extracted from `metrics-remote.ts` so they are unit-testable without a live SSH connection.

**Functions to implement**:
- `parseProcStat(sample1: string, sample2: string): number` — compute CPU busy fraction from two `/proc/stat` reads (delta of `user+nice+system` vs total jiffies), return 0–100 rounded.
- `parseFreeBytes(output: string): { total: number; used: number }` — parse `free -b` stdout (second line, fields 1 and 2).
- `parseSensorsTemp(output: string): number | null` — parse `sensors` stdout for a temperature float; return `null` if not found.
- `parseThermalZoneTemp(output: string): number | null` — parse `/sys/class/thermal/thermal_zone0/temp` millidegree integer, divide by 1000; return `null` on failure.

**Files to create**:
- `src/main/parsers.ts`

**Estimated lines**: ~60–75

**Spec traceability**:
- ssh-profiles: Remote Metric Collection — `/proc/stat` for CPU, `free -b` for RAM, `sensors`/thermal zone for temp
- ssh-profiles: Remote Metric Collection — Remote temperature falls back to thermal zone scenario
- Success Criterion 12 (unit-testable parsers)
- design §7.5 (trade-off: /proc/stat delta as primary)

**Dependencies**: Task 1.2 (types)

---

### Task 3.3 — [x] `src/main/metrics-remote.ts` (ssh2 Client lifecycle + backoff)

**Description**: Manage a single persistent `ssh2.Client` for the active profile. Collect remote metrics per tick, push via `webContents.send()`, and reconnect with exponential backoff on drop.

**Implementation notes**:
- Module-level state: `activeProfile: SshProfile | null`, `client: Client | null`, `connectionState: RemoteConnectionState`, `backoffMs: number` (starts at 1000, doubles, caps at 30000).
- `setActiveProfile(win, profile | null)` — tear down existing client + interval guard; if `profile` is non-null call `ensureConnection()`.
- `ensureConnection()` — `new Client()`, call `.connect({host, port, username, password})`, on `'ready'` set state `'connected'`; on `'error'` or `'close'` set state `'reconnecting'`, push snapshot, call `scheduleReconnect()`.
- `scheduleReconnect()` — `setTimeout(ensureConnection, backoffMs)`, then `backoffMs = Math.min(backoffMs * 2, 30000)`. Reset `backoffMs` to 1000 on successful `'ready'`.
- `collectRemoteTick(win)` — execute `/proc/stat` twice (with ~200 ms gap using `client.exec`), `free -b`, and temperature commands using helper `execSsh(client, cmd): Promise<string>`. Call parsers from `parsers.ts`. Build `RemoteMetricsSnapshot`. Send via `win.webContents.send(CH.METRICS_REMOTE, snapshot)`. Wrap in try/catch; on error send error snapshot.
- `startRemoteTickInSharedLoop(win)` — called from the shared 2 s interval when state is `'connected'` and `activeProfile !== null`.
- Temperature: try `sensors` first; on parse failure or exec error, try `cat /sys/class/thermal/thermal_zone0/temp`; on both failures, `cpuTempC: null`.

**Files to create**:
- `src/main/metrics-remote.ts`

**Estimated lines**: ~120–150

**Spec traceability**:
- ssh-profiles: Remote Metric Collection (all scenarios)
- ssh-profiles: Reconnection With Backoff
- ssh-profiles: Active Profile Selection (single profile constraint)
- ssh-profiles: Stop Polling on Deletion of Active Profile
- design §1.5 (single active remote profile)
- design §2.2 (remote data flow)
- design §7.1 (ssh2 trade-off)
- design §7.6 (one shared interval)
- Success Criteria 5, 6

**Dependencies**: Task 3.1, Task 3.2

---

### Task 3.4 — [x] Complete `src/main/ipc-handlers.ts` with profile + SSH handlers

**Description**: Add the remaining five IPC handler registrations to `ipc-handlers.ts`. Each handler validates its arguments before acting.

**Handlers to add**:
- `ipcMain.handle(CH.SSH_TEST, async (_, input) => {...})` — validate `SshProfileInput` fields (non-empty strings, port 1–65535 or absent), open a one-shot `ssh2.Client`, return `SshTestResult`. Reject with typed error on invalid input; never throw past the handler.
- `ipcMain.handle(CH.PROFILE_SAVE, async (_, input) => profileStore.upsert(input))` — validate first.
- `ipcMain.handle(CH.PROFILE_DELETE, async (_, { id }) => { /* validate id; if id === activeProfile, call setActiveProfile(null) */ return { ok: profileStore.remove(id) }; })`.
- `ipcMain.handle(CH.PROFILE_LIST, async () => profileStore.list())`.
- `ipcMain.on(CH.PROFILE_SELECT, (_, { id }) => { const profile = id ? profileStore.list().find(p => p.id === id) ?? null : null; setActiveProfile(win, profile); })`.

**Validation contract** (per design §4.5):
- `SshProfileInput`: `name`, `host`, `username`, `password` non-empty strings; `port` integer 1–65535 or absent (default 22).
- `profile:delete`: `id` non-empty string.
- `profile:select`: payload `{ id: string | null }`.
- Invalid input: `handle` rejects with typed error; `on` no-ops with log.

**Files to modify**:
- `src/main/ipc-handlers.ts` (extend from Slice 2)

**Estimated lines**: ~90–110

**Spec traceability**:
- ssh-profiles: SSH Profile Creation, Editing, and Deletion (all three CRUD scenarios)
- ssh-profiles: Connection Test (success and failure scenarios)
- ssh-profiles: Active Profile Selection
- ssh-profiles: Stop Polling on Deletion of Active Profile
- ssh-profiles: IPC Validation and Security — Invalid IPC arguments are rejected
- design §4.5 (validation contract)
- Success Criterion 15

**Dependencies**: Task 3.1, Task 3.3, Task 2.3

---

## Slice 4 — Renderer: React UI (MetricsWidget, MetricCard, SSHPanel, ProfileSelector)

**Boundary**: the full UI is functional; the widget displays local and remote metrics; the profile panel is usable.
**Estimated lines**: ~250–310
**Out of scope for this slice**: CSS polish (moved to Slice 5 partly), test suite (unit tests added in Slice 5).

### Task 4.1 — [x] `src/renderer/components/MetricCard.tsx` (stateless display unit)

**Description**: Implement the atomic display card. Stateless: receives `label`, `value`, `unit?` as props and renders them in a consistent layout.

**Files to create**:
- `src/renderer/components/MetricCard.tsx`

**Estimated lines**: ~25–35

**Spec traceability**:
- local-metrics: Local CPU Load Display; Local RAM Display; Optional Local CPU Temperature Display
- design §6 (MetricCard stateless unit)

**Dependencies**: Slice 2 complete (renderer entry must exist)

---

### Task 4.2 — [x] `src/renderer/components/MetricsWidget.tsx` (local + remote cards, drag region)

**Description**: Renders local and remote metric sections using `MetricCard`. Owns the drag region container. Converts bytes to GB (`bytes / 1024**3`, one decimal). Renders `"N/A"` when `cpuTempC === null`. Shows `RemoteConnectionState` badge (connected / reconnecting / idle / error) above the remote section. Values are `"—"` while remote is connecting/reconnecting.

**Files to create**:
- `src/renderer/components/MetricsWidget.tsx`

**Estimated lines**: ~70–85

**Spec traceability**:
- local-metrics: Floating Always-On-Top Window — Draggable Widget Surface (CSS drag region, `no-drag` on interactive controls)
- local-metrics: Local CPU Load Display; Local RAM Display; Optional Local CPU Temperature Display
- ssh-profiles: Remote Metric Collection — Remote metrics displayed for active profile
- ssh-profiles: Reconnection With Backoff — reconnecting state visible in renderer
- design §6 (component structure)

**Dependencies**: Task 4.1

---

### Task 4.3 — [x] `src/renderer/components/ProfileSelector.tsx` (active-profile dropdown)

**Description**: Calls `window.api.listProfiles()` on mount, renders a `<select>` with options. On change calls `window.api.selectProfile(id)`. Selecting the empty option calls `window.api.selectProfile(null)`. A gear button toggles `view` to `'panel'` (callback prop from `App`). All controls are `no-drag`.

**Files to create**:
- `src/renderer/components/ProfileSelector.tsx`

**Estimated lines**: ~45–55

**Spec traceability**:
- ssh-profiles: Active Profile Selection (switching active profile scenario, single active profile constraint)
- local-metrics: Draggable Widget Surface — Interactive controls remain clickable

**Dependencies**: Task 4.1

---

### Task 4.4 — [x] `src/renderer/components/SSHPanel.tsx` (profile CRUD form)

**Description**: Full CRUD form. Loads profiles via `window.api.listProfiles()`. Renders list with Edit and Delete buttons per profile. Form fields: name, host, port (default 22), username, password. "Test connection" button calls `window.api.testConnection(input)` and shows result inline. "Save" calls `window.api.saveProfile(input)`, refreshes list. "Delete" calls `window.api.deleteProfile(id)`. "Cancel" toggles view back to widget. All elements are `no-drag`.

**Files to create**:
- `src/renderer/components/SSHPanel.tsx`

**Estimated lines**: ~90–110

**Spec traceability**:
- ssh-profiles: SSH Profile Creation, Editing, and Deletion (all three scenarios)
- ssh-profiles: Connection Test (success and failure scenarios)
- local-metrics: Draggable Widget Surface — Interactive controls remain clickable
- Success Criteria 4, 7, 8

**Dependencies**: Task 4.1

---

### Task 4.5 — [x] `src/renderer/App.tsx` (layout switch + composition)

**Description**: Replace the Slice 2 placeholder with the real root component. Manages `view: 'widget' | 'panel'` state. Uses `useMetrics()` hook. Renders `<MetricsWidget>` when `view === 'widget'` and `<SSHPanel>` when `view === 'panel'`. Passes toggle callback as prop.

**Files to modify**:
- `src/renderer/App.tsx` (replace placeholder from Task 2.4)

**Estimated lines**: ~30–40

**Spec traceability**:
- design §6 (App.tsx layout switch)
- Success Criterion 1 (displays local metrics in floating window)

**Dependencies**: Task 4.2, Task 4.3, Task 4.4

---

## Slice 5 — Polish: error handling, reconnect badge, "N/A" fallback, CSS, tests, packaging config

**Boundary**: all acceptance criteria are met; test suite passes; macOS packaging is configured.
**Estimated lines**: ~180–230
**Note**: this is the final slice. All features must be complete after this PR.

### Task 5.1 — [x] `src/renderer/styles/widget.css` + transparent/drag CSS

**Description**: Write the widget stylesheet. Outer container: `background: rgba(20,20,20,0.6)`, `border-radius`, `-webkit-app-region: drag`. Interactive controls (buttons, inputs, select): `-webkit-app-region: no-drag`. Connection state badge colors. Linux fallback class `body.no-transparency` with solid background. Link in `src/renderer/main.tsx`.

**Files to create/modify**:
- `src/renderer/styles/widget.css` (create)
- `src/renderer/main.tsx` (add CSS import)

**Estimated lines**: ~50–65

**Spec traceability**:
- local-metrics: Draggable Widget Surface (User drags widget; Interactive controls remain clickable)
- design §5 (drag/no-drag CSS, vibrancy)

**Dependencies**: Slice 4 complete

---

### Task 5.2 — [x] Unit tests: `tests/parsers.test.ts`, `tests/profile-store.test.ts`, `tests/ipc-validation.test.ts`

**Description**: Write the three unit test files that satisfy Success Criterion 12.

**`tests/parsers.test.ts`**:
- `parseProcStat`: test with two known `/proc/stat` lines → expected CPU%.
- `parseFreeBytes`: test with a realistic `free -b` output → expected bytes.
- `parseSensorsTemp`: test with sensors output containing a temp float and with empty/malformed output.
- `parseThermalZoneTemp`: test with millidegree integer string; test invalid string returns `null`.

**`tests/profile-store.test.ts`**:
- Mock `electron-store` (jest manual mock or `jest.mock`).
- Test `upsert` creates a new profile with generated id and port defaulting to 22.
- Test `upsert` updates an existing profile in place (no duplicate).
- Test `remove` deletes by id, returns `true`; returns `false` for unknown id.
- Test `list` returns a copy.

**`tests/ipc-validation.test.ts`**:
- Test that a handler receiving empty `name` rejects with a typed error.
- Test that `port` outside 1–65535 is normalized to 22 on `upsert`.
- Test that `profile:delete` with empty `id` is rejected.

**Files to create**:
- `tests/parsers.test.ts`
- `tests/profile-store.test.ts`
- `tests/ipc-validation.test.ts`

**Estimated lines**: ~90–120

**Spec traceability**:
- Success Criterion 12 (unit tests for parsing, CRUD, IPC validation)
- Success Criterion 14 (ts-jest runs under strict tsconfig)

**Dependencies**: Task 3.2 (parsers), Task 3.1 (profile-store), Task 3.4 (validation logic)

---

### Task 5.3 — [x] SSH integration test: `tests/ssh.integration.test.ts`

**Description**: Write the gated integration test for SSH connectivity.

**Implementation notes**:
- Guard: `if (!process.env.SSH_INTEGRATION) { test.skip(...); }` at the top.
- Test: open a one-shot `ssh2.Client` to `192.168.100.56` with `username: 'ubuntu'`, `password: 'ubuntu'`; assert `'ready'` event is received.
- Test: run `free -b` and `cat /proc/stat` via the client; assert `parseFreeBytes` and `parseProcStat` return valid numbers.
- Always call `client.end()` in `afterAll`.

**Files to create**:
- `tests/ssh.integration.test.ts`

**Estimated lines**: ~40–50

**Spec traceability**:
- Success Criterion 13 (SSH integration test against 192.168.100.56, gated by `SSH_INTEGRATION`)

**Dependencies**: Task 3.2, Task 3.3

---

### Task 5.4 — [x] Verify "N/A" fallback paths and reconnect badge end-to-end

**Description**: Audit and harden the two critical display fallbacks in the renderer and main process.

**Checklist (code review + targeted edits)**:
- `MetricsWidget.tsx`: confirm `cpuTempC === null` renders literal string `"N/A"` for both local and remote cards.
- `MetricsWidget.tsx`: confirm `RemoteConnectionState === 'reconnecting'` renders a visible "reconnecting…" badge with distinct styling.
- `MetricsWidget.tsx`: confirm metric values are `"—"` when remote snapshot fields are `null` (connecting/reconnecting states).
- `metrics-local.ts`: confirm temperature null-check on `cpuTemperature.main` produces `cpuTempC: null` in snapshot.
- `metrics-remote.ts`: confirm both `sensors` failure and thermal-zone failure produce `cpuTempC: null`.
- `ipc-handlers.ts`: confirm each `handle` has a top-level try/catch that rejects with a string (not a raw `Error` object) to avoid IPC serialization issues.

**Files to modify** (targeted, surgical edits only):
- `src/renderer/components/MetricsWidget.tsx`
- `src/main/metrics-local.ts`
- `src/main/metrics-remote.ts`
- `src/main/ipc-handlers.ts`

**Estimated lines**: ~20–30 (edits only; existing lines not counted twice)

**Spec traceability**:
- local-metrics: Optional Local CPU Temperature Display — Temperature unavailable scenario
- ssh-profiles: Reconnection With Backoff — reconnecting state in renderer
- ssh-profiles: Remote Metric Collection — Remote temperature falls back to thermal zone
- local-metrics: Resilient Error Handling
- Success Criteria 6, 10

**Dependencies**: Slice 4 complete, Task 5.2

---

### Task 5.5 — [x] macOS packaging config in `forge.config.ts`

**Description**: Ensure `forge.config.ts` is fully configured for macOS distribution.

**Implementation notes**:
- Add `@electron-forge/maker-zip` for a universal macOS `.zip`.
- Optionally add `@electron-forge/maker-dmg` if available in devDependencies.
- Set `appId: 'com.monitoring.electron-system-monitor'` in the packager config.
- Confirm `npm run make` succeeds and the `.app` bundle launches with correct window behaviour.

**Files to modify**:
- `forge.config.ts`

**Estimated lines**: ~15–20

**Spec traceability**:
- proposal §Scope (macOS packaging via Electron Forge)
- design §8.6 (package step)

**Dependencies**: all prior slices complete (build must succeed cleanly)

---

## Task × Estimated Lines Summary

| Task | Title | Est. lines | Slice cumulative |
|------|-------|-----------|-----------------|
| 1.1 | Bootstrap Forge + Vite + TS | 120–150 | 120–150 |
| 1.2 | Shared types + channel constants | 70–90 | 190–240 |
| 1.3 | window.ts + index.ts | 60–80 | 250–320 |
| **Slice 1 total** | | | **250–320** |
| 2.1 | metrics-local.ts | 60–75 | 60–75 |
| 2.2 | preload/index.ts | 50–65 | 110–140 |
| 2.3 | ipc-handlers.ts (local only) | 25–35 | 135–175 |
| 2.4 | Renderer entry + useMetrics + placeholder App | 50–65 | 185–240 |
| **Slice 2 total** | | | **185–240** |
| 3.1 | profile-store.ts | 60–75 | 60–75 |
| 3.2 | parsers.ts | 60–75 | 120–150 |
| 3.3 | metrics-remote.ts | 120–150 | 240–300 |
| 3.4 | ipc-handlers.ts (SSH + profile handlers) | 90–110 | 330–410 |
| **Slice 3 total** | | | **330–410** |
| 4.1 | MetricCard.tsx | 25–35 | 25–35 |
| 4.2 | MetricsWidget.tsx | 70–85 | 95–120 |
| 4.3 | ProfileSelector.tsx | 45–55 | 140–175 |
| 4.4 | SSHPanel.tsx | 90–110 | 230–285 |
| 4.5 | App.tsx (real root) | 30–40 | 260–325 |
| **Slice 4 total** | | | **260–325** |
| 5.1 | widget.css + CSS import | 50–65 | 50–65 |
| 5.2 | Unit tests (parsers, store, validation) | 90–120 | 140–185 |
| 5.3 | SSH integration test | 40–50 | 180–235 |
| 5.4 | N/A fallback + reconnect badge audit | 20–30 | 200–265 |
| 5.5 | macOS packaging config | 15–20 | 215–285 |
| **Slice 5 total** | | | **215–285** |
| **Grand total** | | | **1 240–1 580** |

> Note: Slice 3 upper bound reaches ~410 lines. If Task 3.3 (`metrics-remote.ts`) runs long during implementation, it should be committed as a standalone unit before Task 3.4 is applied. Both tasks are in the same PR slice but can be reviewed as two separate commits within that PR.

---

## Full Scope Coverage Verification

| Proposal success criterion | Covered by tasks |
|---------------------------|-----------------|
| 1. Frameless, transparent, always-on-top window; local metrics | 1.3, 4.2, 4.5 |
| 2. Widget stays above normal windows | 1.3 |
| 3. Metrics update every 2 s | 2.1, 2.3 |
| 4. User can add + save SSH profile via panel | 4.4 |
| 5. Remote metrics appear within 5 s | 3.3, 3.4 |
| 6. SSH reconnect + "reconnecting" state | 3.3, 5.4 |
| 7. Profiles persist across restarts | 3.1 |
| 8. Deleting active profile stops polling | 3.4 |
| 9. CPU overhead < 5% (one shared interval) | 3.3 design constraint |
| 10. No unhandled exceptions | 1.3, 2.1, 3.3, 5.4 |
| 11. Cold launch < 3 s | 1.1–1.3 scaffold; no additional constraint |
| 12. Unit tests pass | 5.2 |
| 13. SSH integration test | 5.3 |
| 14. Zero TS errors | 1.1 (tsconfig strict) |
| 15. Security defaults enforced | 1.3, 2.2 |
