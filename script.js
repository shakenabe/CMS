const defaultSettings = {
    theme: 'modern', bgPosition: 'center', bgSize: 'cover', bgOpacity: 50, nicoBoost: 1.0,
    baseFontSize: 100, pcLeftWidth: 350, showClock: false, clockType: 'digital1', pocketClockType: 'digital1', showThumbnails: true,
    performanceMode: false, dataSaverMode: false,
    customColorEnabled: false, customAccentColor: '#00aaff', customBorderColor: '#ffffff', blurBaseColor: '#000000',
    pocketAlwaysOn: false, pocketSwipeUnlock: true, forcePcLayout: false,
    musicMode: false, autoScrollActiveTrack: true,
    windowMode: false, windowPositions: {}, windowStates: {},
    defaultSortOrder: 'custom', useFirebase: false
};
let appSettings = { ...defaultSettings };

let allItems = [];
let folderSettings = [];
let musicLibrary =[];
let currentFolderId = null;
let currentSortOrder = 'custom';
let currentSearchQuery = "";
let excludeNico = false;

let currentPlaylist =[];
let currentIndex = 0;
let isPlaying = false;
let currentPlayingItem = null;

let ytPlayer = null;
let isTransitioning = false;

let nicoDuration = 0;
let nicoCurrentTime = 0;
let nicoEndedFlag = false;

let resizeTimer;
let progressInterval;
let windowZCounter = 200;

let currentRenderedCount = 0;
const RENDER_CHUNK_SIZE = 50;
let currentRenderSongs =[];

// 編集モード管理
let isEditMode = false;
let selectedItems = new Set();

const importScreen = document.getElementById('import-screen');
const readyScreen = document.getElementById('ready-screen');
const mainApp = document.getElementById('main-app');
const folderListEl = document.getElementById('widget-folder-list');
const trackListEl = document.getElementById('widget-track-list');

// 無音オーディオ
let silentAudio = null;
let playbackRecoveryTimers = [];
function setupBackgroundPlayback() {
    if (!silentAudio) {
        const silentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
        silentAudio = new Audio(silentWav); silentAudio.loop = true; silentAudio.volume = 0.01;
    }
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === 'visible') { updateProgress(); if (isPlaying) schedulePlaybackRecovery(); }
    });
}
function startSilentAudio() { if (silentAudio && silentAudio.paused) silentAudio.play().catch(e => {}); }
function stopSilentAudio() { if (silentAudio && !silentAudio.paused) silentAudio.pause(); }

function resumeCurrentPlayback() {
    if (!isPlaying || !currentPlayingItem) return;
    if (currentPlayingItem.site === 'youtube' && ytPlayer && typeof ytPlayer.playVideo === 'function') {
        try { if (typeof ytPlayer.getPlayerState !== 'function' || ytPlayer.getPlayerState() !== 1) ytPlayer.playVideo(); } catch (_) {}
    } else if (currentPlayingItem.site === 'niconico') {
        const iframe = document.getElementById('nico-player');
        if (iframe?.contentWindow) iframe.contentWindow.postMessage({ sourceConnectorType: 1, playerId: "1", eventName: "play" }, 'https://embed.nicovideo.jp');
    }
    startSilentAudio();
}

function schedulePlaybackRecovery() {
    playbackRecoveryTimers.forEach(clearTimeout); playbackRecoveryTimers = [];
    [250, 900, 1800].forEach(delay => playbackRecoveryTimers.push(setTimeout(resumeCurrentPlayback, delay)));
}

// IndexedDB (背景画像保存処理)
const DB_NAME = 'cms_player_db_v3'; const STORE_NAME = 'bg_images';
function saveBgImageToDB(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; const MAX = 1920;
                if (width > height) { if (width > MAX) { height *= MAX / width; width = MAX; } } else { if (height > MAX) { width *= MAX / height; height = MAX; } }
                canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                const base64 = canvas.toDataURL('image/jpeg', 0.8);
                const req = indexedDB.open(DB_NAME, 1);
                req.onupgradeneeded = ev => {
                    const db = ev.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) { db.createObjectStore(STORE_NAME, { keyPath: 'id' }); }
                };
                req.onsuccess = ev => { 
                    try {
                        const tx = ev.target.result.transaction(STORE_NAME, 'readwrite');
                        tx.objectStore(STORE_NAME).put({ id: 'bg1', data: base64 });
                        tx.oncomplete = () => { document.documentElement.style.setProperty('--bg-image', `url(${base64})`); resolve(); }; 
                        tx.onerror = () => resolve();
                    } catch (err) { resolve(); }
                };
                req.onerror = () => resolve();
            };
            img.onerror = () => resolve();
            img.src = e.target.result;
        };
        reader.onerror = () => resolve();
        reader.readAsDataURL(file);
    });
}
function loadBgImageFromDB() {
    return new Promise(resolve => {
        const req = indexedDB.open(DB_NAME, 1); 
        req.onupgradeneeded = ev => {
            const db = ev.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) { db.createObjectStore(STORE_NAME, { keyPath: 'id' }); }
        };
        req.onsuccess = ev => { 
            try { 
                const tx = ev.target.result.transaction(STORE_NAME, 'readonly');
                const getReq = tx.objectStore(STORE_NAME).get('bg1'); 
                getReq.onsuccess = () => { if (getReq.result) document.documentElement.style.setProperty('--bg-image', `url(${getReq.result.data})`); resolve(); }; 
                getReq.onerror = () => resolve();
            } catch(err) { resolve(); } 
        }; 
        req.onerror = () => resolve();
    });
}
function clearBgImageDB() { 
    const req = indexedDB.open(DB_NAME, 1); 
    req.onsuccess = ev => { try { ev.target.result.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete('bg1'); document.documentElement.style.setProperty('--bg-image', 'none'); } catch(e){} }; 
}

document.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    currentSortOrder = appSettings.defaultSortOrder || 'custom';
    document.getElementById('widget-sort-select').value = currentSortOrder;
    
    updateLayoutMode(); applyThemeSettings(); await loadBgImageFromDB();

    loadYouTubeAPI();

    window.addEventListener('resize', () => { 
        clearTimeout(resizeTimer); 
        resizeTimer = setTimeout(() => {
            updateLayoutMode();
            if (appSettings.windowMode) clampAllWindowPanels();
            scheduleMarqueeUpdate();
        }, 200); 
    });

    // リスト追加読込
    trackListEl.addEventListener('scroll', () => { 
        if (trackListEl.scrollTop + trackListEl.clientHeight >= trackListEl.scrollHeight - 100) loadMoreTracks(); 
    });
    setupMobileTrackListFocus();

    document.getElementById('import-json').addEventListener('change', handleFileImport);
    document.getElementById('btn-user-start').addEventListener('click', startGame);
    document.getElementById('widget-search-box').addEventListener('input', handleSearch);
    document.getElementById('widget-sort-select').addEventListener('change', handleSortChange);
    document.getElementById('exclude-nico').addEventListener('change', handleNicoFilterChange);
    document.getElementById('widget-btn-fullscreen').addEventListener('click', toggleFullscreen);
    document.getElementById('progress-container').addEventListener('click', handleProgressClick);

    // モバイル用フォルダ切り替え
    document.getElementById('btn-open-mobile-folder').addEventListener('click', () => { document.getElementById('mobile-folder-modal').classList.remove('hidden'); });
    document.getElementById('btn-close-folder-modal').addEventListener('click', () => document.getElementById('mobile-folder-modal').classList.add('hidden'));
    
    // フィルタ・ソートメニューのトグル
    document.getElementById('btn-toggle-mobile-nav').addEventListener('click', () => { 
        document.body.classList.toggle('show-mobile-nav'); 
    });

    // フィルタメニュー内のフォルダ変更
    const folderSelect = document.getElementById('widget-folder-select');
    if (folderSelect) folderSelect.addEventListener('change', (e) => {
        selectFolder(e.target.value);
    });

    setupPlayerControls(); setupSettingsModal(); window.addEventListener('message', handleNicoMessage); setupPocketMode(); setupClockUI();
    setupEditMode();
    applyWindowMode(); 
});

