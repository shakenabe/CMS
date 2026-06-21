const defaultSettings = {
    theme: 'modern', bgPosition: 'center', bgSize: 'cover', bgOpacity: 50, nicoBoost: 1.0,
    baseFontSize: 100, pcLeftWidth: 350, showClock: false, showThumbnails: true,
    performanceMode: false, dataSaverMode: false,
    customColorEnabled: false, customAccentColor: '#00aaff', customBorderColor: '#ffffff',
    pocketAlwaysOn: false, pocketSwipeUnlock: true, forcePcLayout: false, windowMode: false, windowPositions: {},
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
function setupBackgroundPlayback() {
    if (!silentAudio) {
        const silentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
        silentAudio = new Audio(silentWav); silentAudio.loop = true; silentAudio.volume = 0.01;
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === 'visible') updateProgress(); });
}
function startSilentAudio() { if (silentAudio && silentAudio.paused) silentAudio.play().catch(e => {}); }
function stopSilentAudio() { if (silentAudio && !silentAudio.paused) silentAudio.pause(); }

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
            updateLayoutMode(); scheduleMarqueeUpdate();
        }, 200); 
    });

    // リスト追加読込
    trackListEl.addEventListener('scroll', () => { 
        if (trackListEl.scrollTop + trackListEl.clientHeight >= trackListEl.scrollHeight - 100) loadMoreTracks(); 
    });

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

    setupPlayerControls(); setupSettingsModal(); window.addEventListener('message', handleNicoMessage); setupPocketMode();
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
    if (window.innerWidth <= 900 && !appSettings.forcePcLayout) { document.body.classList.add('is-mobile'); document.body.classList.remove('is-pc'); } else { document.body.classList.add('is-pc'); document.body.classList.remove('is-mobile'); }
}

// ウィンドウモード（5つのパネル完全独立）
let isDraggingPanel = false;
function applyWindowMode() {
    const panels = ['widget-player', 'widget-controls', 'widget-folder-list-wrapper', 'widget-track-list-wrapper', 'library-nav-wrapper'];
    
    if (appSettings.windowMode) {
        document.body.classList.add('window-mode');
        panels.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (!appSettings.windowPositions[id]) {
                    const defaults = {
                        'widget-player': { top: '20px', left: '20px', width: '450px', height: '300px' },
                        'widget-controls': { top: '340px', left: '20px', width: '450px', height: '180px' },
                        'widget-folder-list-wrapper': { top: '20px', left: '490px', width: '250px', height: '500px' },
                        'widget-track-list-wrapper': { top: '20px', left: '760px', width: '400px', height: '500px' },
                        'library-nav-wrapper': { top: '540px', left: '490px', width: '670px', height: '80px' }
                    };
                    appSettings.windowPositions[id] = defaults[id] || { top: '50px', left: '50px', width: '300px', height: '200px' };
                }
                el.style.position = 'absolute'; el.style.top = appSettings.windowPositions[id].top; el.style.left = appSettings.windowPositions[id].left;
                if (appSettings.windowPositions[id].width) el.style.width = appSettings.windowPositions[id].width;
                if (appSettings.windowPositions[id].height) el.style.height = appSettings.windowPositions[id].height;
                makeDraggable(el);
            }
        });
    } else {
        document.body.classList.remove('window-mode');
        panels.forEach(id => { const el = document.getElementById(id); if (el) { el.style.position = ''; el.style.top = ''; el.style.left = ''; el.style.width = ''; el.style.height = ''; el.onmousedown = null; } });
    }
}

