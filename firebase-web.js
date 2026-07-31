import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  arrayUnion, collection, doc, documentId, getDoc, getDocs, getFirestore, increment, limit,
  orderBy, query, serverTimestamp, startAfter, Timestamp, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore-lite.js';

const CMS_SAFE_PATCH_VERSION = '2026062704';

function loadCmsSafePatch() {
  if (document.getElementById('cms-safe-patch-css')) return;
  const css = document.createElement('link');
  css.id = 'cms-safe-patch-css';
  css.rel = 'stylesheet';
  css.href = `cms-runtime-20260627.css?v=${CMS_SAFE_PATCH_VERSION}`;
  document.head.appendChild(css);

  const script = document.createElement('script');
  script.id = 'cms-safe-patch-js';
  script.src = `cms-runtime-20260627.js?v=${CMS_SAFE_PATCH_VERSION}`;
  script.defer = true;
  document.head.appendChild(script);
}

loadCmsSafePatch();

const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyBEHDu0Y8Gnu-Cf9bkgIcrJ9HhL1OYJGUY',
  authDomain: 'cms-sync-test.firebaseapp.com',
  projectId: 'cms-sync-test',
  storageBucket: 'cms-sync-test.firebasestorage.app',
  messagingSenderId: '187347469414',
  appId: '1:187347469414:web:0d17b0657fd8be4c34d9a7'
});

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
const PAGE_SIZE = 400;
const CACHE_DB = 'cms_web_library_v4';
const PLAYBACK_QUEUE_KEY = 'cms_player_playback_queue_v1';
const PLAYBACK_HISTORY_QUEUE_KEY = 'cms_player_playback_history_queue_v1';
const PLAYBACK_FLUSH_DELAY_MS = 2 * 60 * 1000;
const PLAYBACK_FLUSH_MAX_PENDING = 5;
const PLAYBACK_HISTORY_MAX_LOCAL = 2000;
let currentUser = null;
let syncInFlight = null;
let playbackFlushTimer = null;
let playbackFlushInFlight = null;

function openCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cloudMedia')) db.createObjectStore('cloudMedia', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCache() {
  const db = await openCache();
  const tx = db.transaction(['media', 'state'], 'readonly');
  const mediaRequest = tx.objectStore('media').getAll();
  const stateRequest = tx.objectStore('state').get('library');
  const [mediaItems, state] = await Promise.all([requestValue(mediaRequest), requestValue(stateRequest)]);
  await transactionDone(tx);
  db.close();
  return { mediaItems: mediaItems || [], ...(state?.value || {}) };
}

async function readCloudBaseline() {
  const db = await openCache();
  const tx = db.transaction(['cloudMedia', 'state'], 'readonly');
  const mediaRequest = tx.objectStore('cloudMedia').getAll();
  const stateRequest = tx.objectStore('state').get('cloudBaseline');
  const [mediaItems, state] = await Promise.all([requestValue(mediaRequest), requestValue(stateRequest)]);
  await transactionDone(tx);
  db.close();
  return { mediaItems: mediaItems || [], ...(state?.value || {}) };
}

async function replaceCache(data, syncState = {}) {
  const db = await openCache();
  const tx = db.transaction(['media', 'state'], 'readwrite');
  const media = tx.objectStore('media');
  media.clear();
  for (const item of (data.mediaItems || [])) {
    if (item?.id && item.site !== 'system' && !item.deleted) media.put(item);
  }
  tx.objectStore('state').put({
    key: 'library',
    value: {
      folderSettings: data.folderSettings || [],
      webSettings: data.webSettings || {},
      initialized: true,
      ...syncState
    }
  });
  await transactionDone(tx);
  db.close();
}

async function replaceCloudBaseline(data, syncState = {}) {
  const db = await openCache();
  const tx = db.transaction(['cloudMedia', 'state'], 'readwrite');
  const media = tx.objectStore('cloudMedia');
  media.clear();
  for (const item of (data.mediaItems || [])) {
    if (item?.id && item.site !== 'system' && !item.deleted) media.put(stripRuntimeFields(item));
  }
  tx.objectStore('state').put({
    key: 'cloudBaseline',
    value: {
      folderSettings: data.folderSettings || [],
      webSettings: data.webSettings || {},
      initialized: true,
      ...syncState
    }
  });
  await transactionDone(tx);
  db.close();
}

