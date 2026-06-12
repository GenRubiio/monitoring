# Proposal: electron-system-monitor

## Intent and Problem Statement

Developers and sysadmins who run remote Linux servers alongside their local macOS workstation have no lightweight, always-visible tool that shows both local and remote system health at a glance. Existing solutions are either full-screen applications (Stacer), menu-bar-only items (iStatMenus), or web dashboards that require a browser tab.

The goal is a minimal floating desktop widget — always on top, frameless, transparent — that shows CPU load percentage, RAM used/total, and CPU temperature for the local machine, and the same three metrics for one selected remote server reached over SSH. An SSH profile panel allows the user to save named server connections (host, username, password). The application must start with zero configuration burden and be packaged as a native macOS app.

---

## Scope

### In Scope (MVP)

- Green-field Electron application bootstrapped with Electron Forge + Vite + TypeScript + React.
- Floating, always-on-top, frameless, transparent macOS window (`setAlwaysOnTop(true, 'floating')`); window draggable via CSS `-webkit-app-region: drag`.
- Local metrics panel: CPU load %, RAM used / total (GB), CPU temperature (°C or "N/A").
- Remote metrics panel: same three metrics fetched from the active SSH profile.
- SSH profile manager: create, edit, delete named profiles with fields host, port (default 22), username, password.
- Profile selector: switch which remote profile is actively polled.
- Credentials persisted in plain text via `electron-store` v8 (CommonJS-compatible).
- Metrics polled every 2 seconds; SSH connection kept alive per active profile, re-established with exponential backoff on drop.
- Temperature displayed as optional; gracefully shows "N/A" when the OS or remote cannot supply it.
- Unit tests (Jest + ts-jest) for metric parsing logic and profile CRUD.
- Integration test for SSH connectivity against 192.168.100.56 (ubuntu/ubuntu), gated behind an environment flag.
- macOS packaging via Electron Forge.

### Out of Scope (MVP)

- Credential encryption (`safeStorage`) — deferred to Phase 2.
- Historical metrics storage, graphs, or export.
- Multi-factor or key-based SSH authentication in the UI (key-based works if the OS agent is available but is not a UI feature).
- Cloud monitoring or any non-SSH remote protocol.
- Windows or Linux packaging (code runs on those platforms but packaging and transparent-window edge cases are not addressed).
- Alerting, notifications, or threshold triggers.
- Multiple simultaneous active remote connections (one active profile at a time in MVP).
- E2E Playwright tests (recommended for Phase 2 once the UI is stable).

---

## Affected Areas

This is a green-field project. No existing source code is modified. All affected areas are net-new.

### New Application — `electron-system-monitor/`

**Main process**

| File | Responsibility |
|---|---|
| `src/main/index.ts` | BrowserWindow creation, app lifecycle, global error handler |
| `src/main/metrics-local.ts` | `systeminformation` polling loop (2 s interval), pushes via `webContents.send()` |
| `src/main/metrics-remote.ts` | `ssh2` Client lifecycle per active profile, command execution, reconnect backoff |
| `src/main/profile-store.ts` | `electron-store` CRUD for SSH profiles |
| `src/main/ipc-handlers.ts` | All `ipcMain.handle()` and `ipcMain.on()` registrations |

**Preload**

| File | Responsibility |
|---|---|
| `src/preload/index.ts` | `contextBridge.exposeInMainWorld()` — exposes only named functions, no raw ipcRenderer |

**Renderer (React)**

| File | Responsibility |
|---|---|
| `src/renderer/App.tsx` | Root component, layout switch between widget and profile panel |
| `src/renderer/components/MetricsWidget.tsx` | Floating display: CPU %, RAM, temp for local and remote |
| `src/renderer/components/SSHPanel.tsx` | Profile form: add / edit / delete |
| `src/renderer/components/ProfileSelector.tsx` | Dropdown to pick active remote profile |
| `src/renderer/hooks/useMetrics.ts` | Subscribe to IPC metric pushes from main |

**IPC channel inventory**

| Channel | Direction | Purpose |
|---|---|---|
| `metrics:local` | main → renderer (push) | Local CPU/RAM/temp every 2 s |
| `metrics:remote` | main → renderer (push) | Remote metrics for active profile |
| `ssh:test` | renderer → main (invoke) | Test connection, return ok or error string |
| `profile:save` | renderer → main (invoke) | Persist new or updated profile |
| `profile:delete` | renderer → main (invoke) | Remove a profile by id |
| `profile:list` | renderer → main (invoke) | Return all stored profiles |
| `profile:select` | renderer → main (send) | Switch active remote profile |

**Build configuration**

- `forge.config.ts` — Electron Forge makers and plugins
- `vite.main.config.ts`, `vite.renderer.config.ts`, `vite.preload.config.ts` — separate Vite configs per Electron process type
- `tsconfig.json` — TypeScript strict mode

**Dependency set (locked)**

```json
{
  "dependencies": {
    "electron-store": "^8.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "ssh2": "^1.16.0",
    "systeminformation": "^5.23.0"
  },
  "devDependencies": {
    "@electron-forge/cli": "^7.5.0",
    "@electron-forge/plugin-vite": "^7.5.0",
    "@electron/rebuild": "^3.6.0",
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@types/ssh2": "^1.15.0",
    "electron": "^30.0.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.0.0"
  }
}
```

