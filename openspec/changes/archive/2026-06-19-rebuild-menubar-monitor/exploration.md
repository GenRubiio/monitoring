# Exploration: rebuild-menubar-monitor

## Date: 2026-06-19

---

## 1. What Exists — State of the Codebase

The project at `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring` is a
**fully implemented and archive-verified** Electron floating-widget desktop app.
The previous change `electron-system-monitor` (archived 2026-06-12) completed all
21 tasks across 5 slices with a PASS verdict.

### Source tree (project root level)

```
src/
  main/
    index.ts              app lifecycle, uncaughtException guards
    window.ts             createWidgetWindow() — frameless, transparent, always-on-top
    metrics-local.ts      systeminformation 2s poll loop
    metrics-remote.ts     RemoteMetricsManager (ssh2, backoff reconnect)
    ipc-handlers.ts       all ipcMain.handle/on registrations
    profile-store.ts      electron-store v8 CRUD for SSH profiles
    temperature-macos.ts  iSMC binary invocation for Apple Silicon temp
    parsers.ts            pure Linux-command parsers (procstat, free, sensors, df)
  preload/
    index.ts              contextBridge MonitorApi (8 named functions)
  renderer/
    main.tsx              React root mount
    App.tsx               view toggle (widget | panel)
    hooks/useMetrics.ts   IPC subscriptions
    components/
      MetricsWidget.tsx   local + remote metric sections, drag region
      SSHPanel.tsx        SSH profile CRUD form
      ProfileSelector.tsx  active-profile dropdown + gear
      MetricCard.tsx      single metric display cell
      WindowControls.tsx  minimize / close buttons
    styles/
      global.css          CSS variables, drag/no-drag rules, system font
      widget.css          widget, panel, badge, card, profile-selector styles
  shared/
    channels.ts           CH constants (9 channels)
    types.ts              MetricsSnapshot, RemoteMetricsSnapshot, SshProfile, MonitorApi

tests/
  parsers.test.ts
  profile-store.test.ts
  ipc-validation.test.ts
  ssh.integration.test.ts   (gated by SSH_INTEGRATION env var)
  temperature-macos.test.ts

forge.config.ts             Vite plugin, makers, postPackage ad-hoc codesign hook
openspec/
  config.yaml               strict_tdd: false; testing commands not yet populated
  specs/local-metrics/spec.md
  specs/ssh-profiles/spec.md
  changes/archive/2026-06-12-electron-system-monitor/  (complete lifecycle)
```

### Key dependency versions (actual installed)

| Package | Version |
|---|---|
| electron | 42.4.0 |
| react / react-dom | ^18.3.1 |
| ssh2 | ^1.17.0 |
| systeminformation | ^5.31.7 |
| electron-store | ^8.2.0 (CJS, intentionally pinned) |
| @electron-forge/plugin-vite | ^7.11.2 |
| typescript | ~5.4 |

---

## 2. What the App Currently Does

The app creates a **floating, always-on-top, frameless, transparent window**
(320×260 px, `hasShadow: false`, `setVibrancy('hud')`, traffic-light hidden).
Window level is `'floating'`, visible on all workspaces.

### Two views

1. **MetricsWidget** (default): shows Local and Remote sections, each with four
   MetricCards: CPU %, Temp, RAM, Disk. Header holds ProfileSelector + WindowControls.
   Outer div carries `-webkit-app-region: drag`; interactive elements are `no-drag`.

2. **SSHPanel**: CRUD form for SSH profiles. Accessed via the gear button in ProfileSelector.

### Main process loop

- `startLocalMetricsLoop` fires immediately and then every 2s; collects
  `si.currentLoad()`, `si.mem()`, `si.fsSize()`, and temperature; pushes
  `MetricsSnapshot` over `metrics:local`.
- Temperature: tries `si.cpuTemperature().main` first, falls back to iSMC binary
  at `resources/native/ismc/iSMC` (Apple Silicon; path resolves from `app.getAppPath()`
  in dev, `process.resourcesPath` in packaged).
- `RemoteMetricsManager` singleton holds one ssh2 `Client` per active profile;
  polls `/proc/stat` (×2 with 200 ms gap), `free -b`, `sensors`/thermal-zone,
  `df -B1 /`; exponential backoff 1 s → 30 s cap; generation counter guards
  stale events after profile switch.
- `registerIpcHandlers` restores the persisted `activeProfileId` on
  `did-finish-load` with a 2 s delay (lets macOS show the Local Network Privacy
  dialog first); triggers mDNS multicast probe via UDP.

### IPC channel inventory (current)

