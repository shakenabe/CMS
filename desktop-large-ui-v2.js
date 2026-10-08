(() => {
    'use strict';

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function saveDesktopRatio(ratio) {
        if (typeof appSettings !== 'object' || !appSettings) return;
        appSettings.desktopLeftRatio = Math.round(clamp(ratio, 28, 52) * 10) / 10;
        document.documentElement.style.setProperty('--desktop-left-ratio', `${appSettings.desktopLeftRatio}%`);
        document.body.style.setProperty('--desktop-left-ratio', `${appSettings.desktopLeftRatio}%`);
        if (typeof saveSettings === 'function') saveSettings();
    }

    const desktopSizeControls = [
        { id: 'set-desktop-folder-width', key: 'desktopFolderWidth', css: '--cms-folder-width', output: 'desktop-folder-width-value', unit: 'px', fallback: 260 },
        { id: 'set-desktop-player-width', key: 'desktopPlayerWidth', css: '--cms-player-width', output: 'desktop-player-width-value', unit: 'px', fallback: 480 },
        { id: 'set-desktop-player-height', key: 'desktopPlayerHeight', css: '--cms-player-height', output: 'desktop-player-height-value', unit: 'px', fallback: 360 },
        { id: 'set-desktop-controls-height', key: 'desktopControlsHeight', css: '--cms-controls-height', output: 'desktop-controls-height-value', unit: 'px', fallback: 200 },
        { id: 'set-desktop-track-height', key: 'desktopTrackHeight', css: '--cms-track-height', output: 'desktop-track-height-value', unit: 'px', fallback: 76 }
    ];

    function applyDesktopSize(control, value) {
        const input = document.getElementById(control.id);
        const numeric = clamp(Number(value) || control.fallback, Number(input?.min || 0), Number(input?.max || 10000));
        document.documentElement.style.setProperty(control.css, `${numeric}${control.unit}`);
        if (input) input.value = String(numeric);
        const output = document.getElementById(control.output);
        if (output) output.textContent = `${numeric}${control.unit}`;
        return numeric;
    }

    function setupDesktopSizeControls() {
        desktopSizeControls.forEach(control => {
            const value = applyDesktopSize(control, appSettings?.[control.key] ?? control.fallback);
            const input = document.getElementById(control.id);
            if (!input || input.dataset.ready === '1') return;
            input.dataset.ready = '1';
            input.addEventListener('input', () => {
                appSettings[control.key] = applyDesktopSize(control, input.value);
            });
            appSettings[control.key] = value;
        });
    }

    function setupDesktopResizer() {
        const workspace = document.getElementById('widget-container');
        const resizer = document.getElementById('desktop-pane-resizer');
        if (!workspace || !resizer || resizer.dataset.ready === '1') return;
        resizer.dataset.ready = '1';
        let dragging = false;
        const setFromClientX = clientX => {
            const rect = workspace.getBoundingClientRect();
            if (!(rect.width > 0)) return;
            if (document.body.classList.contains('theme-modern')) {
                const width = clamp(clientX - rect.left, 320, Math.min(600, rect.width - 420));
                appSettings.desktopPlayerWidth = Math.round(width);
                applyDesktopSize(desktopSizeControls[1], appSettings.desktopPlayerWidth);
                return;
            }
            const scale = window.innerWidth > 1050 && ['nerv', 'niconico'].includes(appSettings.theme) ? .55 : 1;
            const ratio = clamp((clientX - rect.left) / rect.width * 100 / scale, 28, 52);
            document.documentElement.style.setProperty('--desktop-left-ratio', `${ratio}%`);
            document.body.style.setProperty('--desktop-left-ratio', `${ratio}%`);
            resizer.setAttribute('aria-valuenow', String(Math.round(ratio)));
        };
        const commit = () => {
            if (document.body.classList.contains('theme-modern')) {
                if (typeof saveSettings === 'function') saveSettings();
            } else {
                saveDesktopRatio(parseFloat(document.body.style.getPropertyValue('--desktop-left-ratio')) || 36);
            }
        };
        resizer.addEventListener('pointerdown', event => {
            if (!document.body.classList.contains('is-pc') || document.body.classList.contains('window-mode')) return;
            dragging = true;
            event.preventDefault();
            document.body.classList.add('desktop-pane-resizing');
            try { resizer.setPointerCapture(event.pointerId); } catch (_) {}
            setFromClientX(event.clientX);
            trackWindowPointer(event, move => setFromClientX(move.clientX), stop);
        });
        resizer.addEventListener('pointermove', event => { if (dragging) setFromClientX(event.clientX); });
        const stop = () => {
            if (!dragging) return;
            dragging = false;
            document.body.classList.remove('desktop-pane-resizing');
            commit();
        };
        resizer.addEventListener('pointerup', stop);
        resizer.addEventListener('pointercancel', stop);
        resizer.addEventListener('keydown', event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            if (document.body.classList.contains('theme-modern')) {
                appSettings.desktopPlayerWidth = clamp((Number(appSettings.desktopPlayerWidth) || 480) + (event.key === 'ArrowLeft' ? -10 : 10), 320, 600);
                applyDesktopSize(desktopSizeControls[1], appSettings.desktopPlayerWidth);
                if (typeof saveSettings === 'function') saveSettings();
                return;
            }
            const current = Number(appSettings?.desktopLeftRatio) || 36;
            saveDesktopRatio(current + (event.key === 'ArrowLeft' ? -1 : 1));
            resizer.setAttribute('aria-valuenow', String(Math.round(Number(appSettings.desktopLeftRatio))));
        });
        const initial = clamp(Number(appSettings?.desktopLeftRatio) || 36, 28, 52);
        document.documentElement.style.setProperty('--desktop-left-ratio', `${initial}%`);
        document.body.style.setProperty('--desktop-left-ratio', `${initial}%`);
        resizer.setAttribute('aria-valuenow', String(Math.round(initial)));
    }

    function getQueueItem(offset) {
        if (!Array.isArray(currentPlaylist) || !currentPlaylist.length || !Number.isInteger(currentIndex)) return null;
        if (currentPlaybackContext?.finite && currentIndex + offset >= currentPlaylist.length) return null;
        const index = (currentIndex + offset) % currentPlaylist.length;
        return { item: currentPlaylist[index], index };
    }

    function updatePocketQueue() {
        [1, 2].forEach(offset => {
            const button = document.getElementById(`pocket-next-item-${offset}`);
            if (!button) return;
            const queued = getQueueItem(offset);
            const image = button.querySelector('img');
            const title = button.querySelector('strong');
            const artist = button.querySelector('small');
            if (!queued?.item) {
                button.disabled = true;
                image.removeAttribute('src');
                title.textContent = '次の曲はありません';
                artist.textContent = '---';
                return;
            }
            const item = queued.item;
            button.disabled = false;
            button.dataset.queueIndex = String(queued.index);
            image.src = item.thumbnail || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
            title.textContent = item.title || 'タイトルなし';
            artist.textContent = item.channelName || item.uploader || item.site || '投稿者不明';
            button.title = `${title.textContent}から再生`;
            button.setAttribute('aria-label', `${title.textContent}から再生`);
        });
    }

    function setupPocketEnhancements() {
        const volume = document.getElementById('pocket-volume-slider');
        const volumeValue = document.getElementById('pocket-volume-value');
        const opacity = document.getElementById('pocket-panel-opacity-slider');
        const opacityValue = document.getElementById('pocket-panel-opacity-value');
        if (volume) {
            const savedVolume = Number(appSettings?.pocketVolume);
            volume.value = String(clamp(Number.isFinite(savedVolume) ? savedVolume : 100, 0, 100));
            volumeValue.textContent = `${volume.value}%`;
            volume.addEventListener('input', () => {
                appSettings.pocketVolume = Number(volume.value);
                volumeValue.textContent = `${volume.value}%`;
                if (typeof applyVolume === 'function') applyVolume();
            });
            volume.addEventListener('change', () => { if (typeof saveSettings === 'function') saveSettings(); });
        }
        if (opacity) {
            opacity.value = String(CmsStatePolicy.clamp(appSettings?.pocketPanelOpacity, 28));
            opacityValue.textContent = `${opacity.value}%`;
            opacity.addEventListener('input', () => {
                appSettings.pocketPanelOpacity = Number(opacity.value);
                opacityValue.textContent = `${opacity.value}%`;
                document.getElementById('pocket-overlay')?.style.setProperty('--pocket-panel-alpha', String(1 - Number(opacity.value) / 100));
            });
            opacity.addEventListener('change', () => { if (typeof saveSettings === 'function') saveSettings(); });
        }
        document.querySelectorAll('.pocket-next-item[data-queue-offset]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                if (document.getElementById('pocket-overlay')?.classList.contains('layout-editing')) return;
                const index = Number(button.dataset.queueIndex);
                if (!Number.isInteger(index) || index < 0 || index >= currentPlaylist.length) return;
                playbackIntent = 'playing';
                playbackMediaState = 'loading';
                loadVideo(index);
                window.CmsUI?.notify?.('選択した曲から続けて再生します。', { type: 'success', title: '次の曲を変更' });
            });
        });
        updatePocketQueue();
    }

    window.CmsDesktopLargeUI = { updatePocketQueue, refreshSizing: setupDesktopSizeControls };
    document.addEventListener('DOMContentLoaded', () => {
        setupDesktopSizeControls();
        setupDesktopResizer();
        setupPocketEnhancements();
    });
})();
