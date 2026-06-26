# Proposal: rebuild-menubar-monitor

## Date: 2026-06-19

---

## 1. Intent

Convert the existing Electron floating-widget system monitor into a proper macOS
menu bar application. The floating, always-on-top `BrowserWindow` is replaced by
a `Tray` icon in the macOS status bar (top-right). Clicking the tray icon opens
a popover panel anchored below the icon; clicking anywhere outside closes it.
The app will have no Dock presence. All existing monitoring functionality —
local metrics, SSH remote metrics, and SSH profile management — is preserved
inside the popover panel. The floating widget paradigm is retired entirely.

---

## 2. Scope

### In scope

- Replace `createWidgetWindow()` in `src/main/window.ts` with a new
  `createPopoverWindow()` that produces a hidden, non-always-on-top
  `BrowserWindow` with `show: false` and positioning logic anchored to the tray
  icon bounds.
- Rewrite `src/main/index.ts` to create a `Tray` object, wire its `click`
  handler to show/hide the popover, and call `app.dock.hide()` on `ready`.
- Add `LSUIElement = 1` to `extendInfo` in `forge.config.ts` to prevent the
  Dock icon from appearing on app launch before `app.dock.hide()` is called.
- Add a tray icon PNG asset (`resources/icons/tray-icon.png`, 16×16 and
  22×22@2x for Retina) and wire it into the `Tray` constructor.
- Remove drag-region CSS and the `WindowControls` minimize button from the
  renderer; the popover has no need for user repositioning or an in-app minimize
  action.
- Replace `window:minimize` semantics: the `APP_CLOSE` IPC handler is
  repurposed to hide the popover window (`win.hide()`) rather than `app.quit()`.
  A separate quit path is exposed through a tray right-click context menu.
- Update `src/shared/channels.ts` to rename `WINDOW_MINIMIZE` to
  `WINDOW_HIDE` and document the tray-hide semantics, or remove the channel if
  `WindowControls` is dropped entirely.
- Partially supersede `openspec/specs/local-metrics/spec.md`: requirements
  "Floating Always-On-Top Window" and "Draggable Widget Surface" are
  superseded by tray-popover semantics. All other requirements (metrics display,
  IPC security, error handling, 2s poll) remain in force and are inherited
  unchanged.
- Popover window uses `setVibrancy('popover')` instead of `'hud'` for
  macOS-native popover appearance.

### Out of scope

- Credential security (`safeStorage`) — deferred to a future phase as before.
- Windows or Linux builds — this change is macOS-only by nature.
- Inline tray title text (e.g., CPU % shown directly in the menu bar itself).
  The icon-only tray approach is used.
- Multi-window modes or a separate SSH management window.

---

## 3. Affected Areas

### 3.1 Files that must change

| File | Change |
|---|---|
| `src/main/index.ts` | Import `Tray`; add `createTray()` call on `ready`; call `app.dock.hide()`; wire tray `click` to `showPanel()` / `hidePanel()`; add right-click context menu with Quit; remove `app.on('activate')` bootstrap for floating-window restore |
| `src/main/window.ts` | Replace `createWidgetWindow()` with `createPopoverWindow()`: `show: false`, `alwaysOnTop: false`, no drag, `setVibrancy('popover')`; add `positionBelowTray(win, tray)` positioning helper; add `win.on('blur') → win.hide()` auto-close |
| `src/main/ipc-handlers.ts` | Change `CH.WINDOW_MINIMIZE` handler to call `win.hide()`; change `CH.APP_CLOSE` handler to call `app.quit()` (it now means tray-menu-quit); guard `win.isDestroyed()` before `win.hide()` |
| `src/shared/channels.ts` | Rename `WINDOW_MINIMIZE: 'window:minimize'` to `WINDOW_HIDE: 'window:hide'` (or remove if `WindowControls` is dropped) |
| `src/preload/index.ts` | Rename `minimizeWindow()` to `hideWindow()` (or remove) to match channel rename |
| `src/renderer/components/WindowControls.tsx` | Remove minimize button; keep only the close/hide button (repurposed as hide-to-tray, not quit) — or remove the component entirely and rely on click-outside auto-close |
| `src/renderer/components/MetricsWidget.tsx` | Remove `drag` / `no-drag` CSS classes from the root div and header; remove `WindowControls` usage from the header (or replace with hide-only button) |
| `forge.config.ts` | Add `LSUIElement: 1` to `extendInfo`; ensure tray icon file is included in `extraResource` (already covered by `resources/` glob) |