| Channel | Direction | Purpose |
|---|---|---|
| `metrics:local` | push main→renderer | LocalMetricsSnapshot every 2s |
| `metrics:remote` | push main→renderer | RemoteMetricsSnapshot |
| `ssh:test` | invoke | one-shot connection test |
| `profile:save` | invoke | upsert profile (create/update) |
| `profile:delete` | invoke | remove profile by id |
| `profile:list` | invoke | return all profiles |
| `profile:select` | send | switch active profile |
| `window:minimize` | send | minimize window |
| `app:close` | send | quit app |
| `app:open-privacy-settings` | send | open macOS Local Network Privacy pane |

### Storage

`electron-store` (`config.json`) stores: `profiles: SshProfile[]` and
`activeProfileId: string | null`. Passwords are **plain text** — acknowledged MVP
gap; `safeStorage` deferred to Phase 2.

---

## 3. What "Rebuild" Means — Gap Analysis

The change name is `rebuild-menubar-monitor`. The user's stated intent is to
reconstruct an app that shows a **status bar icon in the top-right of macOS
(the system menu bar area)**. This is a conceptually different UX paradigm than
the current floating-widget approach:

| Aspect | Current implementation | Menu bar target |
|---|---|---|
| Window type | Floating always-on-top BrowserWindow (320×260) | Tray icon in macOS menu bar; clicking opens a popover/panel |
| App visibility | Window is always visible over all workspaces | Icon in tray; window shown/hidden on click |
| App presence in Dock | No (`skipTaskbar: true`) | Typically no Dock icon (`app.dock.hide()`) |
| Window creation point | Fixed size, draggable by user | Positioned below the tray icon, fixed or resizable |

**Key missing API surface for a true menu-bar app:**

- `Tray` from the `electron` module: creates the status bar icon.
- `Tray.setImage()` / `Tray.setTitle()`: sets the icon or optionally inline text.
- `Tray.on('click')` / `Tray.on('right-click')`: shows/hides the window.
- The window would use `BrowserWindow` but positioned anchored to the tray icon,
  typically not `alwaysOnTop` in the same way — it would hide when clicking elsewhere.

**Current implementation does NOT use `Tray`**. The `createWidgetWindow()` in
`window.ts` produces a draggable floating panel, not a tray-anchored popover.

The rebuild must add the `Tray` lifecycle and convert (or add alongside) the
window management to open a panel anchored to the tray icon.

---

## 4. Affected Areas for a Rebuild

### 4.1 Must change

| File | Nature of change |
|---|---|
| `src/main/index.ts` | Add `Tray` creation; wire click handler; may keep or replace `BrowserWindow` bootstrap pattern |
| `src/main/window.ts` | Convert from "floating always-visible" to "tray popover" — different geometry, positioning logic anchored to tray icon bounds |
| `src/renderer/App.tsx` | Possibly remove `view` toggle if the SSH panel becomes a separate route/window; or keep as-is inside the popover |
| `src/renderer/components/WindowControls.tsx` | May not be needed (popover closes on outside click); minimize makes less sense |
| `src/renderer/components/MetricsWidget.tsx` | Drag region no longer needed in a tray popover |
| `forge.config.ts` | Possibly add icon resource; NSStatusItem / LSUIElement for Dock-less operation |

### 4.2 Likely stays the same

| Area | Rationale |
|---|---|
| `src/main/metrics-local.ts` | Pure systeminformation polling; no window coupling |
| `src/main/metrics-remote.ts` | RemoteMetricsManager is window-independent (uses `win.webContents.send` — needs `win` ref but that's injectable) |
| `src/main/ipc-handlers.ts` | IPC channel set is still valid; `window:minimize` may be removed |
| `src/main/profile-store.ts` | Storage layer unchanged |
| `src/main/parsers.ts` | Pure functions; no change |
| `src/main/temperature-macos.ts` | Platform utility; no change |
| `src/preload/index.ts` | API bridge unchanged (may drop `minimizeWindow`) |
| `src/shared/types.ts` | Types unchanged |
| `src/shared/channels.ts` | Drop `WINDOW_MINIMIZE` if not needed |
| `tests/` | All unit tests remain valid |

### 4.3 New additions needed

- Tray icon image (PNG, typically 16×16 or 22×22 @2x for Retina)
- `app.dock.hide()` call to remove Dock presence (standard for menu-bar apps)
- `LSUIElement = 1` in `Info.plist` / `extendInfo` in `forge.config.ts` (prevents
  Dock icon from appearing even if `app.dock.hide()` is called late)
- Window positioning logic: `getBounds()` on the Tray, then position the
  BrowserWindow below the icon
- Click-outside detection to auto-hide the panel (Electron `BrowserWindow.on('blur')`)

---

## 5. Architecture Notes for Tray-Based Rebuild

### Tray popover pattern (standard Electron approach)

```
app.on('ready') →
  1. createTray(iconPath)              // Tray object
  2. tray.on('click', showPanel)
  3. createPanel()                     // BrowserWindow, hidden initially
     - frame: false, transparent: true
     - show: false (starts hidden)
     - alwaysOnTop: false (popover hides itself)
  4. showPanel():
     - get tray.getBounds()
     - position window below icon
     - win.show()
  5. win.on('blur') → win.hide()       // click outside closes
```

### Dual-mode consideration

The existing floating widget and a tray-anchored popover are not mutually
exclusive patterns. The rebuild could:

a) **Replace** the floating widget entirely with a tray icon + popover (cleaner,
   more native macOS UX for a persistent monitor).
