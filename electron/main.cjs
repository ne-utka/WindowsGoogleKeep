const { app, BrowserWindow, BrowserView, shell, Menu, Tray, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const KEEP_URL = 'https://keep.google.com';
const GOOGLE_KEEP_HOST = 'keep.google.com';
const GOOGLE_ACCOUNTS_HOST = 'accounts.google.com';
const GOOGLE_DRIVE_HOST = 'drive.google.com';
const KEEP_PARTITION = 'persist:keep';
const APP_ICON_PATH = path.join(__dirname, '..', 'assets', 'app-icon-converted.ico');
const SHELL_PRELOAD_PATH = path.join(__dirname, 'shell-preload.cjs');
const SETTINGS_PRELOAD_PATH = path.join(__dirname, 'settings-preload.cjs');
const TOP_BAR_HEIGHT = 36;
const CHROME_LIKE_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const SETTINGS_KEY = 'appSettings';
const DEFAULT_SETTINGS = {
    autoLaunch: false,
    closeToTray: true,
};

const store = new Store();
let mainWindow;
let keepView;
let settingsWindow;
let tray;
let isQuitting = false;

app.userAgentFallback = CHROME_LIKE_USER_AGENT;

function getAppSettings() {
    return {
        ...DEFAULT_SETTINGS,
        ...store.get(SETTINGS_KEY, {}),
    };
}

function applyAutoLaunchSetting(enabled) {
    try {
        app.setLoginItemSettings({
            openAtLogin: Boolean(enabled),
            path: process.execPath,
            args: [],
        });
    } catch {
        // Ignore unsupported environments.
    }
}

function updateAppSettings(partial) {
    const current = getAppSettings();
    const next = {
        ...current,
        ...partial,
    };
    store.set(SETTINGS_KEY, next);
    applyAutoLaunchSetting(next.autoLaunch);
    syncTrayWithSettings(next);
    return next;
}

function isAllowedHost(hostname) {
    return hostname === GOOGLE_KEEP_HOST || hostname === GOOGLE_ACCOUNTS_HOST;
}

function isGoogleHost(hostname) {
    return hostname === 'google.com' || hostname.endsWith('.google.com');
}

function isGoogleAuthHost(hostname) {
    return (
        isGoogleHost(hostname)
        || hostname === 'gstatic.com'
        || hostname.endsWith('.gstatic.com')
        || hostname === 'googleusercontent.com'
        || hostname.endsWith('.googleusercontent.com')
    );
}

function parseUrl(rawUrl) {
    try {
        return new URL(rawUrl);
    } catch {
        return null;
    }
}

function handleUrlByPolicy(rawUrl, event) {
    const parsed = parseUrl(rawUrl);
    if (!parsed || parsed.protocol !== 'https:') {
        if (event) {
            event.preventDefault();
        }
        return false;
    }

    if (!isAllowedHost(parsed.hostname) && !isGoogleAuthHost(parsed.hostname)) {
        if (event) {
            event.preventDefault();
        }

        if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
            shell.openExternal(parsed.toString());
        }
        return false;
    }
    return true;
}

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    if (!mainWindow.isVisible()) {
        mainWindow.show();
    }
}

function applyNavigationSecurity() {
    if (!keepView || keepView.webContents.isDestroyed()) {
        return;
    }

    keepView.webContents.on('will-navigate', (event, url) => {
        handleUrlByPolicy(url, event);
    });

    keepView.webContents.on('will-redirect', (event, url) => {
        handleUrlByPolicy(url, event);
    });

    keepView.webContents.setWindowOpenHandler(({ url }) => {
        const parsed = parseUrl(url);
        if (!parsed || !handleUrlByPolicy(url)) {
            return { action: 'deny' };
        }

        if (isAllowedHost(parsed.hostname)) {
            keepView.webContents.loadURL(url);
            return { action: 'deny' };
        }
        return { action: 'deny' };
    });
}