function loadYouTubeAPI() { if (!window.YT) { const tag = document.createElement('script'); tag.src = "https://www.youtube.com/iframe_api"; document.getElementsByTagName('script')[0].parentNode.insertBefore(tag, document.getElementsByTagName('script')[0]); } }

function loadSettings() {
    try { const saved = localStorage.getItem('cms_player_settings_v23'); if (saved) { appSettings = { ...defaultSettings, ...JSON.parse(saved) }; } else { const isMobile = window.innerWidth <= 900; if (isMobile) { appSettings.performanceMode = true; appSettings.showClock = false; } } } catch (e) {}
}
function saveSettings() { localStorage.setItem('cms_player_settings_v23', JSON.stringify(appSettings)); }

function updateLayoutMode() {
    if (appSettings.windowMode) { document.body.classList.add('is-pc'); document.body.classList.remove('is-mobile'); return; }
    if (window.innerWidth <= 900 && !appSettings.forcePcLayout) {
        document.body.classList.add('is-mobile'); document.body.classList.remove('is-pc');
    } else {
        document.body.classList.add('is-pc'); document.body.classList.remove('is-mobile', 'mobile-list-focus');
        document.getElementById('mobile-list-fullscreen-header')?.classList.add('hidden');
    }
}

function setupMobileTrackListFocus() {
    const header = document.getElementById('mobile-list-fullscreen-header');
    const closeButton = document.getElementById('mobile-list-close-btn');
    let pointerStart = null;
    const open = () => {
        if (!document.body.classList.contains('is-mobile')) return;
        document.body.classList.add('mobile-list-focus'); header?.classList.remove('hidden');
    };
    const close = () => { document.body.classList.remove('mobile-list-focus'); header?.classList.add('hidden'); };
    trackListEl.addEventListener('wheel', open, { passive: true });
    trackListEl.addEventListener('pointerdown', (e) => { pointerStart = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType }; }, { passive: true });
    trackListEl.addEventListener('pointermove', (e) => {
        if (!pointerStart || pointerStart.id !== e.pointerId) return;
        const distance = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y);
        if (distance >= (pointerStart.type === 'mouse' ? 5 : 10)) open();
    }, { passive: true });
    const clearPointer = () => { pointerStart = null; };
    trackListEl.addEventListener('pointerup', clearPointer, { passive: true });
    trackListEl.addEventListener('pointercancel', clearPointer, { passive: true });
    header?.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('mobile-list-focus')) close(); });
}

const WINDOW_PANEL_IDS = ['widget-player', 'widget-controls', 'widget-clock', 'widget-folder-list-wrapper', 'widget-track-list-wrapper', 'library-nav-wrapper'];
const WINDOW_PANEL_TITLES = {
    'widget-player': 'Player', 'widget-controls': 'Now Playing', 'widget-clock': 'Clock', 'widget-folder-list-wrapper': 'Folders',
    'widget-track-list-wrapper': 'Tracks', 'library-nav-wrapper': 'Library Tools'
};

function applyWindowMode() {
    appSettings.windowPositions = appSettings.windowPositions || {};
    appSettings.windowStates = appSettings.windowStates || {};
    if (appSettings.windowMode) {
        document.body.classList.add('window-mode');
        ensureWindowTaskbar();
        WINDOW_PANEL_IDS.forEach((id, index) => {
            const el = document.getElementById(id);
            if (el) {
                setupWindowPanel(el);
                if (!appSettings.windowPositions[id]) appSettings.windowPositions[id] = getDefaultWindowRect(id, index);
                if (!appSettings.windowStates[id]) appSettings.windowStates[id] = { mode: 'normal' };
                applyWindowPanelState(el);
            }
        });
        updateWindowTaskbar();
    } else {
        document.body.classList.remove('window-mode');
        WINDOW_PANEL_IDS.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.classList.remove('window-minimized', 'window-closed', 'window-maximized');
            el.style.position = ''; el.style.top = ''; el.style.left = ''; el.style.width = ''; el.style.height = ''; el.style.zIndex = '';
        });
    }
}

function getDefaultWindowRect(id, index) {
    const wideDefaults = {
        'widget-player': { top: 16, left: 16, width: 450, height: 300 },
        'widget-controls': { top: 332, left: 16, width: 450, height: 210 },
        'widget-clock': { top: 558, left: 16, width: 450, height: 160 },
        'widget-folder-list-wrapper': { top: 16, left: 482, width: 250, height: 526 },
        'widget-track-list-wrapper': { top: 16, left: 748, width: 410, height: 526 },
        'library-nav-wrapper': { top: 558, left: 482, width: 676, height: 130 }
    };
    if (window.innerWidth >= 1200) return windowRectToCss(wideDefaults[id] || { top: 30, left: 30, width: 360, height: 240 });
    const availableHeight = Math.max(180, window.innerHeight - 56);
    const width = Math.min(560, Math.max(260, window.innerWidth - 32));
    const height = Math.min(id === 'library-nav-wrapper' ? 180 : 430, Math.max(150, availableHeight - 32));
    const offset = 12 + index * 24;
    return windowRectToCss(clampWindowRect({ top: offset, left: offset, width, height }));
}

function windowRectToCss(rect) {
    return { top: `${Math.round(rect.top)}px`, left: `${Math.round(rect.left)}px`, width: `${Math.round(rect.width)}px`, height: `${Math.round(rect.height)}px` };
}

function cssWindowRect(rect, fallback) {
    const number = (value, defaultValue) => Number.isFinite(parseFloat(value)) ? parseFloat(value) : defaultValue;
    return {
        top: number(rect?.top, fallback.top), left: number(rect?.left, fallback.left),
        width: number(rect?.width, fallback.width), height: number(rect?.height, fallback.height)
    };
}

function clampWindowRect(rect) {
    const taskbarHeight = 48;
    const maxWidth = Math.max(220, window.innerWidth - 8);
    const maxHeight = Math.max(140, window.innerHeight - taskbarHeight - 8);
    const width = Math.min(maxWidth, Math.max(Math.min(240, maxWidth), rect.width));
    const height = Math.min(maxHeight, Math.max(Math.min(120, maxHeight), rect.height));
    return {
        width, height,
        left: Math.min(Math.max(4, rect.left), Math.max(4, window.innerWidth - width - 4)),
        top: Math.min(Math.max(4, rect.top), Math.max(4, window.innerHeight - taskbarHeight - height - 4))
    };
}

