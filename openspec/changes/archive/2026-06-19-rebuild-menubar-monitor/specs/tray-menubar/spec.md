# Tray Menu Bar Specification

## Purpose

Define the behavior of the macOS menu bar (status bar) presentation of the
monitoring application. The application runs as a tray (menu bar) app with no
Dock presence. A tray icon lives in the macOS status area; clicking it opens a
popover panel anchored below the icon that contains all existing monitoring UI
(local metrics, remote SSH metrics, and SSH profile management). Clicking
outside the popover hides it. A right-click context menu on the tray provides
the only path to fully quit the application. This domain governs the tray icon,
the popover window lifecycle, its positioning, auto-hide, close/quit semantics,
and Dock suppression. Metric content and IPC security are inherited from the
`local-metrics` and `ssh-profiles` domains and are out of scope here.

## Requirements

### Requirement: Tray Status Icon

The application MUST create an Electron `Tray` instance during the `ready`
lifecycle event, using a valid PNG image asset. The image asset MUST exist and
be a valid PNG, because the application fails to launch when the `Tray`
constructor is given an invalid or missing image. The tray icon SHOULD be
provided as a template image (`setTemplateImage(true)`) so it renders correctly
in both light and dark menu bar appearances, and a Retina `@2x` variant SHOULD
be provided for HiDPI displays.

The created `Tray` instance MUST be stored in a module-level reference that
lives for the entire lifetime of the application. The application MUST NOT allow
the `Tray` instance to become eligible for garbage collection while running,
because a garbage-collected tray causes the icon to disappear from the menu bar.

#### Scenario: Tray icon appears on launch

- GIVEN a valid tray icon PNG asset is present in the packaged resources
- WHEN the application reaches the `ready` lifecycle event
- THEN the application MUST create a `Tray` instance from that PNG
- AND a tray icon MUST appear in the macOS menu bar status area
- AND no floating widget window MUST appear on launch

#### Scenario: Tray reference retained for app lifetime

- GIVEN the application is running with a tray icon visible
- WHEN the application continues running over time
- THEN the `Tray` instance MUST be held by a module-level reference
- AND the tray icon MUST NOT disappear due to garbage collection

#### Scenario: Missing icon asset fails fast

- GIVEN the tray icon PNG asset is missing or invalid
- WHEN the application attempts to construct the `Tray`
- THEN the failure MUST surface at launch rather than producing a silently
  invisible tray

### Requirement: Popover Window Lifecycle

The application MUST create the UI host as a `BrowserWindow` configured with
`show: false`, `frame: false`, and `skipTaskbar: true`, and it MUST be
`alwaysOnTop: false` (it is not a floating widget). The window MUST be created
hidden and MUST be shown and hidden programmatically rather than by the user
opening or closing an OS window.

Left-clicking the tray icon MUST toggle the popover: when the popover is hidden
it MUST be shown (positioned per the positioning requirement) and focused; when
it is already visible it MAY be hidden. The application MUST preserve Electron
security defaults on this window (`contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`) and MUST wire the existing preload
bridge, so that all inherited metric and SSH behavior continues to function
inside the popover.

The popover SHOULD use `setVibrancy('popover')` for a native macOS popover
appearance, and the application MUST NOT crash if applying vibrancy fails; it
MUST fall through to no vibrancy in that case.

#### Scenario: Popover opens on tray click

- GIVEN the application is running and the popover is hidden
- WHEN the user left-clicks the tray icon
- THEN the application MUST position the popover below the tray icon
- AND the application MUST call show and focus on the window
- AND the popover MUST display the Local and Remote metric sections

#### Scenario: Window created hidden and frameless

- GIVEN the application creates the popover `BrowserWindow`
- WHEN the window is constructed
- THEN it MUST be created with `show: false`
- AND `frame: false`
- AND `skipTaskbar: true`
- AND `alwaysOnTop: false`

#### Scenario: Security defaults preserved on the popover

- GIVEN the popover `BrowserWindow` is created
- WHEN its `webPreferences` are configured
- THEN `contextIsolation` MUST be `true`
- AND `nodeIntegration` MUST be `false`
- AND `sandbox` MUST be `true`

#### Scenario: Vibrancy failure does not crash

- GIVEN the popover requests `setVibrancy('popover')`
- WHEN the host macOS version does not support that vibrancy
- THEN the application MUST NOT crash
- AND the popover MUST still display with no vibrancy applied

### Requirement: Tray-Anchored Window Positioning