b) **Add** a tray icon that toggles the existing floating widget's visibility
   (lower disruption; the floating widget approach already works).

Option (b) is lower-risk and preserves the verified implementation. The spec
defines the user's intent as "shows a status bar icon" — if the widget still
floats independently, a tray icon just adds a toggle. If the intent is a
strictly tray-only UI (no floating panel), option (a) is a more significant
architectural change.

---

## 6. Prior Art and Specs

- `openspec/specs/local-metrics/spec.md`: 8 requirements covering floating window
  behavior. A tray approach re-scopes several of these (floating level,
  always-on-top semantics change).
- `openspec/specs/ssh-profiles/spec.md`: 8 requirements. Unchanged by tray
  refactoring — SSH logic is decoupled from window management.
- Archived design (`archive/2026-06-12-electron-system-monitor/design.md`):
  explicitly designed the three-process split; all of that architecture
  is retained in a tray rebuild.

---

## 7. Risks

| Risk | Severity | Notes |
|---|---|---|
| `Tray` API requires an icon resource; missing asset blocks launch | High | Need a valid PNG before the app can start with a tray |
| `LSUIElement` in `extendInfo` may conflict with `app.dock.hide()` order | Medium | Set in plist and guard with `app.dock.hide()` on `ready` |
| Window positioning on multi-monitor / scaled displays | Medium | Tray `getBounds()` returns display-relative coords; needs screen-to-window coordinate math |
| `BrowserWindow.on('blur')` auto-hide can interfere with right-click context menu or SSH panel interactions | Medium | Must exempt panel interactions; possibly disable auto-hide while SSH panel is open |
| Existing `local-metrics` spec requires `alwaysOnTop: true` — tray popover typically does NOT use alwaysOnTop | Medium | Spec may need a requirements update to reflect tray-panel semantics |
| `window:minimize` IPC channel has no equivalent meaning in a tray popover | Low | Remove or repurpose as hide() |
| `setVibrancy('hud')` may look wrong in a tray popover context (vs floating widget) | Low | Test visually; `'menu'` or `'popover'` vibrancy may be more appropriate |
| iSMC binary path resolution works in packaged builds; no change needed | None | `temperature-macos.ts` already handles dev vs packaged path |
| SSH credential plain-text storage remains — not a new risk for this change | Existing | Phase 2 `safeStorage` unchanged |
| `openspec/config.yaml` test commands are empty | Low | `strict_tdd: false`; tests run manually |

---

## 8. Questions for the Proposal Phase

1. **UX mode**: Replace the floating widget with a tray-only popover, or add a
   tray icon that shows/hides the existing floating widget?
2. **Tray icon**: Static image-only, or should it show inline text (e.g., CPU %
   in the menu bar itself like iStatMenus)?
3. **Disk metric**: Added in the prior change but not in the original spec.
   Keep it in the rebuild?
4. **`local-metrics` spec update**: The spec currently mandates always-on-top
   floating behavior. Does the rebuild supersede that spec, or extend it?
5. **`app:close` vs hide**: In a tray app, closing the window should hide it,
   not quit. Should `closeApp()` mean quit-from-tray-menu, and window X button
   becomes hide?

---

## 9. Summary

The codebase is in excellent shape: fully implemented, TypeScript clean,
22 passing unit tests, well-separated concerns. The `rebuild-menubar-monitor`
change is primarily an **architectural change to the window management layer**
(`window.ts`, `index.ts`) to introduce the macOS `Tray` API. The metrics
collection, SSH, storage, and IPC plumbing are all reusable with minimal or no
modification. The largest unknowns are the desired UX mode (floating vs pure
tray popover) and whether the existing `local-metrics` spec requirements for
always-on-top floating behavior need to be revised for the tray paradigm.
