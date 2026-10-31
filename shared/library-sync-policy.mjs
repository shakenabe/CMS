/* Pure addition-outbox rules. This is not a library snapshot or deletion log. */
export const LIBRARY_ADDITIONS_KEY = 'cms_web_library_additions_v1';

export function cleanLibraryAddition(item) {
  if (!item || typeof item.id !== 'string' || !item.id || typeof item.url !== 'string'
      || !['youtube', 'niconico'].includes(item.site)) throw new Error('追加する動画情報を確認してください。');
  const { originalIndex, safeDate, safePlayCount, updatedAt, deleted, deletedAt,
    _cmsQueueId, _cmsQueueItemId, _cmsPlayContext, ...value } = item;
  return JSON.parse(JSON.stringify(value));
}

export function readAdditionOutbox(storage) {
  const raw = storage.getItem(LIBRARY_ADDITIONS_KEY);
  if (!raw) return { version: 1, entries: [] };
  // Never silently erase an unreadable pending journal.
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.entries)) throw new Error('未送信の動画記録を読み込めません。データを保持したまま再試行してください。');
  return value;
}

export function enqueueAdditions(storage, items, folderSettings = []) {
  const journal = readAdditionOutbox(storage);
  const entries = new Map(journal.entries.map(entry => [entry.item.id, entry]));
  for (const item of items) {
    const clean = cleanLibraryAddition(item);
    const old = entries.get(clean.id);
    entries.set(clean.id, { item: clean, queuedAt: old?.queuedAt || Date.now(),
      token: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
      folders: (folderSettings || []).filter(folder => (clean.folders || [clean.folder]).includes(folder.folderName)) });
  }
  const next = { version: 1, entries: [...entries.values()] };
  storage.setItem(LIBRARY_ADDITIONS_KEY, JSON.stringify(next));
  return next;
}

export function acknowledgeAddition(storage, submitted) {
  const journal = readAdditionOutbox(storage);
  journal.entries = journal.entries.filter(entry => entry.item.id !== submitted.item.id || entry.token !== submitted.token);
  storage.setItem(LIBRARY_ADDITIONS_KEY, JSON.stringify(journal));
  return journal;
}

export function overlayAdditions(data, entries) {
  const byId = new Map((data.mediaItems || []).map(item => [item.id, item]));
  const folders = [...(data.folderSettings || [])];
  const folderNames = new Set(folders.map(folder => folder.folderName));
  for (const entry of entries || []) {
    // A cloud copy wins once present, preserving counts changed by other devices.
    if (!byId.has(entry.item.id)) byId.set(entry.item.id, entry.item);
    for (const name of entry.item.folders || [entry.item.folder]) {
      if (!name || folderNames.has(name)) continue;
      const supplied = entry.folders?.find(folder => folder.folderName === name);
      folders.push({ ...(supplied || {}), folderName: name, order: folders.length });
      folderNames.add(name);
    }
  }
  return { ...data, mediaItems: [...byId.values()], folderSettings: folders };
}

export function mergeAdditionFolders(existing, additions) {
  const merged = [...(Array.isArray(existing) ? existing : [])];
  const names = new Set(merged.map(folder => folder.folderName));
  for (const supplied of additions || []) {
    if (!supplied?.folderName || names.has(supplied.folderName)) continue;
    merged.push({ ...supplied, order: merged.length });
    names.add(supplied.folderName);
  }
  return merged;
}

export function libraryFieldPatch(item, baseline) {
  const { originalIndex, safeDate, safePlayCount, updatedAt, deleted, deletedAt,
    _cmsQueueId, _cmsQueueItemId, _cmsPlayContext, ...stored } = item || {};
  const next = JSON.parse(JSON.stringify(stored));
  if (!baseline) return next;
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const patch = {};
  for (const [key, value] of Object.entries(next)) {
    // Playback has its own idempotent event/counter pipeline. An old editor's
    // snapshot must never replace a count written by another device.
    if (['id', 'playCount', 'lastPlayedAt', '_cmsRecommendationCountManaged'].includes(key)) continue;
    if (JSON.stringify(stable(value)) !== JSON.stringify(stable(baseline[key]))) patch[key] = value;
  }
  return patch;
}
