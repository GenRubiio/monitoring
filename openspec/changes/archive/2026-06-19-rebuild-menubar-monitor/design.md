# Design: rebuild-menubar-monitor

## Date: 2026-06-19

Author context: design phase for converting the Electron floating-widget system
monitor into a macOS menu bar (tray) application. Reads against proposal.md and
the `tray-menubar` / `local-metrics` specs in this change folder.

> Naming note: the proposal text references `createFloatingWindow` /
> `createWidgetWindow` interchangeably. The actual current function in
> `src/main/window.ts` is **`createWidgetWindow()`**. This design uses the real
> name. The new function replacing it is `createPopoverWindow()`.

> Location note: the `MonitorApi` interface that the proposal says lives in
> `src/preload/index.ts` is actually declared in **`src/shared/types.ts`**. The
> preload file (`src/preload/index.ts`) only *implements* that interface. Both
> files must change.

---

## 1. Decisions

### 1.1 Tray API choice

Use Electron's built-in `Tray` class (`import { Tray, Menu, nativeImage } from
'electron'`). No third-party menubar helper (e.g. the `menubar` npm package) is
introduced, because:

- The app already owns its `BrowserWindow` creation, preload wiring, IPC
  lifecycle, and SSH/local-network bootstrap timing. A wrapper library would
  fight that existing bootstrap (notably the `did-finish-load` + 2s delayed
  Local Network Privacy probe in `ipc-handlers.ts`).
- `Tray` + manual `positionBelowTray` + `blur`-hide is ~40 lines and keeps full
  control over geometry/multi-display clamping required by the spec.

The tray icon is built with `nativeImage.createFromPath(iconPath)` and marked as
a template image via `icon.setTemplateImage(true)` (alternatively the `@2x`
naming convention lets Electron auto-pick Retina). Template mode makes the icon
render correctly in both light and dark menu bars.

**Tray lifetime:** the `Tray` instance is stored in a module-level variable in
`index.ts` (alongside the existing `mainWindow` ref). This is mandatory — a
GC'd `Tray` makes the menu bar icon vanish (spec: "Tray reference retained for
app lifetime").

**Left-click behavior:** `tray.on('click', togglePanel)` — toggle (show if
hidden, hide if visible). The spec allows toggle (`MAY be hidden` when already
visible). Toggle is the better UX and avoids a redundant show on an already
visible popover.

**Right-click behavior:** `tray.setContextMenu(menu)` with a single `Quit`
item calling `app.quit()`. Setting a context menu makes right-click (and
control-click) open the menu natively; left-click still fires the `click`
event. This is the only full-exit path.

### 1.2 Popover window approach

A single long-lived `BrowserWindow` created once at `ready`, `show: false`,
shown/hidden programmatically. We do **not** create/destroy the window per
open — recreating would re-run the renderer, re-subscribe IPC, and re-trigger
the SSH restore bootstrap. Keeping one hidden window preserves the existing
metric streams and SSH connection across open/close cycles.

Window config changes vs. the current floating widget:

| Option | Current (widget) | New (popover) |
|---|---|---|
| `show` | (default true) | `false` |
| `alwaysOnTop` | `true` | `false` |
| `transparent` | `true` | `true` (kept — needed for rounded corners + vibrancy) |
| `frame` | `false` | `false` |
| `skipTaskbar` | `true` | `true` |
| `resizable` | `false` | `false` |
| `hasShadow` | `false` | `true` (popover reads better with a shadow) |
| vibrancy | `'hud'` | `'popover'` |
| `setAlwaysOnTop('floating')` | yes | removed |
| `setVisibleOnAllWorkspaces` | yes | removed (popover is transient, tied to active display) |
| width × height | 320 × 260 | 320 × 280 (slightly taller, no drag header to absorb) |

Security webPreferences (`contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, preload path) are unchanged — non-negotiable per spec.

Vibrancy is applied inside a `try/catch` (same defensive pattern already in
`window.ts`); failure falls through to no vibrancy and must not crash.

### 1.3 Icon asset strategy

Create monochrome template PNGs under `resources/icons/`:

- `resources/icons/tray-icon.png` — 16×16 (1x / standard menu bar)
- `resources/icons/tray-icon@2x.png` — 32×32 (Retina)

Template image rule: the PNG must be black-on-transparent (alpha-defined
shape). macOS recolors template images automatically for light/dark menu bars.
A simple glyph (e.g. a small monitor/gauge or a filled circle) is sufficient.