function makeDraggable(el) {
    el.onmousedown = (e) => {
        if (!appSettings.windowMode) return;
        const rect = el.getBoundingClientRect();
        
        // 右下（リサイズ用領域）は除外
        if (e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20) return;
        
        // パネル上部25px（ドラッグハンドル領域）以外ならドラッグ開始しない
        if (e.clientY - rect.top > 25) return;
        
        if (['INPUT', 'BUTTON', 'SELECT', 'OPTION', 'TEXTAREA', 'I'].includes(e.target.tagName)) return;

        e.preventDefault(); isDraggingPanel = true;
        
        // iframeによるmousemove/mouseupイベントの吸収を防ぐための透明シールド
        const shield = document.createElement('div');
        shield.style.position = 'fixed'; shield.style.top = 0; shield.style.left = 0;
        shield.style.width = '100vw'; shield.style.height = '100vh';
        shield.style.zIndex = 999999; shield.style.cursor = 'move';
        document.body.appendChild(shield);

        let posX = e.clientX, posY = e.clientY;
        
        const onMouseUp = () => { 
            isDraggingPanel = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            if (shield.parentNode) shield.parentNode.removeChild(shield);
            appSettings.windowPositions[el.id] = { top: el.style.top, left: el.style.left, width: el.style.width, height: el.style.height }; 
            saveSettings(); 
        };
        const onMouseMove = (ev) => { 
            if (!isDraggingPanel) return; ev.preventDefault(); 
            const dx = ev.clientX - posX; const dy = ev.clientY - posY; posX = ev.clientX; posY = ev.clientY; 
            el.style.top = (el.offsetTop + dy) + "px"; el.style.left = (el.offsetLeft + dx) + "px"; 
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };
    
    const ro = new ResizeObserver(() => {
        if (!isDraggingPanel && appSettings.windowMode) {
            appSettings.windowPositions[el.id] = { top: el.style.top, left: el.style.left, width: el.style.width, height: el.style.height }; saveSettings();
        }
    });
    ro.observe(el);
}

function applyThemeSettings() {
    document.body.className = `theme-${appSettings.theme} ${document.body.className.match(/is-(pc|mobile)/)[0]}`;
    if (appSettings.forcePcLayout || appSettings.windowMode) document.body.classList.add('is-pc');
    if (appSettings.windowMode) document.body.classList.add('window-mode');
    
    document.body.classList.toggle('show-list-thumbnails', appSettings.showThumbnails);
    document.body.classList.toggle('performance-mode', appSettings.performanceMode);
    
    document.documentElement.style.setProperty('--base-font-size', `${appSettings.baseFontSize}%`); 
    document.documentElement.style.setProperty('--pc-left-width', `${appSettings.pcLeftWidth}px`);
    document.documentElement.style.setProperty('--bg-position', appSettings.bgPosition); document.documentElement.style.setProperty('--bg-size', appSettings.bgSize);
    
    if (appSettings.customColorEnabled) { document.body.style.setProperty('--text-color', appSettings.customAccentColor); document.body.style.setProperty('--accent-color', appSettings.customAccentColor); document.body.style.setProperty('--border-color', appSettings.customBorderColor); } 
    else { document.body.style.removeProperty('--text-color'); document.body.style.removeProperty('--accent-color'); document.body.style.removeProperty('--border-color'); }
    
    const op = parseFloat(appSettings.bgOpacity); document.documentElement.style.setProperty('--panel-alpha', (100 - op) / 100 * 0.8); document.documentElement.style.setProperty('--panel-blur', appSettings.performanceMode ? '0px' : `${((100 - op) / 100 * 20)}px`);
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
        document.getElementById('set-show-thumbnails').checked = appSettings.showThumbnails;
        document.getElementById('set-pocket-always-on').checked = appSettings.pocketAlwaysOn; document.getElementById('set-pocket-swipe-unlock').checked = appSettings.pocketSwipeUnlock;
        document.getElementById('set-force-pc-layout').checked = appSettings.forcePcLayout; document.getElementById('set-window-mode').checked = appSettings.windowMode;
        document.getElementById('set-use-firebase').checked = Boolean(appSettings.useFirebase);
        document.getElementById('set-use-custom-color').checked = appSettings.customColorEnabled; document.getElementById('set-accent-color').value = appSettings.customAccentColor; document.getElementById('set-border-color').value = appSettings.customBorderColor;
        modal.classList.remove('hidden');
    };

    document.getElementById('set-font-size').oninput = (e) => document.getElementById('font-val').textContent = e.target.value; document.getElementById('set-pc-left-width').oninput = (e) => document.getElementById('pc-width-val').textContent = e.target.value;
    document.getElementById('set-opacity').oninput = (e) => document.getElementById('op-val').textContent = e.target.value; document.getElementById('set-nico-boost').oninput = (e) => document.getElementById('boost-val').textContent = parseFloat(e.target.value).toFixed(1);

    document.getElementById('btn-close-settings').onclick = () => modal.classList.add('hidden');
    document.getElementById('btn-reset-settings').onclick = () => { if (confirm('初期化しますか？')) { localStorage.removeItem('cms_player_settings_v23'); clearBgImageDB(); location.reload(); } };
    document.getElementById('btn-clear-bg').onclick = () => { clearBgImageDB(); alert('背景をクリアしました。Saveを押してください。'); };
    document.getElementById('btn-reset-window').onclick = () => { appSettings.windowPositions = {}; alert('配置をリセットしました。Saveを押してください。'); };

    document.getElementById('btn-save-settings').onclick = async () => {
        appSettings.theme = document.getElementById('set-theme').value; appSettings.baseFontSize = document.getElementById('set-font-size').value; appSettings.pcLeftWidth = document.getElementById('set-pc-left-width').value; appSettings.bgPosition = document.getElementById('set-bg-position').value; appSettings.bgSize = document.getElementById('set-bg-size').value; appSettings.bgOpacity = document.getElementById('set-opacity').value; appSettings.nicoBoost = document.getElementById('set-nico-boost').value; appSettings.defaultSortOrder = document.getElementById('set-default-sort').value;
        appSettings.performanceMode = document.getElementById('set-performance-mode').checked; appSettings.dataSaverMode = document.getElementById('set-data-saver').checked; appSettings.showThumbnails = document.getElementById('set-show-thumbnails').checked; appSettings.pocketAlwaysOn = document.getElementById('set-pocket-always-on').checked; appSettings.pocketSwipeUnlock = document.getElementById('set-pocket-swipe-unlock').checked; appSettings.forcePcLayout = document.getElementById('set-force-pc-layout').checked; appSettings.windowMode = document.getElementById('set-window-mode').checked; appSettings.customColorEnabled = document.getElementById('set-use-custom-color').checked; appSettings.customAccentColor = document.getElementById('set-accent-color').value; appSettings.customBorderColor = document.getElementById('set-border-color').value; appSettings.useFirebase = document.getElementById('set-use-firebase').checked;
        
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
        
        setTimeout(() => { 
            const cTop = trackListEl.scrollTop; const cHeight = trackListEl.clientHeight; const eTop = activeEl.offsetTop; const eHeight = activeEl.clientHeight; 
            if (eTop < cTop || eTop + eHeight > cTop + cHeight) trackListEl.scrollTo({ top: eTop - (cHeight / 2) + (eHeight / 2), behavior: 'smooth' }); 
        }, 100);
    }
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

function setupPlayerControls() { document.getElementById('widget-btn-play').onclick = () => togglePlay(); document.getElementById('widget-btn-next').onclick = playNextVideo; document.getElementById('widget-btn-prev').onclick = playPrevVideo; }
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
        ytPlayer = new YT.Player('yt-player-mount', { height: '100%', width: '100%', videoId: vId, playerVars: { 'playsinline': 1, 'autoplay': 1, 'rel': 0 }, events: { 'onReady': (e) => { if(appSettings.dataSaverMode && typeof e.target.setPlaybackQuality === 'function') e.target.setPlaybackQuality('tiny'); isPlaying = true; updatePlayPauseIcon(); applyVolume(); startProgressTimer(); startSilentAudio(); }, 'onStateChange': onPlayerStateChange, 'onError': () => { setTimeout(playNextVideo, 5000); } } });
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
}

