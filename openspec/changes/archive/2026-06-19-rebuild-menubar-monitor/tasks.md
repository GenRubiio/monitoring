# Tasks: rebuild-menubar-monitor

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~145 (additions + deletions across all files) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception (not needed — within budget) |

Per-file estimates:

| File | Est. additions | Est. deletions | Net delta |
|------|---------------|----------------|-----------|
| `resources/icons/tray-icon.png` (new binary) | — | — | new file |
| `resources/icons/tray-icon@2x.png` (new binary) | — | — | new file |
| `forge.config.ts` | 1 | 0 | +1 |
| `src/main/index.ts` | ~35 | ~10 | +45 |
| `src/main/window.ts` | ~35 | ~15 | +50 |
| `src/main/ipc-handlers.ts` | 4 | 4 | ~8 |
| `src/shared/channels.ts` | 1 | 1 | ~3 |
| `src/shared/types.ts` | 1 | 1 | ~3 |
| `src/preload/index.ts` | 3 | 3 | ~5 |
| `src/renderer/components/WindowControls.tsx` | ~10 | ~15 | ~25 |
| `src/renderer/components/MetricsWidget.tsx` | 0 | ~5 | ~5 |
| **Total** | | | **~145** |

```
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low
```

---

## Prerequisites

Before starting, confirm the current state of all files to be changed:

- [x] **P-1.** Read and note the current content of these files (they are the rollback targets):
  - `forge.config.ts`
  - `src/main/index.ts`
  - `src/main/window.ts`
  - `src/main/ipc-handlers.ts`
  - `src/shared/channels.ts`
  - `src/shared/types.ts`
  - `src/preload/index.ts`
  - `src/renderer/components/WindowControls.tsx`
  - `src/renderer/components/MetricsWidget.tsx`

- [x] **P-2.** Create rollback snapshots directory and copy the nine files above into it (git is not enabled; this is the rollback mechanism):
  ```
  openspec/changes/rebuild-menubar-monitor/rollback-snapshots/
  ```
  Verification: directory exists and contains copies of all nine files named identically to their source names.

---

## Slice 1 — Assets and build prerequisites

Goal: the app still launches as the old floating widget after this slice. Only additive changes are made.

- [x] **1-1.** Create directory `resources/icons/` under the project root (`/Users/evgeny.lyubeznyy/Desktop/Proyectos/monitoring/resources/icons/`).

- [x] **1-2.** Create `resources/icons/tray-icon.png` — a 16×16 monochrome (black-on-transparent alpha) PNG template image. A minimal single-color filled circle or monitor glyph is sufficient. The file MUST be a valid PNG; an invalid or empty file causes `Tray` construction to fail silently or throw at launch.

  Verification: `file resources/icons/tray-icon.png` reports `PNG image data, 16 x 16`.

- [x] **1-3.** Create `resources/icons/tray-icon@2x.png` — a 32×32 version of the same glyph. Electron uses the `@2x` suffix convention to auto-select the Retina variant.

  Verification: `file resources/icons/tray-icon@2x.png` reports `PNG image data, 32 x 32`.

- [x] **1-4.** Edit `forge.config.ts`: add `LSUIElement: 1` inside `extendInfo`, alongside the existing `NSLocalNetworkUsageDescription` and `NSBonjourServices` keys. No other changes to this file.

  Verification: `extendInfo` block contains `LSUIElement: 1` and the two existing keys are undisturbed.

- [x] **1-5.** Confirm that `extraResource: ['resources']` in `forge.config.ts` already covers the new `resources/icons/` directory (it does — the glob includes all children). No edit needed; this is a read-only check.

  Verification: `packagerConfig.extraResource` still reads `['resources']`.

---

## Slice 2 — Main process: popover window and tray

Goal: the app becomes a tray app. After this slice, the floating widget is gone, the tray icon appears, and the popover opens on click. The renderer still has the old `minimizeWindow` call, which will produce a harmless TypeScript warning until Slice 3 is applied. Dev smoke testing is possible after this slice.