### 3.2 Files that stay the same

| File | Rationale |
|---|---|
| `src/main/metrics-local.ts` | Pure `systeminformation` polling loop; no window coupling |
| `src/main/metrics-remote.ts` | `RemoteMetricsManager` receives a `BrowserWindow` ref via `attach(win)`; no coupling to window type |
| `src/main/profile-store.ts` | Storage layer is fully decoupled |
| `src/main/parsers.ts` | Pure functions; no change |
| `src/main/temperature-macos.ts` | Platform utility; no change |
| `src/preload/index.ts` | Minimal change (rename one function); overall API bridge structure unchanged |
| `src/shared/types.ts` | Types unchanged |
| `src/renderer/App.tsx` | View-toggle logic (widget vs SSH panel) is valid inside a popover |
| `src/renderer/components/SSHPanel.tsx` | SSH form unchanged |
| `src/renderer/components/ProfileSelector.tsx` | Unchanged |
| `src/renderer/components/MetricCard.tsx` | Unchanged |
| `src/renderer/hooks/useMetrics.ts` | IPC subscription hooks unchanged |
| `src/renderer/styles/` | CSS variables and layout rules unchanged; drag/no-drag rules become unused but do not need to be removed for correctness |
| `tests/` | All 22 unit tests remain valid; none test window geometry or tray |

### 3.3 New additions

| Addition | Purpose |
|---|---|
| `resources/icons/tray-icon.png` (16×16) | Required by `Tray` constructor; app will not launch without a valid PNG |
| `resources/icons/tray-icon@2x.png` (32×32 at 2x scale) | Retina-quality tray icon on HiDPI displays |
| `positionBelowTray(win, tray)` helper in `window.ts` | Computes `tray.getBounds()` and positions the `BrowserWindow` below the icon, accounting for screen edge cases |
| Right-click context menu on the `Tray` | Provides a Quit option since closing the popover window only hides it |

---

## 4. Architecture

### 4.1 Bootstrap sequence (new)

```
app.on('ready') →
  1. app.dock.hide()
  2. createTray(iconPath) → Tray object stored as module-level ref
  3. createPopoverWindow() → BrowserWindow, show: false, preload wired
  4. registerIpcHandlers(win)
  5. tray.on('click') → showPanel() or togglePanel()
  6. tray.setContextMenu([{ label: 'Quit', click: () => app.quit() }])

showPanel():
  a. positionBelowTray(win, tray)
  b. win.show()
  c. win.focus()

win.on('blur') → win.hide()   // click-outside auto-close
```

### 4.2 Popover window geometry

The popover `BrowserWindow` uses the same width (320 px) as the current widget
and a height of approximately 280 px (slightly taller than the current 260 px to
accommodate content without a drag header). `positionBelowTray` reads
`tray.getBounds()` and `screen.getDisplayNearestPoint()` to compute:

```
x = Math.round(trayBounds.x + trayBounds.width / 2 - windowWidth / 2)
y = trayBounds.y + trayBounds.height + 4    // 4 px gap below icon
```

If the computed `x + windowWidth` would overflow the right edge of the display,
clamp `x` to `displayRight - windowWidth - 8`.

### 4.3 App close vs window hide semantics

| Action | Before (floating widget) | After (tray popover) |
|---|---|---|
| `app:close` IPC | `app.quit()` | `app.quit()` (from tray right-click Quit) |
| In-window close/hide button | `app.quit()` | `win.hide()` (popover hides to tray) |
| Click outside popover | N/A | `win.on('blur')` → `win.hide()` |
| Re-open | N/A | Tray icon click → `win.show()` |

