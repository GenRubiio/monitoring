# Exploration: electron-system-monitor

## Project Context

Brand-new project in `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring`. No source code exists. Existing artifacts are SDD lifecycle documents only (proposal.md, spec.md, context.md, README.md). The spec is complete and a Design phase is pending.

---

## 1. Required npm Packages

### Core Runtime

| Package | Version | Role |
|---|---|---|
| `electron` | ^30 or latest stable | App shell, window management, IPC |
| `react` | ^18 | UI rendering |
| `react-dom` | ^18 | DOM renderer |
| `typescript` | ^5 | Type safety |

### Metrics Collection

| Package | Version | Role |
|---|---|---|
| `systeminformation` | ^5.x | Local CPU load, RAM, CPU temperature |
| `ssh2` | ^1.x | SSH client for remote metric collection |

### Storage and Credential Handling

| Package | Version | Role |
|---|---|---|
| `electron-store` | ^10.x | JSON persistence for SSH profiles and last-used state |
| (none for MVP) | — | Credentials stored as plain text per spec; see Risk section |

Note: `electron-store` v10+ is ESM-only. The project must use `"type": "module"` in package.json or use dynamic import, otherwise pin to `electron-store` v8.x which supports CommonJS.

### Dev / Build

| Package | Version | Role |
|---|---|---|
| `@electron-forge/cli` | ^7 | Build and packaging orchestration |
| `@electron-forge/plugin-vite` | ^7 | Vite bundler plugin for Forge |
| `vite` | ^5 | Bundler for renderer process |
| `@electron/rebuild` | ^3.x | Recompile native modules for Electron's Node ABI |
| `jest` | ^29 | Unit tests |
| `@types/react` | ^18 | TS types |
| `@types/ssh2` | ^1 | TS types for ssh2 |
| `playwright` | ^1 | E2E tests (recommended, aligns with spec) |

### Optional / Phase 2

| Package | Role |
|---|---|
| `electron` `safeStorage` (built-in API) | OS-level encryption of credential buffers; no extra package needed |
| `osx-temperature-sensor` | Needed on Intel macOS for CPU temp via systeminformation |
| `macos-temperature-sensor` | Needed on Apple Silicon macOS for CPU temp |

---

## 2. Bootstrapping Command

```bash
npx create-electron-app@latest electron-system-monitor --template=vite-typescript
```

This generates an Electron Forge project with Vite + TypeScript preconfigured. Add React support separately (`npm install react react-dom @types/react @types/react-dom`).

---

## 3. IPC Architecture (Main / Renderer Split)

Electron security requires that system-level operations (metrics, SSH, file I/O) run only in the **main process**. The renderer process is sandboxed.

### Recommended Pattern

```
Renderer (React UI)
  └── preload.js (contextBridge)
        └── ipcRenderer.invoke() / ipcRenderer.send()
              └── Main Process (ipcMain.handle())
                    ├── systeminformation (local metrics)
                    ├── ssh2 client (remote metrics)
                    └── electron-store (profile persistence)
```

- Use `ipcMain.handle()` + `ipcRenderer.invoke()` for all request/response flows (metric fetch, profile CRUD, SSH test).
- Use `webContents.send()` from main for push-based metric updates (2-second interval timer lives in main process).
- Expose only named functions through `contextBridge.exposeInMainWorld()` — never expose raw `ipcRenderer`.
- `nodeIntegration: false` and `contextIsolation: true` must remain at defaults.
- `sandbox: true` is default since Electron 20; leave it enabled.

### IPC Channel Inventory (draft)

| Channel | Direction | Purpose |
|---|---|---|
| `metrics:local` | main → renderer | Push local CPU/RAM/temp every 2s |
| `metrics:remote` | main → renderer | Push remote metrics for active profile |
| `ssh:test` | renderer → main (invoke) | Test SSH connection, return ok/error |
| `profile:save` | renderer → main (invoke) | Persist new/updated profile |
| `profile:delete` | renderer → main (invoke) | Remove a profile |
| `profile:list` | renderer → main (invoke) | Load all stored profiles |
| `profile:select` | renderer → main (send) | Switch active remote profile |

---