**Path resolution.** In dev, the main bundle runs from `.vite/build`; in a
packaged app, `extraResource: ['resources']` copies `resources/` into
`Contents/Resources/resources/`. To resolve both:

```
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, 'resources', 'icons', 'tray-icon.png')
  : path.join(__dirname, '../../resources/icons/tray-icon.png');
```

`__dirname` in dev is `.vite/build`; `../../` reaches the project root where
`resources/` lives. (Implementer must confirm the dev relative depth against the
actual `.vite/build` layout at slice 2 time; adjust the `..` count if Electron
Forge nests the main bundle differently. A `console.error` if
`nativeImage.createFromPath` returns an empty image gives a fast diagnostic.)

`Tray` throws / shows nothing if the image is invalid, so the asset must exist
before any tray code is wired (slice 1 first — risk mitigation in proposal §7).

---

## 2. Data flow

### 2.1 Launch → tray visible (no dock, no floating window)

```
app.on('ready') →
  app.dock?.hide()                         // defensive; LSUIElement also set
  win   = createPopoverWindow()            // hidden, show:false
  registerIpcHandlers(win)                 // unchanged metric/SSH bootstrap
  tray  = createTray()                     // module-level ref
  tray.setContextMenu(Menu[{ Quit }])
  tray.on('click', () => togglePanel())
  win.on('blur', () => { if (!win.isDestroyed()) win.hide() })
```

The renderer still loads at launch (hidden window), so `did-finish-load` fires
and the existing SSH-profile-restore + Local Network Privacy probe in
`ipc-handlers.ts` runs exactly as before — no behavioral change to metrics/SSH.

### 2.2 Tray click → show popover

```
togglePanel():
  if win.isVisible() → win.hide()
  else:
    positionBelowTray(win, tray)   // compute x/y from tray.getBounds()
    win.show()
    win.focus()
```

### 2.3 Blur → hide (click-outside auto-close)

```
win.on('blur') → if (!win.isDestroyed()) win.hide()
```

Right-clicking the tray opens the *tray's* context menu (a separate native
surface), which does not steal focus from the window in a way that requires
special handling — but because the user clicked outside the window, `blur` may
fire and hide the popover. That is acceptable (clicking the tray to get the menu
is "outside" the popover). The guard the spec asks for is satisfied by the
`isDestroyed()` check and by the fact that the Quit action lives on the tray
menu, not in the window, so hide-on-blur never races with quit.

### 2.4 In-window close button → hide (not quit)

```
renderer close button → window.api.hideWindow()
  → ipcRenderer.send(CH.WINDOW_HIDE)
  → main handler: if (!win.isDestroyed()) win.hide()
```

### 2.5 IPC channel changes

| Channel const | Before | After |
|---|---|---|
| `WINDOW_MINIMIZE: 'window:minimize'` | `win.minimize()` | renamed → `WINDOW_HIDE: 'window:hide'`, handler `win.hide()` |
| `APP_CLOSE: 'app:close'` | `app.quit()` | **kept**, still `app.quit()` — but no longer sent from the renderer close button; reserved for any future explicit quit affordance. The primary quit path is the tray context menu. |

Decision on `APP_CLOSE`: keep the channel and handler intact (it still calls
`app.quit()`), but the renderer no longer wires a button to it. This avoids
churn and leaves a clean explicit-quit IPC path. The renderer close/hide button
maps to `WINDOW_HIDE`. `closeApp()` stays in `MonitorApi` but becomes unused by
current components (no orphaned *sender* is created — orphaned senders are the
risk; an unused but fully-handled channel is fine).

---

## 3. File changes

### 3.1 `resources/icons/tray-icon.png` + `tray-icon@2x.png` (NEW)

- 16×16 and 32×32 monochrome (black-on-transparent) template PNGs.
- `resources/` directory does not yet exist in the repo and must be created.
- `forge.config.ts` already declares `extraResource: ['resources']`, so once the
  folder exists it is bundled into packaged builds automatically.

### 3.2 `src/main/index.ts` (MODIFY — significant)

- Imports: add `Tray`, `Menu`, `nativeImage` to the `electron` import; add
  `import path from 'node:path'`; replace `createWidgetWindow` import with
  `createPopoverWindow`.
- Add module-level `let tray: Tray | null = null;` next to `mainWindow`.
- Replace `bootstrap()`:
  - call `app.dock?.hide()` (optional chaining — `app.dock` is macOS-only).
  - `mainWindow = createPopoverWindow();`
  - `registerIpcHandlers(mainWindow);`
  - `tray = createTray();` (new local helper in this file).
  - wire `tray.on('click', togglePanel)` and `tray.setContextMenu(...)`.
  - wire `mainWindow.on('blur', () => { if (!mainWindow?.isDestroyed()) mainWindow?.hide(); })`.