function applyStartupRouting() {
    const onUrlChange = (url) => {
        const parsed = parseUrl(url);
        if (!parsed) {
            return;
        }

        // Drive SetOSID is a warm-up hop, keep should be the final destination.
        if (parsed.hostname === GOOGLE_DRIVE_HOST && parsed.pathname === '/accounts/SetOSID') {
            keepView.webContents.loadURL(KEEP_URL);
            return;
        }

        if (parsed.hostname === GOOGLE_ACCOUNTS_HOST) {
            showMainWindow();
            return;
        }

        if (parsed.hostname === GOOGLE_KEEP_HOST) {
            showMainWindow();
        }
    };

    keepView.webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
        if (isMainFrame) {
            onUrlChange(url);
        }
    });

    keepView.webContents.on('did-redirect-navigation', (_event, url, _isInPlace, isMainFrame) => {
        if (isMainFrame) {
            onUrlChange(url);
        }
    });

    keepView.webContents.on('did-finish-load', () => {
        onUrlChange(keepView.webContents.getURL());
    });
}

function updateViewBounds() {
    if (!mainWindow || mainWindow.isDestroyed() || !keepView || keepView.webContents.isDestroyed()) {
        return;
    }

    const [width, height] = mainWindow.getContentSize();
    keepView.setBounds({
        x: 0,
        y: TOP_BAR_HEIGHT,
        width,
        height: Math.max(0, height - TOP_BAR_HEIGHT),
    });
}

