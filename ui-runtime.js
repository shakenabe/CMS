// Shared drag lifecycle. The shield prevents an embedded player from swallowing moves.
function trackWindowPointer(start, onMove, onEnd) {
    const shield = document.createElement('div');
    shield.className = 'cms-drag-shield'; document.body.appendChild(shield);
    const move = event => { if (event.pointerId === start.pointerId) onMove(event); };
    const finish = event => {
        if (event?.pointerId != null && event.pointerId !== start.pointerId) return;
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
        window.removeEventListener('blur', finish);
        shield.remove(); onEnd();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('blur', finish);
}

function applyDesktopPanelHeights() {
    const container = document.getElementById('widget-container');
    for (const [id, variable] of [['widget-player', '--cms-player-height'], ['widget-controls', '--cms-controls-height'], ['widget-folder-list-wrapper', '--cms-folders-height']]) {
        const panel = document.getElementById(id);
        const value = Number(appSettings.desktopPanelHeights?.[id]);
        if (value > 0) {
            const height = Math.max(130, Math.min(innerHeight * .65, value)) + 'px';
            panel?.style.setProperty('--panel-height', height); container?.style.setProperty(variable, height);
        } else {
            panel?.style.removeProperty('--panel-height'); container?.style.removeProperty(variable);
        }
    }
}

window.CmsRedesign = {
    snapshot() {
        return { theme: appSettings.theme, color: appSettings.colorMode, light: getResolvedColorMode() === 'light',
            reduced: appSettings.performanceMode, folder: currentPlaybackContext?.folderId,
            title: currentPlayingItem?.title || '', desktop: document.body.classList.contains('is-pc') && !appSettings.windowMode,
            count: allItems.length, playing: isPlaying };
    },
    set(values) { Object.assign(appSettings, values); saveSettings(); updateLayoutMode(); applyThemeSettings(); applyWindowMode(); },
    settings() { document.getElementById('btn-open-settings').click(); },
    history() { document.getElementById('btn-open-stats').click(); },
    locate: () => returnToCurrentTrack()
};

document.addEventListener('DOMContentLoaded', () => {
    const restore = document.getElementById('restore-device-settings');
    restore?.addEventListener('change', async event => {
        const file = event.target.files?.[0]; if (!file) return;
        try {
            const data = JSON.parse(await file.text());
            if (!data.webSettings || typeof data.webSettings !== 'object' || Array.isArray(data.webSettings)) throw new Error('設定付きのCMS JSONを選択してください。');
            if (!confirm('このJSONの表示設定を、このブラウザへ復元しますか？ライブラリは変更しません。')) return;
            const known = Object.fromEntries(Object.keys(defaultSettings).filter(key => Object.hasOwn(data.webSettings, key)).map(key => [key, data.webSettings[key]]));
            appSettings = CmsStatePolicy.mergeSettings(defaultSettings, appSettings, known, true);
            saveSettings(); updateLayoutMode(); applyThemeSettings(); applyWindowMode();
            document.getElementById('btn-close-settings').click();
            document.getElementById('btn-open-settings').click();
            window.CmsUI?.notify?.('この端末の設定を復元しました。', { type: 'success' });
        } catch (error) { window.CmsUI?.notify?.(error.message, { type: 'danger' }); }
        finally { restore.value = ''; }
    });
    for (const id of ['widget-player', 'widget-controls', 'widget-folder-list-wrapper']) {
        const panel = document.getElementById(id);
        const handle = document.createElement('button');
        handle.className = 'cms-panel-resizer'; handle.type = 'button';
        handle.setAttribute('aria-label', `${WINDOW_PANEL_TITLES[id]}の高さを調整`);
        const setHeight = height => {
            const min = id === 'widget-player' ? 130 : 100;
            const value = Math.round(Math.max(min, Math.min(window.innerHeight * .65, height)));
            appSettings.desktopPanelHeights ||= {}; appSettings.desktopPanelHeights[id] = value;
            if (innerWidth > 1050 && ['nerv', 'toyota'].includes(appSettings.theme) && id !== 'widget-folder-list-wrapper') {
                appSettings.desktopPanelHeights['widget-player'] = value;
                appSettings.desktopPanelHeights['widget-controls'] = value;
            }
            applyDesktopPanelHeights();
        };
        if (appSettings.desktopPanelHeights?.[id]) setHeight(appSettings.desktopPanelHeights[id]);
        handle.addEventListener('pointerdown', event => {
            if (appSettings.windowMode) return;
            event.preventDefault(); const height = panel.getBoundingClientRect().height; const y = event.clientY;
            trackWindowPointer(event, move => setHeight(height + move.clientY - y), saveSettings);
        });
        handle.addEventListener('keydown', event => {
            if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
            event.preventDefault();
            if (event.key === 'Home') { delete appSettings.desktopPanelHeights?.[id]; applyDesktopPanelHeights(); }
            else setHeight(panel.getBoundingClientRect().height + (event.key === 'ArrowUp' ? -10 : 10));
            saveSettings();
        });
        panel.appendChild(handle);
    }
});
