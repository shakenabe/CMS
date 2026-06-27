import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  collection, doc, documentId, getDoc, getDocs, getFirestore, limit,
  orderBy, query, startAfter, Timestamp, where
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore-lite.js';

const CMS_SAFE_PATCH_VERSION = '20260627';

function loadCmsSafePatch() {
  if (document.getElementById('cms-safe-patch-css')) return;
  const css = document.createElement('link');
  css.id = 'cms-safe-patch-css';
  css.rel = 'stylesheet';
  css.href = `cms-safe-patch-20260627.css?v=${CMS_SAFE_PATCH_VERSION}`;
  document.head.appendChild(css);

  const script = document.createElement('script');
  script.id = 'cms-safe-patch-js';
  script.src = `cms-safe-patch-20260627.js?v=${CMS_SAFE_PATCH_VERSION}`;
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
let currentUser = null;
let syncInFlight = null;

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

function updateStatus(message) {
  for (const id of ['cloud-status-start', 'cloud-status-settings']) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
  }
}

function showLibrary(data, source) {
  if (data.mediaItems?.length) window.CmsWebPlayer?.applyLibrary(data, source);
}

async function syncCloud({ force = false } = {}) {
  if (!currentUser) throw new Error('Googleログインが必要です');
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    updateStatus('Firebase: 更新確認中...');
    const cache = await readCache();
    const metaSnapshot = await getDoc(userDoc(currentUser.uid, 'sync', 'meta'));
    const remoteMetaAt = metaSnapshot.data()?.lastChangedAt?.toMillis?.() || 0;
    if (!force && cache.initialized && remoteMetaAt && remoteMetaAt <= (cache.remoteMetaAt || 0)) {
      showLibrary(cache, 'cache');
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
    showLibrary(updated, 'firebase');
    updateStatus(`Firebase: 読込完了（${updated.mediaItems.length}件・読取専用）`);
    return updated;
  })();
  try { return await syncInFlight; }
  catch (error) { updateStatus(`Firebaseエラー: ${error.code || error.message}`); throw error; }
  finally { syncInFlight = null; }
}

async function login() {
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    console.info('[auth] login success', {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName
    });
    return await syncCloud({ force: false });
  } catch (error) {
    console.error('[auth] login failed', error);
    updateStatus(`Firebaseエラー: ${error.code || error.message}`);
    throw error;
  }
}

window.CmsWebFirebase = {
  login,
  sync: () => syncCloud({ force: true }),
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
  bind('btn-load-firebase', () => syncCloud({ force: true }));
  bind('btn-cloud-signout', () => signOut(auth));
  try {
    const cache = await readCache();
    showLibrary(cache, 'cache');
    if (cache.mediaItems?.length) updateStatus(`ローカルキャッシュ: ${cache.mediaItems.length}件`);
  } catch (_) {}
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) { updateStatus('Firebase: 未接続（JSONのみでも利用できます）'); return; }
  updateStatus(`Firebase: ${user.email || 'ログイン済み'}（読取専用）`);
  if (window.CmsWebPlayer?.getUseFirebase()) await syncCloud({ force: false }).catch(() => {});
});

setInterval(() => {
  if (currentUser && window.CmsWebPlayer?.getUseFirebase()) void syncCloud({ force: false });
}, 10 * 60 * 1000);
