const { app, BrowserWindow, BrowserView, shell, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const KEEP_URL = 'https://keep.google.com';
const GOOGLE_KEEP_HOST = 'keep.google.com';
const GOOGLE_ACCOUNTS_HOST = 'accounts.google.com';
const APP_ICON_PATH = path.join(__dirname, '..', 'assets', 'app-icon-converted.ico');
const SHELL_PRELOAD_PATH = path.join(__dirname, 'shell-preload.cjs');
const TOP_BAR_HEIGHT = 36;

const store = new Store();
let mainWindow;
let keepView;

function isAllowedHost(hostname) {
    return hostname === GOOGLE_KEEP_HOST || hostname === GOOGLE_ACCOUNTS_HOST;
}

function isGoogleHost(hostname) {
    return hostname === 'google.com' || hostname.endsWith('.google.com');
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
    if (!parsed || parsed.protocol !== 'https:' || !isAllowedHost(parsed.hostname)) {
        if (event) {
            event.preventDefault();
        }

        if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
            // Google services may trigger background warm-up redirects (for example SetOSID).
            // Keep these blocked in-app instead of launching external browser windows.
            if (isGoogleHost(parsed.hostname)) {
                return false;
            }
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
    }
    .actions { height: 100%; display: flex; -webkit-app-region: no-drag; }
    .btn {
      width: 46px; height: 100%; border: 0; background: transparent; color: #e8eaed;
      font: 500 10px "Segoe MDL2 Assets", "Segoe UI", sans-serif; cursor: pointer;
    }
    .btn:hover { background: rgba(255,255,255,0.08); }
    .btn.close:hover { background: #d93025; }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="actions">
      <button class="btn" id="minimize" aria-label="Minimize" title="Minimize">&#xE921;</button>
      <button class="btn" id="maximize" aria-label="Maximize" title="Maximize">&#xE922;</button>
      <button class="btn close" id="close" aria-label="Close" title="Close">&#xE8BB;</button>
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
            partition: 'persist:keep',
            preload: SHELL_PRELOAD_PATH,
        },
    });

    mainWindow.on('close', () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            return;
        }
        store.set('windowBounds', mainWindow.getBounds());
    });

    mainWindow.on('closed', () => {
        keepView = null;
        mainWindow = null;
    });

    mainWindow.on('resize', updateViewBounds);
    mainWindow.on('maximize', updateViewBounds);
    mainWindow.on('unmaximize', updateViewBounds);

    keepView = new BrowserView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            partition: 'persist:keep',
        },
    });
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

function createApp() {
    createMenu();
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

app.whenReady().then(createApp);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createApp();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});
