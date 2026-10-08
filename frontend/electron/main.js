const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const { initLocalDb, setupLocalDbIpc } = require('./localDb');
const { createDateStorage } = require('./dateStorage');

// A second process must not migrate or write the same database/date folders.
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
let storageReady = false;

const DEV_SERVER_URL = process.env.ELECTRON_START_URL || 'http://localhost:3000';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Lottery Booking',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  Menu.setApplicationMenu(null);

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'build', 'index.html'));
  } else {
    mainWindow.loadURL(DEV_SERVER_URL);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

function setupAutoUpdates(mainWindow) {
  if (!app.isPackaged) {
    return;
  }

  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;

  autoUpdater.on('update-available', async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Update now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update available',
      message: `Lottery Booking ${info.version} is available.`,
      detail: 'Download and install the latest version now?'
    });

    if (result.response === 0) {
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: 'The update has been downloaded.',
      detail: 'Restart the app to install it.'
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on('error', (error) => {
    console.error('Auto update error:', error);
  });

  autoUpdater.checkForUpdates().catch((error) => {
    console.error('Auto update check failed:', error);
  });
}

app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  const storage = createDateStorage(initLocalDb(), {
    desktop: app.getPath('desktop'),
    userData: app.getPath('userData')
  });
  await storage.initialize();
  storage.register(ipcMain);
  setupLocalDbIpc(storage.wrap(ipcMain));
  storageReady = true;
  const mainWindow = createWindow();
  setupAutoUpdates(mainWindow);
}).catch((error) => {
  dialog.showErrorBox('Local data could not be prepared', `${error.message}\nNo sync has been started. Restore the data folder or check disk permissions and restart.`);
  app.quit();
});

app.on('activate', () => {
  if (storageReady && BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