- Add `createTray()`: resolves icon path (per §1.3), builds `nativeImage`, calls
  `icon.setTemplateImage(true)`, `new Tray(icon)`, sets a context menu with one
  `Quit` item (`role: 'quit'` or `click: () => app.quit()`), returns the tray.
- Add `togglePanel()` / `showPanel()` helpers (per §2.2).
- Remove the `app.on('activate')` floating-window restore — a tray app has no
  dock icon to click for `activate`; the handler is harmless but pointless. Keep
  `window-all-closed` guard as-is (proposal §7: on macOS it correctly does
  nothing; `win.hide()` means the window never closes anyway).

### 3.3 `src/main/window.ts` (MODIFY — replace function)

- Rename/replace `createWidgetWindow()` → `createPopoverWindow()` with the
  config in §1.2 (`show:false`, `alwaysOnTop:false`, `setVibrancy('popover')`,
  height 280, `hasShadow:true`; drop `setAlwaysOnTop('floating')` and
  `setVisibleOnAllWorkspaces`).
- Add `positionBelowTray(win, tray)` helper (signature in §4).
- Keep dev/prod URL loading logic unchanged.
- Keep the macOS `setWindowButtonVisibility(false)` call (harmless on a
  frameless window; preserves no-traffic-lights behavior).

### 3.4 `src/main/ipc-handlers.ts` (MODIFY — small)

- Replace the `CH.WINDOW_MINIMIZE` listener:
  ```
  ipcMain.on(CH.WINDOW_HIDE, () => {
    if (!win.isDestroyed()) win.hide();
  });
  ```
- In the teardown closure, replace
  `ipcMain.removeAllListeners(CH.WINDOW_MINIMIZE)` →
  `ipcMain.removeAllListeners(CH.WINDOW_HIDE)`.
- `CH.APP_CLOSE` handler and its teardown stay unchanged (`app.quit()`).

### 3.5 `src/shared/channels.ts` (MODIFY — rename one const)

- Replace `WINDOW_MINIMIZE: 'window:minimize',` with
  `WINDOW_HIDE: 'window:hide',`. Keep `APP_CLOSE`. No other changes.

### 3.6 `src/shared/types.ts` (MODIFY — rename API method)

- In `MonitorApi`: replace `minimizeWindow(): void;` with `hideWindow(): void;`.
  Keep `closeApp(): void;` (still implemented, now unused by components).

### 3.7 `src/preload/index.ts` (MODIFY — rename method impl)

- Replace:
  ```
  minimizeWindow(): void {
    ipcRenderer.send(CH.WINDOW_MINIMIZE);
  },
  ```
  with:
  ```
  hideWindow(): void {
    ipcRenderer.send(CH.WINDOW_HIDE);
  },
  ```
- `closeApp()` left as-is (sends `CH.APP_CLOSE`).

### 3.8 `src/renderer/components/WindowControls.tsx` (MODIFY)

- Remove the minimize button entirely.
- Keep a single button repurposed as hide-to-tray: `onClick={() =>
  window.api.hideWindow()}`, `aria-label="Hide"`, `title="Hide"`, glyph `×`.
- Class can stay `window-control--close` (CSS unchanged) or become
  `window-control--hide`; cosmetic only.

### 3.9 `src/renderer/components/MetricsWidget.tsx` (MODIFY)

- Remove `drag` class from the root `div` (`className="widget"`) and from
  `<header>` (`className="widget__header"`).
- Remove `no-drag` from `widget__header-actions` (no longer meaningful, but
  harmless to keep; recommend removing for clarity).
- Keep `WindowControls` usage (now a hide button). The component import stays.
- `widget__fix-btn no-drag` → drop `no-drag` (cosmetic).

### 3.10 `forge.config.ts` (MODIFY)

- Add to `extendInfo`: `LSUIElement: 1` (suppresses Dock icon at launch before
  `app.dock.hide()` runs). Place alongside existing keys; do not disturb
  `NSLocalNetworkUsageDescription` / `NSBonjourServices`.
- `extraResource: ['resources']` already present — confirm `resources/icons/`
  lands in the packaged bundle (it will, as a child of `resources/`).

> Note: `MetricsWidget.tsx` and `SSHPanel.tsx` are unchanged structurally aside
> from drag-class removal. `App.tsx`, hooks, MetricCard, ProfileSelector,
> SSHPanel, all main metric/profile modules, and `tests/` are untouched.

