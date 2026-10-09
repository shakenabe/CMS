/* Shared cloud contract: one receipt per counted event, immutable baseline. */
(function(root) {
'use strict';
root.CMSRecommendationCloud = function(sdk, firestore, requireUser) {
const {arrayUnion, collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp, setDoc} = sdk;
const cleanValue = value => JSON.parse(JSON.stringify(value));
const userCollection = (uid, name) => collection(firestore, 'users', uid, name);
const userDocument = (uid, name, key) => doc(firestore, 'users', uid, name, key);
// Dedicated recommendation data never enters the legacy settings snapshot.
const recommendationKey = value => encodeURIComponent(String(value));
function compactFolder(folder) {
  const result=cleanValue(folder);
  delete result.key;delete result.account;delete result.versions;
  delete result.folderMutationId;delete result.expectedRemoteRevision;delete result.folderOperation;
  for (const field of ['queue','generationSnapshot']) if (result[field]) {
    delete result[field].inputSnapshot;
    delete result[field].items;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length>700000) throw new Error('生成フォルダの同期サイズが上限を超えています。曲数を減らして保存してください。');
  return result;
}
async function initializeRecommendationState(seed) {
  const user = requireUser();
  const stateRef = userDocument(user.uid, 'recommendationState', 'main');
  const state = await runTransaction(firestore, async tx => {
    const existing = await tx.get(stateRef);
    if (existing.exists()) return existing.data();
    const value = { schemaVersion: 1, migrationEpoch: seed.migrationEpoch, snapshotId: seed.snapshotId, capturedAt: seed.capturedAt, snapshot: cleanValue(seed.snapshot || []), ready: false, status: 'preparing' };
    if (JSON.stringify(value).length > 700000) throw new Error('Recommendation migration snapshot exceeds safe document size');
    tx.set(stateRef, value);
    return value;
  });
  if (!state.ready) {
    for (let offset = 0; offset < (state.snapshot || []).length; offset += 100) {
      const group = state.snapshot.slice(offset, offset + 100);
      await runTransaction(firestore, async tx => {
        const refs = group.map(value => userDocument(user.uid, 'recommendationEvidence', recommendationKey(value.contentKey)));
        const existing = await Promise.all(refs.map(ref => tx.get(ref)));
        group.forEach((value, index) => {
          if (!existing[index].exists()) tx.set(refs[index], { schemaVersion: 1, contentKey: value.contentKey, legacyEvidence: { ...value.legacyEvidence, migrationEpoch: state.migrationEpoch, snapshotId: state.snapshotId }, manualPlayCountAfterBaseline: 0, counterRevision: 0 });
        });
      });
    }
    await setDoc(stateRef, { ready: true, status: 'ready' }, { merge: true });
  }
  return { ...state, ready: true, status: 'ready' };
}

async function acceptRecommendationOperation(entry) {
  const user = requireUser();
  const value = cleanValue(entry.payload || {});
  if (entry.kind === 'folder') {
    // Head CAS and a mutation receipt precede immutable, separately sized version documents.
    if (!value.folderId || !Number.isSafeInteger(value.folderRevision) || value.folderRevision<1) throw new Error('Invalid folder revision');
    const mutationId=value.folderMutationId || value.folderId+':v'+value.folderRevision;
    const receiptRef=userDocument(user.uid,'recommendationFolderMutations',recommendationKey(mutationId));
    const ref = userDocument(user.uid, 'recommendationFolders', value.folderId);
    const result=await runTransaction(firestore, async tx => {
      const stateRef=userDocument(user.uid,'recommendationState','main');
      const [receipt,existing,state]=await Promise.all([tx.get(receiptRef),tx.get(ref),tx.get(stateRef)]);
      if (receipt.exists()) return {accepted:true,alreadyApplied:true};
      const current=existing.exists()?existing.data():null;
      const expected=value.expectedRemoteRevision ?? value.folderRevision-1;
      if ((current?.folderRevision || 0)!==expected) throw new Error('生成フォルダが別端末で更新されています。古い内容では上書きできません。');
      if (!Number.isSafeInteger(expected) || expected<0 || value.folderRevision<=expected) throw new Error('Invalid folder revision');
      // A tombstone can only be revived by an explicit, current-revision restore.
      // Older clients' queued updates must never silently recreate a deleted head.
      if (current?.deleted===true && value.deleted!==true && value.folderOperation!=='restore') throw new Error('削除された生成フォルダは、最新版を確認してから明示的に復元してください。');
      if (current?.folderRevision) {
        const oldVersionRef=userDocument(user.uid,'recommendationFolderVersions',recommendationKey(value.folderId)+':v'+current.folderRevision);
        const oldVersion=await tx.get(oldVersionRef);
        if (!oldVersion.exists()) tx.set(oldVersionRef,compactFolder(current));
      }
      const syncRevision=(state.exists()?Number(state.data().dataRevision)||0:0)+1;
      tx.set(ref,{...compactFolder(value),syncRevision,lastMutationId:mutationId,serverCommittedAt:serverTimestamp()});
      tx.set(stateRef,{dataRevision:syncRevision,syncProtocolVersion:2},{merge:true});
      tx.set(receiptRef,{folderId:value.folderId,folderRevision:value.folderRevision,mutationId,acceptedAt:serverTimestamp()});
      return {accepted:true,alreadyApplied:false};
    });
    const versions=value.versions || [];
    for(let offset=0;offset<versions.length;offset+=50) {
      const group=versions.slice(offset,offset+50);
      await runTransaction(firestore,async tx=>{
        const refs=group.map(version=>userDocument(user.uid,'recommendationFolderVersions',recommendationKey(value.folderId)+':v'+version.folderRevision));
        const docs=await Promise.all(refs.map(ref=>tx.get(ref)));
        group.forEach((version,index)=>{
          if(version.folderId!==value.folderId || !Number.isSafeInteger(version.folderRevision) || version.folderRevision<1 || version.folderRevision>=value.folderRevision) throw new Error('Invalid archived folder version');
          if(!docs[index].exists()) tx.set(refs[index],compactFolder(version));
        });
      });
    }
    return result;
  }
  if (entry.kind === 'preference') {
    if (!['favorite', 'excludedFromRecommendations'].includes(value.field)) throw new Error('Invalid recommendation preference');
    const mutationRef = userDocument(user.uid, 'recommendationMutations', value.mutationId);
    const preferenceRef = userDocument(user.uid, 'recommendationPreferences', recommendationKey(value.contentKey));
    const stateRef = userDocument(user.uid,'recommendationState','main');
    return runTransaction(firestore, async tx => {
      const [receipt, previous, state] = await Promise.all([tx.get(mutationRef), tx.get(preferenceRef), tx.get(stateRef)]);
      if (receipt.exists()) return receipt.data();
      const current = previous.exists() ? previous.data() : { contentKey: value.contentKey, favorite: false, excludedFromRecommendations: false, favoriteRevision: 0 };
      const revision = (Number(current.favoriteRevision) || 0) + 1;
      const syncRevision=(state.exists()?Number(state.data().dataRevision)||0:0)+1;
      tx.set(preferenceRef, { ...current, syncRevision, [value.field]: Boolean(value.value), favoriteRevision: revision, lastMutationId: value.mutationId, serverCommittedAt: serverTimestamp() });
      tx.set(stateRef,{dataRevision:syncRevision,syncProtocolVersion:2},{merge:true});
      const result = { accepted: true, mutationId: value.mutationId, favoriteRevision: revision };
      tx.set(mutationRef, result);
      return result;
    });
  }
  if (entry.kind !== 'playback' || !value.eventId || !value.mediaId || value.countedAsPlay !== true || value.outcome !== 'counted') throw new Error('Invalid counted recommendation event');
  const receiptRef = userDocument(user.uid, 'recommendationReceipts', value.eventId);
  const mediaRef = userDocument(user.uid, 'mediaItems', value.mediaId);
  const evidenceRef = value.contentKey ? userDocument(user.uid, 'recommendationEvidence', recommendationKey(value.contentKey)) : null;
  const stateRef = userDocument(user.uid, 'recommendationState', 'main');
  const bucketId = new Date(value.playedAt).toISOString().slice(0, 13).replace(/[-T]/g, '');
  return runTransaction(firestore, async tx => {
    const [receipt, media, evidence, state] = await Promise.all([tx.get(receiptRef), tx.get(mediaRef), evidenceRef ? tx.get(evidenceRef) : null, tx.get(stateRef)]);
    if (receipt.exists()) return { accepted: true, alreadyApplied: true };
    if (!state.exists() || !state.data().ready) throw new Error('Shared baseline is pending');
    if (!media.exists()) throw new Error('動画情報を先に同期してください。');
    const current = media.data();
    const syncRevision=(Number(state.data().dataRevision)||0)+1;
    const oldAt = Date.parse(current.lastPlayedAt || '') || 0;
    tx.set(mediaRef, { id: value.mediaId, playCount: (Number(current.playCount) || 0) + 1, lastPlayedAt: oldAt > Date.parse(value.playedAt) ? current.lastPlayedAt : value.playedAt, deleted: current.deleted === true, _cmsRecommendationCountManaged: true, updatedAt: serverTimestamp() }, { merge: true });
    if (evidenceRef) {
      const previous = evidence?.exists() ? evidence.data() : { schemaVersion: 1, contentKey: value.contentKey, legacyEvidence: { playCountBaseline: 0, capturedAt: state.data().capturedAt, baselineVersion: 1, migrationEpoch: state.data().migrationEpoch, snapshotId: state.data().snapshotId }, manualPlayCountAfterBaseline: 0, counterRevision: 0 };
      const postBaselineManual = value.playContext?.source === 'manual' && Date.parse(value.playedAt) >= Date.parse(state.data().capturedAt);
      tx.set(evidenceRef, { ...previous, syncRevision, manualPlayCountAfterBaseline: (Number(previous.manualPlayCountAfterBaseline) || 0) + (postBaselineManual ? 1 : 0), counterRevision: (Number(previous.counterRevision) || 0) + 1 });
    }
    tx.set(stateRef,{dataRevision:syncRevision,syncProtocolVersion:2},{merge:true});
    tx.set(userDocument(user.uid, 'playbackHistory', bucketId), { schemaVersion: 1, bucketId, events: arrayUnion(value), updatedAt: serverTimestamp() }, { merge: true });
    tx.set(userDocument(user.uid, 'sync', 'meta'), { schemaVersion: 2, lastChangedAt: serverTimestamp(), playbackChangedAt: serverTimestamp() }, { merge: true });
    tx.set(receiptRef, { eventId: value.eventId, contentKey: value.contentKey, playedAt: value.playedAt, acceptedAt: serverTimestamp() });
    return { accepted: true, alreadyApplied: false };
  });
}

async function ensureRecommendationEvidence(contentKeys) {
  if (!contentKeys?.filter(Boolean).length) return;
  const user = requireUser(), stateDoc = await getDoc(userDocument(user.uid, 'recommendationState', 'main'));
  if (!stateDoc.exists() || !stateDoc.data().ready) throw new Error('Shared baseline is pending');
  const state = stateDoc.data();
  const keys = [...new Set(contentKeys.filter(Boolean))];
  for (let offset=0; offset<keys.length; offset+=100) {
    const group=keys.slice(offset,offset+100);
    await runTransaction(firestore,async tx=>{
      const refs=group.map(key=>userDocument(user.uid,'recommendationEvidence',recommendationKey(key)));
      const stateRef=userDocument(user.uid,'recommendationState','main');
      const [current,...docs]=await Promise.all([tx.get(stateRef),...refs.map(ref=>tx.get(ref))]);
      const syncRevision=(Number(current.data().dataRevision)||0)+1;
      if(docs.some(value=>!value.exists())) tx.set(stateRef,{dataRevision:syncRevision,syncProtocolVersion:2},{merge:true});
      group.forEach((contentKey,index)=>{
        if (!docs[index].exists()) tx.set(refs[index], {schemaVersion:1,contentKey,syncRevision,
          legacyEvidence:{playCountBaseline:0,baselineVersion:1,capturedAt:state.capturedAt,migrationEpoch:state.migrationEpoch,snapshotId:state.snapshotId},
          manualPlayCountAfterBaseline:0,counterRevision:0});
      });
    });
  }
}

async function fetchRecommendationState(options = {}) {
  const user = requireUser();
  const state = await getDoc(userDocument(user.uid, 'recommendationState', 'main'));
  const shared = state.exists() ? state.data() : null;
  const cursor=options.afterRevision;
  const incremental=Number.isSafeInteger(cursor) && cursor>=0 && query && where && shared?.syncProtocolVersion===2;
  if (incremental && cursor===(Number(shared.dataRevision)||0)) return {state:shared,preferences:[],folders:[],incremental:true};
  const readCollection=name=>getDocs(incremental?query(userCollection(user.uid,name),where('syncRevision','>',cursor)):userCollection(user.uid,name));
  const [evidence,preferences,folders]=await Promise.all(['recommendationEvidence','recommendationPreferences','recommendationFolders'].map(readCollection));
  const entries = new Map(evidence.docs.map(doc => [doc.data().contentKey, doc.data()]));
  for (const doc of preferences.docs) {
    const preference = doc.data();
    const previous = entries.get(preference.contentKey) || {
      contentKey: preference.contentKey, manualPlayCountAfterBaseline: 0, counterRevision: 0,
      legacyEvidence: { playCountBaseline: 0, capturedAt: shared?.capturedAt || null, baselineVersion: 1,
        migrationEpoch: shared?.migrationEpoch || null, snapshotId: shared?.snapshotId || null }
    };
    // A delta containing only a favorite must not reset manual counters/baseline.
    entries.set(preference.contentKey, { ...(incremental && !entries.has(preference.contentKey) ? {} : previous), ...preference });
  }
  return { state: {...shared,dataRevision:Number(shared?.dataRevision)||0}, preferences: [...entries.values()].map(value=>({...value,cloudKnown:true})), folders: folders.docs.map(doc => doc.data()),incremental:Boolean(incremental) };
}
async function fetchRecommendationFolderVersion(folderId,revision) {
  if (!folderId || !Number.isSafeInteger(revision) || revision<1) throw new Error('Invalid archived folder version');
  const user=requireUser();
  const value=await getDoc(userDocument(user.uid,'recommendationFolderVersions',recommendationKey(folderId)+':v'+revision));
  return value.exists()?value.data():null;
}


return { initializeRecommendationState, ensureRecommendationEvidence, acceptRecommendationOperation, fetchRecommendationState, fetchRecommendationFolderVersion };
};
})(globalThis);