function handleNicoMessage(e) {
    if (e.origin !== 'https://embed.nicovideo.jp' || !currentPlayingItem || currentPlayingItem.site !== 'niconico' || !e.data || !e.data.eventName) return;
    const ev = e.data.eventName; const d = e.data.data;
    if (ev === 'loadComplete') { const i = document.getElementById('nico-player'); if (i && i.contentWindow) { setTimeout(() => { i.contentWindow.postMessage({ sourceConnectorType: 1, playerId: "1", eventName: "play" }, 'https://embed.nicovideo.jp'); applyVolume(); startProgressTimer(); startSilentAudio(); }, 150); } } 
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
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
}

function setupPocketMode() {
    const pOverlay = document.getElementById('pocket-overlay');
    document.getElementById('btn-pocket-mode').addEventListener('click', () => { if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen(); else if (document.documentElement.webkitRequestFullscreen) document.documentElement.webkitRequestFullscreen(); pOverlay.classList.remove('hidden'); });
    let hTimer = null; let tStartY = 0;
    function sHold(e) { pOverlay.classList.add('touch-holding'); if (e && e.touches) tStartY = e.touches[0].clientY; hTimer = setTimeout(unlock, 2000); }
    function eHold() { pOverlay.classList.remove('touch-holding'); clearTimeout(hTimer); }
    function unlock() { if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen(); else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen(); pOverlay.classList.add('hidden'); pOverlay.classList.remove('touch-holding'); clearTimeout(hTimer); }
    pOverlay.addEventListener('mousedown', sHold); pOverlay.addEventListener('mouseup', eHold); pOverlay.addEventListener('mouseleave', eHold);
    pOverlay.addEventListener('touchstart', sHold, {passive: true}); pOverlay.addEventListener('touchend', eHold, {passive: true}); pOverlay.addEventListener('touchcancel', eHold, {passive: true});
    pOverlay.addEventListener('touchmove', (e) => { if (appSettings.pocketSwipeUnlock && tStartY && (tStartY - e.touches[0].clientY > 80)) unlock(); }, {passive: true});
    pOverlay.addEventListener('contextmenu', e => e.preventDefault());
}
