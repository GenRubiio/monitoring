import { BrowserWindow } from 'electron';
import path from 'node:path';

// Vite plugin injected globals (declared in forge.env.d.ts).
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

// Creates the floating, frameless, transparent, always-on-top widget window.
// Security defaults (contextIsolation/nodeIntegration/sandbox) are non-negotiable.
export function createWidgetWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 240,
    frame: false, // no OS title bar/frame
    transparent: true, // enables rounded corners + vibrancy
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true, // hidden from Dock/taskbar
    hasShadow: false, // cleaner floating look on macOS
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // REQUIRED
      nodeIntegration: false, // REQUIRED
      sandbox: true, // REQUIRED
    },
  });

  // 'floating' keeps the widget above normal windows but below macOS fullscreen
  // spaces. 'screen-saver' is explicitly forbidden by the spec.
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true);

  // macOS-only window decorations.
  if (process.platform === 'darwin') {
    try {
      win.setVibrancy('hud'); // frosted-glass HUD look
      win.setWindowButtonVisibility(false); // hide traffic-light buttons
    } catch {
      // Older/other platforms may not support these; ignore defensively.
    }
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return win;
}