## 4. Metrics Collection Details

### Local Metrics via `systeminformation`

```js
import si from 'systeminformation';
const load = await si.currentLoad();   // load.currentLoad = CPU %
const mem  = await si.mem();           // mem.total, mem.used (bytes)
const temp = await si.cpuTemperature(); // temp.main (°C), may be null
```

All calls are async and should be made in the main process on a 2-second `setInterval`. Results are forwarded to the renderer via `webContents.send()`.

### Remote Metrics via `ssh2`

Run shell commands over a persistent SSH connection per active profile:

```bash
# CPU usage (1-second sample)
top -bn1 | grep "Cpu(s)" | awk '{print $2}'
# or
cat /proc/stat  (parse user+system ticks)

# RAM
free -b | grep Mem

# Temperature (Ubuntu with lm-sensors)
sensors | grep "Core 0"
# or
cat /sys/class/thermal/thermal_zone0/temp
```

SSH connection lifecycle: open one `Client` per active profile, keep it alive, re-establish on disconnect with exponential backoff. Do not open a new connection per metric tick.

---

## 5. Window Configuration (Always-on-Top, Frameless)

```js
const win = new BrowserWindow({
  width: 280,
  height: 160,
  frame: false,          // no OS title bar
  transparent: true,     // allows rounded corners / blur
  alwaysOnTop: true,     // float above all windows
  resizable: false,
  skipTaskbar: true,     // hide from taskbar / dock
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});

win.setAlwaysOnTop(true, 'floating'); // macOS level: stays above normal windows
```

### macOS-Specific

- Use level `'floating'` (or `'pop-up-menu'` for highest precedence) in `setAlwaysOnTop`. Level `'floating'` keeps the widget above regular apps but below fullscreen apps.
- To stay above fullscreen apps on macOS: `win.setAlwaysOnTop(true, 'screen-saver')` — but this is intrusive; avoid unless explicitly desired.
- Vibrancy: `win.setVibrancy('under-window')` or `'hud'` gives the frosted glass macOS look. Works best with `transparent: true` and a semi-transparent CSS background.
- `win.setWindowButtonVisibility(false)` hides the traffic-light close/min/max buttons on a frameless macOS window.
- The renderer must implement custom drag via `-webkit-app-region: drag` CSS on the drag handle; interactive elements must be marked `-webkit-app-region: no-drag`.

### Cross-Platform Notes

- On Linux, `transparent: true` requires a compositor running; without one, the background is black. Detect and fall back to opaque.
- Windows: transparency works but visual glitches can appear on resize; keep window non-resizable.

---

## 6. SSH Credential Storage Risks

### MVP (Plain Text)

The spec explicitly accepts plain-text credential storage for MVP. `electron-store` writes JSON to the OS app data directory:
- macOS: `~/Library/Application Support/<appName>/config.json`
- Linux: `~/.config/<appName>/config.json`
- Windows: `%APPDATA%\<appName>\config.json`

This file is readable by any process running as the same user. **Passwords are exposed if the machine is compromised.**

### Phase 2 Upgrade Path

Use Electron's built-in `safeStorage` API (no extra package):
```js
import { safeStorage } from 'electron';
const encrypted = safeStorage.encryptString(plainPassword); // returns Buffer
// store Buffer.toString('base64') in electron-store
const decrypted = safeStorage.decryptString(encrypted);
```

- macOS: key stored in Keychain, inaccessible to other apps
- Windows: DPAPI encryption tied to user login
- Linux: uses gnome-libsecret or kwallet; may fail in headless/CI environments

---

## 7. CPU Temperature Availability Risks

`systeminformation`'s `cpuTemperature()` returns null on many machines:

| Platform | Condition | Availability |
|---|---|---|
| macOS (Intel) | Requires `osx-temperature-sensor` installed as optional dep | Partial |
| macOS (Apple Silicon M-series) | Requires `macos-temperature-sensor` | Partial |
| Linux | Requires `lm-sensors` (`sudo apt install lm-sensors`) | Common, not universal |
| Windows | WMI query, requires admin in some configs | Unreliable |

