(function remoteClientModule(global) {
  'use strict';

  const API = '/remote-api';
  const MAX_VALUE = 8000;
  const TRUSTED_IMAGE_HOSTS = ['ytimg.com', 'img.youtube.com', 'ggpht.com', 'googleusercontent.com', 'nimg.jp', 'nicovideo.jp', 'smilevideo.jp'];
  const ERROR_MESSAGES = {
    INVALID_INVITE: '接続コードが正しくありません。PCで新しいQRコードを表示してください。',
    INVITE_EXPIRED: '接続コードの有効期限が切れました。PCで新しいQRコードを表示してください。',
    EXPIRED: '接続の有効期限が切れました。PCから接続し直してください。',
    UNAUTHORIZED: '接続が解除されました。PCから接続し直してください。',
    REVOKED: 'PC側で接続が解除されました。',
    PENDING: 'PC側の承認を待っています。',
    STALE_REVISION: 'PCの表示が変わりました。表示を更新してから操作してください。',
    STALE: 'PCの表示が変わりました。表示を更新してから操作してください。',
    PC_ONLY: 'この操作はPC側で行ってください。',
    HOST_OFFLINE: 'PCのCMSに接続できません。PC側のタブを確認してください。'
  };

  function extractInvite(value) {
    const text = String(value || '').trim();
    if (!text || text.length > 4096) return '';
    try {
      const url = new URL(text);
      return new URLSearchParams(url.hash.replace(/^#/, '')).get('invite') || '';
    } catch (_) {
      if (text.startsWith('#')) return new URLSearchParams(text.slice(1)).get('invite') || '';
      return /^[A-Za-z0-9_-]{20,512}$/.test(text) ? text : '';
    }
  }

  function safeStyleUrl(value, origin) {
    try {
      const url = new URL(value, origin);
      return url.origin === origin && /\.css$/i.test(url.pathname) && !url.username && !url.password ? url.href : '';
    } catch (_) { return ''; }
  }

  function safeImageUrl(value, origin) {
    const text = String(value || '').trim();
    if (/^data:image\/(png|jpeg|jpg|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
    try {
      const url = new URL(text, origin);
      if (url.username || url.password) return '';
      if (url.origin === origin && !url.pathname.startsWith(API + '/')) return url.href;
      if (url.protocol === 'https:' && TRUSTED_IMAGE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return url.href;
    } catch (_) { /* Invalid source. */ }
    return '';
  }

  function mirrorBodyClass(value, pcLayout) {
    const classes = String(value || '').split(/\s+/).filter(item => /^[\w-]+$/.test(item) && !['is-pc', 'is-tablet', 'is-mobile', 'window-mode', 'remote-view'].includes(item));
    classes.push(pcLayout ? 'is-pc' : 'is-mobile', 'cms-remote-mirror');
    return [...new Set(classes)].join(' ');
  }

  function eventValue(target) {
    const result = {};
    if ('value' in target) result.value = String(target.value || '');
    if (target.type === 'checkbox' || target.type === 'radio') result.checked = Boolean(target.checked);
    if (target.tagName === 'SELECT' && target.selectedIndex >= 0) result.selectedIndex = target.selectedIndex;
    if (target.tagName === 'SELECT' && target.multiple) result.selectedValues = Array.from(target.selectedOptions || [], option => String(option.value));
    return result;
  }

  function safeMirrorCss(value) {
    const raw = String(value || '');
    if (raw.length > 250000) return '';
    const text = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const normalized = text.replace(/\\([0-9a-f]{1,6})(?:\s)?|\\([^\r\n])/gi, (_, hex, character) => hex ? String.fromCodePoint(Math.min(0x10ffff, parseInt(hex, 16)) || 0xfffd) : character);
    if (/@import|url\s*\(|(?:image(?:-set)?|cross-fade)\s*\(|expression\s*\(|<\/style/i.test(normalized)) return '';
    return text;
  }

  function parseSseFrame(frame) {
    let event = 'message';
    const data = [];
    for (const line of frame.replace(/\r\n/g, '\n').split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (!data.length) return null;
    try { return { event, data: JSON.parse(data.join('\n')) }; } catch (_) { return null; }
  }

  let commandSerial = 0;
  function createCommandId(cryptoProvider = global.crypto) {
    // LAN HTTP is not a secure context on Safari/WebView: randomUUID may be
    // absent. These are replay identities, never authentication capabilities.
    if (typeof cryptoProvider?.randomUUID === 'function') return cryptoProvider.randomUUID();
    if (typeof cryptoProvider?.getRandomValues === 'function') return Array.from(cryptoProvider.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
    return 'operation-' + Date.now().toString(36) + '-' + (++commandSerial).toString(36);
  }

  const helpers = { extractInvite, safeStyleUrl, safeImageUrl, mirrorBodyClass, eventValue, safeMirrorCss, parseSseFrame, createCommandId };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global.document) return;

  const document = global.document;
  const byId = id => document.getElementById(id);
  const state = {
    token: '', peerId: '', approved: false, transport: false, healthy: true, targetPc: '', hostOnline: true,
    revision: 0, snapshotRevision: 0, shownRevision: 0, snapshot: null, shownSnapshot: null, connectionEpoch: 0, commandEpoch: 0,
    eventsAbort: null, reconnectTimer: null, pollTimer: null, reconnectDelay: 1000,
    commandChain: Promise.resolve(), acknowledgements: new Map(), actionBusy: false,
    inputTimers: new Map(), scrollTimers: new Map(), frameDoc: null, suppressScrollUntil: 0,
    restoredScroll: new WeakMap(), refreshing: false,
    lastClickId: '', lastClickAt: 0,
    focusEditing: false, rendering: false, composing: false, pcLayout: false, legacyMode:new URLSearchParams(global.location.search).has('legacy'), toastTimer: null, pendingRenderTimer: null
  };

  function notify(text, error) {
    const toast = byId('remote-toast');
    toast.textContent = text;
    toast.classList.toggle('error', Boolean(error));
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 7000 : 4000);
  }

  function friendlyError(error) {
    return ERROR_MESSAGES[error && error.code] || (error && error.userMessage) || 'PCとの通信を確認できませんでした。表示を更新してから、もう一度操作してください。';
  }

  function invalidateCommands(message) {
    state.commandEpoch++;
    for (const entry of state.acknowledgements.values()) {
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error(message || 'Connection changed'), { userMessage: message }));
    }
    state.acknowledgements.clear();
    for (const timer of state.inputTimers.values()) clearTimeout(timer);
    state.inputTimers.clear();
    for (const timer of state.scrollTimers.values()) clearTimeout(timer);
    state.scrollTimers.clear();
  }

  function updateShell() {
    const connected = state.approved && state.transport && state.healthy && state.hostOnline;
    const hasMirror = Boolean(state.shownSnapshot);
    byId('remote-refresh').disabled = !state.token;
    byId('remote-disconnect').disabled = !state.token;
    byId('remote-layout').hidden = !hasMirror;
    byId('remote-layout').setAttribute('aria-pressed', String(state.pcLayout));
    byId('remote-layout').textContent = state.pcLayout ? 'A1モバイルへ' : '旧PC表示';
    global.CmsRemoteMobile?.setConnected(connected, state.actionBusy);
    byId('remote-view').classList.toggle('pc-layout', state.pcLayout);
    byId('remote-view').dataset.mirrorRevision = String(state.shownRevision);
    byId('remote-view').dataset.receivedRevision = String(state.snapshotRevision);
    byId('remote-view').dataset.editing = String(state.focusEditing);
    byId('remote-connection-dot').classList.toggle('connected', connected);
    byId('remote-status').textContent = connected ? (state.acknowledgements.size ? 'PCへ操作を送信中…' : 'PCと接続中') : !state.token ? '未接続' : !state.approved ? 'PCの承認待ち' : !state.healthy ? '表示の更新が必要です' : '再接続中';
    byId('remote-context-text').textContent = (state.targetPc ? '操作先: '+state.targetPc+' · ' : '') + (connected ? '音声はPCから' : 'PCの再接続を確認しています');
    byId('remote-view-curtain').hidden = !hasMirror || connected;
    byId('remote-curtain-text').textContent = state.healthy ? 'PCとの接続を確認しています…' : '上部の更新ボタンで表示を確認してください';
    if (state.frameDoc) state.frameDoc.documentElement.classList.toggle('cms-remote-disconnected', !connected);
  }

  async function api(path, options = {}) {
    const headers = { 'Accept': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(API + path, {
        method: options.method || 'GET', headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
        body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || 'HTTP_' + response.status);
        error.code = result.error || (response.status === 401 ? 'UNAUTHORIZED' : response.status === 410 ? 'EXPIRED' : 'HTTP_' + response.status);
        error.status = response.status;
        throw error;
      }
      return result;
    } finally { clearTimeout(timer); }
  }

  function showPairing(message) {
    byId('remote-welcome').hidden = false;
    byId('remote-waiting').hidden = true;
    byId('remote-view').hidden = true;
    if (message) notify(message, true);
  }

  function resetConnection(message) {
    state.connectionEpoch++;
    state.eventsAbort?.abort();
    clearTimeout(state.reconnectTimer);
    clearInterval(state.pollTimer);
    invalidateCommands(message);
    state.token = ''; state.peerId = ''; state.approved = false; state.transport = false; state.targetPc = ''; state.hostOnline = true;
    state.healthy = true; state.revision = 0; state.snapshotRevision = 0; state.shownRevision = 0; state.snapshot = null; state.shownSnapshot = null;
    if (state.frameDoc) state.frameDoc.body.replaceChildren();
    state.focusEditing = false; state.composing=false; state.rendering=false;
    state.refreshing=false;
    showPairing(message);
    updateShell();
  }

  async function claim(invite) {
    if (!invite) { notify('PCに表示された接続リンク、または接続コードを入力してください。', true); return; }
    if (state.token) await disconnect(false);
    const epoch = ++state.connectionEpoch;
    byId('remote-connect').disabled = true;
    byId('remote-welcome').hidden = true;
    byId('remote-waiting').hidden = false;
    byId('remote-waiting-title').textContent = 'PCに接続しています';
    byId('remote-waiting-text').textContent = '接続できたら、PC側で接続リクエストを承認してください。';
    try {
      const result = await api('/remote/claim', { method: 'POST', body: { invite, label: byId('remote-device-label').value.trim().slice(0, 60) || 'CMS Remote ブラウザ' } });
      if (epoch !== state.connectionEpoch) return;
      if (typeof result.claimToken !== 'string' || !result.claimToken || typeof result.peerId !== 'string') throw new Error('Invalid claim response');
      state.token = result.claimToken; state.peerId = result.peerId;
      state.approved = result.status === 'approved'; state.healthy = true;
      byId('remote-invite').value = '';
      byId('remote-waiting-title').textContent = 'PCの承認を待っています';
      byId('remote-waiting-text').textContent = 'PCに表示された接続リクエストを承認してください。';
      updateShell();
      startEvents(epoch);
      // Always poll even when a browser exposes a ReadableStream but buffers
      // it indefinitely. Safari must not wait for a stream error to operate.
      state.pollTimer = setInterval(() => { if (state.token) refreshState(false).catch(() => {}); }, 2000);
    } catch (error) {
      if (epoch === state.connectionEpoch) resetConnection(friendlyError(error));
    } finally { byId('remote-connect').disabled = false; }
  }

  async function disconnect(showMessage = true) {
    // Capture authorization in the request, then disable controls immediately even if the PC is offline.
    const request = state.token ? api('/remote/disconnect', { method: 'POST', body: {} }).catch(() => {}) : Promise.resolve();
    resetConnection();
    if (showMessage) notify('このブラウザの接続を解除しました。PCの再生は続きます。');
    await request;
  }

  function handleServerEvent(event, data, fromRefresh = false) {
    if (event === 'revoked' || event === 'expired') { resetConnection('PCとの接続が解除されました。接続するには新しいQRコードを読み取ってください。'); return; }
    if (event === 'approved') {
      if (typeof data.targetPc === 'string') state.targetPc = data.targetPc;
      state.hostOnline = data.hostOnline !== false;
      state.approved = true; state.transport = true; state.reconnectDelay = 1000;
      byId('remote-waiting-title').textContent = 'PCの表示を受信しています';
      byId('remote-waiting-text').textContent = '音声はPCから再生されます。';
      updateShell();
      return;
    }
    if (event === 'status') {
      if (typeof data.targetPc === 'string') state.targetPc = data.targetPc;
      state.hostOnline = data.hostOnline !== false;
      if (data.status === 'approved') { state.approved = true; state.transport = true; }
      if (data.status === 'revoked' || data.status === 'expired') { resetConnection('PCとの接続が解除されました。'); return; }
      updateShell();
      return;
    }
    if (event === 'state') {
      if (!fromRefresh) { state.transport = true; state.reconnectDelay = 1000; }
      const revision = Number(data.revision);
      // A slower refresh response must never roll the mirror back after a newer SSE snapshot.
      if (!Number.isSafeInteger(revision) || revision < state.revision) { updateShell(); return; }
      state.revision = revision;
      const snapshot = data.snapshot;
      if (state.approved && snapshot && typeof snapshot.html === 'string' && snapshot.html.length <= 2097152) {
        state.snapshot = snapshot; state.snapshotRevision = revision;
        renderSnapshot();
      }
      updateShell();
      return;
    }
    if (event === 'ack') {
      if (Number.isSafeInteger(data.revision) && data.revision >= state.revision) state.revision = data.revision;
      const entry = state.acknowledgements.get(data.commandId);
      if (entry) { clearTimeout(entry.timer); state.acknowledgements.delete(data.commandId); entry.resolve(data); }
      updateShell();
    }
  }

  async function refreshState(userInitiated) {
    if (!state.token || state.refreshing && !userInitiated) return;
    const epoch=state.connectionEpoch;
    state.refreshing=true;
    try {
      const result = await api('/remote/state');
      if(epoch!==state.connectionEpoch)return;
      if (typeof result.targetPc === 'string') state.targetPc = result.targetPc;
      state.hostOnline = result.hostOnline !== false;
      if (result.status === 'approved') state.approved = true;
      if (result.status === 'revoked' || result.status === 'expired') { resetConnection('PCとの接続が解除されました。'); return; }
      if (userInitiated) state.healthy = true;
      if (result.status === 'approved') state.transport = true;
      if (result.snapshot) handleServerEvent('state', result, true);
      if (userInitiated && !state.transport) { clearTimeout(state.reconnectTimer); startEvents(state.connectionEpoch); }
      updateShell();
      if (userInitiated) notify(state.approved ? 'PCの表示を更新しました。' : 'PC側の承認を待っています。');
    } catch (error) {
      if(epoch!==state.connectionEpoch)return;
      if (error.status === 401 || error.status === 410) resetConnection(friendlyError(error));
      else { state.transport = false; updateShell(); if (userInitiated) notify(friendlyError(error), true); }
      throw error;
    } finally {if(epoch===state.connectionEpoch)state.refreshing=false;}
  }

  async function startEvents(epoch) {
    if (!state.token || epoch !== state.connectionEpoch) return;
    state.eventsAbort?.abort();
    const controller = new AbortController();
    state.eventsAbort = controller;
    try {
      const response = await fetch(API + '/remote/events', { headers: { 'Accept': 'text/event-stream', Authorization: 'Bearer ' + state.token }, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        const error = Object.assign(new Error(result.error || 'Event stream failed'), { status: response.status, code: result.error });
        throw error;
      }
      if (!response.body) throw new Error('Streaming unavailable');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (epoch !== state.connectionEpoch) return;
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        if (buffer.length > 2500000) throw new Error('Event exceeded limit');
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const parsed = parseSseFrame(buffer.slice(0, end));
          buffer = buffer.slice(end + 2);
          if (parsed) handleServerEvent(parsed.event, parsed.data);
          if (epoch !== state.connectionEpoch) return;
        }
      }
      if (epoch === state.connectionEpoch && !controller.signal.aborted) throw new Error('Event stream closed');
    } catch (error) {
      if (epoch !== state.connectionEpoch || controller.signal.aborted) return;
      if (error.status === 401 || error.status === 410) { resetConnection(friendlyError(error)); return; }
      state.transport = false;
      updateShell();
      // Some Safari/network combinations buffer streams. Authenticated polling
      // uses the same approval and replay checks; commands are never resent.
      clearInterval(state.pollTimer);
      state.pollTimer=setInterval(()=>{if(epoch===state.connectionEpoch && state.token)refreshState(false).catch(()=>{});},1500);
      refreshState(false).catch(()=>{});
    }
  }

  function commandError(result) {
    if (!result) return null;
    const body = result.result;
    if (body && (body.ok === false || body.error)) return Object.assign(new Error(body.error || 'Command failed'), { code: body.error, userMessage: body.message || body.error });
    return null;
  }

  function queueCommand(payload) {
    if (!state.token || !state.approved || !state.transport || !state.healthy || !state.hostOnline) return;
    if (typeof payload.value === 'string' && payload.value.length > MAX_VALUE || payload.selectedValues?.some(value => value.length > MAX_VALUE) || payload.selectedValues?.length > 2000 || new TextEncoder().encode(JSON.stringify(payload)).length > 15000) {
      notify('入力内容が遠隔操作の上限を超えています。内容を短くするか、この操作はPC側で行ってください。途中までの内容は送信しません。', true);
      return;
    }
    const connectionEpoch = state.connectionEpoch;
    const commandEpoch = state.commandEpoch;
    const displayedRevision = state.shownRevision;
    state.commandChain = state.commandChain.catch(() => {}).then(async () => {
      if (connectionEpoch !== state.connectionEpoch || commandEpoch !== state.commandEpoch || !state.transport || !state.healthy || !state.hostOnline) return;
      const commandId = createCommandId();
      let ackEntry;
      const acknowledged = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.acknowledgements.delete(commandId);
          reject(Object.assign(new Error('Command acknowledgement timeout'), { userMessage: 'PCの操作結果を確認できませんでした。操作は再送せず停止しています。上部の更新ボタンで確認してください。' }));
        }, 10000);
        ackEntry = { resolve, reject, timer };
        state.acknowledgements.set(commandId, ackEntry);
        updateShell();
      });
      // Register a rejection handler before starting the request; a disconnect can reject it first.
      acknowledged.catch(() => {});
      try {
        const accepted = await api('/remote/command', { method: 'POST', body: { commandId, revision: displayedRevision, payload } });
        if(connectionEpoch!==state.connectionEpoch)return;
        if (Number.isSafeInteger(accepted.revision) && accepted.revision >= state.revision) state.revision = accepted.revision;
        let ack;
        if (accepted.status === 'done' || accepted.result) { clearTimeout(ackEntry.timer); state.acknowledgements.delete(commandId); ack = accepted; updateShell(); }
        else {
          // ACK delivery must not depend solely on a streaming implementation.
          const poll = setInterval(async () => {
            try {
              const result=await api('/remote/result?commandId='+encodeURIComponent(commandId));
              if(result.status==='done')handleServerEvent('ack',{...result,commandId});
            } catch (_) { /* The bounded ACK timeout remains authoritative. */ }
          }, 800);
          try { ack = await acknowledged; } finally { clearInterval(poll); }
        }
        const failure = commandError(ack);
        if (failure) { await refreshState(false); notify(friendlyError(failure),true); return false; }
        if(payload.kind==='action' && Number.isSafeInteger(ack.revision) && state.snapshotRevision<ack.revision)await refreshState(false);
        return true;
      } catch (error) {
        clearTimeout(ackEntry.timer);
        state.acknowledgements.delete(commandId);
        if (connectionEpoch !== state.connectionEpoch) return;
        invalidateCommands();
        state.healthy = false;
        updateShell();
        notify(friendlyError(error), true);
        return false;
      }
    });
    return state.commandChain;
  }

  function editable(target) {
    return target && (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file', 'hidden'].includes(target.type));
  }

  function controlFor(target) {
    return target && target.closest ? target.closest('[data-cms-remote-control], [data-cms-remote-blocked]') : null;
  }

  function blocked(control) {
    const reason = control?.getAttribute('data-cms-remote-blocked');
    if (reason || control?.disabled || control?.getAttribute('aria-disabled') === 'true') {
      if (reason) notify(reason, true);
      return true;
    }
    return false;
  }

  function flushInputs() {
    for (const [controlId, timer] of state.inputTimers) {
      clearTimeout(timer);
      const target = Array.from(state.frameDoc.querySelectorAll('[data-cms-remote-control]')).find(element => element.getAttribute('data-cms-remote-control') === controlId);
      if (target && !blocked(target)) queueCommand({ controlId, kind: 'input', ...eventValue(target) });
    }
    state.inputTimers.clear();
  }

  function installMirrorEvents(doc) {
    doc.addEventListener('click', event => {
      const target = event.target;
      const control = controlFor(target);
      if (!control) { if (target.closest?.('a')) event.preventDefault(); return; }
      if (blocked(control)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (control.matches('input[type="checkbox"], input[type="radio"], select, textarea, input:not([type="button"]):not([type="submit"])')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const clickId = control.getAttribute('data-cms-remote-control');
      const now = Date.now();
      if (clickId === state.lastClickId && now - state.lastClickAt < 220) return;
      state.lastClickId = clickId; state.lastClickAt = now;
      flushInputs();
      const bounds = control.getBoundingClientRect();
      const payload = { controlId: control.getAttribute('data-cms-remote-control'), kind: 'click' };
      if (bounds.width && bounds.height) {
        payload.ratioX = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
        payload.ratioY = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      }
      queueCommand(payload);
    }, true);

    doc.addEventListener('input', event => {
      const target = event.target;
      const control = controlFor(target);
      if (!control || blocked(control) || ['checkbox', 'radio'].includes(target.type)) return;
      const controlId = control.getAttribute('data-cms-remote-control');
      clearTimeout(state.inputTimers.get(controlId));
      state.inputTimers.set(controlId, setTimeout(() => {
        state.inputTimers.delete(controlId);
        queueCommand({ controlId, kind: 'input', ...eventValue(target) });
      }, target.type === 'range' ? 130 : 280));
    }, true);

    doc.addEventListener('change', event => {
      const target = event.target;
      const control = controlFor(target);
      if (!control || blocked(control)) return;
      flushInputs();
      queueCommand({ controlId: control.getAttribute('data-cms-remote-control'), kind: 'change', ...eventValue(target) });
      if (target.tagName === 'SELECT') {
        state.focusEditing = false;
        clearTimeout(state.pendingRenderTimer);
        state.pendingRenderTimer = setTimeout(renderSnapshot,180);
      }
    }, true);

    doc.addEventListener('submit', event => {
      event.preventDefault();
      const control = controlFor(event.target);
      if (control && !blocked(control)) { flushInputs(); queueCommand({ controlId: control.getAttribute('data-cms-remote-control'), kind: 'submit' }); }
    }, true);

    doc.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); queueCommand({ controlId: 'document', kind: 'keydown', key: 'Escape' }); }
    }, true);

    doc.addEventListener('cancel', event => {
      event.preventDefault();
      queueCommand({ controlId: 'document', kind: 'keydown', key: 'Escape' });
    }, true);

    doc.addEventListener('pointerup', event => {
      if (event.target?.matches?.('input[type="range"]')) {
        flushInputs();
        state.focusEditing = false;
        clearTimeout(state.pendingRenderTimer);
        state.pendingRenderTimer = setTimeout(renderSnapshot, 180);
      }
    }, true);

    doc.addEventListener('compositionstart',()=>{state.composing=true;},true);
    doc.addEventListener('compositionend',()=>{state.composing=false;renderSnapshot();},true);
    doc.addEventListener('focusin', event => { if (!state.rendering && editable(event.target)) state.focusEditing = true; }, true);
    doc.addEventListener('focusout', () => {
      if(state.rendering)return;
      flushInputs();
      clearTimeout(state.pendingRenderTimer);
      state.pendingRenderTimer = setTimeout(() => {
        state.focusEditing = editable(doc.activeElement);
        if (!state.focusEditing) renderSnapshot();
      }, 100);
    }, true);

    doc.addEventListener('scroll', event => {
      const target = event.target;
      if (!target || !target.getAttribute || !target.hasAttribute('data-cms-remote-control') || !target.hasAttribute('data-cms-remote-scroll')) return;
      const restored = state.restoredScroll.get(target);
      if (restored && Math.abs(target.scrollTop-restored[1])<1 && Math.abs(target.scrollLeft-restored[0])<1) return;
      state.restoredScroll.delete(target);
      const controlId = target.getAttribute('data-cms-remote-control');
      clearTimeout(state.scrollTimers.get(controlId));
      const payload={controlId,kind:'scroll',ratioX:target.scrollLeft/Math.max(1,target.scrollWidth-target.clientWidth),ratioY:target.scrollTop/Math.max(1,target.scrollHeight-target.clientHeight)};
      state.scrollTimers.set(controlId, setTimeout(() => {
        state.scrollTimers.delete(controlId);
        queueCommand(payload);
      }, 170));
    }, true);
  }

  function sanitizeMirrorHtml(html, doc) {
    const template = doc.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script,iframe,frame,object,embed,applet,link,meta,base,audio,video,source,track,style').forEach(element => element.remove());
    for (const element of template.content.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || ['srcdoc', 'srcset', 'action', 'formaction', 'autofocus', 'contenteditable', 'download', 'target', 'ping', 'form', 'xlink:href'].includes(name)) element.removeAttribute(attribute.name);
        if (name === 'style' && !safeMirrorCss(attribute.value)) element.removeAttribute('style');
      }
      if (element.hasAttribute('href')) element.removeAttribute('href');
      if (element.hasAttribute('src')) {
        const safe = element.tagName === 'IMG' ? safeImageUrl(element.getAttribute('src'), global.location.origin) : '';
        if (safe) element.setAttribute('src', safe); else element.removeAttribute('src');
      }
      if (element.matches('input[type="file"], input[type="password"], input[type="hidden"]')) {
        element.value = ''; element.removeAttribute('value'); element.disabled = true;
        element.setAttribute('data-cms-remote-blocked', 'ファイル・認証の操作はPC側で行ってください。');
        element.removeAttribute('data-cms-remote-control');
      }
      if (element.hasAttribute('data-cms-remote-blocked')) element.setAttribute('title', element.getAttribute('data-cms-remote-blocked'));
    }
    return template.content;
  }

  const mirrorOverrides = `
    html,body{width:100%!important;min-width:0!important;max-width:100%!important;margin:0!important;overscroll-behavior:contain}
    html.cms-remote-disconnected body{pointer-events:none!important}
    body.cms-remote-mirror{min-height:100dvh!important;--remote-shell:0px}
    body.cms-remote-mirror :is([hidden],.hidden){display:none!important}
    [data-cms-remote-blocked]{cursor:not-allowed!important;opacity:.55!important}
    [data-cms-remote-blocked]::after{font-size:9px}
    :is(.cms-remote-player-placeholder,.cms-remote-player-preview){display:grid;place-items:center;min-height:150px;background:#07121b;color:#cce2ec;overflow:hidden;position:relative}
    :is(.cms-remote-player-placeholder,.cms-remote-player-preview) img{width:100%;height:100%;max-height:250px;object-fit:contain}
    :is(.cms-remote-player-placeholder,.cms-remote-player-preview) span{position:absolute;bottom:8px;background:#091521d9;padding:5px 9px;border-radius:8px;font-size:11px}
    body.cms-remote-mirror.is-mobile #pc-appbar{display:none!important}
    body.cms-remote-mirror.is-mobile #main-app{min-height:100dvh!important;height:auto!important;overflow:visible!important}
    body.cms-remote-mirror.is-mobile #widget-container{display:flex!important;flex-direction:column!important;height:auto!important;min-height:0!important;padding:6px!important;gap:8px!important}
    body.cms-remote-mirror.is-mobile :is(#left-pane,#right-pane){display:contents!important;overflow:visible!important}
    body.cms-remote-mirror.is-mobile :is(#widget-clock,#widget-player,#widget-controls,#widget-library,#widget-folder-list-wrapper){position:relative!important;inset:auto!important;transform:none!important;flex:none!important;align-self:stretch!important}
    body.cms-remote-mirror.is-mobile #widget-player{order:1;position:relative!important;width:100%!important;height:auto!important;aspect-ratio:auto!important;min-height:0!important}
    body.cms-remote-mirror.is-mobile #widget-controls{order:2;width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;margin:0!important}
    body.cms-remote-mirror.is-mobile #widget-clock{order:0;width:100%!important}
    body.cms-remote-mirror.is-mobile #widget-library{order:3;width:100%!important;height:auto!important;min-height:300px!important;margin:0!important;overflow:visible!important}
    body.cms-remote-mirror.is-mobile #widget-library .library-lists-container{flex:none!important;min-height:0!important;max-height:55dvh!important;overflow:hidden!important}
    body.cms-remote-mirror.is-mobile #widget-track-list-wrapper{display:flex!important;flex-direction:column!important;flex:none!important;height:55dvh!important;max-height:55dvh!important;min-height:0!important;overflow:hidden!important}
    body.cms-remote-mirror.is-mobile #widget-track-list{flex:1 1 0!important;height:100%!important;max-height:55dvh!important;min-height:0!important;overflow:auto!important;overscroll-behavior:contain!important}
    body.cms-remote-mirror.is-mobile #widget-folder-list-wrapper{order:4;width:100%!important;height:auto!important;min-height:100px!important;margin:0!important;display:block!important}
    body.cms-remote-mirror.is-mobile #widget-folder-list{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr));height:auto!important;max-height:45dvh!important;overflow:auto!important}
    body.cms-remote-mirror.is-mobile :is(#desktop-pane-resizer,.cms-panel-resizer){display:none!important}
    body.cms-remote-mirror.is-mobile :is(.modal-box,.modal-content){max-width:calc(100vw - 16px)!important;max-height:calc(100dvh - 20px)!important}
    body.cms-remote-mirror.is-mobile #mobile-folder-modal:not(.hidden){display:flex!important;align-items:flex-end!important}
    body.cms-remote-mirror.is-mobile #mobile-folder-modal .settings-window{width:100%!important;max-width:none!important;height:75dvh!important;max-height:75dvh!important;min-height:200px!important;display:flex!important;flex-direction:column!important;padding:0!important;gap:0!important}
    body.cms-remote-mirror.is-mobile #mobile-folder-title{flex:none!important}
    body.cms-remote-mirror.is-mobile #mobile-folder-list-modal{display:block!important;flex:1 1 0!important;min-height:0!important;overflow:auto!important;width:100%!important}
    body.cms-remote-mirror.is-mobile #mobile-folder-list-modal .m-f-item{min-height:48px!important;display:flex!important;align-items:center!important;flex:none!important;visibility:visible!important}
    body.cms-remote-mirror.is-mobile #pocket-overlay{position:fixed!important;inset:0!important;height:100dvh!important;overflow:auto!important}
    body.cms-remote-mirror.is-mobile #pocket-content{min-height:100dvh!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel{display:grid!important;position:relative!important;inset:auto!important;transform:none!important;grid-template-columns:minmax(0,1fr)!important;gap:8px!important;width:min(100%,360px)!important;min-width:0!important;max-width:100%!important;margin:14px auto!important;padding:10px!important;border:1px solid var(--border-color,#33505d)!important;border-radius:12px!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-next-heading{display:block!important;color:var(--theme-accent,#43e2c0)!important;font-size:10px!important;font-weight:700!important;letter-spacing:.12em!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-next-item{display:grid!important;grid-template-columns:40px minmax(0,1fr)!important;align-items:center!important;gap:8px!important;min-height:48px!important;min-width:0!important;width:100%!important;padding:4px!important;background:transparent!important;border:1px solid var(--border-color,#33505d)!important;border-radius:7px!important;color:inherit!important;text-align:left!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-next-item img{width:40px!important;height:40px!important;object-fit:cover!important;border-radius:4px!important;background:rgba(255,255,255,.08)!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-next-item :is(span,strong,small){display:block!important;min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-next-item strong{font-size:12px!important;line-height:1.4!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-next-item small{font-size:10px!important;margin-top:3px!important;opacity:.7!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-quick-slider{display:grid!important;grid-template-columns:24px minmax(0,1fr) 44px!important;align-items:center!important;gap:8px!important;min-height:44px!important;width:100%!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel .pocket-quick-slider input{width:100%!important;min-width:0!important;min-height:36px!important}
    body.cms-remote-mirror.is-mobile #pocket-next-panel output{text-align:right!important;font-size:12px!important;font-variant-numeric:tabular-nums!important}
    body.cms-remote-mirror.is-mobile .cms-rec-tools{position:static!important;inset:auto!important}
    body.cms-remote-mirror.is-mobile .cms-rec-conditions{flex:0 1 auto!important;min-height:32px!important;max-height:34dvh!important;overflow:auto!important}
    body.cms-remote-mirror.is-mobile .cms-rec-body{flex:1 1 160px!important;min-height:120px!important;overflow:auto!important}
    body.cms-remote-mirror input,body.cms-remote-mirror textarea,body.cms-remote-mirror select{font-size:max(16px,1em)}
    body.cms-remote-mirror *,body.cms-remote-mirror *::before,body.cms-remote-mirror *::after{animation:none!important;transition:none!important}
  `;

  function scrollSnapshot(doc) {
    const positions = new Map();
    for (const element of doc.querySelectorAll('[id], [data-cms-remote-control]')) {
      if (!element.scrollTop && !element.scrollLeft) continue;
      const key = element.id ? 'id:' + element.id : 'control:' + element.getAttribute('data-cms-remote-control');
      positions.set(key, [element.scrollLeft, element.scrollTop]);
    }
    return { positions, x: doc.defaultView.scrollX, y: doc.defaultView.scrollY };
  }

  function restoreScroll(doc, saved) {
    state.suppressScrollUntil = Date.now() + 300;
    for (const element of doc.querySelectorAll('[id], [data-cms-remote-control]')) {
      const key = element.id ? 'id:' + element.id : 'control:' + element.getAttribute('data-cms-remote-control');
      const position = saved.positions.get(key);
      if (position) { element.scrollLeft = position[0]; element.scrollTop = position[1]; }
      else {
        const x = Number(element.getAttribute('data-cms-remote-scroll-x'));
        const y = Number(element.getAttribute('data-cms-remote-scroll-y'));
        if (Number.isFinite(x) && x >= 0 && x <= 1) element.scrollLeft = x * Math.max(0, element.scrollWidth - element.clientWidth);
        if (Number.isFinite(y) && y >= 0 && y <= 1) element.scrollTop = y * Math.max(0, element.scrollHeight - element.clientHeight);
      }
      state.restoredScroll.set(element,[element.scrollLeft,element.scrollTop]);
    }
    doc.defaultView.scrollTo(saved.x, saved.y);
  }

  function renderSnapshot() {
    const snapshot = state.snapshot;
    const native=byId('remote-mobile');
    if(snapshot?.mobile && !state.pcLayout && !state.legacyMode && global.CmsRemoteMobile) {
      byId('remote-frame').hidden=true;native.hidden=false;
      state.shownSnapshot=snapshot;state.shownRevision=state.snapshotRevision;
      byId('remote-welcome').hidden=true;byId('remote-waiting').hidden=true;byId('remote-view').hidden=false;
      global.CmsRemoteMobile.update(snapshot.mobile);
      return;
    }
    native.hidden=true;byId('remote-frame').hidden=false;
    const doc = state.frameDoc;
    if (!snapshot || !doc || state.composing) return;
    const active=doc.activeElement;
    if(state.focusEditing && (active?.tagName==='SELECT' || active?.matches?.('input[type=range]')))return;
    const preserved=editable(active)&&active.tagName!=='SELECT'&&!active.matches('input[type=range]')?active:null;
    const caret=preserved?{start:preserved.selectionStart,end:preserved.selectionEnd,direction:preserved.selectionDirection}:null;
    const savedScroll = scrollSnapshot(doc);
    const css = Array.isArray(snapshot.css) ? [...new Set(snapshot.css.map(value => safeStyleUrl(value, global.location.origin)).filter(Boolean))].slice(0, 25) : [];
    const cssKey = css.join('\n');
    if (doc.documentElement.dataset.cssKey !== cssKey) {
      doc.querySelectorAll('link[data-mirror-style]').forEach(element => element.remove());
      for (const href of css) {
        const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.mirrorStyle = 'true';
        doc.head.insertBefore(link, doc.getElementById('mirror-overrides'));
      }
      doc.documentElement.dataset.cssKey = cssKey;
    }
    doc.body.className = mirrorBodyClass(snapshot.bodyClass, state.pcLayout);
    const dynamicStyles = (Array.isArray(snapshot.styles) ? snapshot.styles : [snapshot.styles]).map(safeMirrorCss).filter(Boolean).join('\n').slice(0, 250000);
    let dynamicStyle = doc.getElementById('mirror-dynamic');
    if (!dynamicStyle) { dynamicStyle = doc.createElement('style'); dynamicStyle.id = 'mirror-dynamic'; doc.head.insertBefore(dynamicStyle, doc.getElementById('mirror-overrides')); }
    if (dynamicStyle.textContent !== dynamicStyles) dynamicStyle.textContent = dynamicStyles;
    const bodyStyle = typeof snapshot.bodyStyle === 'string' && snapshot.bodyStyle.length < 20000 ? safeMirrorCss(snapshot.bodyStyle) : '';
    doc.body.setAttribute('style', bodyStyle);
    state.suppressScrollUntil = Date.now() + 300;
    const fragment=sanitizeMirrorHtml(snapshot.html, doc);
    const replacement=preserved&&Array.from(fragment.querySelectorAll('[data-cms-remote-control]')).find(node=>node.getAttribute('data-cms-remote-control')===preserved.getAttribute('data-cms-remote-control')&&!node.hasAttribute('data-cms-remote-blocked'));
    state.rendering=true;
    try {
      if(replacement)replacement.replaceWith(preserved);
      doc.body.replaceChildren(fragment);
      if(replacement){preserved.focus({preventScroll:true});if(caret.start!==null)try{preserved.setSelectionRange(caret.start,caret.end,caret.direction);}catch(_){}}
      else state.focusEditing=false;
    } finally {state.rendering=false;}
    state.shownSnapshot = snapshot; state.shownRevision = state.snapshotRevision;
    byId('remote-welcome').hidden = true;
    byId('remote-waiting').hidden = true;
    byId('remote-view').hidden = false;
    for (const dialog of doc.querySelectorAll('dialog[open]')) {
      dialog.removeAttribute('open');
      try { dialog.showModal(); } catch (_) { dialog.setAttribute('open', ''); }
    }
    restoreScroll(doc, savedScroll);
    updateShell();
  }

  function initializeFrame() {
    const frame = byId('remote-frame');
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc || doc.documentElement.dataset.remoteReady) return;
      doc.documentElement.dataset.remoteReady = 'true';
      state.frameDoc = doc;
      installMirrorEvents(doc);
      renderSnapshot();
      updateShell();
    });
    frame.srcdoc = '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; connect-src \'none\'; style-src \'self\' \'unsafe-inline\'; font-src \'self\' data:; img-src \'self\' data: https:; media-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"><style id="mirror-overrides">' + mirrorOverrides + '</style></head><body></body></html>';
  }

  global.CmsRemoteTransport=Object.freeze({send:async(action,args={})=>{
    // Do not queue controls captured from an old displayed song behind an
    // unfinished operation. Local browsing remains available while awaiting ACK.
    if(state.actionBusy)return false;
    const player=state.shownSnapshot?.mobile?.player;
    const context=player && ['play','next','previous','seek'].includes(action) ? {queueId:player.queueId || null,queueRevision:player.queueRevision ?? null,currentQueueItemId:player.currentQueueItemId || null} : undefined;
    state.actionBusy=true;updateShell();
    try{return await queueCommand({kind:'action',action,args,...(context?{context}:{})});}
    finally{state.actionBusy=false;updateShell();}
  },safeImageUrl:value=>safeImageUrl(value,global.location.origin),notify});
  global.addEventListener('cms-remote-mobile-ready',()=>{renderSnapshot();updateShell();});
  initializeFrame();
  byId('remote-pair-form').addEventListener('submit', event => { event.preventDefault(); claim(extractInvite(byId('remote-invite').value)); });
  byId('remote-refresh').addEventListener('click', () => refreshState(true).catch(() => {}));
  byId('remote-disconnect').addEventListener('click', () => disconnect());
  byId('remote-cancel').addEventListener('click', () => disconnect());
  byId('remote-layout').addEventListener('click', () => { state.pcLayout = !state.pcLayout; state.focusEditing = false; renderSnapshot(); });
  global.addEventListener('online', () => { if (state.token) { clearTimeout(state.reconnectTimer); startEvents(state.connectionEpoch); } });
  global.addEventListener('offline', () => { state.transport = false; invalidateCommands('通信が切断されました。'); updateShell(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.token) refreshState(false).catch(() => {}); });
  const initialInvite = extractInvite(global.location.href);
  if (global.location.hash) global.history.replaceState(null, '', global.location.pathname + global.location.search);
  updateShell();
  if (initialInvite) claim(initialInvite);
})(typeof window === 'undefined' ? globalThis : window);
