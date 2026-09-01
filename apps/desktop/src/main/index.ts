import { app, BrowserWindow, desktopCapturer, session } from 'electron';
import { join } from 'node:path';

import { registerAsrIpc } from './asr/asr-ipc';
import { registerRecordingIpc } from './recording/recording-ipc';
import { RecordingManager } from './recording/recording-manager';

app.enableSandbox();

const recordingManager = new RecordingManager();
const asrProcess = registerAsrIpc();

registerRecordingIpc(recordingManager);

const configureMediaCapture = (): void => {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media';
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
      });

      const source = sources[0];

      if (!source) {
        callback({});
        return;
      }

      if (process.platform === 'win32') {
        callback({
          video: source,
          audio: 'loopback',
        });
        return;
      }

      callback({
        video: source,
      });
    } catch {
      callback({});
    }
  });
};

const createWindow = (): void => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,

    minWidth: 360,
    minHeight: 560,

    show: false,

    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),

      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.once('closed', () => {
    void recordingManager.stopAll();
    void asrProcess.stop();
  });

  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
};

app.whenReady().then(() => {
  configureMediaCapture();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