- [x] **2-1.** Rewrite `src/main/window.ts`:
  - Remove `createWidgetWindow()`.
  - Add `createPopoverWindow()` with these `BrowserWindow` options:
    - `width: 320`, `height: 280`
    - `show: false`
    - `frame: false`
    - `transparent: true`
    - `alwaysOnTop: false`
    - `resizable: false`
    - `skipTaskbar: true`
    - `hasShadow: true`
    - `webPreferences`: `preload`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (unchanged from current)
  - Remove `win.setAlwaysOnTop(true, 'floating')` and `win.setVisibleOnAllWorkspaces(true)`.
  - In the macOS `try/catch` block: replace `win.setVibrancy('hud')` with `win.setVibrancy('popover')`; keep `win.setWindowButtonVisibility(false)`.
  - Keep dev/prod URL loading logic unchanged.
  - Add `positionBelowTray(win: BrowserWindow, tray: Tray): void` (exported). Import `Tray` and `screen` from `electron`. Algorithm (from design §4):
    ```
    const trayB = tray.getBounds();
    const { width: w, height: h } = win.getBounds();
    const display = screen.getDisplayNearestPoint({ x: trayB.x, y: trayB.y });
    const area = display.workArea;
    const GAP = 4;
    let x = Math.round(trayB.x + trayB.width / 2 - w / 2);
    const y = Math.round(trayB.y + trayB.height + GAP);
    const minX = area.x + 8;
    const maxX = area.x + area.width - w - 8;
    x = Math.max(minX, Math.min(x, maxX));
    win.setBounds({ x, y, width: w, height: h });
    ```

  Verification: `npx tsc --noEmit` passes (the `Tray` import type must resolve).

- [x] **2-2.** Rewrite `src/main/index.ts`:
  - Imports: add `Tray`, `Menu`, `nativeImage` to the `electron` import; add `import path from 'node:path'`; replace `createWidgetWindow` import with `createPopoverWindow`; add `positionBelowTray` to the `window` import.
  - Add module-level `let tray: Tray | null = null;` next to the existing `mainWindow` ref.
  - Rewrite `bootstrap()`:
    - Call `app.dock?.hide()` (optional chaining — `app.dock` is macOS-only).
    - `mainWindow = createPopoverWindow()`.
    - `registerIpcHandlers(mainWindow)`.
    - `tray = createTray()` (new file-local function, see below).
    - `tray.on('click', togglePanel)`.
    - Wire `mainWindow.on('blur', () => { if (!mainWindow?.isDestroyed()) mainWindow?.hide(); })`.
  - Add file-local `createTray(): Tray`:
    - Resolve icon path:
      ```ts
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'resources', 'icons', 'tray-icon.png')
        : path.join(__dirname, '../../resources/icons/tray-icon.png');
      ```
    - Build: `const icon = nativeImage.createFromPath(iconPath)`.
    - Guard: if `icon.isEmpty()`, log `console.error('[tray] icon not found:', iconPath)` — the Tray will still be constructed (it will throw or be invisible, which surfaces the path issue fast).
    - `icon.setTemplateImage(true)`.
    - `const t = new Tray(icon)`.
    - `t.setContextMenu(Menu.buildFromTemplate([{ label: 'Quit', click: () => app.quit() }]))`.
    - Return `t`.
  - Add file-local `togglePanel(): void`:
    - If `mainWindow?.isVisible()` → `mainWindow.hide()`
    - Else → `positionBelowTray(mainWindow!, tray!)`, `mainWindow!.show()`, `mainWindow!.focus()`
  - Remove `app.on('activate', ...)` handler (tray app has no dock icon to click; the activate event is irrelevant).
  - Keep `app.on('window-all-closed', ...)` as-is (macOS path does nothing, which is correct for a tray app where `win.hide()` never fires `window-all-closed`).

  Verification: `npx tsc --noEmit` passes; `npm start` launches with a tray icon, no floating widget, no Dock icon.

---

## Slice 3 — IPC and channel rename

