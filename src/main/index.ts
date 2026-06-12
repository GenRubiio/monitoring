import { app, BrowserWindow } from 'electron';
import started from 'electron-squirrel-startup';
import { createWidgetWindow } from './window';
import { registerIpcHandlers } from './ipc-handlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

// Resilient error handling: an uncaught error must not silently kill the
// window. Log it and keep the process (and widget) alive.
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[main] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[main] unhandledRejection:', reason);
});

function bootstrap(): void {
  mainWindow = createWidgetWindow();
  registerIpcHandlers(mainWindow);
}

app.on('ready', bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap();
  }
});