function setupWindowPanel(el) {
    el.classList.add('wm-panel');
    if (el.dataset.windowReady === '1') return;
    el.dataset.windowReady = '1';
    const titlebar = document.createElement('div');
    titlebar.className = 'window-titlebar';
    titlebar.innerHTML = `<span class="window-title">${WINDOW_PANEL_TITLES[el.id] || el.id}</span><span class="window-actions"><button type="button" class="window-minimize" aria-label="最小化"><i class="fas fa-window-minimize"></i></button><button type="button" class="window-maximize" aria-label="最大化・復元"><i class="far fa-square"></i></button><button type="button" class="window-close" aria-label="閉じる"><i class="fas fa-xmark"></i></button></span>`;
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'window-resize-handle';
    el.prepend(titlebar); el.appendChild(resizeHandle);
    el.addEventListener('pointerdown', () => focusWindowPanel(el));
    titlebar.querySelector('.window-minimize').addEventListener('click', (e) => { e.stopPropagation(); setWindowPanelMode(el, 'minimized'); });
    titlebar.querySelector('.window-maximize').addEventListener('click', (e) => { e.stopPropagation(); setWindowPanelMode(el, appSettings.windowStates[el.id]?.mode === 'maximized' ? 'normal' : 'maximized'); });
    titlebar.querySelector('.window-close').addEventListener('click', (e) => { e.stopPropagation(); setWindowPanelMode(el, 'closed'); });
    titlebar.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) setWindowPanelMode(el, appSettings.windowStates[el.id]?.mode === 'maximized' ? 'normal' : 'maximized'); });
    setupWindowPointerDrag(el, titlebar);
    setupWindowPointerResize(el, resizeHandle);
}

function setupWindowPointerDrag(el, handle) {
    handle.addEventListener('pointerdown', (e) => {
        if (!appSettings.windowMode || e.target.closest('button')) return;
        if (appSettings.windowStates[el.id]?.mode === 'maximized') return;
        e.preventDefault(); focusWindowPanel(el);
        const start = el.getBoundingClientRect(); const startX = e.clientX; const startY = e.clientY;
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        const move = (ev) => {
            const next = clampWindowRect({ top: start.top + ev.clientY - startY, left: start.left + ev.clientX - startX, width: start.width, height: start.height });
            el.style.top = `${next.top}px`; el.style.left = `${next.left}px`;
        };
        const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); saveWindowPanelRect(el); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    });
}

function setupWindowPointerResize(el, handle) {
    handle.addEventListener('pointerdown', (e) => {
        if (!appSettings.windowMode || appSettings.windowStates[el.id]?.mode === 'maximized') return;
        e.preventDefault(); e.stopPropagation(); focusWindowPanel(el);
        const start = el.getBoundingClientRect(); const startX = e.clientX; const startY = e.clientY;
        try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        const move = (ev) => {
            const next = clampWindowRect({ top: start.top, left: start.left, width: start.width + ev.clientX - startX, height: start.height + ev.clientY - startY });
            el.style.width = `${next.width}px`; el.style.height = `${next.height}px`;
        };
        const end = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); saveWindowPanelRect(el); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    });
}

function saveWindowPanelRect(el) {
    if (!appSettings.windowMode || appSettings.windowStates[el.id]?.mode !== 'normal') return;
    const rect = clampWindowRect(el.getBoundingClientRect());
    appSettings.windowPositions[el.id] = windowRectToCss(rect); saveSettings();
}

function focusWindowPanel(el) {
    if (!appSettings.windowMode) return;
    el.style.zIndex = String(++windowZCounter); updateWindowTaskbar(el.id);
}

function setWindowPanelMode(el, mode) {
    appSettings.windowStates[el.id] = { mode };
    applyWindowPanelState(el); saveSettings(); updateWindowTaskbar(mode === 'normal' || mode === 'maximized' ? el.id : null);
}

function applyWindowPanelState(el) {
    const state = appSettings.windowStates[el.id] || { mode: 'normal' };
    el.classList.toggle('window-minimized', state.mode === 'minimized');
    el.classList.toggle('window-closed', state.mode === 'closed');
    el.classList.toggle('window-maximized', state.mode === 'maximized');
    if (state.mode === 'maximized') {
        el.style.top = '0px'; el.style.left = '0px'; el.style.width = `${window.innerWidth}px`; el.style.height = `${Math.max(140, window.innerHeight - 44)}px`;
    } else {
        const fallback = cssWindowRect(getDefaultWindowRect(el.id, WINDOW_PANEL_IDS.indexOf(el.id)), { top: 10, left: 10, width: 360, height: 240 });
        const rect = clampWindowRect(cssWindowRect(appSettings.windowPositions[el.id], fallback));
        appSettings.windowPositions[el.id] = windowRectToCss(rect);
        Object.assign(el.style, appSettings.windowPositions[el.id]);
    }
    if (state.mode === 'normal' || state.mode === 'maximized') focusWindowPanel(el);
}

function clampAllWindowPanels() {
    if (!appSettings.windowMode) return;
    WINDOW_PANEL_IDS.forEach(id => { const el = document.getElementById(id); if (el) applyWindowPanelState(el); });
    saveSettings();
}

function ensureWindowTaskbar() {
    let taskbar = document.getElementById('window-taskbar');
    if (!taskbar) {
        taskbar = document.createElement('div'); taskbar.id = 'window-taskbar'; taskbar.setAttribute('role', 'toolbar');
        WINDOW_PANEL_IDS.forEach(id => {
            const button = document.createElement('button'); button.type = 'button'; button.dataset.windowId = id; button.textContent = WINDOW_PANEL_TITLES[id];
            button.addEventListener('click', () => { const el = document.getElementById(id); if (!el) return; setWindowPanelMode(el, 'normal'); focusWindowPanel(el); });
            taskbar.appendChild(button);
        });
        const exit = document.createElement('button'); exit.type = 'button'; exit.className = 'window-exit'; exit.innerHTML = '<i class="fas fa-right-from-bracket"></i> 終了';
        exit.addEventListener('click', () => { appSettings.windowMode = false; saveSettings(); updateLayoutMode(); applyThemeSettings(); applyWindowMode(); });
        taskbar.appendChild(exit); document.body.appendChild(taskbar);
    }
}

function updateWindowTaskbar(activeId) {
    const taskbar = document.getElementById('window-taskbar'); if (!taskbar) return;
    taskbar.querySelectorAll('[data-window-id]').forEach(button => {
        const id = button.dataset.windowId; const mode = appSettings.windowStates[id]?.mode || 'normal';
        if (id === 'widget-clock') button.style.display = appSettings.showClock ? '' : 'none';
        button.classList.toggle('active', id === activeId && mode !== 'closed' && mode !== 'minimized');
        button.style.opacity = mode === 'closed' || mode === 'minimized' ? '0.62' : '1';
    });
}

function hexToRgbString(hex) {
    const normalized = String(hex || '#000000').replace('#', '');
    const value = normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized.padEnd(6, '0').slice(0, 6);
    return `${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}`;
}

