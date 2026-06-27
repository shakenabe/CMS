(function () {
  'use strict';

  const SETTINGS_KEY = 'cms_player_settings_v23';
  const RESUME_KEY = 'cms_web_last_playback_v1';
  const COUNT_FLUSH_MS = 1500;
  let countFlushTimer = null;

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function writeSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (_) {}
  }

  function saveResumeState(extra = {}) {
    const state = {
      folderId: window.__cmsSafePatchCurrentFolderId || null,
      itemId: window.__cmsSafePatchCurrentItemId || null,
      index: window.__cmsSafePatchCurrentIndex || 0,
      currentTime: Number(extra.currentTime || 0),
      savedAt: Date.now()
    };
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function readResumeState() {
    try {
      const state = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
      if (!state || Date.now() - Number(state.savedAt || 0) > 30 * 24 * 60 * 60 * 1000) return null;
      return state;
    } catch (_) {
      return null;
    }
  }

  function markCompleted(item) {
    if (!item || !item.id) return;
    item.playCount = (Number(item.playCount) || 0) + 1;
    item.lastPlayedAt = new Date().toISOString();
    saveResumeState({ currentTime: 0 });
    clearTimeout(countFlushTimer);
    countFlushTimer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cms-safe-patch-playcount', { detail: { id: item.id } }));
    }, COUNT_FLUSH_MS);
  }

  function applyPocketVariables() {
    const overlay = document.getElementById('pocket-overlay');
    if (!overlay) return;
    const settings = readSettings();
    const bgX = Number(settings.pocketBgX ?? 50);
    const bgY = Number(settings.pocketBgY ?? 50);
    const bgScale = Number(settings.pocketBgScale ?? 100);
    if (settings.pocketBgManual) {
      overlay.style.setProperty('--pocket-bg-position', `${bgX}% ${bgY}%`);
      overlay.style.setProperty('--pocket-bg-size', `${bgScale}% auto`);
    }
    const map = {
      clock: 'pocket-clock-container',
      art: 'pocket-art',
      title: 'pocket-title',
      progress: 'pocket-progress-area',
      controls: 'pocket-controls',
      unlock: 'pocket-unlock-btn'
    };
    Object.entries(map).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const scale = Math.max(50, Math.min(180, Number(settings.pocketLayoutScale?.[key]) || 100)) / 100;
      el.style.setProperty('--pocket-item-scale', String(scale));
    });
  }

  function addSettingsControls() {
    const tabGeneral = document.getElementById('tab-general');
    const tabPocket = document.getElementById('tab-pocket');
    const settings = readSettings();

    if (tabGeneral && !document.getElementById('set-resume-last-playback')) {
      const row = document.createElement('div');
      row.className = 'setting-row cms-safe-patch-row';
      row.innerHTML = '<label><input type="checkbox" id="set-resume-last-playback"> 前回のフォルダ・曲から再開する</label><small>モバイル再読込時の「All先頭戻り」を軽減します。</small>';
      tabGeneral.appendChild(row);
      row.querySelector('input').checked = settings.resumeLastPlayback !== false;
    }

    if (tabPocket && !document.getElementById('set-pocket-bg-manual')) {
      const wrap = document.createElement('div');
      wrap.className = 'setting-group cms-safe-patch-row';
      wrap.innerHTML = `
        <h3>ロック画面 背景/サイズ微調整</h3>
        <div class="setting-row"><label><input type="checkbox" id="set-pocket-bg-manual"> 背景位置・拡大率を手動調整</label></div>
        <div class="setting-row window-color-grid">
          <div><label>背景X: <span id="pocket-bg-x-val">50</span>%</label><input type="range" id="set-pocket-bg-x" min="0" max="100" value="50"></div>
          <div><label>背景Y: <span id="pocket-bg-y-val">50</span>%</label><input type="range" id="set-pocket-bg-y" min="0" max="100" value="50"></div>
          <div><label>拡大率: <span id="pocket-bg-scale-val">100</span>%</label><input type="range" id="set-pocket-bg-scale" min="50" max="220" value="100"></div>
        </div>
        <div class="setting-row window-color-grid">
          <div><label>時計: <span id="pocket-scale-clock-val">100</span>%</label><input type="range" id="set-pocket-scale-clock" min="50" max="180" value="100"></div>
          <div><label>サムネ: <span id="pocket-scale-art-val">100</span>%</label><input type="range" id="set-pocket-scale-art" min="50" max="180" value="100"></div>
          <div><label>曲名: <span id="pocket-scale-title-val">100</span>%</label><input type="range" id="set-pocket-scale-title" min="50" max="180" value="100"></div>
          <div><label>進捗: <span id="pocket-scale-progress-val">100</span>%</label><input type="range" id="set-pocket-scale-progress" min="50" max="180" value="100"></div>
          <div><label>操作部: <span id="pocket-scale-controls-val">100</span>%</label><input type="range" id="set-pocket-scale-controls" min="50" max="180" value="100"></div>
          <div><label>解除: <span id="pocket-scale-unlock-val">100</span>%</label><input type="range" id="set-pocket-scale-unlock" min="50" max="180" value="100"></div>
        </div>`;
      tabPocket.appendChild(wrap);
    }

    const bindRange = (id, valId, fallback) => {
      const el = document.getElementById(id);
      const val = document.getElementById(valId);
      if (!el || !val) return;
      const key = id.replace(/^set-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.value = settings[key] ?? fallback;
      val.textContent = el.value;
      el.addEventListener('input', () => { val.textContent = el.value; });
    };
    const manual = document.getElementById('set-pocket-bg-manual');
    if (manual) manual.checked = Boolean(settings.pocketBgManual);
    bindRange('set-pocket-bg-x', 'pocket-bg-x-val', 50);
    bindRange('set-pocket-bg-y', 'pocket-bg-y-val', 50);
    bindRange('set-pocket-bg-scale', 'pocket-bg-scale-val', 100);
    ['clock', 'art', 'title', 'progress', 'controls', 'unlock'].forEach(key => {
      const el = document.getElementById(`set-pocket-scale-${key}`);
      const val = document.getElementById(`pocket-scale-${key}-val`);
      if (!el || !val) return;
      el.value = settings.pocketLayoutScale?.[key] ?? 100;
      val.textContent = el.value;
      el.addEventListener('input', () => { val.textContent = el.value; });
    });
  }

  function persistExtraSettings() {
    const settings = readSettings();
    const resume = document.getElementById('set-resume-last-playback');
    if (resume) settings.resumeLastPlayback = resume.checked;
    const manual = document.getElementById('set-pocket-bg-manual');
    if (manual) settings.pocketBgManual = manual.checked;
    const num = id => Number(document.getElementById(id)?.value || 0);
    if (document.getElementById('set-pocket-bg-x')) {
      settings.pocketBgX = num('set-pocket-bg-x');
      settings.pocketBgY = num('set-pocket-bg-y');
      settings.pocketBgScale = num('set-pocket-bg-scale');
    }
    settings.pocketLayoutScale = settings.pocketLayoutScale || {};
    ['clock', 'art', 'title', 'progress', 'controls', 'unlock'].forEach(key => {
      const el = document.getElementById(`set-pocket-scale-${key}`);
      if (el) settings.pocketLayoutScale[key] = Number(el.value);
    });
    writeSettings(settings);
    applyPocketVariables();
  }

  function installEventHooks() {
    document.addEventListener('click', event => {
      if (event.target?.closest?.('#btn-open-settings')) setTimeout(addSettingsControls, 60);
      if (event.target?.closest?.('#btn-save-settings')) persistExtraSettings();
    }, true);

    document.addEventListener('pointerdown', event => {
      if (document.body.classList.contains('mobile-list-focus') && event.target?.closest?.('#mobile-list-fullscreen-header')) {
        document.body.classList.remove('mobile-list-focus');
      }
    }, true);

    const observer = new MutationObserver(() => applyPocketVariables());
    const overlay = document.getElementById('pocket-overlay');
    if (overlay) observer.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  function exposeHelpers() {
    window.CmsSafePatch20260627 = {
      readResumeState,
      saveResumeState,
      markCompleted,
      applyPocketVariables
    };
  }

  function init() {
    exposeHelpers();
    installEventHooks();
    addSettingsControls();
    applyPocketVariables();
    console.info('[cms-runtime] loaded 2026-06-27');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
