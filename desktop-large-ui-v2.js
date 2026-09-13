(() => {
    'use strict';

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function saveDesktopRatio(ratio) {
        if (typeof appSettings !== 'object' || !appSettings) return;
        appSettings.desktopLeftRatio = Math.round(clamp(ratio, 28, 52) * 10) / 10;
        document.documentElement.style.setProperty('--desktop-left-ratio', `${appSettings.desktopLeftRatio}%`);
        if (typeof saveSettings === 'function') saveSettings();
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
            const ratio = clamp((clientX - rect.left) / rect.width * 100, 28, 52);
            document.documentElement.style.setProperty('--desktop-left-ratio', `${ratio}%`);
            resizer.setAttribute('aria-valuenow', String(Math.round(ratio)));
        };
        const commit = () => {
            const rect = workspace.getBoundingClientRect();
            const left = document.getElementById('left-pane')?.getBoundingClientRect();
            if (rect.width > 0 && left) saveDesktopRatio(left.width / rect.width * 100);
        };
        resizer.addEventListener('pointerdown', event => {
            if (!document.body.classList.contains('is-pc') || document.body.classList.contains('window-mode')) return;
            dragging = true;
            document.body.classList.add('desktop-pane-resizing');
            try { resizer.setPointerCapture(event.pointerId); } catch (_) {}
            setFromClientX(event.clientX);
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
            const current = Number(appSettings?.desktopLeftRatio) || 36;
            saveDesktopRatio(current + (event.key === 'ArrowLeft' ? -1 : 1));
            resizer.setAttribute('aria-valuenow', String(Math.round(Number(appSettings.desktopLeftRatio))));
        });
        const initial = clamp(Number(appSettings?.desktopLeftRatio) || 36, 28, 52);
        document.documentElement.style.setProperty('--desktop-left-ratio', `${initial}%`);
        resizer.setAttribute('aria-valuenow', String(Math.round(initial)));
    }

    function getQueueItem(offset) {
        if (!Array.isArray(currentPlaylist) || !currentPlaylist.length || !Number.isInteger(currentIndex)) return null;
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
            opacity.value = String(clamp(Number(appSettings?.pocketPanelOpacity) || 72, 45, 95));
            opacityValue.textContent = `${opacity.value}%`;
            opacity.addEventListener('input', () => {
                appSettings.pocketPanelOpacity = Number(opacity.value);
                opacityValue.textContent = `${opacity.value}%`;
                document.getElementById('pocket-overlay')?.style.setProperty('--pocket-panel-alpha', String(Number(opacity.value) / 100));
            });
            opacity.addEventListener('change', () => { if (typeof saveSettings === 'function') saveSettings(); });
        }
        document.querySelectorAll('.pocket-next-item[data-queue-offset]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
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

    window.CmsDesktopLargeUI = { updatePocketQueue };
    document.addEventListener('DOMContentLoaded', () => {
        setupDesktopResizer();
        setupPocketEnhancements();
    });
})();