function applyThemeSettings() {
    const layoutClass = document.body.classList.contains('is-mobile') ? 'is-mobile' : 'is-pc';
    document.body.className = `theme-${appSettings.theme} ${layoutClass}`;
    if (appSettings.forcePcLayout || appSettings.windowMode) document.body.classList.add('is-pc');
    if (appSettings.windowMode) document.body.classList.add('window-mode');
    
    document.body.classList.toggle('show-list-thumbnails', appSettings.showThumbnails);
    document.body.classList.toggle('performance-mode', appSettings.performanceMode);
    document.body.classList.toggle('music-mode', Boolean(appSettings.musicMode));
    document.body.classList.toggle('show-clock', Boolean(appSettings.showClock) && document.body.classList.contains('is-pc'));
    
    document.documentElement.style.setProperty('--base-font-size', `${appSettings.baseFontSize}%`); 
    document.documentElement.style.setProperty('--pc-left-width', `${appSettings.pcLeftWidth}px`);
    document.documentElement.style.setProperty('--bg-position', appSettings.bgPosition); document.documentElement.style.setProperty('--bg-size', appSettings.bgSize);
    
    if (appSettings.customColorEnabled) { document.body.style.setProperty('--text-color', appSettings.customAccentColor); document.body.style.setProperty('--accent-color', appSettings.customAccentColor); document.body.style.setProperty('--border-color', appSettings.customBorderColor); } 
    else { document.body.style.removeProperty('--text-color'); document.body.style.removeProperty('--accent-color'); document.body.style.removeProperty('--border-color'); }
    document.body.style.setProperty('--panel-rgb', hexToRgbString(appSettings.blurBaseColor || '#000000'));
    document.body.style.setProperty('--bg-color', appSettings.blurBaseColor || '#000000');
    
    const op = parseFloat(appSettings.bgOpacity); const panelAlpha = 0.12 + ((100 - op) / 100 * 0.68); document.documentElement.style.setProperty('--panel-alpha', panelAlpha); document.documentElement.style.setProperty('--panel-blur', appSettings.performanceMode ? '0px' : `${((100 - op) / 100 * 20)}px`);
    const pOverlay = document.getElementById('pocket-overlay'); if (appSettings.pocketAlwaysOn) pOverlay.classList.add('always-on'); else pOverlay.classList.remove('always-on');
}

function setupSettingsModal() {
    const modal = document.getElementById('settings-modal');
    document.querySelectorAll('.tab-btn').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active')); btn.classList.add('active'); document.getElementById('tab-' + btn.dataset.tab).classList.add('active'); }); });

    document.getElementById('btn-open-settings').onclick = () => {
        document.getElementById('set-theme').value = appSettings.theme; document.getElementById('set-font-size').value = appSettings.baseFontSize; document.getElementById('font-val').textContent = appSettings.baseFontSize;
        document.getElementById('set-pc-left-width').value = appSettings.pcLeftWidth; document.getElementById('pc-width-val').textContent = appSettings.pcLeftWidth;
        document.getElementById('set-bg-position').value = appSettings.bgPosition; document.getElementById('set-bg-size').value = appSettings.bgSize;
        document.getElementById('set-opacity').value = appSettings.bgOpacity; document.getElementById('op-val').textContent = appSettings.bgOpacity;
        document.getElementById('set-nico-boost').value = appSettings.nicoBoost || 1.0; document.getElementById('boost-val').textContent = parseFloat(appSettings.nicoBoost || 1.0).toFixed(1);
        document.getElementById('set-default-sort').value = appSettings.defaultSortOrder || 'custom';
        
        document.getElementById('set-performance-mode').checked = appSettings.performanceMode; document.getElementById('set-data-saver').checked = appSettings.dataSaverMode;
        document.getElementById('set-music-mode').checked = Boolean(appSettings.musicMode);
        document.getElementById('set-show-thumbnails').checked = appSettings.showThumbnails;
        document.getElementById('set-show-clock').checked = Boolean(appSettings.showClock);
        document.getElementById('set-clock-type').value = appSettings.clockType || 'digital1';
        document.getElementById('set-pocket-clock-type').value = appSettings.pocketClockType || 'digital1';
        document.getElementById('set-pocket-always-on').checked = appSettings.pocketAlwaysOn; document.getElementById('set-pocket-swipe-unlock').checked = appSettings.pocketSwipeUnlock;
        document.getElementById('set-force-pc-layout').checked = appSettings.forcePcLayout; document.getElementById('set-window-mode').checked = appSettings.windowMode;
        document.getElementById('set-use-firebase').checked = Boolean(appSettings.useFirebase);
        document.getElementById('set-use-custom-color').checked = appSettings.customColorEnabled; document.getElementById('set-accent-color').value = appSettings.customAccentColor; document.getElementById('set-border-color').value = appSettings.customBorderColor; document.getElementById('set-blur-base-color').value = appSettings.blurBaseColor || '#000000';
        modal.classList.remove('hidden');
    };

    document.getElementById('set-font-size').oninput = (e) => document.getElementById('font-val').textContent = e.target.value; document.getElementById('set-pc-left-width').oninput = (e) => document.getElementById('pc-width-val').textContent = e.target.value;
    document.getElementById('set-opacity').oninput = (e) => document.getElementById('op-val').textContent = e.target.value; document.getElementById('set-nico-boost').oninput = (e) => document.getElementById('boost-val').textContent = parseFloat(e.target.value).toFixed(1);

    document.getElementById('btn-close-settings').onclick = () => modal.classList.add('hidden');
    document.getElementById('btn-reset-settings').onclick = () => { if (confirm('初期化しますか？')) { localStorage.removeItem('cms_player_settings_v23'); clearBgImageDB(); location.reload(); } };
    document.getElementById('btn-clear-bg').onclick = () => { clearBgImageDB(); alert('背景をクリアしました。Saveを押してください。'); };
    document.getElementById('btn-reset-window').onclick = () => { appSettings.windowPositions = {}; appSettings.windowStates = {}; alert('配置をリセットしました。Saveを押してください。'); };

    document.getElementById('btn-save-settings').onclick = async () => {
        appSettings.theme = document.getElementById('set-theme').value; appSettings.baseFontSize = document.getElementById('set-font-size').value; appSettings.pcLeftWidth = document.getElementById('set-pc-left-width').value; appSettings.bgPosition = document.getElementById('set-bg-position').value; appSettings.bgSize = document.getElementById('set-bg-size').value; appSettings.bgOpacity = document.getElementById('set-opacity').value; appSettings.nicoBoost = document.getElementById('set-nico-boost').value; appSettings.defaultSortOrder = document.getElementById('set-default-sort').value;
        appSettings.performanceMode = document.getElementById('set-performance-mode').checked; appSettings.dataSaverMode = document.getElementById('set-data-saver').checked; appSettings.musicMode = document.getElementById('set-music-mode').checked; appSettings.showThumbnails = document.getElementById('set-show-thumbnails').checked; appSettings.showClock = document.getElementById('set-show-clock').checked; appSettings.clockType = document.getElementById('set-clock-type').value; appSettings.pocketClockType = document.getElementById('set-pocket-clock-type').value; appSettings.pocketAlwaysOn = document.getElementById('set-pocket-always-on').checked; appSettings.pocketSwipeUnlock = document.getElementById('set-pocket-swipe-unlock').checked; appSettings.forcePcLayout = document.getElementById('set-force-pc-layout').checked; appSettings.windowMode = document.getElementById('set-window-mode').checked; appSettings.customColorEnabled = document.getElementById('set-use-custom-color').checked; appSettings.customAccentColor = document.getElementById('set-accent-color').value; appSettings.customBorderColor = document.getElementById('set-border-color').value; appSettings.blurBaseColor = document.getElementById('set-blur-base-color').value; appSettings.useFirebase = document.getElementById('set-use-firebase').checked;
        
        const fInput = document.getElementById('set-bg-img'); 
        if (fInput.files.length > 0) { await saveBgImageToDB(fInput.files[0]); }
        
        saveSettings(); applyVolume(); modal.classList.add('hidden'); updateLayoutMode(); applyThemeSettings(); applyWindowMode(); scheduleMarqueeUpdate(); 
    };
}

function updateMarquee() {
    if (appSettings.performanceMode) { document.querySelectorAll('.marquee-content').forEach(c => c.classList.remove('is-marquee')); return; }
    requestAnimationFrame(() => { document.querySelectorAll('.marquee-wrapper').forEach(w => { const c = w.querySelector('.marquee-content'); if (!c) return; if (c.scrollWidth > w.clientWidth + 2) { w.style.setProperty('--parent-width', `${w.clientWidth}px`); c.classList.add('is-marquee'); } else c.classList.remove('is-marquee'); }); });
}
function scheduleMarqueeUpdate() { setTimeout(updateMarquee, 100); }

