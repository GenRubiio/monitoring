Verdict: PASS

# Verify Report: rebuild-menubar-monitor

Date: 2026-06-19
Mode: standard (strict TDD inactive — `openspec/config.yaml` has `strict_tdd: false`, empty `verify.test_command`)

## Executive summary

All code-level requirements of the `tray-menubar` spec and the two REMOVED
requirements of the `local-metrics` delta are correctly implemented across the
nine modified source files plus the two new icon assets. `npm test` passes (25
passed, 2 skipped, 0 failed). `npx tsc --noEmit` is clean for all application
source under `src/`; the only remaining error is a pre-existing
`forge.config.ts:52` overload mismatch (`shell: true`) that is present unchanged
in the rollback snapshot and unrelated to this change. The five remaining
unchecked tasks (5-3..5-6) are live macOS GUI / packaging smoke tests that
cannot run headlessly; they are correctly parked as a concrete external blocker
(interactive macOS session required), not autonomously implementable scope.
PASS.

## Automated verification commands

| Command | Outcome |
|---------|---------|
| `npx tsc --noEmit` | 1 error, `forge.config.ts(52,31): error TS2769: No overload matches this call` (boolean `shell: true` not assignable). Zero errors in all `src/` application code. Pre-existing: `shell: true` is present at line 48 of the rollback snapshot `forge.config.ts`, and the only edit to this file in this change is the additive `LSUIElement: 1` key (line 29). Not introduced here. |
| `npm test` | Test Suites: 1 skipped, 4 passed, 4 of 5 total. Tests: 2 skipped, 25 passed, 27 total. 0 failures. |
| `file resources/icons/tray-icon.png` | `PNG image data, 16 x 16, 8-bit/color RGBA` — valid |
| `file resources/icons/tray-icon@2x.png` | `PNG image data, 32 x 32, 8-bit/color RGBA` — valid |
| `grep -rn "minimizeWindow\|WINDOW_MINIMIZE\|createWidgetWindow\|win.minimize\|setVisibleOnAllWorkspaces\|setAlwaysOnTop" src/` | No matches — all old floating-widget references fully removed |

## Spec coverage — tray-menubar

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Tray Status Icon — Tray created at ready from valid PNG | PASS | `index.ts:73` `tray = createTray()` in `bootstrap` registered on `app.on('ready')`; `createTray` builds `nativeImage.createFromPath` + `new Tray(icon)`. Icons valid 16×16/32×32. |
| Tray Status Icon — template image | PASS | `index.ts:41` `icon.setTemplateImage(true)`; `@2x` Retina variant present. |
| Tray Status Icon — module-level ref for app lifetime | PASS | `index.ts:15` `let tray: Tray | null = null` at module scope; assigned in bootstrap, never nulled. |
| Tray Status Icon — missing-icon fast surface | PARTIAL/ACCEPTABLE | `index.ts:36-39` logs `[tray] icon not found:` via `icon.isEmpty()`; Tray still constructed so an invisible icon surfaces at launch. Matches task 2-2 / design §1.3 intent (diagnostic log, not a thrown fail-fast). Spec says failure MUST "surface at launch rather than producing a silently invisible tray" — the console.error satisfies the non-silent requirement. |
| Popover Window Lifecycle — show:false, frame:false, skipTaskbar:true, alwaysOnTop:false | PASS | `window.ts:16-21`. |
| Popover Window Lifecycle — left-click toggles show+focus / hide | PASS | `index.ts:54-63` `togglePanel`; `index.ts:74` `tray.on('click', togglePanel)`. |
| Popover Window Lifecycle — security defaults | PASS | `window.ts:25-27` contextIsolation true, nodeIntegration false, sandbox true; preload wired `window.ts:24`. |
| Popover Window Lifecycle — vibrancy in try/catch, no crash on failure | PASS | `window.ts:32-40` `setVibrancy('popover')` inside `try/catch`, falls through. |
| Tray-Anchored Positioning — compute from getBounds, center, gap below | PASS | `window.ts:57-72` `positionBelowTray`, x centered, y = trayB.y + height + GAP(4). |
| Tray-Anchored Positioning — multi-display resolution | PASS | `window.ts:60` `screen.getDisplayNearestPoint({x: trayB.x, y: trayB.y})`. |
| Tray-Anchored Positioning — clamp right-edge overflow | PASS | `window.ts:68-70` clamps x to `[area.x+8, area.x+area.width-w-8]`. |
| Click-Outside Auto-Hide — blur hides window | PASS | `index.ts:77-79` `mainWindow.on('blur', ...)` hides. |
| Click-Outside Auto-Hide — guard destroyed window | PASS | `index.ts:78` `if (mainWindow && !mainWindow.isDestroyed())`. |
| Click-Outside Auto-Hide — context-menu does not dismiss inappropriately | PASS (by design) | Quit lives on the tray context menu (separate surface), not in-window; design §2.3 / §7.3 chose the simple isDestroyed guard. No race with quit. |
| Hide-vs-Quit — in-window close calls win.hide(), not app.quit() | PASS | `WindowControls.tsx:9` `onClick={() => window.api.hideWindow()}`; preload `hideWindow` → `CH.WINDOW_HIDE`; handler `ipc-handlers.ts:242-244` `win.hide()`. No app.quit in that path. |
| Hide-vs-Quit — re-open via tray | PASS | Persistent hidden window reused by `togglePanel`. |
| Hide-vs-Quit — tray context menu Quit → app.quit() | PASS | `index.ts:47-49` context menu single Quit item `click: () => app.quit()`. |
| Hide-vs-Quit — no orphaned IPC sender | PASS | `CH.WINDOW_HIDE` sent by preload and handled at `ipc-handlers.ts:242`; old `WINDOW_MINIMIZE` gone everywhere (grep clean). `APP_CLOSE` kept and still handled (unused-but-handled is not an orphaned sender). |
| No Dock Presence — LSUIElement=1 | PASS | `forge.config.ts:29` `LSUIElement: 1` inside `extendInfo`; existing keys undisturbed. |
| No Dock Presence — app.dock.hide() on ready | PASS | `index.ts:68` `app.dock?.hide()` first line of bootstrap. |

