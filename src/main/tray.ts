import { Tray, Menu, BrowserWindow, App, nativeImage } from 'electron';
import * as path from 'path';

export function createTray(win: BrowserWindow, app: App): Tray {
  // Use a simple 16x16 empty image as fallback if no icon is available
  let icon: Electron.NativeImage;
  try {
    const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      icon = createDefaultIcon();
    }
  } catch {
    icon = createDefaultIcon();
  }

  const tray = new Tray(icon);
  tray.setToolTip('Chess Helper Overlay');

  const updateMenu = (isVisible: boolean) => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Chess Helper Overlay',
        enabled: false,
      },
      { type: 'separator' },
      {
        label: isVisible ? 'Hide Overlay' : 'Show Overlay',
        click: () => {
          if (win.isVisible()) {
            win.hide();
          } else {
            win.show();
          }
          updateMenu(!isVisible);
        },
      },
      {
        label: 'Analyze Board (⌘⇧C)',
        click: () => {
          win.show();
          win.webContents.send('status-update', { status: 'capturing', message: 'Capturing screen…' });
          // Trigger via ipcMain internal event
          const { ipcMain } = require('electron');
          ipcMain.emit('trigger-capture-internal');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Chess Helper',
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setContextMenu(contextMenu);
  };

  updateMenu(true);

  // Double-click to show/hide
  tray.on('double-click', () => {
    if (win.isVisible()) {
      win.hide();
    } else {
      win.show();
    }
  });

  // Update menu when window visibility changes
  win.on('show', () => updateMenu(true));
  win.on('hide', () => updateMenu(false));

  return tray;
}

function createDefaultIcon(): Electron.NativeImage {
  const { nativeImage } = require('electron');
  // Create a minimal 16x16 PNG (chess knight ♞ approximation)
  // This is a transparent placeholder — ideally you'd use a real .png asset
  return nativeImage.createEmpty();
}