function handleFileImport(e) { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { try { const data = JSON.parse(ev.target.result); processImportData(data); window.CmsWebFirebase?.cacheImportedData(data); importScreen.classList.add('hidden'); readyScreen.classList.remove('hidden'); } catch (err) { alert('JSON解析失敗'); } }; reader.readAsText(file); }
function processImportData(data) {
    const items = Array.isArray(data) ? data : (data.mediaItems || []);
    if (!Array.isArray(data) && data.webSettings && typeof data.webSettings === 'object') {
        Object.keys(defaultSettings).forEach(key => {
            if (Object.prototype.hasOwnProperty.call(data.webSettings, key)) appSettings[key] = data.webSettings[key];
        });
        saveSettings();
        currentSortOrder = appSettings.defaultSortOrder || 'custom';
        updateLayoutMode();
        applyThemeSettings();
    }
    allItems = items.filter(i => i.site !== 'system').map((item, idx) => ({
        ...item,
        originalIndex: idx,
        safeDate: item.savedAt ? new Date(item.savedAt).getTime() : 0,
        safePlayCount: item.playCount || 0
    }));
    folderSettings = Array.isArray(data.folderSettings) ? data.folderSettings : [];
    if (allItems.length > 0) {
        buildLibrary(); renderFolders(); selectFolder(musicLibrary[0]?.id || '__all');
    } else alert('データがありません');
}

window.CmsWebPlayer = {
    applyLibrary(data, source = 'cloud') {
        processImportData(data);
        importScreen.classList.add('hidden');
        readyScreen.classList.remove('hidden');
        return { count: allItems.length, source };
    },
    getUseFirebase: () => Boolean(appSettings.useFirebase)
};

function startGame() { readyScreen.classList.add('hidden'); setupBackgroundPlayback(); startSilentAudio(); mainApp.classList.remove('hidden'); scheduleMarqueeUpdate(); if (currentFolderId) { const f = musicLibrary.find(f => f.id === currentFolderId); startPlaylist(f ? f.songs : (musicLibrary.find(f => f.id === '__all')?.songs ||[]), 0); } }

function buildLibrary() {
    let fMap = {}; let fOrder =[]; 
    const items = allItems.filter(i => { if (excludeNico && i.site === 'niconico') return false; if (currentSearchQuery) { const q = currentSearchQuery.toLowerCase(); return (i.title || "").toLowerCase().includes(q) || (i.tags ||[]).join(' ').toLowerCase().includes(q); } return true; });
    items.forEach(i => { const fs = i.folders && i.folders.length > 0 ? i.folders :[i.folder || 'Manual']; fs.forEach(f => { if (!fMap[f]) { fMap[f] =[]; fOrder.push(f); } fMap[f].push(i); }); });
    const fNames = Object.keys(fMap).sort((a, b) => { const sA = folderSettings.find(s => s.folderName === a); const sB = folderSettings.find(s => s.folderName === b); return (sA && typeof sA.order === 'number' ? sA.order : fOrder.indexOf(a) + 10000) - (sB && typeof sB.order === 'number' ? sB.order : fOrder.indexOf(b) + 10000); });
    musicLibrary =[ { id: '__all', name: '📚 All', songs: sortSongs(items) }, ...fNames.map(n => ({ id: n, name: `📁 ${n}`, songs: sortSongs(fMap[n]) })) ];
}
function sortSongs(songs) { return[...songs].sort((a, b) => { const sf = (s) => s || ""; switch (currentSortOrder) { case 'title_asc': return sf(a.title).localeCompare(sf(b.title)); case 'title_desc': return sf(b.title).localeCompare(sf(a.title)); case 'newest': return b.safeDate - a.safeDate; case 'oldest': return a.safeDate - b.safeDate; case 'playCount_desc': return b.safePlayCount - a.safePlayCount; case 'custom': default: return a.originalIndex - b.originalIndex; } }); }

function renderFolders() {
    folderListEl.innerHTML = ''; const mList = document.getElementById('mobile-folder-list-modal'); if (mList) mList.innerHTML = '';
    musicLibrary.forEach(f => {
        const div = document.createElement('div'); div.className = 'w-f-item'; div.textContent = f.name; div.dataset.folderId = f.id; div.title = f.name; div.onclick = () => selectFolder(f.id); folderListEl.appendChild(div);
        if (mList) { 
            const mDiv = document.createElement('div'); mDiv.className = 'm-f-item'; mDiv.dataset.folderId = f.id; 
            mDiv.innerHTML = `
                ${f.id === currentFolderId ? '<i class="fas fa-check"></i>' : '<i class="fas fa-check" style="visibility:hidden;"></i>'}
                <span>${f.name.replace('📁 ', '').replace('📚 ', '')}</span>
                <i class="fas fa-music"></i>
            `; 
            mDiv.onclick = () => { selectFolder(f.id); document.getElementById('mobile-folder-modal').classList.add('hidden'); }; 
            mList.appendChild(mDiv); 
        }
    });
    populateEditFolders();
}

function selectFolder(id) {
    currentFolderId = id;
    document.querySelectorAll('.w-f-item').forEach(e => e.classList.toggle('active', e.dataset.folderId === id));
    document.querySelectorAll('.m-f-item').forEach(e => { 
        const act = e.dataset.folderId === id; e.classList.toggle('active', act); 
        e.innerHTML = `
            ${act ? '<i class="fas fa-check"></i>' : '<i class="fas fa-check" style="visibility:hidden;"></i>'}
            <span>${e.querySelector('span').textContent}</span>
            <i class="fas fa-music"></i>
        `;
    });
    
    const filterSelect = document.getElementById('widget-folder-select');
    if(filterSelect && filterSelect.value !== id) filterSelect.value = id;

    const f = musicLibrary.find(f => f.id === id); 
    if (f) { 
        const name = f.name.replace('📁 ', '').replace('📚 ', '');
        const folderTitle = document.getElementById('current-folder-title');
        const folderName = document.getElementById('current-folder-name');
        const folderCount = document.getElementById('current-folder-count');
        if (folderTitle) folderTitle.textContent = name;
        if (folderName) {
            const icon = document.createElement('i');
            icon.className = 'fas fa-chevron-down';
            icon.style.cssText = 'font-size:0.8rem; opacity:0.7; margin-left:5px;';
            folderName.replaceChildren(document.createTextNode(name), icon);
        }
        if (folderCount) folderCount.textContent = `${f.songs.length}件のアイテム`;
    }
    selectedItems.clear(); updateEditBar();
    renderTracks(f ? f.songs :[]);
}

