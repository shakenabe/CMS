import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  collection, doc, documentId, getDoc, getDocs, getFirestore, increment, limit,
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
const PAGE_SIZE = 400;
const CACHE_DB = 'cms_web_library_v4';
const PLAYBACK_QUEUE_KEY = 'cms_player_playback_queue_v1';
const PLAYBACK_FLUSH_DELAY_MS = 15000;
let currentUser = null;
let syncInFlight = null;
let playbackFlushTimer = null;
let playbackFlushInFlight = null;

function shouldUseRedirectAuth() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function openCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CACHE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
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
  const entries = Object.entries(snapshot)
    .map(([id, value]) => ({
      id,
      playCountDelta: Math.max(0, Math.floor(Number(value?.playCountDelta) || 0)),
      lastPlayedAt: value?.lastPlayedAt || null
    }))
    .filter(entry => entry.id && entry.playCountDelta > 0);
  if (!entries.length) return { status: 'success', sent: 0 };

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
    if (!silent) updateStatus(`Firebase: 再生回数を同期しました（${entries.length}件）`);
    return { status: 'success', sent: entries.length };
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
  schedulePlaybackQueueFlush();
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
  const localIds = new Set(mediaItems.map(item => item.id));
  const existingSnapshot = await getDocs(query(collection(firestore, 'users', uid, 'mediaItems'), orderBy(documentId())));
  const counter = { batch: writeBatch(firestore), count: 0 };
  let tombstoned = 0;
  const queueSet = (ref, value) => {
    counter.batch.set(ref, value, { merge: true });
    counter.count += 1;
  };

  for (const item of mediaItems) {
    queueSet(userDoc(uid, 'mediaItems', item.id), {
      ...cleanFirestoreValue(item),
      deleted: false,
      updatedAt: serverTimestamp()
    });
    if (counter.count >= 420) await commitBatch(counter.batch, counter);
  }

  for (const remoteDoc of existingSnapshot.docs) {
    if (localIds.has(remoteDoc.id)) continue;
    tombstoned += 1;
    queueSet(userDoc(uid, 'mediaItems', remoteDoc.id), {
      deleted: true,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    if (counter.count >= 420) await commitBatch(counter.batch, counter);
  }

  queueSet(userDoc(uid, 'folderSettings', 'main'), {
    data: cleanFirestoreValue(data.folderSettings || []),
    updatedAt: serverTimestamp()
  });
  queueSet(userDoc(uid, 'settings', 'webPlayer'), {
    data: cleanFirestoreValue(data.webSettings || {}),
    updatedAt: serverTimestamp()
  });
  queueSet(userDoc(uid, 'sync', 'meta'), {
    lastChangedAt: serverTimestamp(),
    webUpdatedAt: serverTimestamp()
  });
  await commitBatch(counter.batch, counter);
  await replaceCache({ mediaItems, folderSettings: data.folderSettings || [], webSettings: data.webSettings || {} }, {
    source: 'web-edit',
    remoteMetaAt: Date.now(),
    lastPullAt: Date.now(),
    lastSyncAt: Date.now()
  });
  updateStatus(`Firebase: 保存完了（${mediaItems.length}件）`);
  return { status: 'success', saved: mediaItems.length, tombstoned };
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
    const metaSnapshot = await getDoc(userDoc(currentUser.uid, 'sync', 'meta'));
    const remoteMetaAt = metaSnapshot.data()?.lastChangedAt?.toMillis?.() || 0;
    if (!force && cache.initialized && remoteMetaAt && remoteMetaAt <= (cache.remoteMetaAt || 0)) {
      showLibrary(cache, 'cache', { silent: true });
      updateStatus(`Firebase: 最新（${cache.mediaItems.length}件）`);
      return cache;
    }

    if (!cache.initialized) {
      const full = await fetchAll(currentUser.uid);
      await replaceCache(full, { remoteMetaAt, lastPullAt: full.mediaCursor, lastSyncAt: Date.now() });
    } else {
      const [changes, folders, webSettings] = await Promise.all([
        fetchChanges(currentUser.uid, cache.lastPullAt || 0),
        getDoc(userDoc(currentUser.uid, 'folderSettings', 'main')),
        getDoc(userDoc(currentUser.uid, 'settings', 'webPlayer'))
      ]);
      const newest = changes.reduce((max, item) => Math.max(max, item.updatedAt?.toMillis?.() || 0), cache.lastPullAt || 0);
      await applyDelta(changes, {
        folderSettings: folders.data()?.data || cache.folderSettings || [],
        webSettings: webSettings.data()?.data || cache.webSettings || {}
      }, { remoteMetaAt, lastPullAt: newest, lastSyncAt: Date.now() });
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
    if (shouldUseRedirectAuth()) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.info('[auth] login success', {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName
    });
    return await syncCloud({ force: false, silent: false });
  } catch (error) {
    if (error?.code === 'auth/cancelled-popup-request' || error?.code === 'auth/popup-blocked' || error?.code === 'auth/popup-closed-by-user') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    console.error('[auth] login failed', error);
    updateStatus(`Firebaseエラー: ${error.code || error.message}`);
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

getRedirectResult(auth).catch(error => {
  if (!error) return;
  console.error('[auth] redirect result failed', error);
  updateStatus(`Firebaseエラー: ${error.code || error.message}`);
});