### 4.4 Tray object lifetime

The `Tray` instance MUST be stored in a module-level variable for the lifetime
of the app. Allowing it to be garbage-collected causes the tray icon to
disappear. The `mainWindow` module-level reference in `index.ts` is extended to
also hold a `tray: Tray | null` reference.

---

## 5. Spec Changes

### 5.1 `openspec/specs/local-metrics/spec.md` — partial supersede

The following two requirements from `local-metrics` spec are **superseded** by
this change and no longer apply to the rebuilt app:

- **Floating Always-On-Top Window**: The app no longer presents a floating,
  always-on-top window. Instead it uses a tray-anchored popover. The new window
  is `alwaysOnTop: false`, `show: false` on creation, and is shown/hidden
  programmatically.

- **Draggable Widget Surface**: The popover is anchored to the tray icon
  position and is not user-repositionable. Drag CSS regions are removed.

All other `local-metrics` requirements remain in force:

- Local CPU Load Display
- Local RAM Display
- Optional Local CPU Temperature Display
- Periodic Metric Refresh (2 s)
- Secure IPC Boundary for Metrics
- Resilient Error Handling

These requirements are inherited without modification by this change.

A follow-up spec update to `local-metrics/spec.md` may be written after this
change is implemented to document the new popover window behavior formally.
This proposal authorizes the implementation to deviate from the two superseded
requirements.

---

## 6. Implementation Plan

### Slice 1 — Asset and build prerequisites

1. Create `resources/icons/tray-icon.png` (16×16) and
   `resources/icons/tray-icon@2x.png` (32×32). A simple monochrome template
   image (white circle or system monitor glyph) renders correctly in both light
   and dark menu bar modes when using Electron's `image.setTemplateImage(true)`.
2. Add `LSUIElement: 1` to `forge.config.ts` `extendInfo`.
3. Verify `resources/` is still included by `extraResource`.

### Slice 2 — Main process: Tray + popover window

4. Rewrite `src/main/window.ts`: replace `createWidgetWindow` with
   `createPopoverWindow` and `positionBelowTray` helper.
5. Rewrite `src/main/index.ts`: `createTray`, `app.dock.hide()`, tray event
   wiring, context menu, `win.on('blur')` auto-hide.

### Slice 3 — IPC and channel cleanup

6. Update `src/shared/channels.ts`: rename or remove `WINDOW_MINIMIZE`.
7. Update `src/main/ipc-handlers.ts`: change handler behaviors per section 4.3.
8. Update `src/preload/index.ts`: rename or remove `minimizeWindow`.

### Slice 4 — Renderer cleanup

9. Update `src/renderer/components/MetricsWidget.tsx`: remove drag CSS classes,
   replace or remove `WindowControls`.
10. Update `src/renderer/components/WindowControls.tsx`: convert to a hide-only
    control or remove entirely.

### Slice 5 — Smoke-test and verification

11. Launch in dev mode (`npm start`): verify tray icon appears, popover opens
    on click, click-outside hides it, metrics stream, SSH panel opens.
12. Run full unit test suite (`npm test`): all 22 tests pass.
13. Run `npm run package` on macOS: verify no Dock icon on launch, tray icon
    present in packaged `.app`.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Missing tray icon PNG blocks app launch entirely | High | Slice 1 creates the asset before any code changes; app will not compile-succeed without it. Use a minimal 1-color template PNG if a designed icon is not yet available. |