async function applyDelta(changes, auxiliary, syncState) {
  const db = await openCache();
  const tx = db.transaction(['media', 'state'], 'readwrite');
  const media = tx.objectStore('media');
  for (const item of changes) {
    if (!item?.id) continue;
    if (item.deleted || item.site === 'system') media.delete(item.id);
    else {
      const cachedItem = { ...item };
      delete cachedItem.updatedAt;
      delete cachedItem.deleted;
      delete cachedItem.deletedAt;
      media.put(cachedItem);
    }
  }
  tx.objectStore('state').put({ key: 'library', value: {
    ...auxiliary,
    initialized: true,
    ...syncState
  }});
  await transactionDone(tx);
  db.close();
}

async function applyCloudBaselineDelta(changes, auxiliary, syncState) {
  const db = await openCache();
  const tx = db.transaction(['cloudMedia', 'state'], 'readwrite');
  const media = tx.objectStore('cloudMedia');
  for (const item of changes) {
    if (!item?.id) continue;
    if (item.deleted || item.site === 'system') media.delete(item.id);
    else media.put(stripRuntimeFields(item));
  }
  const stateStore = tx.objectStore('state');
  const current = await requestValue(stateStore.get('cloudBaseline'));
  stateStore.put({
    key: 'cloudBaseline',
    value: {
      ...(current?.value || {}),
      ...auxiliary,
      initialized: true,
      ...syncState
    }
  });
  await transactionDone(tx);
  db.close();
}

async function applySavedLibraryDelta(changedItems, deletedIds, data, syncState) {
  const db = await openCache();
  const tx = db.transaction(['media', 'cloudMedia', 'state'], 'readwrite');
  const localMedia = tx.objectStore('media');
  const cloudMedia = tx.objectStore('cloudMedia');
  for (const id of deletedIds) {
    localMedia.delete(id);
    cloudMedia.delete(id);
  }
  for (const item of changedItems) {
    localMedia.put(item);
    cloudMedia.put(item);
  }
  const stateStore = tx.objectStore('state');
  const localState = await requestValue(stateStore.get('library'));
  const cloudState = await requestValue(stateStore.get('cloudBaseline'));
  const shared = {
    folderSettings: data.folderSettings || [],
    webSettings: data.webSettings || {},
    initialized: true,
    ...syncState
  };
  stateStore.put({ key: 'library', value: { ...(localState?.value || {}), ...shared } });
  stateStore.put({ key: 'cloudBaseline', value: { ...(cloudState?.value || {}), ...shared } });
  await transactionDone(tx);
  db.close();
}

async function updateCachedPlayback(item) {
  if (!item?.id) return;
  const db = await openCache();
  const tx = db.transaction('media', 'readwrite');
  const media = tx.objectStore('media');
  const cached = await requestValue(media.get(item.id));
  if (cached) {
    media.put({
      ...cached,
      playCount: Number(item.playCount) || 0,
      safePlayCount: Number(item.playCount) || 0,
      lastPlayedAt: item.lastPlayedAt || cached.lastPlayedAt || null
    });
  }
  await transactionDone(tx);
  db.close();
}

function readPlaybackQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(PLAYBACK_QUEUE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function writePlaybackQueue(queue) {
  localStorage.setItem(PLAYBACK_QUEUE_KEY, JSON.stringify(queue || {}));
}

function readPlaybackHistoryQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(PLAYBACK_HISTORY_QUEUE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function writePlaybackHistoryQueue(events) {
  localStorage.setItem(
    PLAYBACK_HISTORY_QUEUE_KEY,
    JSON.stringify((Array.isArray(events) ? events : []).slice(-PLAYBACK_HISTORY_MAX_LOCAL))
  );
}

function createPlaybackHistoryEvent(item) {
  const playedAt = item?.lastPlayedAt || new Date().toISOString();
  const eventId = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  return {
    eventId,
    mediaId: String(item?.id || '').slice(0, 200),
    title: String(item?.title || '').slice(0, 180),
    url: String(item?.url || '').slice(0, 700),
    site: String(item?.site || '').slice(0, 30),
    folder: String(item?.folder || item?.folders?.[0] || '').slice(0, 120),
    playedAt,
    source: 'web'
  };
}

function appendPlaybackHistory(item) {
  if (!item?.id) return 0;
  const events = readPlaybackHistoryQueue();
  events.push(createPlaybackHistoryEvent(item));
  writePlaybackHistoryQueue(events);
  return Math.min(events.length, PLAYBACK_HISTORY_MAX_LOCAL);
}

function playbackHistoryBucketId(playedAt) {
  const date = new Date(playedAt);
  const validDate = Number.isFinite(date.getTime()) ? date : new Date();
  return validDate.toISOString().slice(0, 13).replace(/[-T]/g, '');
}

function groupPlaybackHistoryByHour(events) {
  const groups = new Map();
  for (const event of events) {
    if (!event?.eventId || !event?.mediaId) continue;
    const bucketId = playbackHistoryBucketId(event.playedAt);
    if (!groups.has(bucketId)) groups.set(bucketId, []);
    groups.get(bucketId).push(event);
  }
  return [...groups.entries()].map(([bucketId, bucketEvents]) => ({ bucketId, events: bucketEvents }));
}

function removeSentPlaybackHistory(sentEvents) {
  const sentIds = new Set(sentEvents.map(event => event.eventId));
  if (!sentIds.size) return;
  writePlaybackHistoryQueue(readPlaybackHistoryQueue().filter(event => !sentIds.has(event?.eventId)));
}

function pendingPlaybackCount() {
  const playCountPending = Object.values(readPlaybackQueue())
    .reduce((sum, value) => sum + Math.max(0, Math.floor(Number(value?.playCountDelta) || 0)), 0);
  return Math.max(playCountPending, readPlaybackHistoryQueue().length);
}

function canSyncPlaybackQueue() {
  return Boolean(currentUser && window.CmsWebPlayer?.getUseFirebase?.());
}

function removeSentPlaybackEntries(sentEntries) {
  const latest = readPlaybackQueue();
  for (const sent of sentEntries) {
    const current = latest[sent.id];
    if (!current) continue;
    const remaining = Math.max(0, (Number(current.playCountDelta) || 0) - sent.playCountDelta);
    if (remaining > 0) latest[sent.id] = { ...current, playCountDelta: remaining };
    else delete latest[sent.id];
  }
  writePlaybackQueue(latest);
}

async function flushPlaybackQueue({ silent = true } = {}) {
  if (playbackFlushInFlight) return playbackFlushInFlight;
  if (!canSyncPlaybackQueue()) return { status: 'skipped', reason: 'firebase-disabled' };
  const snapshot = readPlaybackQueue();
  const historySnapshot = readPlaybackHistoryQueue();
  const entries = Object.entries(snapshot)
    .map(([id, value]) => ({
      id,
      playCountDelta: Math.max(0, Math.floor(Number(value?.playCountDelta) || 0)),
      lastPlayedAt: value?.lastPlayedAt || null
    }))
    .filter(entry => entry.id && entry.playCountDelta > 0);
  const historyGroups = groupPlaybackHistoryByHour(historySnapshot);
  if (!entries.length && !historyGroups.length) return { status: 'success', sent: 0, historySent: 0 };

  playbackFlushInFlight = (async () => {
    const uid = currentUser.uid;
    for (let offset = 0; offset < entries.length; offset += 400) {
      const chunk = entries.slice(offset, offset + 400);
      const batch = writeBatch(firestore);
      for (const entry of chunk) {
        batch.set(userDoc(uid, 'mediaItems', entry.id), {
          playCount: increment(entry.playCountDelta),
          lastPlayedAt: entry.lastPlayedAt,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
      batch.set(userDoc(uid, 'sync', 'meta'), {
        lastChangedAt: serverTimestamp(),
        webPlaybackUpdatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      // Clear only the committed delta. New plays added during the request stay queued.
      removeSentPlaybackEntries(chunk);
    }
    for (let offset = 0; offset < historyGroups.length; offset += 400) {
      const chunk = historyGroups.slice(offset, offset + 400);
      const batch = writeBatch(firestore);
      for (const group of chunk) {
        batch.set(userDoc(uid, 'playbackHistory', group.bucketId), {
          schemaVersion: 1,
          bucketId: group.bucketId,
          events: arrayUnion(...group.events),
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
      batch.set(userDoc(uid, 'sync', 'meta'), {
        webPlaybackHistoryUpdatedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      // eventId is stable, so a retry cannot duplicate an already appended history event.
      removeSentPlaybackHistory(chunk.flatMap(group => group.events));
    }
    if (!silent) updateStatus(`Firebase: 再生回数を同期しました（${entries.length}件）`);
    return { status: 'success', sent: entries.length, historySent: historySnapshot.length };
  })();

  try {
    return await playbackFlushInFlight;
  } catch (error) {
    if (!silent) updateStatus(`Firebase再生回数エラー: ${error.code || error.message}`);
    throw error;
  } finally {
    playbackFlushInFlight = null;
  }
}

function schedulePlaybackQueueFlush(delay = PLAYBACK_FLUSH_DELAY_MS) {
  clearTimeout(playbackFlushTimer);
  if (!canSyncPlaybackQueue()) return;
  playbackFlushTimer = setTimeout(() => {
    playbackFlushTimer = null;
    flushPlaybackQueue({ silent: true }).catch(error => console.error('[firebase-playback] flush failed', error));
  }, Math.max(0, delay));
}

function queuePlaybackUpdate(item) {
  updateCachedPlayback(item).catch(error => console.error('[firebase-playback] cache update failed', error));
  // Playback history is a cloud feature only while Firebase auto update is enabled.
  if (!window.CmsWebPlayer?.getUseFirebase?.()) return;
  appendPlaybackHistory(item);
  schedulePlaybackQueueFlush(pendingPlaybackCount() >= PLAYBACK_FLUSH_MAX_PENDING ? 0 : PLAYBACK_FLUSH_DELAY_MS);
}

function userDoc(uid, group, id) {
  return doc(firestore, 'users', uid, group, id);
}

async function fetchAll(uid) {
  const mediaItems = [];
  let cursor = null;
  let mediaCursor = 0;
  while (true) {
    const constraints = [orderBy(documentId()), limit(PAGE_SIZE)];
    if (cursor) constraints.splice(1, 0, startAfter(cursor));
    const snapshot = await getDocs(query(collection(firestore, 'users', uid, 'mediaItems'), ...constraints));
    for (const remoteDoc of snapshot.docs) {
      const item = { id: remoteDoc.id, ...remoteDoc.data() };
      mediaCursor = Math.max(mediaCursor, item.updatedAt?.toMillis?.() || 0);
      delete item.updatedAt;
      mediaItems.push(item);
    }
    if (snapshot.size < PAGE_SIZE) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  const [folders, webSettings] = await Promise.all([
    getDoc(userDoc(uid, 'folderSettings', 'main')),
    getDoc(userDoc(uid, 'settings', 'webPlayer'))
  ]);
  return {
    mediaItems,
    folderSettings: folders.data()?.data || [],
    webSettings: webSettings.data()?.data || {},
    mediaCursor,
    auxiliaryCursor: Math.max(
      folders.data()?.updatedAt?.toMillis?.() || 0,
      webSettings.data()?.updatedAt?.toMillis?.() || 0
    )
  };
}

async function fetchChanges(uid, sinceMillis) {
  const changes = [];
  const since = Math.max(0, Number(sinceMillis) - 5000);
  let cursor = null;
  while (true) {
    const constraints = [
      where('updatedAt', '>=', Timestamp.fromMillis(since)),
      orderBy('updatedAt'), orderBy(documentId()), limit(PAGE_SIZE)
    ];
    if (cursor) constraints.splice(3, 0, startAfter(cursor));
    const snapshot = await getDocs(query(collection(firestore, 'users', uid, 'mediaItems'), ...constraints));
    snapshot.docs.forEach(remoteDoc => changes.push({ id: remoteDoc.id, ...remoteDoc.data() }));
    if (snapshot.size < PAGE_SIZE) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  return changes;
}

function cleanFirestoreValue(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function stableFirestoreValue(value) {
  if (Array.isArray(value)) return value.map(stableFirestoreValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    const next = value[key];
    if (next !== undefined) result[key] = stableFirestoreValue(next);
    return result;
  }, {});
}

function firestoreFingerprint(value) {
  return JSON.stringify(stableFirestoreValue(cleanFirestoreValue(value)));
}

function stripRuntimeFields(item) {
  const { originalIndex, safeDate, safePlayCount, updatedAt, deleted, deletedAt, ...rest } = item || {};
  return rest;
}

async function commitBatch(batch, counter) {
  if (counter.count <= 0) return;
  await batch.commit();
  counter.count = 0;
  counter.batch = writeBatch(firestore);
}

async function saveLibrarySnapshot(data = {}) {
  if (!currentUser) throw new Error('Googleログインが必要です');
  const uid = currentUser.uid;
  const mediaItems = (Array.isArray(data) ? data : (data.mediaItems || []))
    .filter(item => item?.id && item.site !== 'system')
    .map(stripRuntimeFields);
  let baseline = await readCloudBaseline();
  if (!baseline.initialized) {
    updateStatus('Firebase: 初回のみ差分基準を作成中...');
    const full = await fetchAll(uid);
    const baselineState = {
      remoteMetaAt: Date.now(),
      lastPullAt: full.mediaCursor,
      lastSyncAt: Date.now()
    };
    await replaceCloudBaseline(full, baselineState);
    baseline = { ...full, ...baselineState, initialized: true };
  }

  const localIds = new Set(mediaItems.map(item => item.id));
  const baselineById = new Map((baseline.mediaItems || []).map(item => [item.id, item]));
  const changedItems = mediaItems.filter(item => {
    const previous = baselineById.get(item.id);
    return !previous || firestoreFingerprint(previous) !== firestoreFingerprint(item);
  });
  const deletedIds = (baseline.mediaItems || [])
    .filter(item => item?.id && !localIds.has(item.id))
    .map(item => item.id);
  const folderSettingsChanged = firestoreFingerprint(baseline.folderSettings || []) !== firestoreFingerprint(data.folderSettings || []);
  const webSettingsChanged = firestoreFingerprint(baseline.webSettings || {}) !== firestoreFingerprint(data.webSettings || {});

  if (!changedItems.length && !deletedIds.length && !folderSettingsChanged && !webSettingsChanged) {
    updateStatus(`Firebase: 変更なし（${mediaItems.length}件）`);
    return { status: 'success', saved: 0, tombstoned: 0, unchanged: true };
  }

  const counter = { batch: writeBatch(firestore), count: 0 };
  const queueSet = (ref, value) => {
    counter.batch.set(ref, value, { merge: true });
    counter.count += 1;
  };

  for (const item of changedItems) {
    queueSet(userDoc(uid, 'mediaItems', item.id), {
      ...cleanFirestoreValue(item),
      deleted: false,
      updatedAt: serverTimestamp()
    });
    if (counter.count >= 420) await commitBatch(counter.batch, counter);
  }

  for (const id of deletedIds) {
    queueSet(userDoc(uid, 'mediaItems', id), {
      deleted: true,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    if (counter.count >= 420) await commitBatch(counter.batch, counter);
  }

  if (folderSettingsChanged) {
    queueSet(userDoc(uid, 'folderSettings', 'main'), {
      data: cleanFirestoreValue(data.folderSettings || []),
      updatedAt: serverTimestamp()
    });
  }
  if (webSettingsChanged) {
    queueSet(userDoc(uid, 'settings', 'webPlayer'), {
      data: cleanFirestoreValue(data.webSettings || {}),
      updatedAt: serverTimestamp()
    });
  }
  queueSet(userDoc(uid, 'sync', 'meta'), {
    lastChangedAt: serverTimestamp(),
    webUpdatedAt: serverTimestamp()
  });
  await commitBatch(counter.batch, counter);
  await applySavedLibraryDelta(changedItems, deletedIds, data, {
    source: 'web-edit',
    remoteMetaAt: Date.now(),
    lastPullAt: Date.now(),
    lastSyncAt: Date.now()
  });
  updateStatus(`Firebase: 差分保存完了（更新 ${changedItems.length}件・削除 ${deletedIds.length}件）`);
  return { status: 'success', saved: changedItems.length, tombstoned: deletedIds.length };
}

function updateStatus(message) {
  for (const id of ['cloud-status-start', 'cloud-status-settings']) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
  }
}

function showLibrary(data, source, options = {}) {
  if (data.mediaItems?.length) window.CmsWebPlayer?.applyLibrary(data, source, options);
}

async function syncCloud({ force = false, silent = false } = {}) {
  if (!currentUser) throw new Error('Googleログインが必要です');
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    updateStatus('Firebase: 更新確認中...');
    await flushPlaybackQueue({ silent: true });
    const cache = await readCache();
    const cloudBaseline = await readCloudBaseline();
    const metaSnapshot = await getDoc(userDoc(currentUser.uid, 'sync', 'meta'));
    const remoteMetaAt = metaSnapshot.data()?.lastChangedAt?.toMillis?.() || 0;
    if (!force && cache.initialized && cloudBaseline.initialized && remoteMetaAt && remoteMetaAt <= (cache.remoteMetaAt || 0)) {
      showLibrary(cache, 'cache', { silent: true });
      updateStatus(`Firebase: 最新（${cache.mediaItems.length}件）`);
      return cache;
    }

    if (!cache.initialized || !cloudBaseline.initialized) {
      const full = await fetchAll(currentUser.uid);
      const syncState = { remoteMetaAt, lastPullAt: full.mediaCursor, lastSyncAt: Date.now() };
      await Promise.all([
        replaceCache(full, syncState),
        replaceCloudBaseline(full, syncState)
      ]);
    } else {
      const [changes, folders, webSettings] = await Promise.all([
        fetchChanges(currentUser.uid, cache.lastPullAt || 0),
        getDoc(userDoc(currentUser.uid, 'folderSettings', 'main')),
        getDoc(userDoc(currentUser.uid, 'settings', 'webPlayer'))
      ]);
      const newest = changes.reduce((max, item) => Math.max(max, item.updatedAt?.toMillis?.() || 0), cache.lastPullAt || 0);
      const auxiliary = {
        folderSettings: folders.data()?.data || cache.folderSettings || [],
        webSettings: webSettings.data()?.data || cache.webSettings || {}
      };
      const syncState = { remoteMetaAt, lastPullAt: newest, lastSyncAt: Date.now() };
      await Promise.all([
        applyDelta(changes, auxiliary, syncState),
        applyCloudBaselineDelta(changes, auxiliary, syncState)
      ]);
    }
    const updated = await readCache();
    showLibrary(updated, 'firebase', { silent });
    updateStatus(`Firebase: 読込完了（${updated.mediaItems.length}件・再生回数同期可）`);
    return updated;
  })();
  try { return await syncInFlight; }
  catch (error) { updateStatus(`Firebaseエラー: ${error.code || error.message}`); throw error; }
  finally { syncInFlight = null; }
}

async function login() {
  try {
    updateStatus('Firebase: Googleログイン画面を開いています…');
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.info('[auth] login success', {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName
    });
    return await syncCloud({ force: false, silent: false });
  } catch (error) {
    if (error?.code === 'auth/popup-blocked') {
      updateStatus('Firebase: ポップアップがブロックされました。Safariのポップアップを許可して、もう一度お試しください。');
    } else if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
      updateStatus('Firebase: Googleログインがキャンセルされました。');
    } else if (error?.code === 'auth/web-storage-unsupported') {
      updateStatus('Firebase: SafariのCookie/サイトデータが無効です。通常タブで開き、サイトデータを許可してください。');
    } else {
      updateStatus(`Firebaseエラー: ${error.code || error.message}`);
    }
    console.error('[auth] login failed', error);
    throw error;
  }
}

window.CmsWebFirebase = {
  login,
  sync: (options = {}) => syncCloud({ force: true, silent: false, ...options }),
  saveLibrary: saveLibrarySnapshot,
  queuePlaybackUpdate,
  flushPlaybackQueue,
  logout: () => signOut(auth),
  cacheImportedData: data => replaceCache({
    mediaItems: Array.isArray(data) ? data : (data.mediaItems || []),
    folderSettings: data.folderSettings || [],
    webSettings: data.webSettings || {}
  }, { source: 'json', remoteMetaAt: 0, lastPullAt: 0, lastSyncAt: Date.now() })
};

document.addEventListener('DOMContentLoaded', async () => {
  const bind = (id, handler) => document.getElementById(id)?.addEventListener('click', () => {
    handler().catch(error => console.error(`[firebase-ui] ${id}`, error));
  });
  bind('btn-cloud-login', login);
  bind('btn-cloud-login-settings', login);
  bind('btn-load-firebase', () => syncCloud({ force: true, silent: false }));
  bind('btn-cloud-signout', () => signOut(auth));
  try {
    const cache = await readCache();
    showLibrary(cache, 'cache', { silent: true });
    if (cache.mediaItems?.length) updateStatus(`ローカルキャッシュ: ${cache.mediaItems.length}件`);
  } catch (_) {}
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) { updateStatus('Firebase: 未接続（JSONのみでも利用できます）'); return; }
  updateStatus(`Firebase: ${user.email || 'ログイン済み'}（再生回数同期可）`);
  schedulePlaybackQueueFlush(1000);
  if (window.CmsWebPlayer?.getUseFirebase()) await syncCloud({ force: false, silent: true }).catch(() => {});
});

setInterval(() => {
  if (currentUser && window.CmsWebPlayer?.getUseFirebase()) void syncCloud({ force: false, silent: true });
}, 10 * 60 * 1000);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !canSyncPlaybackQueue()) return;
  clearTimeout(playbackFlushTimer);
  playbackFlushTimer = null;
  flushPlaybackQueue({ silent: true }).catch(error => console.error('[firebase-playback] background flush failed', error));
});