**Remote Ubuntu server (192.168.100.56)**: Temperature readable via `/sys/class/thermal/thermal_zone*/temp` or `sensors` command if lm-sensors is installed. The `/sys` path is always present on modern Linux kernels and does not require root.

Mitigation: Always treat temperature as optional. Display "N/A" or hide the field when `temp.main === null`.

---

## 8. Native Module Rebuild Requirements

Both `systeminformation` (pure JS) and `ssh2` (pure JS with optional native `cpu-features`) do not require native compilation in normal use. The `cpu-features` optional dependency in `ssh2` improves cipher negotiation but is truly optional.

If `osx-temperature-sensor` or `macos-temperature-sensor` are added for macOS temperature support, they contain native Node addons and will require `@electron/rebuild` to be run after `npm install`:

```bash
npx electron-rebuild
```

Electron Forge handles this automatically when using `@electron-forge/plugin-vite` — it calls rebuild as part of the packaging step.

---

## 9. File/Folder Structure Recommendation

```
electron-system-monitor/
  src/
    main/
      index.ts              # Electron main process entry
      metrics-local.ts      # systeminformation polling loop
      metrics-remote.ts     # ssh2 client management
      profile-store.ts      # electron-store CRUD
      ipc-handlers.ts       # ipcMain.handle() registrations
    preload/
      index.ts              # contextBridge API surface
    renderer/
      App.tsx               # Root React component
      components/
        MetricsWidget.tsx   # Floating metrics display
        SSHPanel.tsx        # Profile configuration panel
        ProfileSelector.tsx # Dropdown for local/remote toggle
      hooks/
        useMetrics.ts       # Subscribe to IPC metric pushes
      styles/
        widget.css
  forge.config.ts
  vite.main.config.ts
  vite.renderer.config.ts
  vite.preload.config.ts
  package.json
  tsconfig.json
```

---

## 10. Testing Infrastructure Recommendation

The current `openspec/config.yaml` has no test runner configured (`strict_tdd: false`). Recommended setup:

| Layer | Tool | Command |
|---|---|---|
| Unit | Jest + ts-jest | `npm test` |
| Integration | Jest with ssh2 mock | `npm run test:integration` |
| E2E | Playwright (with `@playwright/test`) | `npm run test:e2e` |

Unit test targets: metric result parsing, profile validation, IPC handler logic (injectable dependencies). Integration test target: SSH connection to 192.168.100.56 (ubuntu/ubuntu) — should be gated behind a flag or separate CI step.

---

## 11. Prior Art / Existing Patterns

- **Stacer** (Linux): Electron-based system monitor, but heavy/full-screen. Not a floating widget.
- **iStatMenus** (macOS native): Closest in UX concept — menu-bar metrics display. Not Electron.
- **Electron fiddle examples**: Official examples demonstrate always-on-top transparent window setups.
- Common pattern in the community: `systeminformation` + `setInterval` in main + `webContents.send()` to renderer, with a small frameless React widget. No dominant open-source template exists; this is assembled from parts.

---

## 12. Key Risks Summary

| Risk | Severity | Mitigation |
|---|---|---|
| SSH credentials stored in plain text | High | Document as MVP; Phase 2 uses `safeStorage` |
| CPU temperature unavailable on macOS | Medium | Optional deps + graceful "N/A" display |
| `electron-store` ESM compatibility | Medium | Pin to v8 (CJS) or configure ESM project properly |
| ssh2 connection drops during metric fetch | Medium | Connection pooling, reconnect with backoff |
| always-on-top window blocks user on macOS fullscreen | Low | Use `floating` level, not `screen-saver` |
| Linux transparency without compositor | Low | Detect and fall back to opaque background |
| Electron main process crash kills UI | Medium | Uncaught exception handler; auto-restart via `electron-reloader` in dev |
| `@electron/rebuild` needed for any native optional deps | Low | Electron Forge handles this automatically |
| Remote lm-sensors not installed on 192.168.100.56 | Low | Fall back to `/sys/class/thermal/thermal_zone0/temp` |

---

## 13. Confirmed Package List (Final)

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

Note: `electron-store` pinned to v8 for CommonJS compatibility. Upgrade to v10+ only if the project is configured as full ESM.