---

## 4. Contracts

```ts
// src/main/window.ts

/**
 * Creates the tray-anchored popover window: hidden on creation, frameless,
 * not always-on-top, with macOS 'popover' vibrancy. Security defaults
 * (contextIsolation/nodeIntegration/sandbox) are enforced. The window is
 * shown/hidden programmatically by the tray click handler and blur handler.
 */
export function createPopoverWindow(): BrowserWindow;

/**
 * Positions `win` directly below the tray icon, horizontally centered under it,
 * with a small vertical gap. Resolves the target display from the tray bounds
 * and clamps x so the window stays fully within that display's work area
 * (handles right-edge overflow and multi-monitor placement).
 *
 * @param win  the popover window (uses win.getBounds().width/height)
 * @param tray the Tray instance (uses tray.getBounds())
 */
export function positionBelowTray(win: BrowserWindow, tray: Tray): void;
```

`positionBelowTray` algorithm:

```
const trayB = tray.getBounds();
const { width: w, height: h } = win.getBounds();
const display = screen.getDisplayNearestPoint({ x: trayB.x, y: trayB.y });
const area = display.workArea;
const GAP = 4;

let x = Math.round(trayB.x + trayB.width / 2 - w / 2);
const y = Math.round(trayB.y + trayB.height + GAP);

// clamp within the target display's work area (both edges)
const minX = area.x + 8;
const maxX = area.x + area.width - w - 8;
x = Math.max(minX, Math.min(x, maxX));

win.setBounds({ x, y, width: w, height: h });
```

(`Tray` type imported from `electron`; `screen` imported from `electron` in
`window.ts`.)

```ts
// src/main/index.ts (file-local helpers, not exported)
function createTray(): Tray;          // builds nativeImage, sets template, context menu
function togglePanel(): void;         // show+position+focus if hidden, else hide
```

```ts
// src/shared/types.ts — MonitorApi delta
- minimizeWindow(): void;
+ hideWindow(): void;
//  closeApp(): void;  (unchanged)
```

---

## 5. Tests (manual — no test runner change)

No automated test covers window geometry or tray (confirmed: `tests/` only
covers validation contracts via `__test__`). The 22 existing unit tests remain
valid and must still pass unchanged.

Automated gate:
- `npm test` → all 22 pass (no logic touched in validators).
- `npx tsc --noEmit` → zero type errors (catches the `minimizeWindow` →
  `hideWindow` rename propagation across types/preload/component).

Manual smoke test (dev, `npm start`):
1. App launches with **no** floating widget and **no** Dock icon; a tray icon
   appears top-right in the menu bar.
2. Left-click tray → popover appears directly below the icon, centered, with a
   small gap; shows Local + Remote metric sections.
3. Local CPU / RAM / Disk / Temp update every ~2s while popover is open.
4. Click anywhere outside the popover → it hides; tray icon remains.
5. Left-click tray again → popover re-shows (same window, state preserved).
6. In-window close (×) button → popover hides (app does NOT quit); tray click
   re-opens it.
7. Open SSH panel from inside the popover, perform a profile save/select; remote
   metrics stream. Confirm the password `<input>` does not trigger an unwanted
   blur-hide while typing (it should not — focus stays in the window).
8. Right-click tray → context menu with Quit; selecting Quit fully exits.
9. No console errors about unhandled IPC channels (verifies `window:minimize`
   has no orphaned sender and `window:hide` is handled).

Edge checks:
10. Move the menu bar to a secondary display (or test on a multi-monitor rig):
    popover appears on the display owning the tray icon.
11. Tray near right screen edge: popover x clamps so it stays fully on screen.

Packaged check (`npm run package` on macOS):
12. Launched `.app` shows the tray icon and no Dock icon (LSUIElement +
    dock.hide).

---

## 6. Rollout (implementation order)

Follow the proposal's slices; each slice is independently compilable except
slice 2 depends on slice 1's asset.

1. **Slice 0 — snapshot.** Save current copies of the 7 files in §3.2–§3.10 to
   `openspec/changes/rebuild-menubar-monitor/rollback-snapshots/` (git is not
   enabled here; this is the rollback mechanism).
2. **Slice 1 — assets + build prereqs.** Create `resources/icons/tray-icon.png`
   + `@2x`; add `LSUIElement: 1` to `forge.config.ts`. (No tray code yet, so the
   app still runs the old widget — safe.)