When showing the popover, the application MUST compute its position from
`tray.getBounds()` so the window appears anchored just below the tray icon. The
horizontal position MUST center the window under the icon
(`x = round(trayBounds.x + trayBounds.width / 2 - windowWidth / 2)`) and the
vertical position MUST place the window below the icon with a small gap
(`y = trayBounds.y + trayBounds.height + gap`).

The application MUST handle multiple displays by resolving the target display
from the tray icon location (for example via `screen.getDisplayMatching()` or
`screen.getDisplayNearestPoint()`) and MUST keep the window within that
display's bounds. If the computed window position would overflow the right edge
of the target display, the application MUST clamp the horizontal position so the
window remains fully on screen.

#### Scenario: Popover anchored below the icon

- GIVEN the user left-clicks the tray icon on the primary display
- WHEN the application computes the popover position
- THEN it MUST read `tray.getBounds()`
- AND it MUST center the window horizontally under the icon
- AND it MUST place the window below the icon with a small gap

#### Scenario: Multi-display placement

- GIVEN the menu bar containing the tray icon is on a secondary display
- WHEN the user left-clicks the tray icon
- THEN the application MUST resolve the display matching the tray bounds
- AND the popover MUST appear on that same display

#### Scenario: Clamp at the right screen edge

- GIVEN the tray icon is near the right edge of its display
- WHEN the computed `x + windowWidth` would overflow the display's right edge
- THEN the application MUST clamp `x` so the window stays fully within the
  display work area

### Requirement: Click-Outside Auto-Hide

The popover MUST hide itself when it loses focus, so that clicking anywhere
outside the popover closes it. The application MUST register a handler on the
window `blur` event that hides the window. The application MUST guard against
hiding the popover while the tray's own context menu is open, so that
interacting with the tray right-click menu does not unexpectedly dismiss the
popover. The handler MUST verify the window is not destroyed before calling
hide.

#### Scenario: Clicking outside hides the popover

- GIVEN the popover is visible and focused
- WHEN the user clicks anywhere outside the popover
- THEN the window MUST emit `blur`
- AND the application MUST hide the popover window
- AND the tray icon MUST remain in the menu bar

#### Scenario: Tray context menu does not dismiss inappropriately

- GIVEN the tray context menu is open
- WHEN the blur handler runs
- THEN the application MUST NOT treat the context menu interaction as a reason
  to hide the popover in an unintended way

#### Scenario: Hide guards against a destroyed window

- GIVEN the popover window has been destroyed
- WHEN the auto-hide handler runs
- THEN the application MUST check the window is not destroyed before calling
  hide
- AND it MUST NOT crash

### Requirement: Hide-Versus-Quit Semantics

Closing or dismissing the popover MUST only hide the window, never quit the
application. Any in-window close/hide control MUST call `win.hide()` and MUST
NOT call `app.quit()`. Re-opening MUST be possible by clicking the tray icon
again, which shows the same window.

The application MUST provide a Quit action through the tray's right-click
context menu, and selecting that action MUST fully exit the application via
`app.quit()`. This context-menu Quit MUST be the path that fully terminates the
app under normal use.

#### Scenario: In-window close hides to tray

- GIVEN the popover is visible
- WHEN the user activates the in-window close/hide control
- THEN the application MUST call `win.hide()`
- AND the application MUST NOT quit
- AND clicking the tray icon again MUST re-show the same window

#### Scenario: Quit from the tray context menu

- GIVEN the application is running
- WHEN the user right-clicks the tray icon and selects Quit
- THEN the application MUST call `app.quit()`
- AND the application MUST fully exit

#### Scenario: No orphaned IPC sender

- GIVEN the renderer triggers the hide action
- WHEN the corresponding IPC channel is sent
- THEN a registered main-process handler MUST receive it
- AND there MUST NOT be a console error about an unhandled IPC channel

### Requirement: No Dock Presence

The application MUST NOT appear in the macOS Dock. The application MUST set
`LSUIElement = 1` in the packaged app's `Info.plist` (via `extendInfo`) so the
Dock icon does not appear during launch, and MUST also call `app.dock.hide()`
during the `ready` lifecycle event as a defensive measure for Electron versions
where `LSUIElement` alone is insufficient.

#### Scenario: No Dock icon on launch

- GIVEN the application is launched (in development or as a packaged build)
- WHEN the application starts up
- THEN no Dock icon MUST be shown for the application
- AND the application MUST set `LSUIElement = 1` in the packaged build
- AND the application MUST call `app.dock.hide()` on `ready`
