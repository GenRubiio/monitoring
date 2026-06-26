# Apply Progress: rebuild-menubar-monitor

## Date: 2026-06-19

Mode: standard (strict TDD inactive — no test runner configured for new code;
existing Jest suite is a regression gate only).
Delivery path: `force-chained` — single session, 5 slices in order, single PR
(within ~145-line budget, 400-line risk Low).

---

## Summary by slice

### Prerequisites
- **P-1** Read all nine target files before editing.
- **P-2** Created `openspec/changes/rebuild-menubar-monitor/rollback-snapshots/`
  and copied the nine pre-change files into it (git not enabled; this is the
  file-based rollback mechanism).

### Slice 1 — Assets + LSUIElement (additive; old widget still ran after this)
- Created `resources/icons/` directory.
- Created `resources/icons/tray-icon.png` — valid 16×16 RGBA PNG, a
  black-on-transparent filled circle (template-image-ready). Verified:
  `PNG image data, 16 x 16`.
- Created `resources/icons/tray-icon@2x.png` — valid 32×32 RGBA PNG, same glyph.
  Verified: `PNG image data, 32 x 32`.
- Generated programmatically with Python (zlib + struct PNG writer) since no
  image tool was available. Alpha defines the shape so macOS recolors it for
  light/dark menu bars once `setTemplateImage(true)` is applied.
- `forge.config.ts`: added `LSUIElement: 1` inside `extendInfo`, alongside the
  untouched `NSLocalNetworkUsageDescription` and `NSBonjourServices` keys.
- Confirmed `packagerConfig.extraResource` still reads `['resources']`; the new
  `resources/icons/` is bundled as a child.

### Slice 2 — Main process: Tray + popover window
- `src/main/window.ts`: replaced `createWidgetWindow()` with
  `createPopoverWindow()` (`show:false`, `frame:false`, `transparent:true`,
  `alwaysOnTop:false`, `resizable:false`, `skipTaskbar:true`, `hasShadow:true`,
  width 320 × height 280; security webPreferences unchanged). Dropped
  `setAlwaysOnTop(true,'floating')` and `setVisibleOnAllWorkspaces(true)`.
  Replaced `setVibrancy('hud')` with `setVibrancy('popover')` inside the
  existing macOS try/catch (kept `setWindowButtonVisibility(false)`). Added
  exported `positionBelowTray(win, tray)` using `screen.getDisplayNearestPoint`
  + work-area clamp on both edges (4px gap below the icon). Imported `screen`
  and the `Tray` type from `electron`.
- `src/main/index.ts`: imports now include `Menu`, `Tray`, `nativeImage`,
  `node:path`, `createPopoverWindow`, `positionBelowTray`. Added module-level
  `let tray: Tray | null = null`. `bootstrap()` now calls `app.dock?.hide()`,
  creates the popover window, registers IPC, creates the tray, wires
  `tray.on('click', togglePanel)`, and registers `mainWindow.on('blur', …)`
  auto-hide guarded by `isDestroyed()`. Added file-local `createTray()`
  (resolves dev vs packaged icon path, `isEmpty()` diagnostic log,
  `setTemplateImage(true)`, tooltip, right-click context menu with a single
  Quit item) and `togglePanel()`. Removed the `app.on('activate', …)` handler
  (no Dock icon to activate in a tray app). Kept the `window-all-closed` guard.

### Slice 3 + 4 — IPC rename + renderer (applied atomically, same pass)
- `src/shared/channels.ts`: `WINDOW_MINIMIZE: 'window:minimize'` →
  `WINDOW_HIDE: 'window:hide'`. `APP_CLOSE` kept.
- `src/shared/types.ts`: `MonitorApi.minimizeWindow()` → `hideWindow()`.
  `closeApp()` kept (still implemented, now unused by components — fully handled
  channel, not an orphaned sender).
- `src/preload/index.ts`: `minimizeWindow` impl → `hideWindow()` sending
  `CH.WINDOW_HIDE`.
- `src/main/ipc-handlers.ts`: listener `CH.WINDOW_MINIMIZE → win.minimize()`
  replaced with `CH.WINDOW_HIDE → win.hide()`; teardown
  `removeAllListeners(CH.WINDOW_MINIMIZE)` → `…(CH.WINDOW_HIDE)`. `APP_CLOSE`
  handler/teardown unchanged.
- `src/renderer/components/WindowControls.tsx`: removed the minimize button;
  the remaining button is now a hide-to-tray control
  (`onClick={() => window.api.hideWindow()}`, `aria-label/title="Hide"`, glyph
  `×`, class `window-control--close` retained for CSS reuse).
