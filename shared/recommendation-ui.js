/* Shared UI. Builds DOM with textContent; no library records are rewritten. */
(function () {
  'use strict';
  const adapter = window.CMSRecommendationAdapter, engine = window.CMSRecommendationEngine;
  if (!adapter || !engine) return;
  let snapshot = null, preview = null, busy = false, starTimer, previewNeedsRegeneration = false, appendRequest = null, folderUpdateTarget = null, runSerial=0, refreshSerial=0;
  let launchPending=false,launchSerial=0,pendingConfirmation=null,appliedExcludedTagsKey=null;
  const element = (tag, text, parent) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (parent) parent.append(node); return node; };
  const style = element('style', `
.cms-rec-launcher { position:fixed; right:18px; bottom:82px; z-index:9000; display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; max-width:calc(100vw - 32px); }
.cms-rec-launcher[hidden],.cms-rec-details[hidden],.cms-rec-history-entry[hidden] { display:none!important; }
.cms-rec-open,.cms-rec-details { padding:10px 16px; border-radius:22px; background:#173d66; color:#fff; border:1px solid #8db7e2; cursor:pointer; }
.cms-rec-details { padding:10px 12px; background:#243748; } .cms-rec-open:disabled,.cms-rec-details:disabled { opacity:.65; cursor:wait; }
.cms-rec-dialog { --cms-rec-bg:var(--bg-card,var(--theme-surface,#fff)); --cms-rec-fg:var(--text-primary,var(--theme-text,#18212b)); width:min(860px,94vw); max-height:86vh; padding:20px; border:1px solid #8198ab; border-radius:14px; background:var(--cms-rec-bg); color:var(--cms-rec-fg); box-shadow:0 12px 60px #0006; }
.cms-rec-dialog::backdrop { background:#0008; } .cms-rec-dialog button,.cms-rec-dialog select,.cms-rec-dialog input,.cms-rec-dialog textarea { padding:7px; margin:4px; color:var(--cms-rec-fg); background:var(--cms-rec-bg); border:1px solid #8092a8; border-radius:6px; cursor:pointer; }
.cms-rec-dialog[open] { display:flex; flex-direction:column; height:min(760px,86vh); overflow:hidden; }
.cms-rec-dialog > h2,.cms-rec-dialog > .cms-rec-tools,.cms-rec-dialog > .cms-rec-status { flex-shrink:0; }
.cms-rec-tools { display:flex; flex-wrap:wrap; align-items:center; gap:4px; } .cms-rec-status { white-space:pre-wrap; padding:10px 0; } .cms-rec-body { flex:1; min-height:0; overflow:auto; }
.cms-rec-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid #8198ab44; } .cms-rec-title { flex:1; min-width:120px; overflow-wrap:anywhere; } .cms-rec-reason { display:block; font-size:12px; opacity:.8; margin-top:4px; }
.cms-rec-star { font-size:19px; padding:3px 7px; border:1px solid #8292a3; border-radius:6px; background:transparent; color:inherit; cursor:pointer; flex:none; }
.cms-rec-star[aria-pressed="true"] { color:#b77700; background:#ffd46522; } .cms-rec-debug { white-space:pre-wrap; font-size:12px; }
.cms-rec-help { margin:6px 0; font-size:13px; line-height:1.5; opacity:.85; }
.cms-rec-exclusions { flex-shrink:0; margin:6px 0; } .cms-rec-exclusions summary { cursor:pointer; }
.cms-rec-exclusions textarea { display:block; width:calc(100% - 10px); max-height:100px; resize:vertical; cursor:text; box-sizing:border-box; }
.cms-rec-confirm[open] { width:min(500px,92vw); height:auto; max-height:85vh; overflow:auto; gap:10px; }
.cms-rec-confirm p { margin:0; white-space:pre-line; line-height:1.6; } .cms-rec-confirm input { display:block; width:calc(100% - 10px); box-sizing:border-box; cursor:text; }
.cms-rec-confirm [hidden] { display:none!important; } .cms-rec-confirm .cms-rec-danger { border-color:#bf6262; color:#b63b3b; }
@media(max-width:600px) { .cms-rec-dialog { padding:12px; } .cms-rec-launcher { right:8px; bottom:100px; } }
`, document.head);
  style.id = 'cms-recommendation-style';
  const launcher = element('div', null, document.body); launcher.className = 'cms-rec-launcher';
  const open = element('button', '★ おすすめ / 選曲', launcher); open.className = 'cms-rec-open'; open.id = 'cms-open-recommendations'; open.type='button';
  const details = element('button', '選曲詳細', launcher); details.className='cms-rec-details'; details.id='cms-recommendation-details'; details.type='button'; details.hidden=true;
  const dialog = element('dialog', null, document.body); dialog.className = 'cms-rec-dialog'; dialog.id = 'cms-recommendations';
  const heading = element('h2', 'おすすめ・スマート選曲', dialog);
  element('p','おすすめの確認や条件の変更だけでは再生を切り替えません。曲順を作り、内容を確認してから再生・保存できます。',dialog).className='cms-rec-help';
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
  const mode = select('モード ', [['smartRandom','好みと未再生曲を混ぜる'],['uniformRandom','全曲を均等に選ぶ']]);
  const profile = select('選び方 ', [['standard','標準：好み・久しぶり・発掘をバランスよく'],['stable','お気に入り・よく聴く曲を多めに'],['explore','まだあまり聴いていない曲を多めに'],['rediscover','久しぶりの曲を多めに']]);
  const lengthWrap = element('label', '曲数 ', tools), length = element('input', null, lengthWrap);
  length.type = 'number'; length.min = '1'; length.max = '200'; length.value = '20'; length.style.width = '65px';
  const scope = select('対象 ', [['library','全ライブラリ'],['currentFolder','現在表示中のフォルダ'],['favorites','★ お気に入りだけ'],['vocaloid','ボカロの登録曲'],['site:youtube','YouTube'],['site:niconico','ニコニコ']]);
  const operation = select('プレビュー ', [['replace','新規生成'],['append','前のプレビューに追加'],['appendActive','再生キューに追加']]);
  const debugWrap = element('label', '内訳 ', tools), debug = element('input', null, debugWrap); debug.type = 'checkbox';
  const exclusions=element('details',null,dialog);exclusions.className='cms-rec-exclusions';
  const exclusionsSummary=element('summary','選曲から除外するタグ',exclusions);
  const exclusionsLabel=element('label','除外タグ（カンマ・読点・改行で区切る）',exclusions),excludedTagsInput=element('textarea',null,exclusionsLabel);
  excludedTagsInput.id='cms-rec-excluded-tags';excludedTagsInput.rows=2;excludedTagsInput.maxLength=12000;
  excludedTagsInput.placeholder='例：軍歌、作業用BGM';excludedTagsInput.setAttribute('aria-label','選曲から除外するタグ');
  const exclusionsHelp=element('p','登録タグと完全一致する動画だけを選曲から除外します。動画やお気に入りは削除しません。',exclusions);exclusionsHelp.className='cms-rec-help';
  const applyExcludedTags=button('除外タグを保存',async()=>{
    if(typeof adapter.setExcludedTags!=='function') throw new Error('この環境では除外タグを保存できません。更新後に再試行してください。');
    const tags=normalizeExcludedTags(excludedTagsInput.value);
    await adapter.setExcludedTags(tags);
    excludedTagsInput.value=tags.join('\n');
    previewNeedsRegeneration=Boolean(preview);if(preview)play.disabled=save.disabled=true;
    await refresh();
    exclusionsHelp.textContent='除外タグを保存しました。次に作る選曲リストから適用します。既存の動画は変更していません。';
  },exclusions);
  excludedTagsInput.addEventListener('input',()=>{exclusionsHelp.textContent='まだ保存していません。「除外タグを保存」を押すと選曲に反映します。';});
  const status = element('div', '', dialog); status.className = 'cms-rec-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const body = element('div', null, dialog); body.className = 'cms-rec-body';
  const actions = element('div', null, dialog); actions.className = 'cms-rec-tools';
  const folderNameWrap=element('label','フォルダ名 ',tools),folderName=element('input',null,folderNameWrap);
  folderName.type='text';folderName.value='スマート選曲';folderName.maxLength=120;folderName.setAttribute('aria-label','生成フォルダ名');
  const refreshRecommendations=button('おすすめを見直す', refresh);refreshRecommendations.setAttribute('aria-label','おすすめを見直す');refreshRecommendations.title='端末内の履歴・お気に入りから表示を更新します。曲順は作りません。';
  const syncRecommendations=button('他の端末と同期', async () => { await adapter.sync(); await refresh(); });syncRecommendations.setAttribute('aria-label','他の端末と同期');syncRecommendations.title='他の端末の履歴・お気に入り・保存した選曲を読み込みます。通常は押す必要はありません。';
  button('選曲リストを作成', generate);
  // Closing is never serialized behind cloud/storage work.
  const close=element('button','閉じる',actions);close.type='button';close.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{cancelConfirmation();busy=false;runSerial++;refreshSerial++;setBusyState(false);});
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
  const confirmation=element('dialog',null,document.body);confirmation.id='cms-rec-confirmation';confirmation.className='cms-rec-dialog cms-rec-confirm';
  const confirmationTitle=element('h2','確認',confirmation);confirmationTitle.id='cms-rec-confirmation-title';confirmation.setAttribute('aria-labelledby',confirmationTitle.id);
  const confirmationMessage=element('p','',confirmation);
  const confirmationField=element('label','',confirmation),confirmationInput=element('input',null,confirmationField);confirmationInput.type='text';confirmationInput.maxLength=120;
  confirmationField.prepend(element('span','新しいフォルダ名'));
  const confirmationActions=element('div',null,confirmation);confirmationActions.className='cms-rec-tools';
  const confirmationCancel=element('button','キャンセル',confirmationActions),confirmationAccept=element('button','確認',confirmationActions);
  confirmationCancel.type=confirmationAccept.type='button';confirmationCancel.addEventListener('click',()=>confirmation.close());
  confirmationAccept.addEventListener('click',()=>{
    const pending=pendingConfirmation;if(!pending)return;
    const value=confirmationInput.value.trim();
    if(pending.needsName && !value) { confirmationInput.setCustomValidity('フォルダ名を入力してください。');confirmationInput.reportValidity();return; }
    pendingConfirmation=null;confirmation.close();pending.resolve({confirmed:true,value});
  });
  confirmationInput.addEventListener('input',()=>confirmationInput.setCustomValidity(''));
  confirmationInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();confirmationAccept.click();}});
  confirmation.addEventListener('close',()=>{
    const pending=pendingConfirmation;pendingConfirmation=null;pending?.resolve({confirmed:false});
  });
  confirmation.addEventListener('click',event=>{
    if(event.target!==confirmation)return;
    const bounds=confirmation.getBoundingClientRect();
    if(event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom)confirmation.close();
  });
  function cancelConfirmation() { if(confirmation.open)confirmation.close(); }
  function askConfirmation({title,message,confirmText='確認',name=null,danger=false}) {
    cancelConfirmation();confirmationTitle.textContent=title;confirmationMessage.textContent=message;
    confirmationAccept.textContent=confirmText;confirmationAccept.className=danger?'cms-rec-danger':'';
    confirmationField.hidden=name===null;confirmationInput.value=name || '';confirmationInput.setAttribute('aria-label','新しいフォルダ名');confirmationInput.setCustomValidity('');
    return new Promise(resolve=>{
      pendingConfirmation={resolve,needsName:name!==null};confirmation.showModal();
      if(name!==null){confirmationInput.focus();confirmationInput.select();}else confirmationCancel.focus();
    });
  }
  function normalizeExcludedTags(value) {
    if(engine.normalizeExcludedTags)return engine.normalizeExcludedTags(value);
    return [...new Set((Array.isArray(value)?value:[value || '']).flatMap(tag=>String(tag).split(/[,、，\r\n]+/)).map(tag=>tag.normalize('NFKC').trim().toLocaleLowerCase()).filter(Boolean))].slice(0,100).map(tag=>tag.slice(0,120));
  }
  function getLaunchSettings() {
    const value=adapter.getLaunchSettings?.() || {};
    return { enabled:value.enabled!==false, behavior:value.behavior==='play'?'play':'panel',
      profile:['standard','stable','explore','rediscover'].includes(value.profile)?value.profile:'standard',
      length:Math.max(1,Math.min(200,Math.floor(Number(value.length) || 20))),
      scope:['library','currentFolder','favorites','vocaloid'].includes(value.scope)?value.scope:'library',excludedTags:normalizeExcludedTags(value.excludedTags) };
  }
  function setBusyState(value) {
    open.disabled=value; details.disabled=value;
    open.setAttribute('aria-busy',String(value));
  }
  function applyLaunchSettings({ updateControls=false, cancelPending=false,excludedTagsOnly=false }={}) {
    const settings=getLaunchSettings();
    if (cancelPending || !settings.enabled) { launchSerial++;cancelConfirmation();runSerial++; refreshSerial++; busy=false;setBusyState(false); }
    launcher.hidden=!settings.enabled;
    details.hidden=!settings.enabled || settings.behavior!=='play';
    open.textContent=settings.behavior==='play'?'▶ スマート選曲':'★ おすすめ / 選曲';
    open.setAttribute('aria-label',open.textContent);
    open.title=settings.behavior==='play'?'確認画面で承認してから、設定した対象・選び方で選曲し再生':'おすすめの確認・選曲リストの作成・フォルダ保存';
    for (const entry of document.querySelectorAll('.cms-rec-history-entry')) entry.hidden=!settings.enabled;
    if (!settings.enabled && dialog.open) dialog.close();
    const excludedTagsKey=JSON.stringify(settings.excludedTags);
    const exclusionsChanged=appliedExcludedTagsKey!==null && appliedExcludedTagsKey!==excludedTagsKey;
    if (updateControls) {
      const changed=profile.value!==settings.profile || length.value!==String(settings.length) || scope.value!==settings.scope;
      profile.value=settings.profile;length.value=String(settings.length);scope.value=settings.scope;
      if (changed && preview) { previewNeedsRegeneration=true;play.disabled=save.disabled=true; }
    }
    if(updateControls || excludedTagsOnly) {
      excludedTagsInput.value=settings.excludedTags.join('\n');appliedExcludedTagsKey=excludedTagsKey;
      exclusionsSummary.textContent='選曲から除外するタグ'+(settings.excludedTags.length?'（'+settings.excludedTags.length+'件）':'');
      if (exclusionsChanged && preview) { previewNeedsRegeneration=true;play.disabled=save.disabled=true; }
    }
    return settings;
  }
  async function openPanel() {
    if (!getLaunchSettings().enabled) return;
    launchSerial++;cancelConfirmation();
    if (!dialog.open) dialog.showModal();
    return run(refresh);
  }
  async function launch() {
    const settings=getLaunchSettings();
    if (!settings.enabled) return;
    if (settings.behavior==='panel') return openPanel();
    if(busy || launchPending)return;
    const serial=++launchSerial;launchPending=true;
    const selectedScope=[...scope.options].find(option=>option.value===settings.scope)?.textContent || '全ライブラリ';
    const selectedProfile=[...profile.options].find(option=>option.value===settings.profile)?.textContent || '標準';
    try {
      const answer=await askConfirmation({title:'スマート選曲を開始しますか？',confirmText:'確認して再生',
        message:'対象：'+selectedScope+'\n選び方：'+selectedProfile+'\n曲数：'+settings.length+'曲'+(settings.excludedTags.length?'\n除外タグ：'+settings.excludedTags.join('、'):'')+'\n\n現在再生中の曲・再生キューを、この選曲結果に置き換えます。キャンセルすると何も変更しません。'});
      if(!answer.confirmed || serial!==launchSerial || !getLaunchSettings().enabled)return;
      return await run(async isCurrent => {
      const next=await adapter.state();
      if (!isCurrent()) return;
      const queue=engine.buildQueue(prepare(next,getScope(settings.scope,next),settings.excludedTags), { mode:'smartRandom',profile:settings.profile,length:settings.length,
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
    } finally { launchPending=false; }
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
  function prepare(state=snapshot, selectedScope=getScope(),excludedTags=getLaunchSettings().excludedTags) {
    const migration = state.migration;
    if (!migration || (migration.ready !== true && migration.status !== 'ready')) throw new Error('共有の再生記録が未確認です。「他の端末と同期」を押してから再試行してください。通常の再生はそのまま利用できます。');
    return engine.prepareCandidates({ records:state.records, history:state.history, preferences:state.preferences, relations:[],
      referenceTime:new Date().toISOString(), timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tokyo',
      scope:selectedScope,excludedTags,currentContentKey:state.currentContentKey, sessionRecentContentKeys:state.sessionRecentContentKeys || [], historyLimit:state.historyLimit || 1000 });
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
    element('h3','保存した選曲フォルダ', body);
    if (!snapshot.folders?.length) element('p','プレビューを生成し、固定順フォルダとして保存できます。',body);
    for (const folder of snapshot.folders || []) {
      if(folder.deleted || folder.deletedAt)continue;
      const row = element('div', null, body); row.className = 'cms-rec-row cms-rec-folder-row';row.dataset.folderId=folder.folderId;
      element('span', folder.name + ' · ' + folder.items.length + '曲', row);
      button('再生', () => playReferences(folder.items, { source:'generatedFolder', folderId:folder.folderId, queueId:folder.queueId }), row);
      if(typeof adapter.renameFolder==='function')button('名前を変更',async isCurrent=>{
        const answer=await askConfirmation({title:'選曲フォルダの名前を変更',message:'曲順や登録動画は変更しません。',name:folder.name,confirmText:'名前を保存'});
        if(!answer.confirmed || !isCurrent())return;
        const renamed=await adapter.renameFolder(folder.folderId,folder.folderRevision,answer.value);
        if(folderUpdateTarget?.folderId===folder.folderId)folderUpdateTarget={folderId:folder.folderId,folderRevision:renamed.folderRevision};
        await refresh();status.textContent='フォルダ名を「'+renamed.name+'」に変更しました。曲順はそのままです。';
      },row);
      if(typeof adapter.deleteFolder==='function')button('フォルダを削除',async isCurrent=>{
        const answer=await askConfirmation({title:'この選曲フォルダを削除しますか？',confirmText:'フォルダだけ削除',danger:true,
          message:'「'+folder.name+'」をライブラリの選曲フォルダから外します。\n登録動画・再生履歴・お気に入りは削除しません。'+(typeof adapter.restoreFolder==='function'?'\n削除済み一覧から元に戻せます。':'')});
        if(!answer.confirmed || !isCurrent())return;
        await adapter.deleteFolder(folder.folderId,folder.folderRevision);
        if(folderUpdateTarget?.folderId===folder.folderId){folderUpdateTarget=null;save.textContent='生成フォルダとして保存';}
        await refresh();status.textContent='「'+folder.name+'」のフォルダだけを削除しました。登録動画は残っています。';
      },row);
      button('選曲を作り直す',()=>{
        const recipe=folder.queue || folder.generationSnapshot || {};
        folderUpdateTarget={folderId:folder.folderId,folderRevision:folder.folderRevision};
        mode.value=recipe.mode || folder.mode || 'smartRandom';profile.value=recipe.profile || 'standard';length.value=String(folder.items.length);
        operation.value='replace';appendRequest=null;previewNeedsRegeneration=true;
        const oldScope=recipe.scope || {type:'library'};
        const scopeValue=oldScope.type==='folder'?'folder:'+encodeURIComponent(oldScope.folderName):oldScope.type==='site'?'site:'+oldScope.site:'library';
        if(![...scope.options].some(option=>option.value===scopeValue)) element('option','元の対象: '+(oldScope.folderName || oldScope.site || '全ライブラリ'),scope).value=scopeValue;
        scope.value=scopeValue;play.disabled=save.disabled=true;save.textContent='このフォルダの曲順を更新';
        if(recipe.excludedTags?.length)status.textContent='このフォルダを保存したときの除外タグ: '+recipe.excludedTags.join('、')+'。現在の除外設定を確認してください。';
        else status.textContent='「'+folder.name+'」を作り直します。「選曲リストを作成」で内容を確認し、「このフォルダの曲順を更新」で保存してください。以前の曲順も残ります。';
      },row);
      if(folder.revisionHistory?.length) {
        const choice=element('select',null,row);choice.setAttribute('aria-label',folder.name+'の旧版');
        for(const revision of [...folder.revisionHistory].reverse()) element('option','v'+revision.folderRevision,choice).value=String(revision.folderRevision);
        button('以前の曲順を見る',async()=>{
          const version=await adapter.folderVersion(folder.folderId,Number(choice.value));
          const recipe=version.queue || version.generationSnapshot || {};
          preview={...recipe,items:version.items,actualLength:version.items.length,segments:version.segments || recipe.segments || [],restoredFromRevision:version.folderRevision};
          previewNeedsRegeneration=false;appendRequest=null;folderUpdateTarget={folderId:folder.folderId,folderRevision:folder.folderRevision};
          play.textContent='プレビューを再生';save.textContent='このフォルダの曲順を更新';
          await refresh();status.textContent='保存版'+version.folderRevision+'の曲順を表示しています。「このフォルダの曲順を更新」で、この曲順に戻せます。';
        },row);
      }
    }
    if(snapshot.deletedFolders?.length && typeof adapter.restoreFolder==='function') {
      const removed=element('details',null,body);element('summary','削除済みの選曲フォルダ（'+snapshot.deletedFolders.length+'件）',removed);
      for(const folder of snapshot.deletedFolders) {
        const row=element('div',null,removed);row.className='cms-rec-row cms-rec-deleted-folder';row.dataset.folderId=folder.folderId;
        element('span',folder.name+' · '+(folder.items?.length || 0)+'曲',row);
        button('元に戻す',async()=>{
          const restored=await adapter.restoreFolder(folder.folderId,folder.folderRevision);
          await refresh();status.textContent='「'+restored.name+'」を選曲フォルダに戻しました。';
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
  window.addEventListener('cms-recommendation-settings-change',event=>{
    const excludedTagsOnly=event.detail?.excludedTagsOnly===true;
    applyLaunchSettings({updateControls:!excludedTagsOnly,excludedTagsOnly,cancelPending:true});renderStars();
  });
  applyLaunchSettings({updateControls:true});
  // Load only after a real library exists; never freeze an empty Web baseline.
  setTimeout(() => adapter.state().then(value => { snapshot=value; renderStars(); }).catch(() => {}),1500);
  window.CMSRecommendationUI = { refresh:() => run(refresh),openPanel,launch };
})();

