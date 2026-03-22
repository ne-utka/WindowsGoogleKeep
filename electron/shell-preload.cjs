const { contextBridge, ipcRenderer } = require('electron');

const controlsApi = {
    minimize: () => ipcRenderer.invoke('window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window-control', 'toggle-maximize'),
    close: () => ipcRenderer.invoke('window-control', 'close'),
    isMaximized: () => ipcRenderer.invoke('window-control', 'is-maximized'),
    toggleSettingsWindow: () => ipcRenderer.invoke('settings-window-toggle'),
    reloadKeepPage: () => ipcRenderer.invoke('reload-keep-page'),
};

contextBridge.exposeInMainWorld('windowControls', controlsApi);

function bindControls() {
    const minButton = document.getElementById('minimize');
    const maxButton = document.getElementById('maximize');
    const closeButton = document.getElementById('close');
    const reloadButton = document.getElementById('reload-page');
    const settingsToggle = document.getElementById('settings-toggle');
    if (!minButton || !maxButton || !closeButton || !reloadButton || !settingsToggle) {
        return;
    }

    const setMaxIcon = (isMaximized) => {
        maxButton.innerHTML = isMaximized ? '&#xE923;' : '&#xE922;';
        maxButton.title = isMaximized ? 'Restore' : 'Maximize';
        maxButton.setAttribute('aria-label', isMaximized ? 'Restore' : 'Maximize');
    };

    minButton.addEventListener('click', () => {
        controlsApi.minimize();
    });

    maxButton.addEventListener('click', async () => {
        const isMaximized = await controlsApi.toggleMaximize();
        setMaxIcon(Boolean(isMaximized));
    });

    closeButton.addEventListener('click', () => {
        controlsApi.close();
    });

    reloadButton.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    reloadButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        controlsApi.reloadKeepPage();
    });

    settingsToggle.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    settingsToggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        controlsApi.toggleSettingsWindow();
    });

    controlsApi.isMaximized().then((isMaximized) => {
        setMaxIcon(Boolean(isMaximized));
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bindControls, { once: true });
} else {
    bindControls();
}
