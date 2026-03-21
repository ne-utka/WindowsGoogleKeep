const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('windowControls', {
    minimize: () => ipcRenderer.invoke('window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window-control', 'toggle-maximize'),
    close: () => ipcRenderer.invoke('window-control', 'close'),
    isMaximized: () => ipcRenderer.invoke('window-control', 'is-maximized'),
});

function bindControls() {
    const minButton = document.getElementById('minimize');
    const maxButton = document.getElementById('maximize');
    const closeButton = document.getElementById('close');
    if (!minButton || !maxButton || !closeButton) {
        return;
    }

    const setMaxIcon = (isMaximized) => {
        maxButton.innerHTML = isMaximized ? '&#xE923;' : '&#xE922;';
        maxButton.title = isMaximized ? 'Restore' : 'Maximize';
        maxButton.setAttribute('aria-label', isMaximized ? 'Restore' : 'Maximize');
    };

    minButton.addEventListener('click', () => {
        window.windowControls.minimize();
    });

    maxButton.addEventListener('click', async () => {
        const isMaximized = await window.windowControls.toggleMaximize();
        setMaxIcon(Boolean(isMaximized));
    });

    closeButton.addEventListener('click', () => {
        window.windowControls.close();
    });

    window.windowControls.isMaximized().then((isMaximized) => {
        setMaxIcon(Boolean(isMaximized));
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bindControls, { once: true });
} else {
    bindControls();
}