function buildShellHtml() {
    return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    :root { color-scheme: dark; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #202124; }
    .topbar {
      height: ${TOP_BAR_HEIGHT}px;
      background: #202124;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: flex-end;
      -webkit-app-region: drag;
      user-select: none;
      position: relative;
    }
    .actions { height: 100%; display: flex; -webkit-app-region: no-drag; align-items: center; }
    .btn {
      width: 46px; height: 100%; border: 0; background: transparent; color: #e8eaed;
      font: 500 10px "Segoe MDL2 Assets", "Segoe UI", sans-serif; cursor: pointer;
    }
    .btn:hover { background: rgba(255,255,255,0.08); }
    .btn.close:hover { background: #d93025; }
    .settings-btn {
      width: 34px;
      height: 34px;
      margin-right: 4px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #e8eaed;
      cursor: pointer;
      -webkit-app-region: no-drag;
      pointer-events: auto;
    }
    .settings-btn svg {
      width: 18px;
      height: 18px;
      display: block;
      pointer-events: none;
    }
    .settings-btn:hover {
      background: rgba(255, 255, 255, 0.1);
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="actions">
      <button class="settings-btn" id="reload-page" aria-label="Reload" title="Reload">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 20q-3.35 0-5.675-2.325T4 12t2.325-5.675T12 4q1.725 0 3.3.712T18 6.75V5q0-.425.288-.712T19 4t.713.288T20 5v5q0 .425-.288.713T19 11h-5q-.425 0-.712-.288T13 10t.288-.712T14 9h3.2q-.8-1.4-2.187-2.2T12 6Q9.5 6 7.75 7.75T6 12t1.75 4.25T12 18q1.7 0 3.113-.862t2.187-2.313q.2-.35.563-.487t.737-.013q.4.125.575.525t-.025.75q-1.025 2-2.925 3.2T12 20"/>
        </svg>
      </button>
      <button class="settings-btn" id="settings-toggle" aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19.14 12.94a7.98 7.98 0 0 0 .05-.94c0-.32-.02-.63-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.28 7.28 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.03.31-.06.62-.06.94 0 .32.03.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.5.39 1.05.71 1.63.94l.36 2.54c.04.24.25.42.49.42h3.8c.24 0 .45-.18.49-.42l.36-2.54c.58-.23 1.13-.55 1.63-.94l2.39.96c.26.12.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/>
        </svg>
      </button>
      <button class="btn" id="minimize" aria-label="Minimize" title="Minimize">&#xE921;</button>
      <button class="btn" id="maximize" aria-label="Maximize" title="Maximize">&#xE922;</button>
      <button class="btn close" id="close" aria-label="Close" title="Close">&#xE8BB;</button>
    </div>
  </div>
</body>
</html>`;
}

function buildSettingsHtml() {
    return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    :root { color-scheme: dark; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
      font-family: "Segoe UI", sans-serif;
      color: #e8eaed;
      box-sizing: border-box;
    }
    *, *::before, *::after { box-sizing: inherit; }
    .panel {
      width: 100%;
      height: 100%;
      padding: 12px 12px 10px;
      border-radius: 14px;
      background: rgba(32, 33, 36, 0.98);
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(12px);
      user-select: none;
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    h2 {
      margin: 0;
      font: 600 13px "Google Sans", "Segoe UI", sans-serif;
      letter-spacing: 0.2px;
    }
    .close {
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: #e8eaed;
      cursor: pointer;
      font: 500 12px "Segoe UI", sans-serif;
    }
    .close:hover { background: rgba(255,255,255,0.1); }
    .item {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 10px;
      align-items: start;
      padding: 8px 4px;
      border-radius: 10px;
    }
    .item:hover { background: rgba(255,255,255,0.04); }
    .item input {
      margin-top: 2px;
      width: 16px;
      height: 16px;
      accent-color: #8ab4f8;
      cursor: pointer;
    }
    .label {
      margin: 0;
      font: 500 13px "Google Sans", "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .hint {
      margin: 2px 0 0;
      font: 400 12px "Segoe UI", sans-serif;
      line-height: 1.4;
      color: rgba(232, 234, 237, 0.72);
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="head">
      <h2>Settings</h2>
      <button id="settings-close" class="close" aria-label="Close">&times;</button>
    </div>
    <label class="item" for="setting-auto-launch">
      <input type="checkbox" id="setting-auto-launch" />
      <div>
        <p class="label">Launch at system startup</p>
        <p class="hint">Start the app automatically after signing in to Windows.</p>
      </div>
    </label>
    <label class="item" for="setting-close-to-tray">
      <input type="checkbox" id="setting-close-to-tray" />
      <div>
        <p class="label">Close to tray</p>
        <p class="hint">The close button hides the app to tray instead of exiting.</p>
      </div>
    </label>
    <div class="item">
      <span></span>
      <div>
        <p class="label">Google language</p>
        <p class="hint">Open your Google account language settings in browser.</p>
        <button id="open-google-language" style="margin-top:8px;width:100%;height:32px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:#2b2c2f;color:#e8eaed;cursor:pointer;">Open language settings</button>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function createMainWindow() {
    const savedBounds = store.get('windowBounds', {
        width: 1300,
        height: 850,
    });

    mainWindow = new BrowserWindow({
        width: savedBounds.width || 1300,
        height: savedBounds.height || 850,
        x: savedBounds.x,
        y: savedBounds.y,
        title: '',
        frame: false,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: '#202124',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: KEEP_PARTITION,
            preload: SHELL_PRELOAD_PATH,
        },
    });

    mainWindow.on('close', (event) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }
        store.set('windowBounds', mainWindow.getBounds());

        const settings = getAppSettings();
        if (!isQuitting && settings.closeToTray) {
            event.preventDefault();
            closeSettingsWindow();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        closeSettingsWindow();
        keepView = null;
        mainWindow = null;
    });

    mainWindow.on('resize', updateViewBounds);
    mainWindow.on('maximize', updateViewBounds);
    mainWindow.on('unmaximize', updateViewBounds);
    mainWindow.on('resize', positionSettingsWindow);
    mainWindow.on('move', positionSettingsWindow);

    keepView = new BrowserView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: KEEP_PARTITION,
        },
    });
    keepView.webContents.setUserAgent(CHROME_LIKE_USER_AGENT);
    mainWindow.setBrowserView(keepView);
    updateViewBounds();

    mainWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(buildShellHtml())}`);
    applyNavigationSecurity();
    applyStartupRouting();
    keepView.webContents.loadURL(KEEP_URL);
}

function createMenu() {
    Menu.setApplicationMenu(null);
}

function positionSettingsWindow() {
    if (!mainWindow || mainWindow.isDestroyed() || !settingsWindow || settingsWindow.isDestroyed()) {
        return;
    }

    const [windowX, windowY] = mainWindow.getPosition();
    const [windowWidth] = mainWindow.getSize();
    const [settingsWidth] = settingsWindow.getSize();
    const offsetFromRight = 14;
    const x = windowX + windowWidth - settingsWidth - offsetFromRight;
    const y = windowY + TOP_BAR_HEIGHT + 8;
    settingsWindow.setPosition(x, y, false);
}

function closeSettingsWindow() {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
        settingsWindow = null;
        return;
    }
    settingsWindow.close();
}

function openSettingsWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
    }

    if (settingsWindow && !settingsWindow.isDestroyed()) {
        positionSettingsWindow();
        settingsWindow.focus();
        return true;
    }

    settingsWindow = new BrowserWindow({
        width: 420,
        height: 260,
        show: false,
        frame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        parent: mainWindow,
        modal: false,
        backgroundColor: '#00000000',
        transparent: true,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            preload: SETTINGS_PRELOAD_PATH,
        },
    });

    settingsWindow.on('blur', () => {
        closeSettingsWindow();
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });

    settingsWindow.once('ready-to-show', async () => {
        if (!settingsWindow || settingsWindow.isDestroyed()) {
            return;
        }

        try {
            const size = await settingsWindow.webContents.executeJavaScript(`
                (() => {
                    const panel = document.querySelector('.panel');
                    if (!panel) {
                        return { width: 420, height: 260 };
                    }
                    const rect = panel.getBoundingClientRect();
                    const style = window.getComputedStyle(panel);
                    const marginLeft = Number.parseFloat(style.marginLeft || '0') || 0;
                    const marginRight = Number.parseFloat(style.marginRight || '0') || 0;
                    const marginTop = Number.parseFloat(style.marginTop || '0') || 0;
                    const marginBottom = Number.parseFloat(style.marginBottom || '0') || 0;
                    const width = Math.ceil(rect.width + marginLeft + marginRight);
                    const height = Math.ceil(rect.height + marginTop + marginBottom);
                    return { width, height };
                })();
            `, true);

            const width = Math.max(320, Number(size?.width) || 420);
            const height = Math.max(180, Number(size?.height) || 260);
            settingsWindow.setContentSize(width, height);
        } catch {
            // Fallback to initial dimensions.
        }

        positionSettingsWindow();
        settingsWindow.show();
        settingsWindow.focus();
    });

    settingsWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(buildSettingsHtml())}`);
    return true;
}

function toggleSettingsWindow() {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        closeSettingsWindow();
        return false;
    }
    return openSettingsWindow();
}

function showMainWindowFromTray() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    mainWindow.show();
    mainWindow.focus();
}

function createTray() {
    if (tray) {
        return;
    }

    tray = new Tray(APP_ICON_PATH);
    tray.setToolTip('WindowsGoogleKeep');
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {
                label: 'Open',
                click: () => showMainWindowFromTray(),
            },
            {
                label: 'Quit',
                click: () => {
                    isQuitting = true;
                    app.quit();
                },
            },
        ]),
    );

    tray.on('double-click', () => showMainWindowFromTray());
}

function destroyTray() {
    if (!tray) {
        return;
    }
    tray.destroy();
    tray = null;
}

function syncTrayWithSettings(settingsArg) {
    const settings = settingsArg || getAppSettings();
    if (settings.closeToTray) {
        createTray();
        return;
    }
    destroyTray();
}

function createApp() {
    createMenu();
    const settings = getAppSettings();
    applyAutoLaunchSetting(settings.autoLaunch);
    syncTrayWithSettings(settings);
    createMainWindow();

    globalShortcut.register('CommandOrControl+R', () => {
        if (mainWindow && mainWindow.isFocused()) {
            if (keepView && !keepView.webContents.isDestroyed()) {
                keepView.webContents.reload();
            }
        }
    });
}

ipcMain.handle('window-control', (event, action) => {
    const shellWindow = BrowserWindow.fromWebContents(event.sender);
    if (!shellWindow || shellWindow.isDestroyed()) {
        return false;
    }

    if (action === 'minimize') {
        shellWindow.minimize();
        return true;
    }

    if (action === 'toggle-maximize') {
        if (shellWindow.isMaximized()) {
            shellWindow.unmaximize();
            return false;
        }
        shellWindow.maximize();
        return true;
    }

    if (action === 'close') {
        shellWindow.close();
        return true;
    }

    if (action === 'is-maximized') {
        return shellWindow.isMaximized();
    }

    return false;
});

ipcMain.handle('app-settings-get', () => {
    return getAppSettings();
});

ipcMain.handle('app-settings-update', (_event, partial) => {
    if (!partial || typeof partial !== 'object') {
        return getAppSettings();
    }
    return updateAppSettings(partial);
});

ipcMain.handle('settings-window-toggle', () => {
    return toggleSettingsWindow();
});

ipcMain.handle('settings-window-close', () => {
    closeSettingsWindow();
    return true;
});

ipcMain.handle('open-google-language-settings', () => {
    shell.openExternal('https://myaccount.google.com/language');
    return true;
});

ipcMain.handle('reload-keep-page', () => {
    if (!keepView || keepView.webContents.isDestroyed()) {
        return false;
    }
    keepView.webContents.reload();
    return true;
});

app.whenReady().then(createApp);

app.on('before-quit', () => {
    isQuitting = true;
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createApp();
        return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    destroyTray();
});




