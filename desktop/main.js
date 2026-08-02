// Thin Electron wrapper over the built dist/. No game logic lives here.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#08080f',
    title: 'THWIP',
    autoHideMenuBar: true,
    webPreferences: {
      // The game is entirely self-contained; it needs no Node access.
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  // Vite is built with base './', so the file:// load resolves correctly.
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Pointer lock without the "press ESC to exit" toast interrupting a run.
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });

  // Any external link opens in the real browser, not in the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
