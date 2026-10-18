const Sentry = require('./sentry');
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { trayImage } = require('./badge');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://notification-dashboard-gamma.vercel.app';
// const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

const POLL_MS = 5000;
const APP_ID = 'com.notification.dashboard';
const APP_NAME = 'Notification Dashboard';
const ICON_PATH = path.join(__dirname, 'icon.ico');

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Windows takes the taskbar icon and the toast icon/label from a Start menu
// shortcut that carries the same AppUserModelID. The running electron.exe
// identity is "Electron" until that shortcut exists.
function installWindowsIdentity() {
  if (process.platform !== 'win32') return;
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  fs.mkdirSync(programs, { recursive: true });
  const shortcut = path.join(programs, `${APP_NAME}.lnk`);
  const appPath = path.resolve(app.getAppPath());
  // No extra quotes: a quoted path is not a real folder, so Windows opens
  // Electron's welcome window instead of this dashboard.
  const wrote = shell.writeShortcutLink(shortcut, 'create', {
    target: process.execPath,
    args: app.isPackaged ? '' : appPath,
    cwd: app.isPackaged ? path.dirname(process.execPath) : appPath,
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
let seenIds = null;
let pollTimer;
const activeToasts = new Set();
const RECENT_MS = 10 * 60 * 1000;
const REPORT_INTERVAL_MS = 15 * 60 * 1000;
const lastReportAt = new Map();

function reportOnce(key, error, tags) {
  const now = Date.now();
  if (now - (lastReportAt.get(key) || 0) < REPORT_INTERVAL_MS) return;
  lastReportAt.set(key, now);
  const event = error instanceof Error ? error : new Error(String(error));
  Sentry.captureException(event, { tags, fingerprint: [key] });
}

async function pollDashboard() {
  try {
    const [vpsRes, noteRes] = await Promise.all([
      fetch(new URL('/api/vps', DASHBOARD_URL)),
      fetch(new URL('/api/notifications?limit=30', DASHBOARD_URL)),
    ]);
    if (!vpsRes.ok || !noteRes.ok) {
      reportOnce(
        'electron-dashboard-poll',
        `Dashboard poll failed (vps ${vpsRes.status}, notifications ${noteRes.status})`,
        { source: 'electron-poll' },
      );
      return;
    }
    const vps = await vpsRes.json();
    const notes = await noteRes.json();
    const unread = (vps.items || []).reduce((sum, item) => sum + (Number(item.unread) || 0), 0);
    if (unread !== unreadCount) applyUnread(unread);

    const items = notes.items || [];
    if (!seenIds) {
      seenIds = new Set(items.map((item) => item.id));
      const recent = items.filter((item) => !item.read && Date.now() - Number(item.receivedAt) < RECENT_MS);
      for (const item of recent.slice(0, 3)) showToast(item);
      return;
    }
    const fresh = items.filter((item) => !item.read && item.id && !seenIds.has(item.id));
    for (const item of items) if (item.id) seenIds.add(item.id);
    if (seenIds.size > 5000) seenIds = new Set(items.map((item) => item.id));
    for (const item of fresh.slice(0, 5)) showToast(item);
  } catch (err) {
    // Keep the last badge when the dashboard cannot be reached.
    reportOnce('electron-dashboard-poll', err, { source: 'electron-poll' });
  }
}

function showToast(item) {
  if (!Notification.isSupported()) return;
  const toast = new Notification({
    title: `[${item.vps}] ${item.title || item.app || 'Notification'}`,
    body: item.body || '',
    icon: path.join(__dirname, 'icon.png'),
  });
  activeToasts.add(toast);
  toast.on('show', () => console.log(`[toast] ${toast.title}`));
  toast.on('failed', (_event, error) => {
    activeToasts.delete(toast);
    console.error(`[toast] failed: ${error}`);
  });
  toast.on('close', () => activeToasts.delete(toast));
  toast.on('click', () => {
    showWindow();
    toast.close();
  });
  toast.show();
}

function startPolling() {
  pollDashboard();
  pollTimer = setInterval(pollDashboard, POLL_MS);
}

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
  win.webContents.on('dom-ready', () => {
    // The shell shows the Windows toast itself. Silence the page's own
    // Notification so a new message does not appear twice.
    win.webContents.executeJavaScript(`(() => {
      function DesktopNotification() {}
      DesktopNotification.permission = 'granted';
      DesktopNotification.requestPermission = () => Promise.resolve('granted');
      window.Notification = DesktopNotification;
    })()`).catch(() => {});
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3 || !url.startsWith('http')) return;
    reportOnce('electron-dashboard-load', `Could not load the dashboard (${code}: ${description})`, {
      source: 'electron-load',
    });
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

  app.on('render-process-gone', (_event, _contents, details) => {
    if (details.reason !== 'crashed' && details.reason !== 'oom') return;
    Sentry.captureMessage(`Dashboard window ${details.reason}`, {
      level: 'fatal',
      extra: { reason: details.reason, exitCode: details.exitCode },
      tags: { source: 'electron-renderer' },
    });
  });

  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'crashed' && details.reason !== 'oom') return;
    Sentry.captureMessage(`${details.type || 'Child'} process ${details.reason}`, {
      level: 'fatal',
      extra: { type: details.type, reason: details.reason, exitCode: details.exitCode },
      tags: { source: 'electron-process' },
    });
  });

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
    startPolling();
  });

  app.on('before-quit', () => {
    clearInterval(pollTimer);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', showWindow);
}
