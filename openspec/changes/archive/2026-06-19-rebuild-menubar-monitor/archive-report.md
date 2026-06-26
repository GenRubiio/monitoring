# Archive Report: rebuild-menubar-monitor

**Date: 2026-06-19**

---

## Archive Status

**Result: SUCCESS**

The `rebuild-menubar-monitor` change has completed all required phases (propose, design, implement, verify, sync) and is cleared for archival.

---

## Phase Summary

### Proposal Phase
- **Status:** Complete
- **Change Intent:** Convert the Electron floating-widget system monitor into a macOS menu bar (tray) application. Floating always-on-top window replaced with tray icon in status bar + click-to-show popover. No Dock presence. All monitoring functionality preserved.
- **Scope:** 9 source files modified; 2 new binary icon assets; config update to `forge.config.ts`.
- **Risk Assessment:** High-risk items (missing tray PNG, GC'd Tray object, window blur race) mitigated by asset-first slicing and defensive coding.

### Design Phase
- **Status:** Complete
- **Key Decisions:**
  - Use native Electron `Tray` class (no third-party wrapper) for simplicity and control.
  - Single long-lived hidden `BrowserWindow` (not recreate-per-click) preserves metric streams across toggle cycles.
  - Monochrome template PNG icons (16×16 and 32×32 Retina) auto-recolored by macOS for light/dark menu bars.
  - `positionBelowTray()` helper with multi-display clamping (spec requirement) instead of fixed screen position.
  - Toggle behavior on left-click (show if hidden, hide if visible); right-click context menu with Quit.
  - `LSUIElement: 1` in forge.config + `app.dock.hide()` in bootstrap for no-Dock semantics.
  - Vibrancy changed from `'hud'` to `'popover'` for macOS-native appearance.
- **Data Flow:** Hidden window pre-loads at `ready`; metric/SSH bootstrap unchanged (IPC handlers fire normally). Tray click → `positionBelowTray()` + `show()` + `focus()`. Window blur → `hide()` for click-outside auto-close.

### Implementation Phase
- **Status:** Complete (9 slices, 5 locked to verify as smoke tests)
- **Files Modified:** 9 source files, 2 new icon assets, 1 config edit
- **Slices Completed:**
  - **Slice 1 (Assets/Build):** Icon PNGs created and validated; `LSUIElement: 1` added to `forge.config.ts`.
  - **Slice 2 (Main Process):** `window.ts` rewritten with `createPopoverWindow()` and `positionBelowTray()` helper; `index.ts` rewritten with `createTray()`, `app.dock.hide()`, `togglePanel()`, context menu, blur-hide wiring.
  - **Slice 3 (IPC/Channels):** `channels.ts` updated; `ipc-handlers.ts` refactored for hide semantics; `WINDOW_MINIMIZE` → `WINDOW_HIDE` + handlers re-mapped.
  - **Slice 4 (Renderer):** `WindowControls.tsx` updated; `MetricsWidget.tsx` drag CSS removed.
  - **Slices 5-1..5-2 (Unit & Type Checks):** `npm test` (25 active + 2 skipped); `npx tsc --noEmit` clean for `src/` (pre-existing overload error in `forge.config.ts` unchanged and unrelated to this change).

### Verification Phase
- **Status:** PASS (Verdict first line confirmed)
- **Key Findings:**
  - All 13 tray-menubar spec requirements verified PASS across 9 modified files + 2 new icons.
  - Both removed local-metrics requirements (Floating Always-On-Top Window, Draggable Widget Surface) correctly superseded by tray-popover behavior.
  - 25 unit tests passing; 2 skipped; 0 failures.
  - TypeScript clean for all `src/` code.
  - Slices 5-3..5-6 (interactive macOS GUI/packaging smoke tests) parked as concrete external blocker (no headless GUI available); recommend maintainer run `npm start` and `npm run package` on macOS for final validation.
  - Pre-existing `forge.config.ts:52` overload error (boolean `shell: true` not assignable) noted; not introduced by this change.
  - One cosmetic stale comment in `MetricsWidget.tsx:44` (drag region reference removed but comment retained); harmless, no functional impact.

### Sync Phase
- **Status:** SYNCED (exit code 0)
- **Sync Method:** File-backed sync via `sdd-sync` CLI
- **Sync CLI:** `node "/Users/evgeny.lyubeznyy/Desktop/Basetis/vibeless-claude-sdd/scripts/sdd-sync.mjs" rebuild-menubar-monitor --approve-destructive`
- **Destructive Approval:** Recorded human approval in parent prompt for removal of two local-metrics requirements (Floating Always-On-Top Window, Draggable Widget Surface).
- **Canonical Targets:**
  - `openspec/specs/local-metrics/spec.md` — merge mode, 2 requirements removed
  - `openspec/specs/tray-menubar/spec.md` — create-copy mode (new domain), 6 requirements added
- **Active Same-Domain Collisions:** None.

---

## Artifacts Read

### Change Metadata
- `openspec/changes/rebuild-menubar-monitor/proposal.md` — Intent, scope, architecture, risks, success criteria
- `openspec/changes/rebuild-menubar-monitor/design.md` — Decisions, data flow, icon strategy
- `openspec/changes/rebuild-menubar-monitor/tasks.md` — Sliced implementation plan with completion checklist
- `openspec/changes/rebuild-menubar-monitor/verify-report.md` — Verdict PASS, test results, spec coverage matrix
- `openspec/changes/rebuild-menubar-monitor/sync-report.md` — Exit code 0, op-count table, domains synced

### Specs Created
- `openspec/changes/rebuild-menubar-monitor/specs/tray-menubar/spec.md` — New domain, 13 code-level requirements
- `openspec/changes/rebuild-menubar-monitor/specs/local-metrics/spec.md` — Delta with 2 removed requirements (superseded)

---

## Domains Synced

| Domain | Mode | Added | Modified | Removed | Canonical Path |
|--------|------|-------|----------|---------|-----------------|
| `tray-menubar` | create-copy | 6 | 0 | 0 | `openspec/specs/tray-menubar/spec.md` |
| `local-metrics` | merge | 0 | 0 | 2 | `openspec/specs/local-metrics/spec.md` |

**Total canonical operations:** 8 (6 added, 2 removed)

---

## Requirement Changes

### Added Requirements (tray-menubar)

1. Tray Status Icon — Tray created at ready from valid PNG
2. Tray Status Icon — template image
3. Tray Status Icon — module-level ref for app lifetime
4. Tray Status Icon — missing-icon fast surface
5. Popover Window Lifecycle — show:false, frame:false, skipTaskbar:true, alwaysOnTop:false
6. Popover Window Lifecycle — left-click toggles show+focus / hide
7. Popover Window Lifecycle — security defaults
8. Popover Window Lifecycle — vibrancy in try/catch, no crash on failure
9. Tray-Anchored Positioning — compute from getBounds, center, gap below
10. Tray-Anchored Positioning — multi-display resolution
11. Tray-Anchored Positioning — clamp right-edge overflow
12. Click-Outside Auto-Hide — blur hides window
13. Click-Outside Auto-Hide — guard destroyed window

*(And 10+ additional requirements covering hide-vs-quit semantics, no-Dock presence, IPC channels—see verify-report.md line 32-55 for full spec coverage matrix)*

### Removed Requirements (local-metrics)

1. ~~Floating Always-On-Top Window~~ — Superseded by tray-menubar Popover Window Lifecycle
2. ~~Draggable Widget Surface~~ — Superseded by tray-menubar Tray-Anchored Positioning

All other local-metrics requirements (Local CPU Load Display, Local RAM Display, CPU Temp, Periodic Refresh 2s, Secure IPC, Error Handling) remain in force and inherited.

---

## Warnings & Notes

### Active Same-Domain Collisions
None. No other active change targets `tray-menubar` or `local-metrics`.

### Destructive Sync Approval
Explicit human approval recorded in parent prompt for removal of two local-metrics requirements. CLI invoked with `--approve-destructive`. No blockers.

### Non-Blocking Findings (Verification Report)
1. **Pre-existing overload error** in `forge.config.ts:52` (boolean `shell: true` not assignable to `execSync` option) — present in rollback snapshot, unrelated to this change.
2. **Cosmetic stale comment** in `MetricsWidget.tsx:44` — references removed drag region; harmless.
3. **Unused-but-handled IPC channel** `CH.APP_CLOSE` — intentionally retained per design; fully-handled (not orphaned sender).
4. **Test count drift** — verify-report references 22 tests; actual count is 25 active (+2 skipped). Pre-existing repo drift; none touched by this change.

### Parked Verification Items
Slices 5-3, 5-4, 5-5, 5-6 (interactive macOS GUI and packaging smoke tests) cannot run headlessly. Recommend maintainer run on macOS:
- `npm start` — verify tray icon appearance, popover open/close, metrics stream, SSH panel, blur auto-hide, right-edge clamp.
- `npm run package` — verify `.app` has tray icon visible and no Dock icon on launch.

These are a concrete external blocker (no headless GUI), not parked scope-creep or code work.

---

## Archive Location

**Archived path:**
```
openspec/changes/archive/2026-06-19-rebuild-menubar-monitor/
```

Change folder moved from `openspec/changes/rebuild-menubar-monitor/` on 2026-06-19.

---

## Next Recommended Phase

The change is fully archived. Maintainer should:
1. Run `npm start` on macOS to smoke-test GUI behavior (slices 5-3..5-6).
2. Run `npm run package` to verify packaged `.app` tray + no Dock.
3. Consider fixing the pre-existing `forge.config.ts:52` overload error and any entitlements.plist path issue (design §8.2) in a follow-up maintenance change.
4. Review archived change for audit trail completeness.

---

## Signature

**Archived by:** SDD Archive Executor  
**Archive date:** 2026-06-19  
**Change status:** COMPLETE & SYNCED  
**Artifact mode:** openspec (file-backed)
