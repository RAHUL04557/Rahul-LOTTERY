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
  // `quitAndInstall()` starts the NSIS installer before Electron has finished
  // shutting down. On some Windows machines that leaves Lottery Booking.exe
  // locked and NSIS displays “cannot be closed”. A detached helper waits for
  // this process to exit before it launches the installer.
  autoUpdater.autoInstallOnAppQuit = false;
  let updateInstallStarted = false;

  const restartAndInstallUpdate = () => {
    if (updateInstallStarted) {
      return;
    }

    updateInstallStarted = true;
    const installerPath = autoUpdater.installerPath;
    if (!installerPath || !require('fs').existsSync(installerPath)) {
      updateInstallStarted = false;
      dialog.showErrorBox(
        'Update could not start',
        'The downloaded update file was not found. Please download the update again.'
      );
      return;
    }

    // The app is installed per-machine, so run the installer after Electron
    // has completely exited and explicitly request elevation. This avoids an
    // installer that exits silently because Lottery Booking.exe is locked.
    const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const script = [
      '$ErrorActionPreference = "Stop"',
      `Wait-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
      'Start-Sleep -Milliseconds 750',
      `Start-Process -FilePath ${quotePowerShell(installerPath)} -ArgumentList @('--updated', '--force-run') -Verb RunAs`
    ].join('; ');
    const launcher = require('child_process').spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );

    launcher.once('error', (error) => {
      updateInstallStarted = false;
      dialog.showErrorBox('Update could not start', `Windows could not start the update installer.\n\n${error.message}`);
    });
    launcher.once('spawn', () => {
      launcher.unref();
      app.quit();
    });
  };

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
      restartAndInstallUpdate();
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
