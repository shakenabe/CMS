/* Shared UI. Builds DOM with textContent; no library records are rewritten. */
(function () {
  'use strict';
  const adapter = window.CMSRecommendationAdapter, engine = window.CMSRecommendationEngine;
  if (!adapter || !engine) return;
  let snapshot = null, preview = null, busy = false, starTimer, previewNeedsRegeneration = false, appendRequest = null, folderUpdateTarget = null, runSerial=0, refreshSerial=0;
  const element = (tag, text, parent) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (parent) parent.append(node); return node; };
  const style = element('style', `
.cms-rec-launcher { position:fixed; right:18px; bottom:82px; z-index:9000; display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; max-width:calc(100vw - 32px); }
.cms-rec-launcher[hidden],.cms-rec-details[hidden],.cms-rec-history-entry[hidden] { display:none!important; }
.cms-rec-open,.cms-rec-details { padding:10px 16px; border-radius:22px; background:#173d66; color:#fff; border:1px solid #8db7e2; cursor:pointer; }
.cms-rec-details { padding:10px 12px; background:#243748; } .cms-rec-open:disabled,.cms-rec-details:disabled { opacity:.65; cursor:wait; }
.cms-rec-dialog { --cms-rec-bg:var(--bg-card,var(--theme-surface,#fff)); --cms-rec-fg:var(--text-primary,var(--theme-text,#18212b)); width:min(860px,94vw); max-height:86vh; padding:20px; border:1px solid #8198ab; border-radius:14px; background:var(--cms-rec-bg); color:var(--cms-rec-fg); box-shadow:0 12px 60px #0006; }
.cms-rec-dialog::backdrop { background:#0008; } .cms-rec-dialog button,.cms-rec-dialog select,.cms-rec-dialog input { padding:7px; margin:4px; color:var(--cms-rec-fg); background:var(--cms-rec-bg); border:1px solid #8092a8; border-radius:6px; cursor:pointer; }
.cms-rec-dialog[open] { display:flex; flex-direction:column; height:min(760px,86vh); overflow:hidden; }
.cms-rec-dialog > h2,.cms-rec-dialog > .cms-rec-tools,.cms-rec-dialog > .cms-rec-status { flex-shrink:0; }
.cms-rec-tools { display:flex; flex-wrap:wrap; align-items:center; gap:4px; } .cms-rec-status { white-space:pre-wrap; padding:10px 0; } .cms-rec-body { flex:1; min-height:0; overflow:auto; }
.cms-rec-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #8198ab44; } .cms-rec-title { flex:1; min-width:120px; overflow-wrap:anywhere; } .cms-rec-reason { display:block; font-size:12px; opacity:.8; margin-top:4px; }
.cms-rec-star { font-size:19px; padding:3px 7px; border:1px solid #8292a3; border-radius:6px; background:transparent; color:inherit; cursor:pointer; flex:none; }
.cms-rec-star[aria-pressed="true"] { color:#b77700; background:#ffd46522; } .cms-rec-debug { white-space:pre-wrap; font-size:12px; }
@media(max-width:600px) { .cms-rec-dialog { padding:12px; } .cms-rec-launcher { right:8px; bottom:100px; } }
`, document.head);
  style.id = 'cms-recommendation-style';
  const launcher = element('div', null, document.body); launcher.className = 'cms-rec-launcher';
  const open = element('button', '★ おすすめ / 選曲', launcher); open.className = 'cms-rec-open'; open.id = 'cms-open-recommendations'; open.type='button';
  const details = element('button', '選曲詳細', launcher); details.className='cms-rec-details'; details.id='cms-recommendation-details'; details.type='button'; details.hidden=true;
  const dialog = element('dialog', null, document.body); dialog.className = 'cms-rec-dialog'; dialog.id = 'cms-recommendations';
  const heading = element('h2', 'おすすめ・Smart Random', dialog);
  const tools = element('div', null, dialog); tools.className = 'cms-rec-tools';
  function button(label, action, parent = tools) {
    const b = element('button', label, parent); b.type = 'button';
    b.addEventListener('click', () => void run(action)); return b;
  }
  function select(label, options) {
    const wrap = element('label', label, tools), node = element('select', null, wrap);
    node.setAttribute('aria-label',label.trim());
    for (const [value, text] of options) { const option = element('option', text, node); option.value = value; }
    return node;
  }
  const mode = select('モード ', [['smartRandom','Smart Random'],['uniformRandom','全曲から均等']]);
  const profile = select('配分 ', [['standard','標準 14 / 4 / 2'],['stable','安定 16 / 3 / 1'],['explore','発掘 11 / 4 / 5'],['rediscover','再発見 10 / 8 / 2']]);
  const lengthWrap = element('label', '曲数 ', tools), length = element('input', null, lengthWrap);
  length.type = 'number'; length.min = '1'; length.max = '200'; length.value = '20'; length.style.width = '65px';
  const scope = select('対象 ', [['library','全ライブラリ'],['currentFolder','現在表示中のフォルダ'],['favorites','★ お気に入りだけ'],['vocaloid','ボカロの登録曲'],['site:youtube','YouTube'],['site:niconico','ニコニコ']]);
  const operation = select('プレビュー ', [['replace','新規生成'],['append','前のプレビューに追加'],['appendActive','再生キューに追加']]);
  const debugWrap = element('label', '内訳 ', tools), debug = element('input', null, debugWrap); debug.type = 'checkbox';
  const status = element('div', '', dialog); status.className = 'cms-rec-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const body = element('div', null, dialog); body.className = 'cms-rec-body';
  const actions = element('div', null, dialog); actions.className = 'cms-rec-tools';
  const folderNameWrap=element('label','フォルダ名 ',tools),folderName=element('input',null,folderNameWrap);
  folderName.type='text';folderName.value='スマート選曲';folderName.maxLength=120;folderName.setAttribute('aria-label','生成フォルダ名');
  button('おすすめを更新', refresh);
  button('推薦データを同期', async () => { await adapter.sync(); await refresh(); });
  button('キューを生成', generate);
  // Closing is never serialized behind cloud/storage work.
  const close=element('button','閉じる',actions);close.type='button';close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{busy=false;runSerial++;refreshSerial++;setBusyState(false);});
  const play = button('プレビューを再生', async () => {
    if (previewNeedsRegeneration) throw new Error('条件を変更したため、先にキューを再生成してください。');
    if (!preview?.items.length) throw new Error('先にキューを生成してください。');
    await playReferences(appendRequest ? appendRequest.suffix.items : preview.items, { source: preview.mode, queueId: preview.queueId }, preview);
  }, actions);
  const save = button('生成フォルダとして保存', async () => {
    if (previewNeedsRegeneration) throw new Error('条件を変更したため、先にキューを再生成してください。');
    if (!preview?.items.length) throw new Error('先にキューを生成してください。');
    if(folderUpdateTarget) {
      const updated=await adapter.updateFolder(folderUpdateTarget.folderId,folderUpdateTarget.folderRevision,preview);
      folderUpdateTarget=null;save.textContent='生成フォルダとして保存';await refresh();
      status.textContent='「'+updated.name+'」をv'+updated.folderRevision+'に更新しました。旧版は復元用に保持しています。';
      return;
    }
    const name = folderName.value.trim();
    if (!name) throw new Error('フォルダ名を入力してください。');
    const folder = await adapter.saveFolder(preview, name); await refresh();
    status.textContent = '「' + folder.name + '」を固定順フォルダとして保存しました。';
  }, actions);
  button('新規保存に戻す',()=>{folderUpdateTarget=null;save.textContent='生成フォルダとして保存';status.textContent='既存フォルダは変更せず、新規保存します。';},actions);
  play.disabled = save.disabled = true;
  for (const control of [mode,profile,length,scope,operation]) control.addEventListener('change',()=>{
    if (!preview) return;
    previewNeedsRegeneration=true;play.disabled=save.disabled=true;
    status.textContent='生成条件を変更しました。プレビューは古い条件のままです。キューを再生成してください。';
  });
  function getLaunchSettings() {
    const value=adapter.getLaunchSettings?.() || {};
    return { enabled:value.enabled!==false, behavior:value.behavior==='play'?'play':'panel',
      profile:['standard','stable','explore','rediscover'].includes(value.profile)?value.profile:'standard',
      length:Math.max(1,Math.min(200,Math.floor(Number(value.length) || 20))),
      scope:['library','currentFolder','favorites','vocaloid'].includes(value.scope)?value.scope:'library' };
  }
  function setBusyState(value) {
    open.disabled=value; details.disabled=value;
    open.setAttribute('aria-busy',String(value));
  }
  function applyLaunchSettings({ updateControls=false, cancelPending=false }={}) {
    const settings=getLaunchSettings();
    if (cancelPending || !settings.enabled) { runSerial++; refreshSerial++; busy=false;setBusyState(false); }
    launcher.hidden=!settings.enabled;
    details.hidden=!settings.enabled || settings.behavior!=='play';
    open.textContent=settings.behavior==='play'?'▶ スマート選曲':'★ おすすめ / 選曲';
    open.setAttribute('aria-label',open.textContent);
    open.title=settings.behavior==='play'?'設定した対象・配分でキューを生成し、そのまま再生':'おすすめの確認・キュー生成・フォルダ保存';
    for (const entry of document.querySelectorAll('.cms-rec-history-entry')) entry.hidden=!settings.enabled;
    if (!settings.enabled && dialog.open) dialog.close();
    if (updateControls) {
      const changed=profile.value!==settings.profile || length.value!==String(settings.length) || scope.value!==settings.scope;
      profile.value=settings.profile;length.value=String(settings.length);scope.value=settings.scope;
      if (changed && preview) { previewNeedsRegeneration=true;play.disabled=save.disabled=true; }
    }
    return settings;
  }
  async function openPanel() {
    if (!getLaunchSettings().enabled) return;
    if (!dialog.open) dialog.showModal();
    return run(refresh);
  }
  async function launch() {
    const settings=getLaunchSettings();
    if (!settings.enabled) return;
    if (settings.behavior==='panel') return openPanel();
    return run(async isCurrent => {
      const next=await adapter.state();
      if (!isCurrent()) return;
      const queue=engine.buildQueue(prepare(next,getScope(settings.scope,next)), { mode:'smartRandom',profile:settings.profile,length:settings.length,
        seed:crypto.getRandomValues(new Uint32Array(1))[0],queueId:crypto.randomUUID(),operation:'replace' });
      queue.generatedAt=new Date().toISOString();
      if (!queue.items.length) throw new Error(queue.emptyReason || 'この対象に再生できる候補がありません。対象設定を変更してください。');
      queue.segments=[{generationQueueId:queue.queueId,mode:queue.mode,profile:queue.profile,engineVersion:queue.engineVersion,
        configVersion:queue.configVersion,seed:queue.seed,inputSnapshotHash:queue.inputSnapshotHash,
        requestedQuota:queue.requestedQuota,actualCounts:queue.actualCounts,start:0,length:queue.items.length}];
      if (!isCurrent()) return;
      await adapter.saveQueue(queue);
      if (!isCurrent()) return;
      const started=await playReferences(queue.items,{source:'smartRandom',queueId:queue.queueId,profile:queue.profile},queue,isCurrent);
      if (!started || !isCurrent()) return;
      snapshot=next;preview=queue;appendRequest=null;folderUpdateTarget=null;previewNeedsRegeneration=false;
      mode.value='smartRandom';profile.value=settings.profile;length.value=String(settings.length);scope.value=settings.scope;operation.value='replace';
      play.textContent='プレビューを再生';save.textContent='生成フォルダとして保存';play.disabled=save.disabled=false;
      renderStars();
    }, { showError:true });
  }
  async function run(action, { showError=false }={}) {
    if (busy) return;
    const serial=++runSerial;
    busy = true;setBusyState(true);
    const isCurrent=()=>serial===runSerial && getLaunchSettings().enabled;
    try { await action(isCurrent); } catch (error) {
      if (serial!==runSerial) return;
      const message=error.message || String(error);status.textContent=message;
      if (showError && getLaunchSettings().enabled) {
        if (!dialog.open) dialog.showModal();
        window.CmsUI?.notify?.(message,{type:'warning',title:'スマート選曲'});
      }
    }
    finally { if(serial===runSerial) { busy = false;setBusyState(false); } }
  }
  function getScope(value=scope.value, state=snapshot) {
    if (value==='favorites') return {type:'contentKeys',contentKeys:(state?.preferences || []).filter(pref=>pref.favorite).map(pref=>pref.contentKey)};
    if (value==='currentFolder' || value==='vocaloid') {
      const selected=value==='currentFolder'?adapter.getCurrentScope?.():adapter.getVocaloidScope?.();
      if (!selected || !['records','library'].includes(selected.type) || (value==='vocaloid' && selected.type!=='records')) throw new Error('この対象を取得できません。対象設定を変更してください。');
      return selected.type==='records'?{type:'records',recordIds:[...(selected.recordIds || [])]}:{type:'library'};
    }
    if (value.startsWith('folder:')) return {type:'folder',folderName:decodeURIComponent(value.slice(7))};
    return value.startsWith('site:') ? { type:'site', site:value.slice(5) } : { type:'library' };
  }
  function prepare(state=snapshot, selectedScope=getScope()) {
    const migration = state.migration;
    if (!migration || (migration.ready !== true && migration.status !== 'ready')) throw new Error('共有baselineの確認待ちです。「推薦データを同期」を実行してください。通常再生はそのまま利用できます。');
    return engine.prepareCandidates({ records:state.records, history:state.history, preferences:state.preferences, relations:[],
      referenceTime:new Date().toISOString(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
      scope:selectedScope, currentContentKey:state.currentContentKey, sessionRecentContentKeys:state.sessionRecentContentKeys || [], historyLimit:state.historyLimit || 1000 });
  }
  async function refresh() {
    const serial=++refreshSerial;
    const next=await adapter.state();
    if(serial!==refreshSerial) return;
    snapshot=next;
    for (const name of new Set(snapshot.records.flatMap(item => item.folders || [item.folder]).filter(Boolean))) {
      const value='folder:'+encodeURIComponent(name);
      if (![...scope.options].some(option=>option.value===value)) element('option','フォルダ: '+name,scope).value=value;
    }
    renderStars();
    body.replaceChildren();
    status.textContent = 'エンジン v' + engine.VERSION + ' · 過去の再生回数は嗜好の確定値ではありません。';
    let sections;
    try { sections = engine.buildRecommendationSections(prepare()); }
    catch (error) { status.textContent = error.message; }
    if (sections) {
      const favoriteKeys=new Set(snapshot.preferences.filter(pref=>pref.favorite).map(pref=>pref.contentKey));
      const favorites=[...sections.core,...sections.rediscovery,...sections.discovery].filter(candidate=>favoriteKeys.has(candidate.contentKey));
      element('h3','★ お気に入り',body);
      if (!favorites.length) element('p','一覧の☆を押すと、お気に入りとしてここに表示されます。',body);
      for (const candidate of favorites) renderCandidate(candidate,body);
      for (const [key, name] of [['core','よく聴いている曲'],['rediscovery','久しぶりに聴く曲'],['discovery','まだあまり聴いていない曲'],['recent','最近の記録（統計）']]) {
        element('h3', name, body);
        if (!sections[key].length) element('p','この条件に合う候補はありません。',body);
        for (const candidate of sections[key]) renderCandidate(candidate, body);
      }
    }
    element('h3','保存した生成フォルダ', body);
    if (!snapshot.folders?.length) element('p','プレビューを生成し、固定順フォルダとして保存できます。',body);
    for (const folder of snapshot.folders || []) {
      const row = element('div', null, body); row.className = 'cms-rec-row';
      element('span', folder.name + ' · ' + folder.items.length + '曲', row);
      button('再生', () => playReferences(folder.items, { source:'generatedFolder', folderId:folder.folderId, queueId:folder.queueId }), row);
      button('再生成の対象',()=>{
        const recipe=folder.queue || folder.generationSnapshot || {};
        folderUpdateTarget={folderId:folder.folderId,folderRevision:folder.folderRevision};
        mode.value=recipe.mode || folder.mode || 'smartRandom';profile.value=recipe.profile || 'standard';length.value=String(folder.items.length);
        operation.value='replace';appendRequest=null;previewNeedsRegeneration=true;
        const oldScope=recipe.scope || {type:'library'};
        const scopeValue=oldScope.type==='folder'?'folder:'+encodeURIComponent(oldScope.folderName):oldScope.type==='site'?'site:'+oldScope.site:'library';
        if(![...scope.options].some(option=>option.value===scopeValue)) element('option','元の対象: '+(oldScope.folderName || oldScope.site || '全ライブラリ'),scope).value=scopeValue;
        scope.value=scopeValue;play.disabled=save.disabled=true;save.textContent='このフォルダを更新（旧版保持）';
        status.textContent='更新対象: '+folder.name+' v'+folder.folderRevision+'。条件を確認してキューを生成し、プレビュー後に更新してください。';
      },row);
      if(folder.revisionHistory?.length) {
        const choice=element('select',null,row);choice.setAttribute('aria-label',folder.name+'の旧版');
        for(const revision of [...folder.revisionHistory].reverse()) element('option','v'+revision.folderRevision,choice).value=String(revision.folderRevision);
        button('旧版をプレビュー',async()=>{
          const version=await adapter.folderVersion(folder.folderId,Number(choice.value));
          const recipe=version.queue || version.generationSnapshot || {};
          preview={...recipe,items:version.items,actualLength:version.items.length,segments:version.segments || recipe.segments || [],restoredFromRevision:version.folderRevision};
          previewNeedsRegeneration=false;appendRequest=null;folderUpdateTarget={folderId:folder.folderId,folderRevision:folder.folderRevision};
          play.textContent='プレビューを再生';save.textContent='このフォルダを更新（旧版保持）';
          await refresh();status.textContent='v'+version.folderRevision+'の順序を表示しています。更新を確定すると、新しい版として復元します。';
        },row);
      }
    }
    if (preview) renderPreview();
    const excluded = snapshot.preferences.filter(pref => pref.excludedFromRecommendations);
    if (excluded.length) {
      element('h3','おすすめの対象外',body);
      for (const pref of excluded) {
        const record = snapshot.records.find(item => engine.normalizeContentKey(item) === pref.contentKey);
        const row = element('div',null,body); row.className='cms-rec-row';
        element('span',record?.title || pref.contentKey,row);
        button('対象に戻す',async () => { await adapter.preference(pref.contentKey,'excludedFromRecommendations',false); await refresh(); },row);
      }
    }
  }
  function preference(key) { return (snapshot?.preferences || []).find(item => item.contentKey === key) || {}; }
  function star(record, parent) {
    const key = engine.normalizeContentKey(record); if (!key) return null;
    const b = element('button', preference(key).favorite ? '★':'☆', parent); b.className = 'cms-rec-star'; b.type = 'button'; b.dataset.contentKey = key;
    b.setAttribute('aria-label','お気に入りを切り替え'); b.setAttribute('aria-pressed', String(Boolean(preference(key).favorite)));
    b.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void run(async () => {
      snapshot = await adapter.state();
      await adapter.preference(key,'favorite',!preference(key).favorite); await refresh();
    }); });
    return b;
  }
  function renderCandidate(candidate, parent) {
    const row = element('div', null, parent); row.className = 'cms-rec-row'; star(candidate,row);
    const title = element('div', candidate.title || candidate.url, row); title.className = 'cms-rec-title';
    const reason = element('small', (candidate.reasons || []).join(' / '), title); reason.className = 'cms-rec-reason';
    button('再生', () => playReferences([candidate], { source:'recommendation' }), row);
    button('対象外', async () => { await adapter.preference(candidate.contentKey,'excludedFromRecommendations',true); await refresh(); }, row);
    if (debug.checked) { const detail = element('details',null,title); element('summary','スコア内訳',detail); const pre=element('pre',JSON.stringify({ bucket:candidate.bucket, weight:candidate.weight, breakdown:candidate.breakdown, reasons:candidate.reasonCodes },null,2),detail); pre.className='cms-rec-debug'; }
  }
  async function generate(isCurrent=()=>true) {
    const next=await adapter.state();
    if (!isCurrent()) return;
    snapshot = next;
    const prepared = prepare();
    const base=operation.value==='appendActive' ? snapshot.activeQueue : preview;
    const appending=operation.value!=='replace';
    const queue = engine.buildQueue(prepared, { mode:mode.value, profile:profile.value, length:Number(length.value),
      seed:crypto.getRandomValues(new Uint32Array(1))[0], queueId:crypto.randomUUID(),
      operation:appending?'append':'replace', baseQueue:appending?base:null });
    queue.generatedAt = new Date().toISOString();
    if (!queue.items.length) throw new Error(queue.emptyReason || '候補がありません。');
    const segment={generationQueueId:queue.queueId,mode:queue.mode,profile:queue.profile,engineVersion:queue.engineVersion,
      configVersion:queue.configVersion,seed:queue.seed,inputSnapshotHash:queue.inputSnapshotHash,
      requestedQuota:queue.requestedQuota,actualCounts:queue.actualCounts,start:appending?base.items.length:0,length:queue.items.length};
    await adapter.saveQueue(queue);
    if (!isCurrent()) return;
    appendRequest=operation.value==='appendActive' ? {expected:{queueId:base.queueId,queueRevision:base.queueRevision,length:base.items.length},suffix:queue} : null;
    if (appending) {
      const combined=base.items.concat(queue.items);
      preview={...base,items:combined,actualLength:combined.length,queueRevision:(base.queueRevision || 1)+1,
        segments:[...(base.segments || []),segment]};
    } else preview={...queue,segments:[segment]};
    previewNeedsRegeneration=false;
    play.textContent=appendRequest?'追加を確定':'プレビューを再生';
    await refresh();
    status.textContent = preview.actualLength + '曲のプレビューです。再生するまで現在の再生は変わりません。末尾で停止します。';
  }
  function renderPreview() {
    const section = element('section', null, body); element('h3','固定キューのプレビュー · ' + preview.actualLength + '曲',section);
    for (const segment of preview.segments || []) element('p','生成分 '+segment.length+'曲 · seed '+segment.seed+' / 実配分 '+JSON.stringify(segment.actualCounts),section);
    for (const [index,candidate] of preview.items.entries()) { const line=element('p',(index+1)+'. '+(candidate.title || candidate.url),section); element('small',(candidate.reasons || []).join(' / '),line).className='cms-rec-reason'; }
    if (debug.checked) { const details=element('details',null,section); element('summary','生成診断（入力ハッシュ・緩和情報）',details); element('pre',JSON.stringify({engineVersion:preview.engineVersion,configVersion:preview.configVersion,inputSnapshotHash:preview.inputSnapshotHash,diagnostics:preview.diagnostics},null,2),details).className='cms-rec-debug'; }
    play.disabled = save.disabled = previewNeedsRegeneration;
  }
  async function playReferences(references, context, queue = null, isCurrent=()=>true) {
    const fresh = await adapter.state(), records = fresh.records;
    if (!isCurrent()) return false;
    const items = references.map(ref => {
      const ids = ref.playbackRecordIds || ref.recordIds || [ref.recordId];
      const record = records.find(item => !item.deleted && ids.includes(item.id) && engine.normalizeContentKey(item) === ref.contentKey)
        || records.find(item => !item.deleted && engine.normalizeContentKey(item) === ref.contentKey);
      return record ? { ...record, _cmsPlayContext:{...context,originMode:ref.originMode || null,originQueueId:ref.originQueueId || null,
        originProfile:ref.originProfile || null,originEngineVersion:ref.originEngineVersion || null,originConfigVersion:ref.originConfigVersion || null} } : null;
    }).filter(Boolean);
    if (!items.length) throw new Error('登録が削除されたため再生できません。元登録は復元しません。');
    let active=null;
    if (queue) {
      const valid=new Set(items.map(item=>engine.normalizeContentKey(item)));
      const prefix=queue===preview && appendRequest ? queue.items.slice(0,appendRequest.expected.length) : [];
      active={...queue,items:prefix.concat(references.filter(ref=>valid.has(ref.contentKey)))};
      active.actualLength=active.items.length;
      delete active.inputSnapshot;
    }
    if (queue===preview && appendRequest) {
      await adapter.append(items,active,appendRequest.expected);
      if (!isCurrent()) return false;
      status.textContent=items.length+'曲を末尾に追加しました。現在の曲・再生位置・既存の順序は変えていません。';
      return true;
    }
    if (!isCurrent()) return false;
    const started=await adapter.play(items,context,active,isCurrent);
    if (started===false) return false;
    if (!isCurrent()) return false;
    status.textContent = items.length + '曲の固定順で再生を開始しました。' + (items.length<references.length?'削除済みの参照はスキップしました。':'');
    return true;
  }
  function renderStars() {
    const history = adapter.historyContainer?.();
    if (history && !history.querySelector('.cms-rec-history-entry')) {
      const entry = element('button','★ おすすめ：お気に入りや再生記録から選曲',history);
      entry.type='button';entry.className='cms-rec-history-entry';entry.addEventListener('click',()=>void launch());history.prepend(entry);
    }
    const settings=getLaunchSettings();
    for (const entry of document.querySelectorAll('.cms-rec-history-entry')) entry.hidden=!settings.enabled;
    for (const row of document.querySelectorAll(adapter.rowSelector)) {
      const record = adapter.rowRecord(row), key = engine.normalizeContentKey(record);
      if (!key) continue;
      let b = row.querySelector('.cms-rec-star');
      if (!b) b = star(record,row);
      if (!b) continue;
      // Virtualized rows may be reused for a different video; recreate its bound handler.
      if (b.dataset.contentKey !== key) { b.remove(); b = star(record,row); }
      const value=Boolean(preference(key).favorite), text=value?'★':'☆';
      if (b.textContent!==text) b.textContent=text;
      if (b.getAttribute('aria-pressed')!==String(value)) b.setAttribute('aria-pressed',String(value));
    }
  }
  open.addEventListener('click', () => void launch());
  details.addEventListener('click',()=>void openPanel());
  debug.addEventListener('change', () => void run(refresh));
  const observer = new MutationObserver(changes => {
    if (!changes.some(change=>!dialog.contains(change.target) && !change.target.closest?.('.cms-rec-star'))) return;
    clearTimeout(starTimer); starTimer=setTimeout(renderStars,150);
  });
  observer.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('cms-recommendation-settings-change',()=>{
    applyLaunchSettings({updateControls:true,cancelPending:true});renderStars();
  });
  applyLaunchSettings({updateControls:true});
  // Load only after a real library exists; never freeze an empty Web baseline.
  setTimeout(() => adapter.state().then(value => { snapshot=value; renderStars(); }).catch(() => {}),1500);
  window.CMSRecommendationUI = { refresh:() => run(refresh),openPanel,launch };
})();

