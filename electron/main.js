const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, session, shell } = require('electron');
const path = require('path');
const { trayImage } = require('./badge');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';
const APP_ID = 'com.notification.dashboard';
const APP_NAME = 'Notification Dashboard';
const ICON_PATH = path.join(__dirname, 'icon.ico');

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Windows takes the taskbar icon and the toast icon/label from a Start menu
// shortcut that carries the same AppUserModelID. The running electron.exe
// identity is "Electron" until that shortcut exists.
function installWindowsIdentity() {
  if (process.platform !== 'win32') return;
  const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`);
  const packaged = app.isPackaged;
  const wrote = shell.writeShortcutLink(shortcut, 'create', {
    target: process.execPath,
    args: packaged ? '' : `"${path.resolve(app.getAppPath())}"`,
    cwd: packaged ? path.dirname(process.execPath) : path.resolve(app.getAppPath()),
    icon: ICON_PATH,
    iconIndex: 0,
    appUserModelId: APP_ID,
    description: APP_NAME,
  });
  if (!wrote) console.error(`Could not create the Windows shortcut at ${shortcut}`);
}

let win;
let tray;
let unreadCount = 0;

function unreadTooltip(count) {
  if (!count) return 'Notification Dashboard';
  return `Notification Dashboard — ${count > 99 ? '99+' : count} unread`;
}

function applyUnread(count) {
  unreadCount = count;
  if (!tray) return;
  tray.setImage(trayImage(count));
  tray.setToolTip(unreadTooltip(count));
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function offlinePage(detail) {
  const safeUrl = DASHBOARD_URL.replace(/[<>&"]/g, '');
  const safeDetail = String(detail || '').replace(/[<>&"]/g, '');
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Notification Dashboard</title>
  <style>
    body { margin: 0; height: 100vh; display: grid; place-items: center; background: #0f1115; color: #f5f6f8; font: 15px/1.5 system-ui, sans-serif; }
    main { max-width: 420px; padding: 24px; }
    h1 { font-size: 18px; font-weight: 600; margin: 0 0 8px; }
    p { margin: 0; color: #c7cad1; }
    code { color: #f5f6f8; }
  </style>
</head>
<body>
  <main>
    <h1>Dashboard unavailable</h1>
    <p>Could not open <code>${safeUrl}</code>.</p>
    <p>${safeDetail}</p>
    <p>Start the Next server, or set DASHBOARD_URL to the deployed dashboard.</p>
  </main>
</body>
</html>`)}`;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(ICON_PATH),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(DASHBOARD_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3 || !url.startsWith('http')) return;
    win.loadURL(offlinePage(description));
  });

  win.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  tray = new Tray(trayImage(unreadCount));
  tray.setToolTip(unreadTooltip(unreadCount));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show', click: showWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]));
  tray.on('click', showWindow);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  ipcMain.on('unread-count', (_event, count) => {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 0 || n === unreadCount) return;
    applyUnread(n);
  });

  app.whenReady().then(() => {
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'notifications');
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'notifications');
    });
    installWindowsIdentity();
    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', showWindow);
}