- `src/renderer/components/MetricsWidget.tsx`: removed `drag` from root `div`
  and `<header>`, removed `no-drag` from `widget__header-actions` and from the
  `widget__fix-btn` button. All other JSX/logic unchanged; `WindowControls`
  import/usage kept.

### Slice 5 — Verification
- `npx tsc --noEmit`: all `src/` application code compiles cleanly. The only
  reported errors are in `forge.config.ts` (line 52, the `execSync` overload for
  the `shell: true` option in the `postPackage` hook) — this is **pre-existing**
  and unrelated to this change: the `shell: true` line is present unchanged in
  the rollback snapshot, and my only forge.config.ts edit is the additive
  `LSUIElement: 1` key. No app-source type errors; the
  `minimizeWindow`→`hideWindow` rename propagated correctly.
- `npm test`: 4 suites passed, 1 skipped; 25 tests passed, 2 skipped, 0
  failures. (The spec text says "22"; the repo currently has 25 active tests —
  none touched by this change.)
- Grep audit: `minimizeWindow`, `WINDOW_MINIMIZE`, `createWidgetWindow`, and
  `win.minimize` no longer appear anywhere under `src/`.

---

## Files changed (exact paths)

New:
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/resources/icons/tray-icon.png`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/resources/icons/tray-icon@2x.png`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/openspec/changes/rebuild-menubar-monitor/rollback-snapshots/` (9 snapshot files)

Modified:
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/forge.config.ts`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/main/window.ts`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/main/index.ts`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/main/ipc-handlers.ts`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/shared/channels.ts`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/shared/types.ts`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/preload/index.ts`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/renderer/components/WindowControls.tsx`
- `/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/src/renderer/components/MetricsWidget.tsx`

---

## Commands run

- `file resources/icons/tray-icon.png resources/icons/tray-icon@2x.png` → valid 16×16 / 32×32 PNG.
- `grep -rn "minimizeWindow\|WINDOW_MINIMIZE\|createWidgetWindow\|win.minimize" src/` → no matches.
- `npx tsc --noEmit` → clean for `src/`; only the pre-existing `forge.config.ts` `execSync`/`shell:true` overload error remains.
- `npm test` → 25 passed, 2 skipped, 0 failed.

---

## Deviations from design

- **Icon generation method.** Icons were generated programmatically (Python PNG
  writer) rather than from a design tool — design §1.3 explicitly permits a
  simple filled-circle glyph. Shape is alpha-defined black-on-transparent, ready
  for `setTemplateImage(true)`.
- **`forge.config.ts` pre-existing tsc error.** `npx tsc --noEmit` is not
  fully zero-error because of a pre-existing `execSync(..., { shell: true })`
  overload mismatch in the `postPackage` hook (present in the original/snapshot,
  not introduced here). Success criterion §11 / task 5-2 ("zero type errors") is
  met for all application source under `src/`; the lone build-config error is
  out of scope and predates this change. Flagging for the maintainer.
- **Test count.** Spec/design reference "22 tests"; the repo actually runs 25
  active tests (+2 skipped). All pass; none were touched.

---

## Remaining tasks (manual / live-launch — cannot run headlessly)

- [ ] **5-3** Dev smoke test (`npm start`): tray icon appears, no Dock icon, no
  floating widget, popover opens below the icon on left-click, metrics stream,
  click-outside hides, re-open preserves state, in-window × hides (no quit),
  SSH panel works, password input does not trigger blur-hide, right-click Quit
  exits, no unhandled-IPC console errors.
- [ ] **5-4** Dev icon-path check: if the tray icon is blank, check console for
  `[tray] icon not found:` and adjust the `../../` depth in `createTray()`. The
  `app.isPackaged ? process.resourcesPath : __dirname/../../` resolution follows
  design §1.3; the relative dev depth (`.vite/build` → project root) must be
  confirmed at first launch (design open question §8.1).
- [ ] **5-5** Right-screen-edge clamp: confirm `positionBelowTray` keeps the
  window on screen.
- [ ] **5-6** Packaged build smoke test (`npm run package` on macOS): no Dock
  icon (LSUIElement), tray icon present, popover opens. Note: packaging may hit
  the pre-existing `entitlements.plist` reference in the postPackage hook
  (design §8.2) — out of scope for this change.

These require an interactive macOS GUI session and a packaging run; they are not
executable in this headless environment and are left for the maintainer.

---

## Workload / PR boundary

Single PR. All five implementation slices land together (~145 changed lines,
within the 400-line budget; 400-line risk Low; no chaining needed). Slices 3+4
were applied atomically so no intermediate state had an orphaned IPC sender or a
type error. Code-complete; only live/manual macOS verification (5-3..5-6)
remains.