`electron-store` is pinned to v8 to retain CommonJS compatibility with Electron Forge's default module system. Upgrading to v10+ (ESM-only) requires converting the project to `"type": "module"` and is deferred to Phase 2.

---

## Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| SSH credentials stored in plain text | High | Explicitly accepted for MVP; documented as a known gap. Phase 2 upgrades to `electron.safeStorage` (Keychain on macOS, DPAPI on Windows). File permissions on the electron-store JSON are OS-controlled (user-only read). |
| CPU temperature unavailable on macOS | Medium | `systeminformation.cpuTemperature()` returns null on most Macs without optional native sensors. Always render temperature as optional; display "N/A" rather than erroring. Optional deps `osx-temperature-sensor` / `macos-temperature-sensor` can be added in Phase 2 after confirming the native rebuild pipeline. |
| `electron-store` ESM incompatibility | Medium | Pinned to v8 which is CJS. Do not upgrade without converting the entire project to ESM. |
| SSH connection drops between metric ticks | Medium | Keep one persistent `ssh2.Client` per active profile. On error or close event, reconnect with exponential backoff (1 s, 2 s, 4 s, cap 30 s). Renderer shows "reconnecting…" badge during gap. |
| Remote server lacks `lm-sensors` for temperature | Low | Fall back to reading `/sys/class/thermal/thermal_zone0/temp` (always present on modern Linux kernels, no root required). If both paths fail, display "N/A". |
| Always-on-top window obscures fullscreen apps on macOS | Low | Use level `'floating'` in `setAlwaysOnTop`; this keeps widget above normal windows but below fullscreen spaces. Do not use `'screen-saver'` level. |
| Linux transparency fails without compositor | Low | Detect `transparent` window capability; fall back to a solid semi-opaque background if the compositor is absent. Out of scope for MVP but code should not hard-crash. |
| Electron main process uncaught exception crashes UI | Medium | Register `process.on('uncaughtException')` and `process.on('unhandledRejection')` in main; log to file, show error state in renderer via IPC rather than silently killing the window. |
| Native module rebuild requirement | Low | `systeminformation` and `ssh2` are pure JS in standard use. No rebuild step needed for MVP. Electron Forge handles `@electron/rebuild` automatically if native optional deps are added later. |

---

## Rollback Plan

Because this is a green-field project with no prior source code, there is nothing to roll back to at the application level.

- **SDD artifacts**: If the proposal or subsequent spec is rejected, the lifecycle documents are discarded and the `openspec/changes/electron-system-monitor/` directory is deleted or archived. No code has been produced yet.
- **During development**: The project directory (`electron-system-monitor/`) is isolated. Deleting it has zero impact on any other system.
- **After packaging**: Uninstalling the macOS `.app` bundle fully removes the application. `electron-store` data lives at `~/Library/Application Support/electron-system-monitor/config.json`; this must be manually deleted to remove stored profiles. A future uninstaller script should handle this.
- **Phase 2 `safeStorage` migration**: If the migration fails, reverting `profile-store.ts` to plain-text reads restores MVP behavior without data loss (the plain-text values were never deleted during migration, only supplemented with encrypted copies).

---

## Success Criteria

### Functional

1. The Electron application launches on macOS and displays a frameless, transparent, always-on-top window showing local CPU%, RAM used/total, and CPU temperature (or "N/A").
2. The widget remains visible and above normal application windows; it does not disappear behind other windows without user action.
3. Metrics update visibly every 2 seconds without manual interaction.
4. The user can open the SSH profile panel, enter host `192.168.100.56`, user `ubuntu`, password `ubuntu`, save the profile, and select it as the active remote target.
5. Within 5 seconds of selecting a remote profile, the widget displays remote CPU%, RAM, and temperature (or "N/A") sourced from the Ubuntu server.
6. If the SSH connection drops, the widget shows a "reconnecting" state and automatically restores metric polling without user action.
7. All saved profiles persist across application restarts.
8. Deleting a profile removes it permanently and stops polling if it was active.

### Non-Functional

9. Widget window CPU overhead is below 5% on the local machine during idle metric polling.
10. The application produces no unhandled exceptions in normal operation; all errors are caught and reflected in the UI.
11. Cold launch time (app open to first metric displayed) is under 3 seconds on a standard developer Mac.

### Quality

12. Unit tests cover: metric result parsing (CPU, RAM, temp extraction from `systeminformation` output), profile CRUD operations, and IPC handler argument validation. Test suite passes with `npm test`.
13. SSH integration test against 192.168.100.56 succeeds when the server is reachable and the `SSH_INTEGRATION` environment variable is set.
14. TypeScript compilation produces zero errors (`tsc --noEmit`).
15. Electron security defaults are not weakened: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.

### Phase 2 Gate (not required for MVP)

16. Credentials can be re-encrypted with `safeStorage` via a migration command without data loss.
17. After Phase 2 migration, the plain-text password field in `config.json` is absent.