3. **Slice 2 — main: tray + popover.** Rewrite `window.ts`
   (`createPopoverWindow` + `positionBelowTray`) and `index.ts` (`createTray`,
   `app.dock.hide`, click/blur wiring, context menu). After this slice the app
   is a tray app, but the renderer still references `minimizeWindow`.
4. **Slice 3 — IPC + channel rename.** `channels.ts`, `ipc-handlers.ts`,
   `types.ts`, `preload/index.ts` in one coordinated edit (rename
   `WINDOW_MINIMIZE`→`WINDOW_HIDE`, `minimizeWindow`→`hideWindow`). This must be
   atomic with slice 4 to avoid a dangling sender / type error.
5. **Slice 4 — renderer cleanup.** `WindowControls.tsx` (hide-only button),
   `MetricsWidget.tsx` (drop drag classes). Now `tsc` is clean.
6. **Slice 5 — verify.** `npm test`, `npx tsc --noEmit`, dev smoke test, then
   `npm run package` smoke test (steps in §5).

Slices 3 and 4 should land together (single coordinated commit/edit pass) — the
rename touches both the sender (renderer) and the handler (main); splitting them
leaves an unhandled channel or a type error in between.

---

## 7. Tradeoffs

### 7.1 Tray-only vs tray + window-toggle (chosen: toggle on left-click)

- **Toggle (chosen):** left-click shows if hidden, hides if visible. Best
  match to macOS menu-bar-app expectations; spec explicitly permits it.
- **Show-only:** simpler, but a second click on an open popover would be a
  no-op while the icon is the obvious "close" affordance — worse UX.
  Auto-hide-on-blur already covers most closing, so toggle's hide branch is a
  minor add. Toggle chosen.

### 7.2 `LSUIElement` vs `app.dock.hide()` (chosen: both)

- `LSUIElement: 1` in Info.plist prevents the Dock icon from *ever* flashing at
  launch (it is read before JS runs). But it only applies to packaged builds
  with an Info.plist; in `npm start` dev the Electron binary's own plist is
  used, so a Dock icon can briefly appear.
- `app.dock.hide()` at `ready` covers dev and is a defensive backstop for
  Electron versions where `LSUIElement` alone is insufficient (proposal §7).
- Using **both** is idempotent and safe; neither alone fully covers both dev and
  packaged. Chosen: both.

### 7.3 Blur-guard approach (chosen: simple `isDestroyed()` guard, no flag)

- **Chosen:** `win.on('blur', () => { if (!win.isDestroyed()) win.hide(); })`.
  Minimal, matches the spec's required destroyed-window guard. The tray context
  menu lives on the tray (separate surface) and the only in-window focusables
  are HTML inputs (no native OS dialogs in this app — SSH password is an
  `<input>`), so no extra "ignore blur while menu open" flag is needed.
- **Rejected:** a `suppressBlurHide` boolean toggled around context-menu
  display. Adds state and race surface for a scenario this app doesn't hit
  (no native file pickers / OS dialogs). If a future feature adds a native
  dialog inside the popover, introduce the flag then.

### 7.4 Recreate-per-open vs persistent hidden window (chosen: persistent)

- **Persistent (chosen):** one window created at `ready`, `show:false`, reused.
  Preserves metric streams, SSH connection, and the one-time Local Network
  Privacy bootstrap across open/close cycles. Lower latency on open.
- **Recreate:** would re-run the renderer and re-trigger the SSH restore +
  TCC probe every open — slow, and could re-prompt for Local Network. Rejected.

### 7.5 Keep vs remove `APP_CLOSE` / `closeApp` (chosen: keep, leave unused)

- Keeping the fully-handled `app:close` channel costs nothing and preserves a
  clean explicit-quit IPC path for future use. An unused but *handled* channel
  is not the orphaned-sender risk (the risk is a sender with no handler). The
  renderer close button is repointed to `WINDOW_HIDE`; tray menu owns real quit.

---

## 8. Open questions / implementer flags

1. **Dev icon path depth.** The `../../resources/icons` relative path from
   `.vite/build` must be confirmed against the actual Forge/Vite output layout
   at slice 2. If `nativeImage.createFromPath` returns `isEmpty() === true`, the
   path is wrong — log and adjust the `..` count. (Low risk, fast to diagnose.)
2. **`entitlements.plist`.** `forge.config.ts` `postPackage` references
   `${__dirname}/entitlements.plist`. This file was not found in the repo scan;
   it is out of scope for this change but if packaging fails on signing it is a
   pre-existing issue, not introduced here.
3. **Window height.** 280px is an estimate; if the SSH panel view overflows,
   adjust `createPopoverWindow` height. Width 320 is unchanged from the widget.
