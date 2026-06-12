# Apply Progress: electron-system-monitor

Status: **complete** — all 5 slices implemented. Green-field Electron + Vite +
TypeScript + React 18 system-monitor widget.

Delivery path: force-chained via stacked-to-main (5 slices), implemented end to
end in one apply pass. Strict TDD: **inactive** (`strict_tdd: false`, no test
runner was configured at scaffold time; a Jest + ts-jest runner was added as
required by the proposal/design).

NOT committed (per instructions). No PRs opened.

---

## Completed tasks (all)

### Slice 1 — scaffold + shared types + window config

- **1.1** Bootstrapped with `npx create-electron-app . --template=vite-typescript --force`.
  Restructured the flat scaffold (`src/main.ts`/`preload.ts`/`renderer.ts`) into
  the design's `src/main`, `src/preload`, `src/renderer`, `src/shared` layout.
  Added deps: `react@18.3.1`, `react-dom@18.3.1`, `systeminformation@5`,
  `ssh2@1`, `electron-store@8.2.0` (CJS, NOT v10+); dev deps `@types/react`,
  `@types/react-dom`, `@types/node@20`, `@types/ssh2`, `@vitejs/plugin-react`,
  `jest@29`, `ts-jest@29`, `@types/jest`, `typescript@5.4`. `tsconfig.json`:
  `strict: true`, `module: commonjs`, `jsx: react-jsx`, `isolatedModules: true`.
  Three Vite configs wired (externals for main/preload, React plugin for
  renderer). `jest.config.js` (CJS — `jest.config.ts` needs ts-node, avoided).
- **1.2** `src/shared/channels.ts` (7-channel `CH` constant), `src/shared/types.ts`
  (`MetricsSnapshot`, `RemoteConnectionState`, `RemoteMetricsSnapshot`,
  `SshProfile`, `SshProfileInput`, `SshTestResult`, `MonitorApi`).
- **1.3** `src/main/window.ts` (`createWidgetWindow()`: `frame:false`,
  `transparent:true`, `alwaysOnTop:true`, `resizable:false`, `skipTaskbar:true`,
  `hasShadow:false`, `contextIsolation:true`, `nodeIntegration:false`,
  `sandbox:true`; `setAlwaysOnTop(true,'floating')`, `setVibrancy('hud')`,
  `setWindowButtonVisibility(false)`). `src/main/index.ts` (lifecycle +
  `uncaughtException`/`unhandledRejection` guards).

### Slice 2 — local metrics IPC + preload bridge

- **2.1** `src/main/metrics-local.ts` (`collectLocalSnapshot()` + 2s
  `startLocalMetricsLoop()`; per-tick try/catch sets `error` and still sends;
  `cpuTempC` null-safe).
- **2.2** `src/preload/index.ts` (`contextBridge.exposeInMainWorld('api', ...)`;
  push disposers via `removeListener`; raw `ipcRenderer` and event object never
  exposed).
- **2.3 / 3.4** `src/main/ipc-handlers.ts` (`registerIpcHandlers(win)`: starts
  local loop + shared 2s remote tick + all 7 channels).
- **2.4** `src/renderer/main.tsx`, `global.d.ts`, `hooks/useMetrics.ts`, `App.tsx`
  (real composition delivered in Slice 4).

### Slice 3 — SSH profile store + remote metrics IPC

- **3.1** `src/main/profile-store.ts` (`ProfileStore` over electron-store v8 via
  `require`; `upsert`/`remove`/`list`/`getById`/active-id helpers; port
  normalized to 22; constructor accepts an injectable store for tests).
- **3.2** `src/main/parsers.ts` (pure `parseProcStat`, `parseFreeBytes`,
  `parseSensorsTemp`, `parseThermalZoneTemp`).
- **3.3** `src/main/metrics-remote.ts` (`RemoteMetricsManager` singleton — single
  persistent `ssh2.Client`, generation-guarded teardown, exponential backoff
  1s→2s→…→cap 30s, `sensors`→thermal-zone temp fallback; `testSshConnection()`
  one-shot for `ssh:test`).
- **3.4** profile/SSH handlers with validation; deleting the active profile tears
  down the connection.

### Slice 4 — React UI

- **4.1** `MetricCard.tsx`, **4.2** `MetricsWidget.tsx` (drag region, GB
  conversion, "N/A" temp, connection badge, "—" placeholders), **4.3**
  `ProfileSelector.tsx`, **4.4** `SSHPanel.tsx` (full CRUD + test connection),
  **4.5** `App.tsx` (widget ↔ panel switch).

### Slice 5 — polish, tests, packaging

- **5.1** `styles/global.css` + `styles/widget.css` (glass-morphism, cyan accent,
  drag/no-drag regions, badge colors, `body.no-transparency` Linux fallback).