| Tray object garbage-collected, icon disappears | High | Store `Tray` in module-level variable for app lifetime; document in code comment. |
| `win.on('blur')` fires during right-click context menu on tray, hiding the popover | Medium | The context menu is on the tray itself, not on the window, so `blur` on the window is not triggered by right-clicking the tray icon. Validate during smoke test. |
| `win.on('blur')` fires when user interacts with SSH panel (e.g. native OS dialog for file picker) | Medium | SSH panel in this app has no OS-native dialogs; password field uses an HTML `<input>`. No exemption needed. |
| Multi-monitor / HiDPI: tray `getBounds()` returns screen-space coordinates; window could appear on wrong display | Medium | Use `screen.getDisplayNearestPoint(trayBounds)` to resolve target display and clamp x within its `workArea`. |
| `LSUIElement + app.dock.hide()` interaction: on some Electron versions, `LSUIElement: 1` alone does not fully suppress Dock; `app.dock.hide()` is also needed | Low | Apply both; `app.dock.hide()` call is idempotent and safe alongside `LSUIElement`. |
| `setVibrancy('popover')` may not render correctly on older macOS — app targets macOS 12+ | Low | Fall through to no vibrancy on catch; same pattern already in `window.ts`. |
| Existing `window:minimize` IPC channel referenced in renderer `WindowControls.tsx` — must not leave a dangling IPC send with no handler | Medium | Remove channel and handler together in Slice 3 and Slice 4 as a single coordinated step. |
| `app.on('window-all-closed')` currently quits on non-macOS; the popover `win.hide()` does not close the window, so this event never fires on macOS in the tray pattern | None | On macOS the existing guard `if (process.platform !== 'darwin') app.quit()` is already correct; macOS path does nothing on window-all-closed in a tray app. |

---

## 8. Rollback

Git is not enabled in this project directory. Rollback is file-based:

1. `src/main/index.ts` — restore prior content (Tray removed, `createWidgetWindow` restored).
2. `src/main/window.ts` — restore `createWidgetWindow` with all original options.
3. `src/main/ipc-handlers.ts` — restore `CH.WINDOW_MINIMIZE` → `win.minimize()` and `CH.APP_CLOSE` → `app.quit()`.
4. `src/shared/channels.ts` — restore `WINDOW_MINIMIZE` channel name.
5. `src/preload/index.ts` — restore `minimizeWindow`.
6. `src/renderer/components/WindowControls.tsx` — restore minimize + close buttons.
7. `src/renderer/components/MetricsWidget.tsx` — restore drag CSS classes and `WindowControls` import.
8. `forge.config.ts` — remove `LSUIElement: 1` from `extendInfo`.

The tray icon assets in `resources/icons/` are additive and do not need to be
removed on rollback. The `LSUIElement` removal in step 8 is required to restore
Dock presence.

Prior to beginning implementation, a snapshot of the five files in 3.1 that
must change should be saved to
`openspec/changes/rebuild-menubar-monitor/rollback-snapshots/`.

---

## 9. Success Criteria

The change is complete and successful when all of the following hold:

1. **Tray icon visible**: launching the app does NOT show a floating widget; a
   tray icon appears in the macOS menu bar status area.

2. **No Dock icon**: the app has no Dock icon after launch (both in dev and
   packaged builds).

3. **Popover opens on click**: clicking the tray icon shows the popover panel
   below the icon, containing Local and Remote metric sections.

4. **Click-outside hides popover**: clicking anywhere outside the popover closes
   it; the tray icon remains.

5. **Metrics stream correctly**: local CPU, RAM, Disk, Temp values update every
   2 seconds inside the popover panel.

6. **SSH remote metrics work**: selecting an SSH profile connects and streams
   remote metrics; all SSH panel CRUD operations function.

7. **Quit from tray**: right-clicking the tray icon shows a context menu with a
   Quit item that fully exits the app.

8. **No dangling IPC channels**: no console errors about unhandled IPC channels;
   `window:minimize` (or its renamed replacement) has no orphaned sender.

9. **Unit tests pass**: `npm test` reports all 22 existing tests passing with no
   new failures.

10. **Packaged build**: `npm run package` produces a `.app` where the tray icon
    is present in the menu bar and `LSUIElement` suppresses the Dock icon on
    launch.

11. **TypeScript clean**: `npx tsc --noEmit` reports zero type errors after all
    file changes.