function escapeHTML(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

function renderTracks(songs) { trackListEl.innerHTML = ''; trackListEl.scrollTop = 0; currentRenderSongs = songs; currentRenderedCount = 0; if (songs.length === 0) { trackListEl.innerHTML = '<div style="padding:20px; text-align:center;">動画がありません</div>'; return; } loadMoreTracks(); }

function loadMoreTracks() {
    if (currentRenderedCount >= currentRenderSongs.length) return;
    const frag = document.createDocumentFragment(); const end = Math.min(currentRenderedCount + RENDER_CHUNK_SIZE, currentRenderSongs.length);
    for (let i = currentRenderedCount; i < end; i++) {
        const s = currentRenderSongs[i]; const div = document.createElement('div'); div.className = 'w-t-item'; div.title = s.title; div.dataset.index = i;
        const isChecked = selectedItems.has(s.originalIndex);
        
        div.innerHTML = `
            <div class="w-t-checkbox" style="display: ${isEditMode ? 'flex' : 'none'}; align-items:center; padding-right:15px;">
                <input type="checkbox" class="edit-cb" data-original-idx="${s.originalIndex}" ${isChecked ? 'checked' : ''}>
            </div>
            <span class="w-t-idx" style="display: ${isEditMode ? 'none' : 'block'};">${i + 1}</span>
            <span class="w-t-playing-icon hidden"><i class="fa-solid fa-volume-high"></i></span>
            <img class="w-t-thumb" src="${s.thumbnail || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"}" loading="lazy">
            <div class="w-t-info overflow-hidden">
                <div class="marquee-wrapper"><span class="track-title-text marquee-content">${escapeHTML(s.title)}</span></div>
                <div class="marquee-wrapper"><span class="track-artist-text marquee-content">${escapeHTML(s.channelName || s.site)}</span></div>
            </div>
        `;
        div.onclick = (e) => { 
            if (isEditMode) {
                const cb = div.querySelector('.edit-cb');
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) selectedItems.add(s.originalIndex);
                else selectedItems.delete(s.originalIndex);
                updateEditBar();
            } else {
                startPlaylist(currentRenderSongs, i); 
            }
        }; 
        frag.appendChild(div);
    }
    trackListEl.appendChild(frag); currentRenderedCount = end; updateActiveTrackUI(); scheduleMarqueeUpdate();
}

function updateActiveTrackUI() {
    if (!currentRenderSongs) return; const tIdx = currentRenderSongs.findIndex(s => s === currentPlayingItem); if (tIdx < 0) return;
    if (tIdx >= currentRenderedCount) { while(tIdx >= currentRenderedCount && currentRenderedCount < currentRenderSongs.length) loadMoreTracks(); }
    document.querySelectorAll('.w-t-item').forEach(el => { el.classList.remove('active'); el.querySelector('.w-t-idx').classList.remove('hidden'); el.querySelector('.w-t-playing-icon').classList.add('hidden'); });
    const activeEl = trackListEl.children[tIdx];
    if (activeEl) {
        activeEl.classList.add('active'); activeEl.querySelector('.w-t-idx').classList.add('hidden'); activeEl.querySelector('.w-t-playing-icon').classList.remove('hidden');
        
        if (appSettings.autoScrollActiveTrack !== false) setTimeout(() => scrollActiveTrackInList(activeEl), 100);
    }
}

function scrollActiveTrackInList(activeEl) {
    if (!activeEl || !trackListEl.clientHeight) return;
    const listRect = trackListEl.getBoundingClientRect(); const itemRect = activeEl.getBoundingClientRect();
    const desired = trackListEl.scrollTop + (itemRect.top - listRect.top) - (trackListEl.clientHeight - itemRect.height) / 2;
    const max = Math.max(0, trackListEl.scrollHeight - trackListEl.clientHeight);
    trackListEl.scrollTo({ top: Math.min(max, Math.max(0, desired)), behavior: 'smooth' });
}

// 🌟 編集モードとダウンロード
function toggleEditMode() {
    if (isEditMode) {
        if (confirm("編集モードを終了しますか？")) {
            if (confirm("変更内容をJSONファイルとして保存（ダウンロード）しますか？")) {
                downloadJSON();
            }
            isEditMode = false; selectedItems.clear();
            document.body.classList.remove('edit-mode');
            document.getElementById('edit-action-bar').classList.add('hidden');
            document.getElementById('btn-edit-mode').textContent = "編集";
            renderTracks(currentRenderSongs);
        }
    } else {
        isEditMode = true; selectedItems.clear(); updateEditBar();
        document.body.classList.add('edit-mode');
        document.getElementById('edit-action-bar').classList.remove('hidden');
        document.getElementById('btn-edit-mode').textContent = "完了";
        renderTracks(currentRenderSongs);
    }
}

function downloadJSON() {
    const exportData = {
        schemaVersion: 4,
        version: '4.0',
        exportedAt: new Date().toISOString(),
        mediaItems: allItems.map(item => {
            const { originalIndex, safeDate, safePlayCount, ...rest } = item;
            return rest;
        }),
        folderSettings: folderSettings,
        settings: {},
        webSettings: { ...appSettings }
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "cms_playlist_edited.json");
    document.body.appendChild(dlAnchorElem);
    dlAnchorElem.click();
    document.body.removeChild(dlAnchorElem);
}

function setupEditMode() {
    const editModeButton = document.getElementById('btn-edit-mode');
    if (!editModeButton) return;
    editModeButton.onclick = toggleEditMode;
    document.getElementById('btn-edit-cancel').onclick = toggleEditMode;

    document.getElementById('btn-edit-delete').onclick = () => {
        if (selectedItems.size === 0) return;
        if (confirm(`${selectedItems.size}件のアイテムを削除しますか？`)) {
            allItems = allItems.filter(item => !selectedItems.has(item.originalIndex));
            selectedItems.clear(); buildLibrary(); selectFolder(currentFolderId || '__all');
        }
    };

    document.getElementById('btn-edit-move').onclick = () => {
        if (selectedItems.size === 0) return;
        const targetFolder = document.getElementById('edit-folder-target').value;
        if (!targetFolder) return alert('移動先フォルダを選択してください');
        allItems.forEach(item => { if (selectedItems.has(item.originalIndex)) { item.folder = targetFolder; item.folders = [targetFolder]; } });
        selectedItems.clear(); buildLibrary(); selectFolder(currentFolderId || '__all'); alert('移動しました');
    };
}
function updateEditBar() {
    const editCount = document.getElementById('edit-count');
    if (editCount) editCount.textContent = `${selectedItems.size}件`;
}
function populateEditFolders() {
    const selEdit = document.getElementById('edit-folder-target'); 
    const selFilter = document.getElementById('widget-folder-select');
    if (!selEdit && !selFilter) return;

    if (selEdit) selEdit.innerHTML = '<option value="">移動先...</option>';
    if (selFilter) selFilter.innerHTML = '';

    musicLibrary.forEach(f => { 
        if(selEdit && f.id !== '__all') {
            const opt1 = document.createElement('option'); opt1.value = f.id; opt1.textContent = f.name.replace('📁 ', ''); selEdit.appendChild(opt1); 
        }
        if (selFilter) {
            const opt2 = document.createElement('option'); opt2.value = f.id; opt2.textContent = f.name; selFilter.appendChild(opt2);
        }
    });

    if(currentFolderId && selFilter) selFilter.value = currentFolderId;
}

function handleSearch(e) { currentSearchQuery = e.target.value; buildLibrary(); renderFolders(); selectFolder(currentFolderId || musicLibrary[0]?.id); }
function handleSortChange(e) { currentSortOrder = e.target.value; buildLibrary(); selectFolder(currentFolderId || musicLibrary[0]?.id); }
function handleNicoFilterChange(e) { excludeNico = e.target.checked; buildLibrary(); renderFolders(); selectFolder(currentFolderId || musicLibrary[0]?.id); }

function setupPlayerControls() {
    document.getElementById('widget-btn-play').onclick = () => togglePlay();
    document.getElementById('widget-btn-next').onclick = playNextVideo;
    document.getElementById('widget-btn-prev').onclick = playPrevVideo;
    document.getElementById('pocket-btn-play').onclick = () => togglePlay();
    document.getElementById('pocket-btn-next').onclick = playNextVideo;
    document.getElementById('pocket-btn-prev').onclick = playPrevVideo;
}
function toggleFullscreen() { const pw = document.getElementById('widget-player'); if (!document.fullscreenElement && !document.webkitFullscreenElement) { if (pw.requestFullscreen) pw.requestFullscreen(); else if (pw.webkitRequestFullscreen) pw.webkitRequestFullscreen(); else document.body.classList.toggle('pseudo-fullscreen'); } else { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); else document.body.classList.remove('pseudo-fullscreen'); } }

