/* Dedicated, user-scoped state. A counted play is one IndexedDB transaction,
 * including the legacy media counter; no localStorage increment queue is used. */
(function (global) {
    'use strict';
    const DB_NAME = 'cms_web_library_v4', DB_VERSION = 3;
    const OWNER_UID = 'Kt8r2xqtrZavgowOEYA4mNVQc8J2';
    const STORE = 'recommendationData';
    const uuid = () => crypto.randomUUID();
    const keyOf = value => global.CMSRecommendationEngine.normalizeContentKey(value);
    const namespace = () => global.CmsWebPlayer?.getUseFirebase?.() ? `user:${OWNER_UID}` : 'local';
    const clone = value => JSON.parse(JSON.stringify(value));
    let envelope = null, envelopeNamespace = null;
    function open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of ['media', 'cloudMedia']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
                if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'key' });
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            request.onblocked = () => reject(new Error('別のCMSタブを閉じ、保存領域の更新を再試行してください。'));
        });
    }
    function value(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
    function done(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('保存が中断されました')); }); }
    function fresh(ns) {
        return { schemaVersion: 1, owner: ns, migration: null, preferences: {}, history: [], events: {}, mutations: {}, folders: [], folderOutbox: {}, diagnostics: [], queues: [], activeQueue: null, attempt: null, sessionRecentContentKeys: [] };
    }
    function changed(data, ns) {
        if (namespace() === ns) { envelope = data; envelopeNamespace = ns; }
        global.dispatchEvent(new CustomEvent('cms-recommendation-state', { detail: { owner: ns } }));
    }
    async function mutate(fn, ns = namespace(), withMedia = false) {
        const db = await open();
        const tx = db.transaction(withMedia ? [STORE, 'media'] : [STORE], 'readwrite');
        const completed = done(tx), store = tx.objectStore(STORE);
        try {
            const row = await value(store.get(`${ns}:main`));
            const data = row?.value || fresh(ns);
            const result = await fn(data, store, withMedia ? tx.objectStore('media') : null);
            store.put({ key: `${ns}:main`, value: data });
            await completed; changed(data, ns); return result;
        } catch (error) { try { tx.abort(); } catch (_) {} await completed.catch(() => {}); throw error; }
        finally { db.close(); }
    }
    function maxima(records) {
        const map = new Map();
        for (const record of records) { const key = keyOf(record); if (!key || record.deleted || record.site === 'system') continue; map.set(key, Math.max(map.get(key) || 0, Math.max(0, Number(record.playCount) || 0))); }
        return [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    }
    async function ensure(records = []) {
        const ns = namespace();
        return mutate(data => {
            if (!data.migration) {
                const capturedAt = new Date().toISOString(), migrationEpoch = uuid(), snapshotId = uuid();
                data.migration = { migrationEpoch, snapshotId, capturedAt, checkpoint: capturedAt, ready: ns === 'local', status: ns === 'local' ? 'ready' : 'waitingForSharedBaseline', snapshot: maxima(records).map(([contentKey, count]) => ({ contentKey, legacyEvidence: { playCountBaseline: count, baselineVersion: 1, capturedAt, migrationEpoch, snapshotId } })) };
                if (ns === 'local') for (const entry of data.migration.snapshot) data.preferences[entry.contentKey] = { ...entry, manualPlayCountAfterBaseline: 0, counterRevision: 0, favorite: false, excludedFromRecommendations: false, favoriteRevision: 0 };
            }
            if (data.migration.ready && ns === 'local') for (const [contentKey] of maxima(records)) {
                if (!data.preferences[contentKey]) data.preferences[contentKey] = { contentKey, legacyEvidence: { playCountBaseline: 0, capturedAt: new Date().toISOString(), baselineVersion: 1, migrationEpoch: data.migration.migrationEpoch, snapshotId: data.migration.snapshotId }, manualPlayCountAfterBaseline: 0, counterRevision: 0, favorite: false, favoriteRevision: 0, excludedFromRecommendations: false };
            }
            return clone(data);
        }, ns);
    }
    async function read(ns = namespace()) {
        const db = await open(), tx = db.transaction(STORE, 'readonly'), completed = done(tx);
        const row = await value(tx.objectStore(STORE).get(`${ns}:main`)); await completed; db.close();
        const data = row?.value || fresh(ns); if (ns === namespace()) { envelope = data; envelopeNamespace = ns; } return clone(data);
    }
    function peek() { return envelopeNamespace === namespace() ? envelope : fresh(namespace()); }
    function preferences(data = peek()) {
        const result = clone(data.preferences);
        for (const event of Object.values(data.events)) {
            if (event.acknowledged || event.playContext?.source !== 'manual' || !result[event.contentKey]?.legacyEvidence) continue;
            result[event.contentKey].manualPlayCountAfterBaseline = (result[event.contentKey].manualPlayCountAfterBaseline || 0) + 1;
        }
        for (const mutation of Object.values(data.mutations)) if (!mutation.acknowledged) {
            result[mutation.contentKey] ||= { contentKey: mutation.contentKey };
            result[mutation.contentKey][mutation.field] = mutation.value;
        }
        return Object.values(result);
    }
    async function recordCountedPlay(item, attempt, playContext) {
        if (!item?.id || !attempt?.eventId) throw new Error('再生試行のIDがありません。');
        const records=global.CmsWebPlayer?.getRecords?.();
        if (records && !records.some(record=>!record.deleted && record.id===item.id && keyOf(record)===keyOf(item))) return {status:'missing'};
        const ns = attempt.owner || namespace(), contentKey = keyOf(item);
        const event = { schemaVersion: 1, outcome: 'counted', playbackAttemptId: attempt.playbackAttemptId, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo', eventId: attempt.eventId, recordId: item.id, mediaId: item.id, contentKey, title: item.title || '', url: item.url || '', site: item.site || '', folder: item.folder || item.folders?.[0] || 'Manual', playedAt: new Date().toISOString(), countedAsPlay: true, source: 'web', playContext: clone(playContext), legacyCountApplied: true, evidencePending: ns !== 'local' };
        const result = await mutate(async (data, store, media) => {
            const receiptKey = `${ns}:receipt:${event.eventId}`;
            if (await value(store.get(receiptKey))) return { status: 'alreadyApplied', event };
            const cached = await value(media.get(item.id));
            const updated = { ...(cached || item), playCount: Math.max(Number(cached?.playCount) || 0, Number(item.playCount) || 0) + 1, lastPlayedAt: event.playedAt, _cmsRecommendationCountManaged: true };
            delete updated.safeDate; delete updated.safePlayCount; delete updated.originalIndex;
            delete updated._cmsPlayContext;
            media.put(updated);
            if (ns === 'local' && contentKey && data.preferences[contentKey]?.legacyEvidence) {
                if (event.playContext.source === 'manual') data.preferences[contentKey].manualPlayCountAfterBaseline++;
                data.preferences[contentKey].counterRevision++;
                event.acknowledged = true; event.evidencePending = false;
            }
            if (ns !== 'local') data.events[event.eventId] = event;
            data.history.unshift(event); data.history = data.history.slice(0, 2000);
            store.put({ key: receiptKey, value: { eventId: event.eventId, appliedAt: event.playedAt, legacyCountApplied: true } });
            if (data.attempt?.eventId === attempt.eventId) data.attempt.counted = true;
            return { status: 'applied', event, item: updated };
        }, ns, true);
        if (result.item) { item.playCount = result.item.playCount; item.safePlayCount = item.playCount; item.lastPlayedAt = result.item.lastPlayedAt; item._cmsRecommendationCountManaged = true; }
        if (ns !== 'local') global.CmsWebFirebase?.scheduleRecommendationSync?.();
        return result;
    }
    async function beginAttempt(item, context, restored) {
        const ns = namespace(), contentKey = keyOf(item);
        const attempt = restored?.eventId && restored.contentKey === contentKey && restored.owner === ns ? clone(restored) : { eventId: uuid(), playbackAttemptId: uuid(), owner: ns, contentKey, recordId: item.id, startedAt: new Date().toISOString(), counted: false, playContext: clone(context) };
        await mutate(data => { data.attempt = attempt; if (!restored) { data.sessionRecentContentKeys.push(contentKey); data.sessionRecentContentKeys = data.sessionRecentContentKeys.slice(-5); } }, ns);
        return attempt;
    }
    async function setPreference(contentKey, field, requestedValue) {
        if (!['favorite', 'excludedFromRecommendations'].includes(field) ||
            typeof contentKey !== 'string' || !/^(?:youtube:[A-Za-z0-9_-]{11}|niconico:(?:(?:sm|nm|so)?\d+))$/.test(contentKey)) throw new Error('無効な好み設定です');
        const ns = namespace();
        const mutation = await mutate(data => {
            const pref = data.preferences[contentKey] ||= { contentKey, favorite: false, excludedFromRecommendations: false, favoriteRevision: 0 };
            const mutation = { mutationId: uuid(), contentKey, field, value: Boolean(requestedValue), expectedRevision: pref.favoriteRevision || 0, createdAt: new Date().toISOString() };
            if (ns === 'local') { pref[field] = mutation.value; pref.favoriteRevision++; mutation.acknowledged = true; }
            else data.mutations[mutation.mutationId] = mutation;
            return mutation;
        }, ns);
        if (ns !== 'local') global.CmsWebFirebase?.scheduleRecommendationSync?.();
        return mutation;
    }
    function mergePreference(data, pref) {
        const old = data.preferences[pref.contentKey] || { contentKey: pref.contentKey };
        const next = { ...old };
        if (pref.cloudKnown) next.cloudKnown=true;
        if (pref.legacyEvidence && (!old.legacyEvidence || (pref.counterRevision || 0) >= (old.counterRevision || 0))) {
            next.legacyEvidence = pref.legacyEvidence; next.manualPlayCountAfterBaseline = pref.manualPlayCountAfterBaseline || 0; next.counterRevision = pref.counterRevision || 0;
        }
        if ((pref.favoriteRevision || 0) >= (old.favoriteRevision || 0)) for (const field of ['favorite', 'excludedFromRecommendations', 'favoriteRevision', 'lastMutationId', 'serverCommittedAt']) if (pref[field] !== undefined) next[field] = pref[field];
        data.preferences[pref.contentKey] = next;
    }
    async function removeFolderArchives(store,ns,folderId) {
        const prefix=ns+':folderVersion:'+folderId+':v';
        for(const key of await value(store.getAllKeys())) if(typeof key==='string' && (key===ns+':folderSnapshot:'+folderId || key.startsWith(prefix))) store.delete(key);
    }
    async function adoptShared(payload, owner = namespace()) {
        if (!owner.startsWith('user:')) throw new Error('共有状態はローカル領域へ保存できません');
        return mutate(async(data,store) => {
            if (payload.state?.ready) data.migration = { ...data.migration, ...payload.state, ready: true, snapshot: data.migration?.snapshot || [] };
            for (const pref of payload.preferences || []) mergePreference(data, pref);
            for (const remote of payload.folders || []) {
                const index = data.folders.findIndex(folder => folder.folderId === remote.folderId);
                if(remote.purged) {
                    await removeFolderArchives(store,owner,remote.folderId);delete data.folderOutbox[remote.folderId];
                    if(index<0)data.folders.push(remote);else data.folders[index]=remote;
                    continue;
                }
                if (index < 0) data.folders.push(remote);
                else if (!data.folders[index].purged && !data.folderOutbox[remote.folderId] && remote.folderRevision > data.folders[index].folderRevision) data.folders[index] = remote;
            }
            return clone(data);
        }, owner);
    }
    async function acknowledgeEvent(eventId, preference, owner) {
        return mutate(data => { if (preference) mergePreference(data, preference); delete data.events[eventId]; const history = data.history.find(item => item.eventId === eventId); if (history) { history.acknowledged = true; history.evidencePending = false; } }, owner);
    }
    async function acknowledgeMutation(mutationId, preference, owner) {
        return mutate(data => { mergePreference(data, preference); delete data.mutations[mutationId]; }, owner);
    }
    async function saveQueue(queue) {
        const ns=namespace();
        return mutate((data,store)=>{
            store.put({key:ns+':queue:'+queue.queueId,value:clone(queue)});
            data.queues.unshift({queueId:queue.queueId,generatedAt:queue.generatedAt,mode:queue.mode,seed:queue.seed,inputSnapshotHash:queue.inputSnapshotHash});
            for (const old of data.queues.slice(10)) store.delete(ns+':queue:'+old.queueId);
            data.queues=data.queues.slice(0,10);
        },ns);
    }
    async function setActiveQueue(queue) { return mutate(data => { data.activeQueue = queue ? clone(queue) : null; }); }
    async function saveFolder(queue, requestedName) {
        if (!queue?.items?.length) throw new Error('空のキューは保存できません');
        const ns = namespace();
        const folder = await mutate((data,store) => {
            const base = String(requestedName || `スマート選曲 ${new Date().toISOString().slice(0, 10)}`).trim().slice(0, 120) || 'スマート選曲';
            const ordinaryNames = new Set((global.CmsWebPlayer?.getRecords?.() || []).flatMap(item => item.folders || [item.folder]));
            let name = base, suffix = 2; while (ordinaryNames.has(name) || data.folders.some(folder => !folder.deleted && folder.name === name)) name = `${base} (${suffix++})`;
            const folderId=uuid(),snapshot=clone(queue),{inputSnapshot,...metadata}=snapshot;
            store.put({key:ns+':folderSnapshot:'+folderId,value:snapshot});
            const folder = { folderId, folderRevision: 1, name, queueId: queue.queueId, mode: queue.mode, createdAt: new Date().toISOString(), items: clone(queue.items), segments: clone(queue.segments || []), generationSnapshot: metadata, snapshotRef:folderId, revisionHistory: [] };
            data.folders.push(folder); if (ns !== 'local') data.folderOutbox[folder.folderId] = {...folder,folderMutationId:uuid(),expectedRemoteRevision:0}; return clone(folder);
        }, ns);
        if (ns !== 'local') global.CmsWebFirebase?.scheduleRecommendationSync?.(); return folder;
    }
    async function acknowledgeFolder(id, owner) { return mutate(data => { delete data.folderOutbox[id]; }, owner); }
    async function folderVersion(folderId,revision) {
        if((await read()).folders.some(folder=>folder.folderId===folderId && folder.purged)) return null;
        const ns=namespace(),database=await open(),tx=database.transaction(STORE,'readonly'),completed=done(tx);
        const row=await value(tx.objectStore(STORE).get(ns+':folderVersion:'+folderId+':v'+revision));
        await completed;database.close();return row?.value || null;
    }
    async function cacheFolderVersion(version) {
        const ns=namespace();
        return mutate((data,store)=>{ if(data.folders.some(folder=>folder.folderId===version.folderId && folder.purged)) throw new Error('完全削除した選曲は復元できません。'); store.put({key:ns+':folderVersion:'+version.folderId+':v'+version.folderRevision,value:clone(version)}); },ns);
    }
    async function updateFolder(folderId,expectedRevision,queue) {
        if (!queue?.items?.length) throw new Error('空のフォルダには更新できません。');
        const ns=namespace();
        const result=await mutate(async(data,store)=>{
            const index=data.folders.findIndex(folder=>folder.folderId===folderId);
            const old=data.folders[index];
            if (!old || old.deleted || old.folderRevision!==expectedRevision) throw new Error('フォルダが変更または削除されています。再確認してください。');
            const saved=await value(store.get(ns+':folderSnapshot:'+folderId));
            const oldSnapshot=saved?.value?.queueId===old.queueId ? saved.value : {...old.generationSnapshot,items:old.items};
            store.put({key:ns+':folderVersion:'+folderId+':v'+old.folderRevision,value:{...old,generationSnapshot:oldSnapshot}});
            const snapshot=clone(queue),{inputSnapshot,...metadata}=snapshot;
            store.put({key:ns+':folderSnapshot:'+folderId,value:snapshot});
            const next={...old,folderRevision:old.folderRevision+1,items:clone(queue.items),generationSnapshot:metadata,segments:clone(queue.segments || []),
              queueId:queue.queueId,mode:queue.mode,updatedAt:new Date().toISOString(),
              revisionHistory:[...(old.revisionHistory || []),{folderRevision:old.folderRevision,queueId:old.queueId,updatedAt:old.updatedAt || old.createdAt}]};
            data.folders[index]=next;
            if (ns!=='local') data.folderOutbox[folderId]={...next,folderOperation:data.folderOutbox[folderId]?.folderOperation==='restore'?'restore':'update',
                folderMutationId:uuid(),expectedRemoteRevision:data.folderOutbox[folderId]?.expectedRemoteRevision ?? old.folderRevision};
            return clone(next);
        },ns);
        if (ns!=='local') global.CmsWebFirebase?.scheduleRecommendationSync?.();
        return result;
    }
    async function changeFolder(folderId, expectedRevision, operation, requestedName) {
        const ns=namespace();
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision<1) throw new Error('フォルダの版を再確認してください。');
        const result=await mutate(async(data,store)=>{
            const index=data.folders.findIndex(folder=>folder.folderId===folderId),old=data.folders[index];
            if (!old || old.folderRevision!==expectedRevision) throw new Error('フォルダが変更されています。再確認してください。');
            if (old.purged) throw new Error('完全削除した選曲は復元できません。');
            if (operation==='restore' ? !old.deleted : old.deleted) throw new Error(operation==='restore'?'このフォルダは削除されていません。':'削除したフォルダは先に復元してください。');
            let name=operation==='rename'?String(requestedName || '').trim():old.name;
            if (!name || name.length>120) throw new Error('フォルダ名は1〜120文字で入力してください。');
            if (operation!=='delete') {
                const ordinaryNames=new Set((global.CmsWebPlayer?.getRecords?.() || []).filter(item=>!item.deleted).flatMap(item=>item.folders || [item.folder]));
                const names=new Set([...ordinaryNames,...data.folders.filter(folder=>!folder.deleted && folder.folderId!==folderId).map(folder=>folder.name)]);
                if (operation==='rename' && names.has(name)) throw new Error('同じ名前のフォルダがあります。別の名前を指定してください。');
                if (operation==='restore') {
                    const base=name;let suffix=2;
                    while(names.has(name)) { const ending=` (${suffix++})`;name=base.slice(0,120-ending.length)+ending; }
                }
                if (operation==='rename' && name===old.name) return clone(old);
            }
            const saved=await value(store.get(ns+':folderSnapshot:'+folderId));
            const oldSnapshot=saved?.value?.queueId===old.queueId?saved.value:{...old.generationSnapshot,items:old.items};
            store.put({key:ns+':folderVersion:'+folderId+':v'+old.folderRevision,value:{...old,generationSnapshot:oldSnapshot}});
            const at=new Date().toISOString();
            const next={...old,name,folderRevision:old.folderRevision+1,updatedAt:at,
                revisionHistory:[...(old.revisionHistory || []),{folderRevision:old.folderRevision,queueId:old.queueId,updatedAt:old.updatedAt || old.createdAt}]};
            if (operation==='delete') { next.deleted=true;next.deletedAt=at; }
            if (operation==='restore') { next.deleted=false;next.deletedAt=null;next.restoredAt=at; }
            data.folders[index]=next;
            if(ns!=='local') data.folderOutbox[folderId]={...next,folderOperation:operation!=='delete' && data.folderOutbox[folderId]?.folderOperation==='restore'?'restore':operation,folderMutationId:uuid(),
                expectedRemoteRevision:data.folderOutbox[folderId]?.expectedRemoteRevision ?? old.folderRevision};
            return clone(next);
        },ns);
        if(ns!=='local') global.CmsWebFirebase?.scheduleRecommendationSync?.();
        return result;
    }
    const renameFolder=(folderId,expectedRevision,name)=>changeFolder(folderId,expectedRevision,'rename',name);
    const deleteFolder=(folderId,expectedRevision)=>changeFolder(folderId,expectedRevision,'delete');
    const restoreFolder=(folderId,expectedRevision)=>changeFolder(folderId,expectedRevision,'restore');
    async function purgeFolder(folderId, expectedRevision) {
        const ns=namespace();
        const result=await mutate(async(data,store)=>{
            const index=data.folders.findIndex(folder=>folder.folderId===folderId),old=data.folders[index];
            if(!old || !old.deleted || old.purged || old.folderRevision!==expectedRevision) throw new Error('削除済みの選曲を再確認してください。');
            // Retain only a non-restorable identity tombstone: removing it would let an old cloud snapshot revive the list.
            const next={folderId,folderRevision:old.folderRevision+1,deleted:true,purged:true,purgedAt:new Date().toISOString()};
            await removeFolderArchives(store,ns,folderId);
            data.folders[index]=next;
            if(ns!=='local') data.folderOutbox[folderId]={...next,revisionHistory:[...(old.revisionHistory || []).map(item=>({folderRevision:item.folderRevision})),{folderRevision:old.folderRevision}],
                folderOperation:'purge',folderMutationId:uuid(),expectedRemoteRevision:data.folderOutbox[folderId]?.expectedRemoteRevision ?? old.folderRevision};
            return clone(next);
        },ns);
        if(ns!=='local') global.CmsWebFirebase?.scheduleRecommendationSync?.();
        return result;
    }
    async function addDiagnostic(reason, item) { return mutate(data => { data.diagnostics.unshift({ reason, contentKey: keyOf(item), at: new Date().toISOString() }); data.diagnostics = data.diagnostics.slice(0, 100); }); }
    async function mergeHistory(events, owner = namespace()) {
        return mutate(data => {
            const map = new Map(data.history.filter(event => event.eventId).map(event => [event.eventId, event]));
            for (const event of events || []) if (event.eventId && !map.has(event.eventId)) map.set(event.eventId, clone(event));
            data.history = [...map.values()].sort((a,b) => Date.parse(b.playedAt)-Date.parse(a.playedAt)).slice(0,2000);
        }, owner);
    }
    async function applySynchronization(payload, accepted, owner) {
        return mutate(async(data,store) => {
            if (!payload.state?.ready) throw new Error('共有baselineが未確定です。');
            data.migration = { ...data.migration, ...payload.state, ready:true, snapshot:data.migration?.snapshot || [] };
            for (const pref of payload.preferences || []) mergePreference(data,pref);
            for (const id of accepted.events) {
                delete data.events[id];
                const event=data.history.find(event=>event.eventId===id);
                if (event) {event.acknowledged=true;event.evidencePending=false;}
            }
            for (const id of accepted.mutations) delete data.mutations[id];
            for (const acceptedFolder of accepted.folders) {
                const pending=data.folderOutbox[acceptedFolder.folderId];
                if(pending?.folderMutationId===acceptedFolder.folderMutationId) delete data.folderOutbox[acceptedFolder.folderId];
                else if(pending) {
                    const remote=(payload.folders || []).find(folder=>folder.folderId===acceptedFolder.folderId && folder.lastMutationId===acceptedFolder.folderMutationId);
                    if(remote && pending.folderRevision>remote.folderRevision && (pending.revisionHistory || []).some(version=>version.folderRevision===remote.folderRevision)) pending.expectedRemoteRevision=remote.folderRevision;
                }
            }
            for (const folder of payload.folders || []) {
                const index=data.folders.findIndex(value=>value.folderId===folder.folderId);
                if(folder.purged) {
                    await removeFolderArchives(store,owner,folder.folderId);delete data.folderOutbox[folder.folderId];
                    if(index<0)data.folders.push(folder);else data.folders[index]=folder;
                    continue;
                }
                if (index<0) data.folders.push(folder);
                else if (!data.folders[index].purged && !data.folderOutbox[folder.folderId] && folder.folderRevision>data.folders[index].folderRevision) data.folders[index]=folder;
            }
        }, owner);
    }
    global.CmsRecommendationStore = { ensure, read, peek, preferences, recordCountedPlay, beginAttempt, setPreference, adoptShared, acknowledgeEvent, acknowledgeMutation, saveQueue, setActiveQueue, saveFolder, acknowledgeFolder, folderVersion, cacheFolderVersion, updateFolder, renameFolder, deleteFolder, restoreFolder, purgeFolder, addDiagnostic, mergeHistory, applySynchronization, namespace, ownerUid: OWNER_UID };
})(window);
