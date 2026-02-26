import { app, BrowserWindow, globalShortcut, ipcMain, Tray } from 'electron';
import * as path from 'path';
import { EngineManager } from './engine/engine-manager';
import { registerIpcHandlers } from './ipc-handlers';
import { createTray } from './tray';
import { getSettings, initStore } from './store';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // Not on Windows or not installed via Squirrel, ignore
}

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
export const engineManager = new EngineManager();

function createWindow(): BrowserWindow {
  const settings = getSettings();

  const win = new BrowserWindow({
    width: 320,
    height: 700,
    minWidth: 320,
    maxWidth: 320,
    minHeight: 500,
    maxHeight: 1200,
    useContentSize: true,
    x: settings.windowX ?? undefined,
    y: settings.windowY ?? undefined,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Keep above fullscreen apps (macOS)
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Load the renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Save window position on move
  win.on('moved', () => {
    const [x, y] = win.getPosition();
    const store = initStore();
    store.set('windowX', x);
    store.set('windowY', y);
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

async function initializeEngine(): Promise<void> {
  const settings = getSettings();
  try {
    await engineManager.initialize(settings.stockfishPath || undefined);
    console.log('[Main] Stockfish engine ready');
  } catch (err) {
    console.error('[Main] Failed to initialize Stockfish:', err);
    // Send error to renderer once it's ready
    mainWindow?.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send('status-update', {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

function registerHotkey(win: BrowserWindow): void {
  const settings = getSettings();
  const hotkey = settings.captureHotkey;

  const success = globalShortcut.register(hotkey, () => {
    win.webContents.send('status-update', {
      status: 'capturing',
      message: 'Capturing screen…',
    });
    ipcMain.emit('trigger-capture-internal');
  });

  if (!success) {
    console.warn('[Main] Failed to register hotkey:', hotkey);
  } else {
    console.log('[Main] Hotkey registered:', hotkey);
  }
}

app.whenReady().then(async () => {
  initStore();
  mainWindow = createWindow();

  registerIpcHandlers(mainWindow, engineManager);
  tray = createTray(mainWindow, app);
  registerHotkey(mainWindow);

  // Initialize engine in background
  initializeEngine();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS keep running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  engineManager.shutdown();
});

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
