# Delta for Local Metrics

This delta retires the floating-widget window paradigm. The local metrics
themselves (CPU, RAM, temperature, 2 s refresh, secure IPC, error handling) are
unchanged and are inherited from the canonical spec. The window presentation
behavior moves to the new `tray-menubar` domain.

## REMOVED Requirements

### Requirement: Floating Always-On-Top Window

(Reason: The app no longer presents a floating, always-on-top window. The UI is
now shown in a tray-anchored popover that is created hidden
(`show: false`), is `alwaysOnTop: false`, and is shown/hidden programmatically.
The replacing behavior is defined in the `tray-menubar` domain under
"Popover Window Lifecycle" and "Tray-Anchored Window Positioning".)

### Requirement: Draggable Widget Surface

(Reason: The popover is anchored to the tray icon position and is not
user-repositionable. The `-webkit-app-region: drag` region and the in-app
minimize control are removed. There is no replacing drag behavior; window
placement is handled automatically by the `tray-menubar`
"Tray-Anchored Window Positioning" requirement.)