- **5.2** `tests/parsers.test.ts`, `tests/profile-store.test.ts`,
  `tests/ipc-validation.test.ts` — 22 passing.
- **5.3** `tests/ssh.integration.test.ts` — gated by `SSH_INTEGRATION` (skips
  otherwise; 2 skipped).
- **5.4** Audited fallbacks: `cpuTempC === null` → "N/A" (local + remote),
  reconnecting badge, "—" placeholders, handlers reject with strings.
- **5.5** `forge.config.ts` — `MakerZIP` for darwin, `appBundleId:
  com.monitoring.electron-system-monitor`. `npm run make` ZIP maker present.

---

## Files changed

Created: `src/shared/{channels,types}.ts`; `src/main/{index,window,metrics-local,
metrics-remote,parsers,profile-store,ipc-handlers}.ts`; `src/preload/index.ts`;
`src/renderer/{main.tsx,App.tsx,global.d.ts}`,
`src/renderer/hooks/useMetrics.ts`,
`src/renderer/components/{MetricCard,MetricsWidget,ProfileSelector,SSHPanel}.tsx`,
`src/renderer/styles/{global,widget}.css`; `tests/{parsers,profile-store,
ipc-validation,ssh.integration}.test.ts`; `jest.config.js`.

Modified: `package.json` (deps, scripts `test`/`typecheck`, `main` →
`.vite/build/index.js`), `tsconfig.json`, `forge.config.ts`,
`vite.{main,preload,renderer}.config.ts`, `index.html`. Removed flat scaffold
files `src/{main,preload,renderer}.ts`, `src/index.css`.

---

## Verification evidence

| Check | Command | Result |
|-------|---------|--------|
| TypeScript zero errors (Criterion 14) | `npx tsc --noEmit` | exit 0 |
| Unit tests (Criterion 12) | `npx jest` | 22 passed, 2 skipped (gated SSH), 0 failed |
| Full build + macOS package (Criterion 1, packaging) | `npx electron-forge package` | `.app` produced at `out/monitoring-darwin-arm64/monitoring.app` |
| electron-store pinned v8 (ssh-profiles spec) | `npm ls electron-store` | `electron-store@8.2.0` |
| Security defaults (Criterion 15) | window.ts webPreferences | `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` |

Vite emits `main` → `.vite/build/index.js`, `preload` → `.vite/build/preload.js`
(preload `entryFileNames` overridden to avoid an index.js collision with main).

---

## Deviations from design

1. **Build files distinct names**: both main and preload entries are `index.ts`,
   which collide as `index.js` in `.vite/build/`. Resolved by overriding the
   preload Vite `output.entryFileNames` to `preload.js` (matches the
   `path.join(__dirname,'preload.js')` reference in `window.ts`). The `package.json`
   `main` was repointed to `.vite/build/index.js` (design kept `src/main/index.ts`).
2. **jest.config.js (not .ts)**: a `.ts` Jest config requires `ts-node`, which is
   not in the locked dep set. Used `jest.config.js` (CJS) with the `ts-jest`
   preset instead — identical behavior, one fewer dependency.
3. **Window size 320×240** (design quoted both 280×200 and the prompt's 320×200);
   bumped height to 240 to fit local + remote sections without clipping. Cosmetic.
4. The shared 2s tick for remote lives in `ipc-handlers.ts` (drives
   `remoteMetrics.tick()`); `metrics-local.ts` keeps its own 2s interval. Both run
   at the same cadence as the design intends; this is a minor split of the "one
   shared interval" wording but preserves the <5% idle CPU intent.

---

## Remaining tasks

None. All 21 tasks across all 5 slices are implemented and verified by typecheck,
unit tests, and a successful macOS package build.

The following require a GUI/host environment and were NOT runtime-verified here
(headless apply context); they are covered by the build + unit tests but should
be confirmed by a human on a Mac:

- Manual visual confirmation of the floating/transparent/always-on-top window and
  2s live updates (`npm start`) — Success Criteria 1–3, 9, 11.
- Live SSH path against `192.168.100.56` (`SSH_INTEGRATION=1 npm test` with the
  server up) — Success Criteria 5, 6, 13.

---

## Workload / PR boundary

Single apply pass produced all 5 stacked slices. Recommended commit/PR boundaries
(stacked-to-main, per `tasks.md` forecast), each independently reviewable:

1. Slice 1 — scaffold + `src/shared/*` + window/lifecycle + build config.
2. Slice 2 — `metrics-local.ts` + `preload/index.ts` + `ipc-handlers` (local) +
   renderer entry/hook/placeholder.
3. Slice 3 — `profile-store.ts` + `parsers.ts` + `metrics-remote.ts` + full
   `ipc-handlers.ts`.
4. Slice 4 — React UI components + real `App.tsx`.
5. Slice 5 — CSS + tests + integration test + packaging config.

No commits or PRs were created (per instructions).