Goal: `WINDOW_MINIMIZE`/`minimizeWindow` references are gone from the entire codebase; `WINDOW_HIDE`/`hideWindow` are in place. This slice and Slice 4 are atomic — they must be applied together before running `tsc` to avoid orphaned sender or type errors. Apply Slice 3 then immediately Slice 4 in the same session.

- [x] **3-1.** Edit `src/shared/channels.ts`: rename `WINDOW_MINIMIZE: 'window:minimize'` to `WINDOW_HIDE: 'window:hide'`. No other changes.

  Verification: the string `WINDOW_MINIMIZE` no longer appears in this file; `WINDOW_HIDE: 'window:hide'` is present.

- [x] **3-2.** Edit `src/shared/types.ts` (`MonitorApi` interface): rename `minimizeWindow(): void;` to `hideWindow(): void;`. Keep `closeApp(): void;` unchanged.

  Verification: `minimizeWindow` no longer appears in this file.

- [x] **3-3.** Edit `src/preload/index.ts`: rename the method:
  - Old: `minimizeWindow(): void { ipcRenderer.send(CH.WINDOW_MINIMIZE); }`
  - New: `hideWindow(): void { ipcRenderer.send(CH.WINDOW_HIDE); }`
  - Keep `closeApp()` unchanged.

  Verification: `minimizeWindow` and `CH.WINDOW_MINIMIZE` no longer appear in this file.

- [x] **3-4.** Edit `src/main/ipc-handlers.ts`:
  - Replace `ipcMain.on(CH.WINDOW_MINIMIZE, () => { if (!win.isDestroyed()) win.minimize(); })` with:
    ```ts
    ipcMain.on(CH.WINDOW_HIDE, () => {
      if (!win.isDestroyed()) win.hide();
    });
    ```
  - In the teardown closure, replace `ipcMain.removeAllListeners(CH.WINDOW_MINIMIZE)` with `ipcMain.removeAllListeners(CH.WINDOW_HIDE)`.
  - Keep `CH.APP_CLOSE` handler (`app.quit()`) and its teardown unchanged.

  Verification: `WINDOW_MINIMIZE` and `win.minimize()` no longer appear in this file.

---

## Slice 4 — Renderer cleanup

Apply immediately after Slice 3. Together these slices eliminate all references to `minimizeWindow` and `WINDOW_MINIMIZE`, removing the orphaned-sender risk and making `tsc` clean.

- [x] **4-1.** Edit `src/renderer/components/WindowControls.tsx`:
  - Remove the minimize button (`window-control--minimize`) entirely.
  - Repurpose the close button as a hide-to-tray button:
    - `onClick={() => window.api.hideWindow()}`
    - `aria-label="Hide"`, `title="Hide"`
    - Glyph `×` (unchanged)
    - Class: keep `window-control--close` or change to `window-control--hide` (cosmetic only)
  - The component now renders a single button.

  Verification: `minimizeWindow` and `closeApp` no longer appear in this component; `hideWindow` is the only API call.

- [x] **4-2.** Edit `src/renderer/components/MetricsWidget.tsx`:
  - Remove `drag` CSS class from the root `div` (change `className="widget drag"` to `className="widget"`).
  - Remove `drag` CSS class from `<header>` (change `className="widget__header drag"` to `className="widget__header"`).
  - Remove `no-drag` from `widget__header-actions` (change `className="widget__header-actions no-drag"` to `className="widget__header-actions"`).
  - Remove `no-drag` from the `widget__fix-btn` button class (change `className="widget__fix-btn no-drag"` to `className="widget__fix-btn"`).
  - Keep `WindowControls` import and usage; keep all other JSX structure, logic, and metric rendering unchanged.

  Verification: no `drag` or `no-drag` class strings remain in this file.

- [x] **4-3.** After both 4-1 and 4-2 are applied, run `npx tsc --noEmit`. All type errors related to `minimizeWindow` must be gone. Zero type errors expected.

---

## Slice 5 — Verification

All automated and manual checks confirming the full change is correct.

- [x] **5-1.** Run automated test suite: `npm test`. All 22 existing unit tests must pass. No new failures are introduced (test files are not touched by this change).

