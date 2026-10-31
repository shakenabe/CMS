/* Structured remote model. All writes and playback remain on the PC. */
(() => {
    'use strict';
    const player = () => window.CmsWebPlayer;
    const adapter = () => window.CMSRecommendationAdapter;
    const engine = () => window.CMSRecommendationEngine;
    let data = null, pending = null, preview = null, previewId = '', previewConditions = null, lastCloudRefresh = 0;
    const short = (value, limit = 500) => String(value || '').slice(0, limit);
    const keyOf = item => engine().normalizeContentKey(item);
    const fields = item => ({ contentKey:keyOf(item), title:short(item.title), artist:short(item.channelName || item.uploader || item.site),
        thumbnail:window.CmsRemoteHostTools?.safeImageUrl(item.thumbnail) || '', site:item.site, folders:getStatsItemFolders(item),
        savedAt:Number(item.safeDate) || Date.parse(item.savedAt) || 0, playCount:Number(item.safePlayCount || item.playCount) || 0, tags:(Array.isArray(item.tags)?item.tags:[]).filter(value=>typeof value==='string').slice(0,30).map(value=>short(value,120)) });
    async function refresh() {
        if (pending) return pending;
        pending = (async () => {
            if (!player().getRecords().length) { data = null; return; }
            data = await adapter().state();
        })();
        try { await pending; } finally { pending = null; }
    }
    function snapshot() {
        const state = player().getRemoteState(), records = player().getRecords().filter(item => !item.deleted);
        const preferences = new Map((data?.preferences || []).map(pref => [pref.contentKey, pref]));
        const songs = records.slice(0, 10000).map(item => ({ ...fields(item), favorite:preferences.get(keyOf(item))?.favorite === true }));
        const names = new Set(songs.flatMap(item => item.folders));
        const folders = [{ id:'__all', name:'すべて', count:songs.length }, ...state.folders.filter(folder => names.has(folder.id)).map(folder => ({...folder,count:songs.filter(song => song.folders.includes(folder.id)).length}))];
        for (const name of names) if (!folders.some(folder => folder.id === name)) folders.push({id:name,name,count:songs.filter(song => song.folders.includes(name)).length});
        if (state.playlist.length) folders.splice(1,0,{id:'__smart_queue',name:'再生中のキュー',count:state.playlist.length});
        return { version:2, player:{ ...state, item:state.item ? {...fields(state.item),queueItemId:state.currentQueueItemId || state.item.queueItemId || null} : null, playlist:state.playlist.slice(0,10000).map(item=>({...fields(item),queueItemId:item.queueItemId || item._cmsQueueItemId || null,favorite:preferences.get(keyOf(item))?.favorite===true})), folders:undefined },
            records:songs, folders, truncated:records.length>songs.length, cloud:window.CmsWebFirebase?.getSyncStatus?.() || {connected:false,auto:false,message:'PCでGoogle接続してください'},
            smart:{ settings:player().getRecommendationLaunchSettings(), folders:(data?.folders || []).map(folder => ({id:folder.folderId,name:short(folder.name),revision:folder.folderRevision,count:folder.items.length})),
                preview:preview ? {id:previewId,conditions:previewConditions,items:preview.items.map(item => ({contentKey:item.contentKey,title:short(item.title),reasons:item.reasons})),count:preview.items.length} : null } };
    }
    function requireFields(args, names) {
        if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !names.includes(key))) throw new Error('操作内容が不正です。');
    }
    function selectionSettings(args) {
        requireFields(args,['mode','profile','length','scope','folderId']);
        if (!['smartRandom','uniformRandom'].includes(args.mode) || !['standard','stable','explore','rediscover'].includes(args.profile)
            || !Number.isInteger(args.length) || args.length<1 || args.length>200 || !['library','favorites','folder'].includes(args.scope)) throw new Error('選曲条件が範囲外です。');
        if(args.scope==='folder' && !snapshot().folders.some(folder=>folder.id===args.folderId && !folder.id.startsWith('__')))throw new Error('対象フォルダを選んでください。');
        return {mode:args.mode,profile:args.profile,length:args.length,scope:args.scope==='folder'?'folder:'+args.folderId:args.scope};
    }
    async function playReferences(refs, context, queue) {
        const fresh = await adapter().state();
        const songs = refs.map(ref => {const record=fresh.records.find(item => !item.deleted && keyOf(item) === ref.contentKey);return record?{...record,_cmsPlayContext:{...context,originMode:ref.originMode || null,originQueueId:ref.originQueueId || null,originProfile:ref.originProfile || null,originEngineVersion:ref.originEngineVersion || null,originConfigVersion:ref.originConfigVersion || null}}:null;}).filter(Boolean);
        if (!songs.length) throw new Error('再生できる登録曲がありません。');
        const valid=new Set(songs.map(keyOf)),active=queue?{...queue,items:queue.items.filter(item=>valid.has(item.contentKey))}:null;
        if(active){active.actualLength=active.items.length;delete active.inputSnapshot;}
        await adapter().play(songs, context, active); await refresh();
    }
    async function dispatch(action, args) {
        if (['play','next','previous','seek','volume','lock','track'].includes(action)) {
            const specs = {play:['playing'],next:[],previous:[],seek:['ratio'],volume:['volume'],lock:['locked'],track:['contentKey','folderId','sort','queueId','queueRevision','queueItemId']};
            requireFields(args,specs[action]);
            if (action==='play' && typeof args.playing!=='boolean' || action==='lock' && typeof args.locked!=='boolean'
                || action==='seek' && (!Number.isFinite(args.ratio)||args.ratio<0||args.ratio>1)
                || action==='volume' && (!Number.isFinite(args.volume)||args.volume<0||args.volume>100)) throw new Error('操作値が範囲外です。');
            if (action==='track' && (typeof args.contentKey!=='string' || !snapshot().folders.some(folder=>folder.id===args.folderId) || !['custom','newest','oldest','title_asc','playCount_desc'].includes(args.sort))) throw new Error('曲一覧が変更されました。');
            await player().remotePlayback(action,args); return;
        }
        if (action==='settings') { player().remoteSettings(args); return; }
        if (action==='cloud.refresh') {
            requireFields(args,[]);
            if(!window.CmsWebFirebase?.getSyncStatus?.().connected)throw new Error('先にPCでGoogle接続してください。');
            if (Date.now()-lastCloudRefresh<15000) throw new Error('更新確認は15秒ほど間隔を空けてください。');
            lastCloudRefresh=Date.now(); await window.CmsWebFirebase.sync({force:false,silent:true}); await refresh(); return;
        }
        await refresh();
        if (!data) throw new Error('先にPCでライブラリを読み込んでください。');
        if (action==='favorite') {
            requireFields(args,['contentKey','favorite']);
            if (typeof args.favorite!=='boolean' || !data.records.some(item=>keyOf(item)===args.contentKey)) throw new Error('お気に入りの対象が見つかりません。');
            await adapter().preference(args.contentKey,'favorite',args.favorite);
        } else if (action==='smart.refresh') { requireFields(args,[]); }
        else if (action==='smart.settings') {
            const settings=selectionSettings(args);
            player().setRecommendationLaunchSettings(settings); preview=null;previewId='';previewConditions=null;
        }
        else if (action==='smart.exclusions') {
            requireFields(args,['folders','tags']);
            if (!Array.isArray(args.folders) || !Array.isArray(args.tags) || args.folders.length>200 || args.tags.length>100 || [...args.folders,...args.tags].some(value=>typeof value!=='string'||value.length>120)) throw new Error('除外設定が不正です。');
            await adapter().setExcludedFolders(args.folders); await adapter().setExcludedTags(args.tags); preview=null;previewId='';
        } else if (action==='smart.generate') {
            const desired=selectionSettings(args),settings=player().getRecommendationLaunchSettings();
            if(desired.mode!==settings.mode || desired.profile!==settings.profile || desired.length!==settings.length || desired.scope!==settings.scope)throw new Error('選曲条件が変わっています。「選曲設定をPCに保存」を押してから生成してください。');
            if (!data.migration || !(data.migration.ready || data.migration.status==='ready')) throw new Error('再生記録の共有準備が未完了です。PCで履歴・選曲の同期を確認してください。');
            let scope={type:'library'};
            if (args.scope==='favorites') scope={type:'contentKeys',contentKeys:data.preferences.filter(pref=>pref.favorite).map(pref=>pref.contentKey)};
            if (args.scope==='folder') { if(!snapshot().folders.some(folder=>folder.id===args.folderId && !folder.id.startsWith('__'))) throw new Error('対象フォルダを選んでください。');scope={type:'folder',folderName:args.folderId}; }
            const prepared=engine().prepareCandidates({records:data.records,history:data.history,preferences:data.preferences,relations:[],referenceTime:new Date().toISOString(),timezone:'Asia/Tokyo',scope,
                excludedTags:settings.excludedTags,excludedFolders:settings.excludedFolders,currentContentKey:data.currentContentKey,sessionRecentContentKeys:data.sessionRecentContentKeys || [],historyLimit:data.historyLimit || 2000});
            const queue=engine().buildQueue(prepared,{mode:settings.mode,profile:settings.profile,length:settings.length,seed:crypto.getRandomValues(new Uint32Array(1))[0],queueId:typeof crypto.randomUUID==='function'?crypto.randomUUID():Array.from(crypto.getRandomValues(new Uint8Array(16)),value=>value.toString(16).padStart(2,'0')).join('')});
            if (!queue.items.length) throw new Error(queue.emptyReason || '候補がありません。');
            queue.generatedAt=new Date().toISOString(); await adapter().saveQueue(queue); preview=queue;previewId=queue.queueId;
            previewConditions={...args,excludedFolders:settings.excludedFolders.slice().sort(),excludedTags:settings.excludedTags.slice().sort()};
        } else if (action==='smart.playPreview' || action==='smart.savePreview') {
            requireFields(args,action==='smart.savePreview'?['id','name']:['id']);
            if (!preview || args.id!==previewId) throw new Error('プレビューが更新されました。内容を確認し直してください。');
            if (action==='smart.playPreview') await playReferences(preview.items,{source:preview.mode,queueId:preview.queueId,finite:true},preview);
            else { if(typeof args.name!=='string'||!args.name.trim()||args.name.length>120)throw new Error('フォルダ名を入力してください。');await adapter().saveFolder(preview,args.name.trim()); }
        } else if (action==='smart.playFolder' || action==='smart.renameFolder') {
            requireFields(args,action==='smart.renameFolder'?['id','revision','name']:['id','revision']);
            const folder=data.folders.find(folder=>folder.folderId===args.id && folder.folderRevision===args.revision);
            if (!folder) throw new Error('保存フォルダが更新されました。表示を更新してください。');
            if (action==='smart.playFolder') await playReferences(folder.items,{source:'generatedFolder',folderId:folder.folderId,queueId:folder.queueId,finite:true},{...folder.generationSnapshot,queueId:folder.queueId,items:folder.items,actualLength:folder.items.length});
            else {if(typeof args.name!=='string'||!args.name.trim()||args.name.length>120)throw new Error('フォルダ名を入力してください。');await adapter().renameFolder(folder.folderId,folder.folderRevision,args.name.trim());}
        } else throw new Error('この操作はPCで行ってください。');
        await refresh();
    }
    window.CmsRemoteModel=Object.freeze({snapshot,refresh,dispatch});
    window.addEventListener('cms-recommendation-state',()=>{void refresh().then(()=>window.dispatchEvent(new Event('cms-state-change'))).catch(()=>{});});
})();