function applyVolume() {
    let boost = parseFloat(appSettings.nicoBoost) || 1.0; let ytVol = Math.max(10, Math.floor(100 / boost)); 
    if (currentPlayingItem && currentPlayingItem.site === 'youtube' && ytPlayer && typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(ytVol);
    if (currentPlayingItem && currentPlayingItem.site === 'niconico') { const nIframe = document.getElementById('nico-player'); if (nIframe && nIframe.contentWindow) nIframe.contentWindow.postMessage({ sourceConnectorType: 1, playerId: "1", eventName: "volumeChange", data: { volume: 1 } }, 'https://embed.nicovideo.jp'); }
}

function startProgressTimer() { clearInterval(progressInterval); progressInterval = setInterval(updateProgress, 1000); }
function stopProgressTimer() { clearInterval(progressInterval); }

function updateProgress() {
    if (!isPlaying) return; let cur = 0; let dur = 0;
    if (currentPlayingItem.site === 'youtube' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') { cur = ytPlayer.getCurrentTime(); dur = ytPlayer.getDuration(); } 
    else if (currentPlayingItem.site === 'niconico') { nicoCurrentTime += 1; cur = nicoCurrentTime; dur = nicoDuration; if (dur > 0 && cur >= dur + 2 && !nicoEndedFlag) { nicoEndedFlag = true; stopProgressTimer(); playNextVideo(); return; } } else return;
    if (dur > 0) { const pct = (cur / dur) * 100; document.getElementById('progress-bar').style.width = `${pct}%`; document.getElementById('pocket-progress-bar').style.width = `${pct}%`; document.getElementById('time-current').textContent = formatTime(cur); document.getElementById('time-duration').textContent = formatTime(dur); document.getElementById('pocket-time-current').textContent = formatTime(cur); document.getElementById('pocket-time-duration').textContent = formatTime(dur); }
}
function formatTime(s) { if (!s || isNaN(s)) return "0:00"; const m = Math.floor(s / 60); const sc = Math.floor(s % 60); return `${m}:${sc.toString().padStart(2, '0')}`; }
function handleProgressClick(e) { if (!currentPlayingItem || !ytPlayer || currentPlayingItem.site !== 'youtube' || typeof ytPlayer.getDuration !== 'function') return; const r = e.target.getBoundingClientRect(); const pos = (e.clientX - r.left) / r.width; const dur = ytPlayer.getDuration(); if (dur > 0) { ytPlayer.seekTo(dur * pos, true); updateProgress(); } }

function startPlaylist(items, idx = 0) { if (items.length === 0) return; currentPlaylist = items; currentIndex = idx; loadVideo(currentIndex); }
function playNextVideo() { if (currentPlaylist.length === 0 || isTransitioning) return; isTransitioning = true; setTimeout(() => { isTransitioning = false; }, 1000); currentIndex = (currentIndex + 1) % currentPlaylist.length; loadVideo(currentIndex); }
function playPrevVideo() { if (currentPlaylist.length === 0 || isTransitioning) return; isTransitioning = true; setTimeout(() => { isTransitioning = false; }, 1000); currentIndex = (currentIndex - 1 + currentPlaylist.length) % currentPlaylist.length; loadVideo(currentIndex); }

function getYouTubeId(url) { try { return new URL(url).searchParams.get('v') || url.split('/').pop(); } catch(e) { const m = url.match(/[?&]v=([^&]+)/); return m ? m[1] : url.split('/').pop(); } }
function getNicoId(url) { return url.split('?')[0].split('/').pop(); }

function createYouTubePlayer(vId) {
    if (window.YT && window.YT.Player) {
        ytPlayer = new YT.Player('yt-player-mount', { height: '100%', width: '100%', videoId: vId, playerVars: { 'playsinline': 1, 'autoplay': 1, 'rel': 0 }, events: { 'onReady': (e) => { if(appSettings.dataSaverMode && typeof e.target.setPlaybackQuality === 'function') e.target.setPlaybackQuality('tiny'); isPlaying = true; try { e.target.playVideo(); } catch (_) {} updatePlayPauseIcon(); applyVolume(); startProgressTimer(); startSilentAudio(); schedulePlaybackRecovery(); }, 'onStateChange': onPlayerStateChange, 'onError': () => { setTimeout(playNextVideo, 5000); } } });
    } else setTimeout(() => createYouTubePlayer(vId), 1000);
}
function onPlayerStateChange(e) { if (e.data === YT.PlayerState.PLAYING) { isPlaying = true; updatePlayPauseIcon(); applyVolume(); startProgressTimer(); startSilentAudio(); } else if (e.data === YT.PlayerState.PAUSED) { isPlaying = false; updatePlayPauseIcon(); stopProgressTimer(); stopSilentAudio(); } else if (e.data === YT.PlayerState.ENDED) { stopProgressTimer(); document.getElementById('progress-bar').style.width = '0%'; playNextVideo(); } }

function loadVideo(idx) {
    if (idx < 0 || idx >= currentPlaylist.length) return;
    currentIndex = idx; isTransitioning = false; currentPlayingItem = currentPlaylist[idx]; isPlaying = true; nicoDuration = 0; nicoCurrentTime = 0; nicoEndedFlag = false;
    updatePlayerUI(currentPlayingItem); updateActiveTrackUI();
    document.getElementById('progress-bar').style.width = '0%'; document.getElementById('pocket-progress-bar').style.width = '0%'; document.getElementById('time-current').textContent = '0:00'; document.getElementById('time-duration').textContent = '0:00'; stopProgressTimer();
    const c = document.getElementById('player-container');
    if (currentPlayingItem.site === 'youtube') {
        const vId = getYouTubeId(currentPlayingItem.url);
        if (c.querySelector('#nico-player') || c.querySelector('iframe')) { c.innerHTML = '<div id="yt-player-mount"></div>'; ytPlayer = null; }
        if (!ytPlayer) { c.innerHTML = '<div id="yt-player-mount"></div>'; createYouTubePlayer(vId); } else { if (typeof ytPlayer.loadVideoById === 'function') ytPlayer.loadVideoById(vId); else { c.innerHTML = '<div id="yt-player-mount"></div>'; createYouTubePlayer(vId); } }
    } else {
        if (ytPlayer) { try { ytPlayer.destroy(); } catch(e){} ytPlayer = null; }
        c.innerHTML = ''; 
        if (currentPlayingItem.site === 'niconico') { const nId = getNicoId(currentPlayingItem.url); setTimeout(() => { const i = document.createElement('iframe'); i.id = 'nico-player'; i.src = `https://embed.nicovideo.jp/watch/${nId}?jsapi=1&playerId=1&loop=0`; i.setAttribute('allow', 'autoplay; fullscreen; encrypted-media'); i.style.width = '100%'; i.style.height = '100%'; i.style.border = 'none'; c.appendChild(i); }, 50); } 
        else { c.innerHTML = `<iframe src="${currentPlayingItem.url}" allowfullscreen allow="autoplay" style="width:100%; height:100%; border:none;"></iframe>`; }
    }
    schedulePlaybackRecovery();
}

function handleNicoMessage(e) {
    if (e.origin !== 'https://embed.nicovideo.jp' || !currentPlayingItem || currentPlayingItem.site !== 'niconico' || !e.data || !e.data.eventName) return;
    const ev = e.data.eventName; const d = e.data.data;
    if (ev === 'loadComplete') { const i = document.getElementById('nico-player'); if (i && i.contentWindow) { setTimeout(() => { i.contentWindow.postMessage({ sourceConnectorType: 1, playerId: "1", eventName: "play" }, 'https://embed.nicovideo.jp'); applyVolume(); startProgressTimer(); startSilentAudio(); schedulePlaybackRecovery(); }, 150); } } 
    else if (ev === 'playerMetadataChange') { if (d && d.duration) nicoDuration = d.duration / 1000; } else if (ev === 'playerPlayTimeChange') { if (d && d.playTime) nicoCurrentTime = d.playTime / 1000; } 
    else if (ev === 'playerStatusChange') { const s = d.playerStatus; if (s === 4 && !nicoEndedFlag) { nicoEndedFlag = true; playNextVideo(); } else if (s === 2) { isPlaying = true; updatePlayPauseIcon(); applyVolume(); startProgressTimer(); startSilentAudio(); } else if (s === 3) { isPlaying = false; updatePlayPauseIcon(); stopProgressTimer(); stopSilentAudio(); } } 
    else if (ev === 'error') setTimeout(() => playNextVideo(), 5000);
}

function togglePlay(fPlay) {
    if (!currentPlayingItem) return;
    isPlaying = typeof fPlay === 'boolean' ? fPlay : !isPlaying; updatePlayPauseIcon();
    if (isPlaying) { startProgressTimer(); startSilentAudio(); applyVolume(); } else { stopProgressTimer(); stopSilentAudio(); }
    if (currentPlayingItem.site === 'youtube' && ytPlayer && typeof ytPlayer.playVideo === 'function') { if (isPlaying) ytPlayer.playVideo(); else ytPlayer.pauseVideo(); } 
    else if (currentPlayingItem.site === 'niconico') { const i = document.getElementById('nico-player'); if (i && i.contentWindow) i.contentWindow.postMessage({ sourceConnectorType: 1, playerId: "1", eventName: isPlaying ? "play" : "pause" }, 'https://embed.nicovideo.jp'); }
}

function updatePlayerUI(i) {
    document.getElementById('widget-title').textContent = i.title; document.getElementById('widget-artist').textContent = i.channelName || i.site; document.getElementById('pocket-title').textContent = i.title;
    const t = i.thumbnail || "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>"; document.getElementById('widget-art').src = t; document.getElementById('pocket-art').src = t;
    updatePlayPauseIcon(); scheduleMarqueeUpdate(); 
    if ('mediaSession' in navigator) { navigator.mediaSession.metadata = new MediaMetadata({ title: i.title, artist: i.channelName || i.site, artwork:[{ src: t, sizes: '512x512', type: 'image/jpeg' }] }); navigator.mediaSession.setActionHandler('play', () => togglePlay(true)); navigator.mediaSession.setActionHandler('pause', () => togglePlay(false)); navigator.mediaSession.setActionHandler('previoustrack', playPrevVideo); navigator.mediaSession.setActionHandler('nexttrack', playNextVideo); }
}

function updatePlayPauseIcon() {
    document.getElementById('widget-play-icon').className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    const mIcon = document.getElementById('m-header-play-icon'); if (mIcon) mIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    const pocketIcon = document.getElementById('pocket-play-icon'); if (pocketIcon) pocketIcon.className = isPlaying ? 'fas fa-pause' : 'fas fa-play';
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
}

function setupClockUI() {
    const setHands = (clock, now) => {
        if (!clock) return;
        const seconds = now.getSeconds(); const minutes = now.getMinutes() + seconds / 60; const hours = (now.getHours() % 12) + minutes / 60;
        const hour = clock.querySelector('.hour-hand'); const minute = clock.querySelector('.minute-hand'); const second = clock.querySelector('.second-hand');
        if (hour) hour.style.transform = `translateX(-50%) rotate(${hours * 30}deg)`;
        if (minute) minute.style.transform = `translateX(-50%) rotate(${minutes * 6}deg)`;
        if (second) second.style.transform = `translateX(-50%) rotate(${seconds * 6}deg)`;
    };
    const update = () => {
        const now = new Date();
        const time = now.toLocaleTimeString('ja-JP', { hour12: false });
        const shortTime = time.slice(0, 5);
        const date = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
        const clockTime = document.getElementById('clock-time'); const analogClock = document.getElementById('analog-clock');
        const clockType = appSettings.clockType || 'digital1';
        if (clockTime) { clockTime.textContent = time; clockTime.className = `theme-text ${clockType}`; clockTime.classList.toggle('hidden', clockType === 'analog'); }
        if (analogClock) analogClock.classList.toggle('hidden', clockType !== 'analog');
        const clockDate = document.getElementById('clock-date'); if (clockDate) clockDate.textContent = date;
        const pocketClock = document.getElementById('pocket-clock-text'); const pocketAnalog = document.getElementById('pocket-analog-clock'); const pocketContainer = document.getElementById('pocket-clock-container');
        const pocketType = appSettings.pocketClockType || 'digital1';
        if (pocketContainer) pocketContainer.classList.toggle('hidden', pocketType === 'none');
        if (pocketClock) { pocketClock.textContent = shortTime; pocketClock.className = `theme-text ${pocketType}`; pocketClock.classList.toggle('hidden', pocketType === 'analog' || pocketType === 'none'); }
        if (pocketAnalog) pocketAnalog.classList.toggle('hidden', pocketType !== 'analog');
        setHands(analogClock, now); setHands(pocketAnalog, now);
    };
    update(); setInterval(update, 1000);
}

function setupPocketMode() {
    const pOverlay = document.getElementById('pocket-overlay');
    let holdTimer = null; let startY = null; let activePointer = null;
    const open = () => {
        pOverlay.classList.remove('hidden'); document.body.classList.add('pocket-active');
        const request = document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        if (request) { try { const result = request.call(document.documentElement); if (result?.catch) result.catch(() => {}); } catch (_) {} }
    };
    const cancelHold = () => { pOverlay.classList.remove('touch-holding'); clearTimeout(holdTimer); holdTimer = null; activePointer = null; startY = null; };
    const unlock = () => {
        cancelHold(); activePointer = null; startY = null;
        pOverlay.classList.add('hidden'); document.body.classList.remove('pocket-active');
        try {
            const exit = document.exitFullscreen || document.webkitExitFullscreen;
            if (exit && (document.fullscreenElement || document.webkitFullscreenElement)) { const result = exit.call(document); if (result?.catch) result.catch(() => {}); }
        } catch (_) {}
    };
    document.getElementById('btn-pocket-mode').addEventListener('click', open);
    document.getElementById('pocket-unlock-btn').addEventListener('click', (e) => { e.stopPropagation(); unlock(); });
    pOverlay.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        activePointer = e.pointerId; startY = e.clientY; pOverlay.classList.add('touch-holding');
        clearTimeout(holdTimer); holdTimer = setTimeout(unlock, 2000);
    });
    pOverlay.addEventListener('pointermove', (e) => {
        if (activePointer !== e.pointerId || startY === null) return;
        if (appSettings.pocketSwipeUnlock && (e.pointerType === 'touch' || e.pointerType === 'pen') && startY - e.clientY > 80) unlock();
    });
    pOverlay.addEventListener('pointerup', cancelHold);
    pOverlay.addEventListener('pointercancel', cancelHold);
    pOverlay.addEventListener('contextmenu', e => e.preventDefault());
}
