# Local Metrics Specification

## Purpose

Define the behavior of the floating desktop widget that displays local machine
system health — CPU load percentage, RAM usage, and CPU temperature — in an
always-on-top, frameless, transparent window on macOS. The widget reads metrics
from the operating system through the Electron main process and refreshes them
on a fixed interval without user interaction.

## Requirements

### Requirement: Floating Always-On-Top Window

The application MUST present its UI in a frameless, transparent, always-on-top
window on macOS. The window MUST remain visible above normal application windows
until the user explicitly closes or hides it. The application MUST use the
`'floating'` always-on-top level and MUST NOT use the `'screen-saver'` level, so
that the widget stays above regular windows but does not obscure macOS fullscreen
spaces.

The window MUST be created with `frame: false`, `transparent: true`,
`alwaysOnTop: true`, and `resizable: false`, and MUST be excluded from the dock
and taskbar (`skipTaskbar: true`). On macOS the OS traffic-light window buttons
MUST be hidden.

#### Scenario: Widget stays above normal windows

- GIVEN the application has launched on macOS
- WHEN the user focuses another application window over the widget area
- THEN the widget MUST remain visible on top of that window
- AND the widget MUST NOT disappear behind it without an explicit user action

#### Scenario: Floating level chosen over screen-saver level

- GIVEN the application is configuring the window's always-on-top behavior
- WHEN it calls `setAlwaysOnTop`
- THEN it MUST pass the `'floating'` level
- AND it MUST NOT pass the `'screen-saver'` level

#### Scenario: Window is frameless and non-resizable

- GIVEN the window is created
- WHEN the window appears on screen
- THEN it MUST have no OS title bar or frame
- AND it MUST NOT be resizable by the user
- AND the macOS traffic-light buttons MUST NOT be visible

### Requirement: Draggable Widget Surface

The widget MUST be repositionable by the user by dragging a designated drag
region. The drag region MUST be marked with CSS `-webkit-app-region: drag`.
Interactive controls (buttons, inputs, selectors) within the widget MUST be
marked `-webkit-app-region: no-drag` so they remain clickable.

#### Scenario: User drags the widget

- GIVEN the widget is visible on screen
- WHEN the user presses and drags the drag region
- THEN the window MUST move with the pointer
- AND releasing the pointer MUST leave the window at the new position

#### Scenario: Interactive controls remain clickable

- GIVEN the widget contains a button or selector inside the drag region's area
- WHEN the user clicks that control
- THEN the control MUST receive the click rather than initiating a window drag

### Requirement: Local CPU Load Display

The widget MUST display the local machine's current CPU load as a percentage.
CPU load MUST be sourced from the main process using `systeminformation`
(`currentLoad`) and forwarded to the renderer. The renderer MUST NOT call
system APIs directly.

#### Scenario: CPU percentage is shown

- GIVEN the application is running and polling local metrics
- WHEN a local metrics sample is collected
- THEN the widget MUST display the current CPU load as a percentage value

### Requirement: Local RAM Display

The widget MUST display local RAM as used and total memory expressed in
gigabytes. RAM values MUST be sourced from the main process using
`systeminformation` (`mem`, reporting `total` and `used` in bytes) and converted
for display.

#### Scenario: RAM used and total are shown

- GIVEN the application is running and polling local metrics
- WHEN a local metrics sample is collected
- THEN the widget MUST display RAM as used / total in gigabytes

### Requirement: Optional Local CPU Temperature Display

The widget MUST display the local CPU temperature in degrees Celsius when it is
available. Temperature MUST be treated as optional: when `systeminformation`
(`cpuTemperature`) reports `main` as `null` or otherwise unavailable, the widget
MUST display "N/A" and MUST NOT raise an error or crash.

#### Scenario: Temperature available

- GIVEN the operating system can supply a CPU temperature reading
- WHEN a local metrics sample is collected
- THEN the widget MUST display the temperature in degrees Celsius

#### Scenario: Temperature unavailable

- GIVEN `cpuTemperature().main` is `null` or unavailable (e.g. a Mac without the optional native sensor)
- WHEN a local metrics sample is collected
- THEN the widget MUST display "N/A" for temperature
- AND the application MUST NOT raise an error or crash

### Requirement: Periodic Metric Refresh

The application MUST poll local metrics every 2 seconds. The polling timer MUST
run in the main process, and updated metrics MUST be pushed to the renderer via
the `metrics:local` IPC channel using `webContents.send()`. The widget MUST
update its displayed values on each push without any user interaction.

#### Scenario: Metrics update automatically

- GIVEN the widget is displayed
- WHEN 2 seconds elapse
- THEN the main process MUST collect a fresh local metrics sample
- AND push it to the renderer over `metrics:local`
- AND the widget MUST update its displayed values without user interaction

### Requirement: Secure IPC Boundary for Metrics

All local system metric collection MUST occur in the main process. The renderer
MUST receive metrics only through the preload-exposed named API backed by IPC.
The application MUST keep Electron security defaults: `contextIsolation: true`,
`nodeIntegration: false`, and `sandbox: true`. The preload script MUST expose
only named functions via `contextBridge.exposeInMainWorld()` and MUST NOT expose
the raw `ipcRenderer` object.

#### Scenario: Renderer cannot access system APIs directly

- GIVEN the renderer process is running
- WHEN it needs local metrics
- THEN it MUST obtain them only through the preload-exposed named API
- AND it MUST NOT have access to `nodeIntegration`, raw `ipcRenderer`, or system APIs

#### Scenario: Security defaults preserved

- GIVEN the BrowserWindow is created
- WHEN its `webPreferences` are configured
- THEN `contextIsolation` MUST be `true`
- AND `nodeIntegration` MUST be `false`
- AND `sandbox` MUST be `true`

### Requirement: Resilient Error Handling

The main process MUST register handlers for `uncaughtException` and
`unhandledRejection`. An error during metric collection MUST NOT silently kill
the window; instead the error MUST be logged and an error state SHOULD be
reflected in the renderer.

#### Scenario: Metric collection error does not crash the UI

- GIVEN local metric collection throws or rejects on a polling tick
- WHEN the error is raised
- THEN the main process MUST catch and log the error
- AND the widget window MUST remain open
- AND the application SHOULD reflect the error state in the renderer