- [x] **5-2.** Run TypeScript check: `npx tsc --noEmit`. Zero errors. This confirms the rename propagated correctly across `channels.ts`, `types.ts`, `preload/index.ts`, and `WindowControls.tsx`.

- [ ] **5-3.** Dev smoke test — run `npm start` and verify the following in order:
  1. No floating widget window appears on launch.
  2. No Dock icon is visible after launch.
  3. A tray icon appears in the macOS menu bar status area (top-right).
  4. Left-click the tray icon: popover appears directly below the icon, horizontally centered, with a small gap; popover shows Local and Remote metric sections.
  5. Local CPU / RAM / Disk / Temp values update approximately every 2 seconds.
  6. Click anywhere outside the popover: it hides; the tray icon remains.
  7. Left-click the tray icon again: popover re-shows (same window, state preserved).
  8. In-window close (×) button: popover hides; app does NOT quit; tray click re-opens it.
  9. Open the SSH panel from inside the popover; perform a profile save and select; remote metrics stream.
  10. Confirm typing in the SSH password `<input>` does not trigger an unwanted blur-hide (focus must stay in the window).
  11. Right-click the tray icon: context menu shows a Quit item; selecting it fully exits the app.
  12. No console errors about unhandled IPC channels (`window:minimize` must not appear as an unhandled channel; `window:hide` must be handled without error).

- [ ] **5-4.** Dev icon path check — if step 5-3 shows no tray icon or a blank icon: inspect the console for `[tray] icon not found:` log. If present, confirm the relative path `../../resources/icons/tray-icon.png` from `.vite/build` reaches the project root. Adjust the `..` count in `createTray()` in `src/main/index.ts` if needed. (The design notes this as a low-risk, fast-to-diagnose item.)

- [ ] **5-5.** Edge case — right screen edge: move the tray icon to the far right of the menu bar (it is already there by default on macOS). Confirm the popover does not overflow the right edge of the display; `positionBelowTray` must clamp `x` within the display work area.

- [ ] **5-6.** Packaged build smoke test — run `npm run package` on macOS. After packaging:
  1. Launch the generated `monitoring.app`.
  2. Confirm no Dock icon appears on launch (`LSUIElement: 1` is in `Info.plist`).
  3. Confirm the tray icon is visible in the menu bar.
  4. Confirm the popover opens on tray click with metrics displaying.

---

## Rollback procedure (if needed)

Git is not enabled. Rollback is file-restoration using the snapshots saved in task P-2:

1. Restore `src/main/index.ts` from `openspec/changes/rebuild-menubar-monitor/rollback-snapshots/index.ts`.
2. Restore `src/main/window.ts` from snapshot.
3. Restore `src/main/ipc-handlers.ts` from snapshot.
4. Restore `src/shared/channels.ts` from snapshot.
5. Restore `src/shared/types.ts` from snapshot.
6. Restore `src/preload/index.ts` from snapshot.
7. Restore `src/renderer/components/WindowControls.tsx` from snapshot.
8. Restore `src/renderer/components/MetricsWidget.tsx` from snapshot.
9. Restore `forge.config.ts` from snapshot (removes `LSUIElement: 1`).
10. The tray icon assets in `resources/icons/` are additive and do not need to be removed; they are harmless when the `Tray` constructor is not called.

---

## Implementation order summary

```
P-1 → P-2 (snapshots) → 1-1 → 1-2 → 1-3 → 1-4 → 1-5
→ 2-1 → 2-2 (tsc check + dev launch)
→ 3-1 → 3-2 → 3-3 → 3-4    ← apply atomically with Slice 4
→ 4-1 → 4-2 → 4-3 (tsc clean)
→ 5-1 → 5-2 → 5-3 → 5-4 → 5-5 → 5-6
```

Slices 3 and 4 must be applied in the same session (no intermediate `tsc` or `npm start` between them), because Slice 3 renames the channel constant and type that the renderer uses, and Slice 4 updates the renderer. Applying one without the other leaves either an orphaned IPC sender (`CH.WINDOW_MINIMIZE` sent, no handler) or a TypeScript type error (`minimizeWindow` referenced but not in `MonitorApi`).