## Spec coverage — local-metrics delta (REMOVED requirements)

| Removed requirement | Status | Evidence |
|---------------------|--------|----------|
| Floating Always-On-Top Window | PASS (removed) | `alwaysOnTop:false`, `show:false`; `setAlwaysOnTop('floating')` and `setVisibleOnAllWorkspaces` removed (grep clean). Replacing behavior lives in tray-menubar Popover Lifecycle / Positioning. |
| Draggable Widget Surface | PASS (removed) | `MetricsWidget.tsx` root `div className="widget"`, header `className="widget__header"`, actions `widget__header-actions`, fix button `widget__fix-btn` — no `drag`/`no-drag` strings remain in metric layout. Minimize control removed from `WindowControls.tsx`. |

## Task completion

- Prerequisites P-1, P-2: complete (snapshots dir confirmed present).
- Slice 1 (1-1..1-5): complete — icons valid, LSUIElement added, extraResource confirmed.
- Slice 2 (2-1, 2-2): complete — window.ts and index.ts match design.
- Slice 3 (3-1..3-4) + Slice 4 (4-1..4-3): complete and applied atomically — rename propagated, tsc clean for src/.
- Slice 5: 5-1 (npm test) and 5-2 (tsc) checked and re-verified PASS. 5-3, 5-4, 5-5, 5-6 remain unchecked.

5-3..5-6 require an interactive macOS GUI session (`npm start` live launch, on-screen tray/popover/dock/blur behavior, right-edge clamp, `npm run package` build). These are a concrete external blocker (no headless GUI), not autonomously implementable code work and not parked scope-creep. Apply correctly returned `partial` for this reason. No reviewable code slice remains unimplemented.

## TDD compliance

N/A — strict TDD is inactive (`strict_tdd: false`, no configured test runner for new code). The existing Jest suite is a regression gate only; none of its files were touched by this change and all 25 active tests still pass. No TDD evidence table is required or expected; mutation spot-check and assertion-quality audit are not applicable to this non-TDD change.

## Review workload / PR boundary

- Forecast: ~145 changed lines, 400-line budget risk Low, single PR, no chaining.
- Actual: nine source files modified (config rename + small handler/type edits + main-process tray/popover logic ~90 net lines + 2 binary icon assets). Well within the ~145 estimate and the 400-line budget.
- No `size:exception` needed or used; delivery matched the `single-pr` strategy. No scope creep beyond the assigned tasks.

## Findings (non-blocking)

1. WARNING (pre-existing, out of scope): `forge.config.ts:52` `execSync(..., { shell: true })` overload error. Present in the rollback snapshot; predates this change. The only edit here was the additive `LSUIElement: 1`. Flag for the maintainer; does not block this change. Also note the `postPackage` hook references `${__dirname}/entitlements.plist` (design §8.2) which was not found in the repo — relevant to 5-6 packaging, pre-existing, out of scope.
2. SUGGESTION (cosmetic): `MetricsWidget.tsx:44` retains the stale comment `// Floating widget: local + remote metric sections. Owns the drag region.` The drag region is gone; the comment is now inaccurate. Harmless, no functional impact.
3. INFO: `closeApp()` / `CH.APP_CLOSE` intentionally kept but now unused by components — a fully-handled channel, not an orphaned sender (design §7.5). Verified handler still present at `ipc-handlers.ts:246-248`.
4. INFO: Test count is 25 active (+2 skipped), not the "22" referenced in spec/design — repo drift, not a regression; none touched by this change.

## Blockers

None at the code level. The only outstanding items (5-3..5-6) are live macOS
GUI/packaging smoke tests that require an interactive desktop session and cannot
be executed in this headless environment. Recommend the maintainer run
`npm start` and `npm run package` on macOS to close out 5-3..5-6.
