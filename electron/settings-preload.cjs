const { ipcRenderer } = require('electron');

function bindSettings() {
    const autoLaunchCheckbox = document.getElementById('setting-auto-launch');
    const closeToTrayCheckbox = document.getElementById('setting-close-to-tray');
    const openGoogleLanguageButton = document.getElementById('open-google-language');
    const closeButton = document.getElementById('settings-close');
    if (!autoLaunchCheckbox || !closeToTrayCheckbox || !openGoogleLanguageButton || !closeButton) {
        return;
    }

    const applySettingsToUi = (settings) => {
        autoLaunchCheckbox.checked = Boolean(settings.autoLaunch);
        closeToTrayCheckbox.checked = Boolean(settings.closeToTray);
    };

    ipcRenderer.invoke('app-settings-get').then((settings) => {
        applySettingsToUi(settings || {});
    });

    autoLaunchCheckbox.addEventListener('change', async () => {
        const settings = await ipcRenderer.invoke('app-settings-update', {
            autoLaunch: autoLaunchCheckbox.checked,
        });
        applySettingsToUi(settings || {});
    });

    closeToTrayCheckbox.addEventListener('change', async () => {
        const settings = await ipcRenderer.invoke('app-settings-update', {
            closeToTray: closeToTrayCheckbox.checked,
        });
        applySettingsToUi(settings || {});
    });

    openGoogleLanguageButton.addEventListener('click', () => {
        ipcRenderer.invoke('open-google-language-settings');
    });

    closeButton.addEventListener('click', () => {
        ipcRenderer.invoke('settings-window-close');
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            ipcRenderer.invoke('settings-window-close');
        }
    });
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', bindSettings, { once: true });
} else {
    bindSettings();
}
