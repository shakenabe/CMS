/* Stable parent-document controls: no iframe events or remotely supplied HTML. */
(() => {
  'use strict';
  const root=document.getElementById('remote-mobile');
  const transport=window.CmsRemoteTransport;
  let model=null,connected=false,view='library',smartTab='saved',folder='__all',showFolders=false,limit=80,listKey='',touchStart=null,touchBusy=false,selectionDirty=false,generating=false;
  let renderedListContext='';
  const scrollPositions=new Map();
  const $=id=>document.getElementById(id);
  const el=(tag,text,parent)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(parent)parent.append(node);return node;};
  const button=(text,action,parent)=>{const node=el('button',text,parent);node.type='button';node.onclick=action;return node;};
  const send=(action,args={})=>Promise.resolve(transport.send(action,args));
  const time=value=>Math.floor(Math.max(0,Number(value)||0)/60)+':'+String(Math.floor(Math.max(0,Number(value)||0)%60)).padStart(2,'0');
  root.innerHTML=`<section class="native-player"><div class="native-player-heading"><span>PC PLAYER</span><button type="button" id="native-lock">▣ ロック</button></div><div class="native-now"><img id="native-art" alt="再生中の曲のサムネイル"><div><small>いま聴いている曲</small><h1 id="native-title">曲を選んでください</h1><p id="native-artist"></p></div></div><p id="native-playback-notice" role="status" hidden></p><div class="native-time"><span id="native-time">0:00</span><input type="range" id="native-seek" min="0" max="1000" value="0" aria-label="PCの再生位置"><span id="native-duration">0:00</span></div><div class="native-controls"><button type="button" id="native-prev" aria-label="PCで前の曲">⏮</button><button type="button" id="native-play" aria-label="PCで再生">▶</button><button type="button" id="native-next" aria-label="PCで次の曲">⏭</button><button type="button" id="native-star" aria-label="再生中の曲をお気に入りに">☆</button></div><label class="native-volume">♫<input id="native-volume" type="range" min="0" max="100" aria-label="PCの音量"><output id="native-volume-value"></output></label></section><nav class="native-nav" aria-label="遠隔画面"><button type="button" data-view="library">ライブラリ</button><button type="button" data-view="smart">選曲・★</button><button type="button" data-view="settings">設定</button></nav><section class="native-pane"><div class="native-toolbar"><button type="button" id="native-back" hidden>‹ 戻る</button><button type="button" id="native-folders">▱ フォルダ</button><strong id="native-list-title">すべて</strong><button type="button" id="native-expand" aria-label="一覧を全画面表示">⤢</button></div><div id="native-library-tools" class="native-search"><input id="native-search" type="search" placeholder="曲名・投稿者・タグを検索" aria-label="曲を検索"><select id="native-sort" aria-label="曲の並び順"><option value="custom">CMSの順番</option><option value="newest">新しい順</option><option value="oldest">古い順</option><option value="playCount_desc">再生回数順</option><option value="title_asc">名前順</option></select></div><nav id="native-smart-tabs" class="native-nav" hidden><button type="button" data-smart="saved">保存した選曲</button><button type="button" data-smart="favorites">★ お気に入り</button><button type="button" data-smart="create">新しく選曲</button></nav><div id="native-list" class="native-list"></div><section id="native-create" class="native-form" hidden></section><section id="native-settings" class="native-form" hidden></section></section><dialog id="native-confirm"><form method="dialog"><h2 id="native-confirm-title"></h2><p id="native-confirm-text"></p><input id="native-confirm-name" maxlength="120" aria-label="フォルダ名" hidden><div class="native-confirm-actions"><button value="cancel">キャンセル</button><button id="native-confirm-ok" value="ok">実行</button></div></form></dialog>`;
  const safeArt=(node,url)=>{const safe=transport.safeImageUrl(url);if(safe){if(node.dataset.failedUrl===safe){node.hidden=true;return;}node.onerror=()=>{node.dataset.failedUrl=safe;node.hidden=true;};if(node.getAttribute('src')!==safe)node.src=safe;node.hidden=false;}else{node.removeAttribute('src');node.hidden=true;}};
  async function confirm(title,text,initialName) {
    $('native-confirm-title').textContent=title;$('native-confirm-text').textContent=text;
    $('native-confirm-name').hidden=initialName===undefined;$('native-confirm-name').value=initialName || '';
    const dialog=$('native-confirm');if(dialog.open)return null;
    return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='ok'?{name:$('native-confirm-name').value.trim()}:null),{once:true});dialog.showModal();});
  }
  function markTabs() {
    root.querySelectorAll('[data-view]').forEach(node=>node.setAttribute('aria-current',node.dataset.view===view?'page':'false'));
    root.querySelectorAll('[data-smart]').forEach(node=>node.setAttribute('aria-current',node.dataset.smart===smartTab?'page':'false'));
  }
  function navigate(next) {view=next;limit=80;listKey='';showFolders=false;render();}
  root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>navigate(node.dataset.view));
  root.querySelectorAll('[data-smart]').forEach(node=>node.onclick=()=>{smartTab=node.dataset.smart;limit=80;listKey='';render();});
  $('native-play').onclick=()=>void send('play',{playing:model?.player.intent!=='playing'});
  $('native-prev').onclick=()=>void send('previous');$('native-next').onclick=()=>void send('next');
  $('native-lock').onclick=()=>void send('lock',{locked:!model?.player.locked});
  $('native-seek').onchange=()=>void send('seek',{ratio:Number($('native-seek').value)/1000});
  $('native-volume').onchange=()=>void send('volume',{volume:Number($('native-volume').value)});
  $('native-volume').oninput=()=>{$('native-volume-value').textContent=$('native-volume').value+'%';};
  $('native-star').onclick=()=>{const item=model?.player.item;if(item)void send('favorite',{contentKey:item.contentKey,favorite:!model.records.find(row=>row.contentKey===item.contentKey)?.favorite});};
  $('native-folders').onclick=()=>{showFolders=!showFolders;listKey='';render();};
  const fullscreen=value=>{root.classList.toggle('native-fullscreen',value);$('native-back').hidden=!value;$('native-expand').hidden=value;};
  $('native-expand').onclick=()=>fullscreen(true);$('native-back').onclick=()=>fullscreen(false);
  $('native-search').oninput=()=>{limit=80;listKey='';renderList();};$('native-sort').onchange=()=>{limit=80;listKey='';renderList();};
  const list=$('native-list');
  list.addEventListener('pointerdown',event=>{touchStart={x:event.clientX,y:event.clientY};touchBusy=true;});
  list.addEventListener('pointermove',event=>{if(touchStart && Math.abs(event.clientY-touchStart.y)>35){if(event.clientY<touchStart.y)fullscreen(true);touchStart.moved=true;}});
  list.addEventListener('click',event=>{if(touchStart?.moved){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  window.addEventListener('pointerup',()=>{touchBusy=false;setTimeout(()=>{touchStart=null;renderList();},80);});
  window.addEventListener('pointercancel',()=>{touchBusy=false;touchStart=null;});
  list.addEventListener('scroll',()=>{if(list.scrollTop>90)fullscreen(true);},{passive:true});
  function row(item,parent,playAction) {
    const article=el('article',null,parent);article.className='native-row';
    const art=el('img',null,article);art.alt='';art.loading='lazy';safeArt(art,item.thumbnail);
    const main=button('',playAction,article);main.className='native-row-title';el('strong',item.title,main);el('small',item.artist || '',main);
    const star=button(item.favorite?'★':'☆',()=>void send('favorite',{contentKey:item.contentKey,favorite:!item.favorite}),article);star.setAttribute('aria-label',item.title+'のお気に入り');star.setAttribute('aria-pressed',String(Boolean(item.favorite)));
    article.classList.toggle('is-playing',folder==='__smart_queue' && item.queueItemId ? item.queueItemId===model.player.currentQueueItemId : item.contentKey===model.player.item?.contentKey);return article;
  }
  function filteredSongs() {
    const query=$('native-search').value.trim().toLocaleLowerCase();
    const source=folder==='__smart_queue'?model.player.playlist:model.records;
    let songs=source.filter(item=>(folder==='__all'||folder==='__smart_queue'||item.folders.includes(folder))&&(!query||(item.title+' '+item.artist+' '+(item.tags || []).join(' ')).toLocaleLowerCase().includes(query)));
    const sort=$('native-sort').value;
    if(sort!=='custom')songs=songs.slice().sort((a,b)=>sort==='newest'?b.savedAt-a.savedAt:sort==='oldest'?a.savedAt-b.savedAt:sort==='playCount_desc'?b.playCount-a.playCount:a.title.localeCompare(b.title));
    return songs;
  }
  function renderList() {
    if(!model || touchBusy)return;
    if(view==='settings'||view==='smart'&&smartTab==='create')return;
    const songs=view==='library'?filteredSongs():model.records.filter(item=>item.favorite);
    if(view==='library' && !showFolders && folder==='__smart_queue')limit=Math.max(limit,Math.ceil(((Number(model.player.index)||0)+1)/80)*80);
    const rows=view==='smart'&&smartTab==='saved'?model.smart.folders:showFolders?model.folders:songs;
    const key=JSON.stringify([view,smartTab,showFolders,folder,limit,rows,model.player.item?.contentKey]);if(key===listKey)return;listKey=key;
    const context=JSON.stringify([view,smartTab,showFolders,folder,$('native-sort').value,$('native-search').value,folder==='__smart_queue'?model.player.queueId:'']);
    if(renderedListContext)scrollPositions.set(renderedListContext,list.scrollTop);
    const oldTop=context===renderedListContext?list.scrollTop:scrollPositions.get(context)||0;
    renderedListContext=context;list.replaceChildren();
    if(view==='smart'&&smartTab==='saved') {
      for(const saved of rows) {
        const card=el('article',null,list);card.className='native-saved-card';el('h3',saved.name,card);el('p',saved.count+'曲 · 保存した曲順',card);
        button('▶ 再生',async()=>{if(await confirm('保存した選曲を再生','PCの再生キューを「'+saved.name+'」に切り替えます。'))await send('smart.playFolder',{id:saved.id,revision:saved.revision});},card);
        button('名前を変更',async()=>{const answer=await confirm('フォルダ名を変更','曲順は変えません。',saved.name);if(answer?.name)await send('smart.renameFolder',{id:saved.id,revision:saved.revision,name:answer.name});},card);
        const note=el('small','削除・以前の曲順への復元はPCで確認できます。',card);note.className='native-muted';
      }
    } else if(view==='library'&&showFolders) {
      for(const item of rows){const pick=button('',()=>{folder=item.id;showFolders=false;limit=80;listKey='';render();},list);pick.className='native-folder';el('span','▱ '+item.name,pick);el('strong',String(item.count),pick);}
    } else {
      for(const item of songs.slice(0,limit))row(item,list,()=>void send('track',{contentKey:item.contentKey,folderId:view==='smart'?'__all':folder,sort:$('native-sort').value,...(folder==='__smart_queue' && item.queueItemId?{queueItemId:item.queueItemId,queueId:model.player.queueId,queueRevision:model.player.queueRevision}:{})}));
      if(songs.length>limit)button('さらに表示（残り'+(songs.length-limit)+'曲）',()=>{limit+=80;listKey='';renderList();},list);
    }
    if(!rows.length)el('p',view==='smart'&&smartTab==='saved'?'保存した選曲はまだありません。「新しく選曲」から作成できます。':'該当する曲・フォルダはありません。',list);
    list.scrollTop=oldTop;
  }
  function select(label,values,parent,id) {
    const wrap=el('label',label,parent),input=el('select',null,wrap);input.id=id;
    for(const [value,text] of values){const option=el('option',text,input);option.value=value;}return input;
  }
  const create=$('native-create');
  el('h2','選曲条件',create);el('p','条件を保存してから候補を作ります。条件の変更や保存だけでは、PCの再生を切り替えません。',create);
  const mode=select('選曲モード',[['smartRandom','好み・久しぶり・発掘を混ぜる'],['uniformRandom','偏りのないランダム']],create,'native-mode');
  const profile=select('選び方',[['standard','バランスよく'],['stable','お気に入り・よく聴く曲を多め'],['rediscover','久しぶりの曲を多め'],['explore','まだあまり聴いていない曲を多め']],create,'native-profile');
  const lengthLabel=el('label','曲数（1〜200）',create),length=el('input',null,lengthLabel);length.id='native-length';length.type='number';length.min='1';length.max='200';length.value='20';
  const scope=select('対象',[['library','全ライブラリ'],['favorites','★ お気に入り'],['folder','フォルダを指定']],create,'native-scope');
  const target=select('対象フォルダ',[],create,'native-target');
  const selectionArgs=()=>({mode:mode.value,profile:profile.value,length:Number(length.value),scope:scope.value,folderId:target.value});
  button('選曲設定をPCに保存',async()=>{if(await send('smart.settings',selectionArgs())){selectionDirty=false;renderPreview();}},create).id='native-save-selection';
  const excluded=el('details',null,create);el('summary','除外フォルダ・タグ',excluded);
  const folderOptions=el('div',null,excluded);folderOptions.className='native-excluded-folders';folderOptions.id='native-excluded-folders';
  const tagsLabel=el('label','除外タグ（カンマ・改行で区切る）',excluded),tags=el('textarea',null,tagsLabel);tags.id='native-tags';tags.maxLength=4000;
  button('除外設定をPCに保存',async()=>{if(await send('smart.exclusions',{folders:[...folderOptions.querySelectorAll('input:checked')].map(node=>node.value),tags:tags.value.split(/[,、\n]+/).map(value=>value.trim()).filter(Boolean)})){tags.value=model.smart.settings.excludedTags.join('\n');renderPreview();}},excluded);
  const generate=button('プレビューを作成',async()=>{
    if(generating)return;
    generating=true;generate.disabled=true;
    try{await send('smart.generate',selectionArgs());}finally{generating=false;generate.disabled=!connected;}
  },create);generate.id='native-generate';
  const preview=el('section',null,create);preview.id='native-preview';let previewKey='';
  const draftConditions=()=>({...selectionArgs(),excludedFolders:[...folderOptions.querySelectorAll('input:checked')].map(node=>node.value).sort(),excludedTags:tags.value.split(/[,、\n]+/).map(value=>value.trim()).filter(Boolean).sort()});
  for(const input of [mode,profile,length,scope,target])input.addEventListener('input',()=>{selectionDirty=true;renderPreview();});
  for(const input of [tags,folderOptions])input.addEventListener('input',()=>renderPreview());
  function renderPreview() {
    const value=model.smart.preview,draft=draftConditions(),key=JSON.stringify([value,draft]);if(key===previewKey)return;previewKey=key;preview.replaceChildren();
    if(!value)return;
    el('h3',value.count+'曲のプレビュー',preview);
    if(JSON.stringify(value.conditions)!==JSON.stringify(draft)){el('p','条件が変わりました。除外設定を変更した場合は保存してから、プレビューを作成し直してください。',preview);return;}
    button('この曲順でPC再生',async()=>{if(await confirm('PCで再生しますか？','プレビューの'+value.count+'曲へ切り替えます。'))await send('smart.playPreview',{id:value.id});},preview);
    button('選曲フォルダとして保存',async()=>{const answer=await confirm('選曲を保存','曲順を固定して保存します。','スマート選曲');if(answer?.name)await send('smart.savePreview',{id:value.id,name:answer.name});},preview);
    const details=el('details',null,preview);el('summary','曲順を見る',details);
    for(const [index,item] of value.items.entries())el('p',(index+1)+'. '+item.title,details);
  }
  const settings=$('native-settings');el('h2','PCの設定',settings);
  const cloud=el('section',null,settings);cloud.className='native-cloud';el('h3','Firebaseライブラリ',cloud);el('p','',cloud).id='native-cloud-status';el('small','',cloud).id='native-cloud-time';
  button('PCで更新を確認',()=>void send('cloud.refresh'),cloud).id='native-cloud-refresh';
  el('p','Google接続はPCで一度行います。JSON読み込みはPCの手動・復旧用として残っています。',cloud);
  const theme=select('表示スタイル',[['modern','P1 / A1'],['nerv','P2'],['toyota','P3'],['niconico','P4']],settings,'native-theme');theme.onchange=()=>void send('settings',{theme:theme.value});
  const settingsControls=[];
  for(const [key,label] of [['performanceMode','軽量化モード'],['dataSaverMode','通信量を抑える'],['musicMode','音楽モード'],['showThumbnails','サムネイルを表示'],['showClock','時計を表示'],['resumeLastPlayback','前回の再生位置を保持']]) {
    const wrap=el('label',null,settings),input=el('input',null,wrap);input.type='checkbox';input.dataset.setting=key;el('span',label,wrap);input.onchange=()=>void send('settings',{[key]:input.checked});settingsControls.push(input);
  }
  const diagnostics=el('details',null,settings);el('summary','接続診断',diagnostics);el('p','',diagnostics).id='native-diagnostics';
  function render() {
    if(!model)return;markTabs();
    $('native-smart-tabs').hidden=view!=='smart';$('native-library-tools').hidden=view!=='library';$('native-folders').hidden=view!=='library';
    list.hidden=view==='settings'||view==='smart'&&smartTab==='create';create.hidden=view!=='smart'||smartTab!=='create';settings.hidden=view!=='settings';
    $('native-list-title').textContent=view==='settings'?'設定':view==='smart'?smartTab==='saved'?'保存した選曲':smartTab==='favorites'?'すべてのお気に入り':'新しく選曲':showFolders?'フォルダを選択':model.folders.find(item=>item.id===folder)?.name || 'すべて';
    renderList();renderPreview();
  }
  let foldersKey='',initialized=false,lastKey='';
  function update(next) {
    model=next;
    const p=model.player;
    $('native-title').textContent=p.item?.title || '曲を選んでください';$('native-artist').textContent=p.item?.artist || '音声はPCから出ます';safeArt($('native-art'),p.item?.thumbnail);
    $('native-play').textContent=p.playing?'Ⅱ':'▶';$('native-play').setAttribute('aria-label',p.intent==='playing'?'PCで一時停止':'PCで再生');
    $('native-lock').textContent=p.locked?'▢ ロック解除':'▣ ロック';
    $('native-time').textContent=time(p.time);$('native-duration').textContent=time(p.duration);
    if(document.activeElement!==$('native-seek'))$('native-seek').value=p.duration?String(Math.round(p.time/p.duration*1000)):'0';
    if(document.activeElement!==$('native-volume'))$('native-volume').value=String(p.volume ?? 100);
    $('native-volume-value').textContent=$('native-volume').value+'%';
    const favorite=model.records.find(item=>item.contentKey===p.item?.contentKey)?.favorite===true;$('native-star').textContent=favorite?'★':'☆';$('native-star').setAttribute('aria-pressed',String(favorite));
    $('native-playback-notice').textContent=p.notice || (p.mediaState==='loading'?'PCで読み込み中…':'');$('native-playback-notice').hidden=!$('native-playback-notice').textContent;
    $('native-cloud-status').textContent=model.cloud.message || (model.cloud.connected?'接続済み':'PCでGoogle接続してください');
    $('native-cloud-time').textContent=(model.cloud.auto?'自動読み込みON':'自動読み込みOFF')+(model.cloud.lastSyncAt?' · 最終同期 '+new Date(model.cloud.lastSyncAt).toLocaleString('ja-JP'):'');
    if(!initialized || !selectionDirty){mode.value=model.smart.settings.mode || 'smartRandom';profile.value=model.smart.settings.profile;length.value=String(model.smart.settings.length);}
    if(!initialized){tags.value=model.smart.settings.excludedTags.join('\n');initialized=true;}
    const names=model.folders.filter(item=>!item.id.startsWith('__')),key=JSON.stringify([names,model.smart.settings.excludedFolders]);
    if(key!==foldersKey && !folderOptions.contains(document.activeElement)) {
      foldersKey=key;const selected=target.value;target.replaceChildren();folderOptions.replaceChildren();
      for(const item of names){const option=el('option',item.name,target);option.value=item.id;const label=el('label',null,folderOptions),input=el('input',null,label);input.type='checkbox';input.value=item.name;input.checked=model.smart.settings.excludedFolders.includes(item.name);el('span',item.name,label);}if([...target.options].some(item=>item.value===selected))target.value=selected;
    }
    if(!selectionDirty){const savedScope=model.smart.settings.scope || 'library';if(savedScope.startsWith('folder:')){scope.value='folder';target.value=savedScope.slice(7);}else if(['library','favorites'].includes(savedScope))scope.value=savedScope;}
    if(document.activeElement!==theme)theme.value=p.settings.theme;
    for(const input of settingsControls)if(input!==document.activeElement)input.checked=Boolean(p.settings[input.dataset.setting]);
    $('native-diagnostics').textContent='PC状態を受信済み · '+new Date().toLocaleTimeString('ja-JP')+' · 再生状態：'+p.mediaState+' · 操作の受付状況は上部に表示します。';
    if(model.truncated)transport.notify('ライブラリが大きいため、一部の曲を表示しています。全曲の操作はPCで行えます。');
    render();setConnected(connected);
    const currentKey=p.currentQueueItemId || p.item?.contentKey || '';
    const trackChanged=lastKey!==currentKey;lastKey=currentKey;
    if(trackChanged && folder==='__smart_queue' && !touchBusy)list.querySelector('.is-playing')?.scrollIntoView({block:'nearest'});
  }
  function setConnected(value,busy=false) {
    connected=value;
    root.querySelectorAll('button,input,select,textarea').forEach(node=>{if(!node.closest('#native-confirm'))node.disabled=!value;});
    if(busy)root.querySelectorAll('.native-player button,.native-player input,#native-create button,#native-settings button,.native-saved-card button,.native-row button').forEach(node=>{node.disabled=true;});
    generate.disabled=!value || busy || generating;
    if(model)$('native-cloud-refresh').disabled=!value||busy||!model.cloud.connected;
  }
  window.CmsRemoteMobile=Object.freeze({update,setConnected});window.dispatchEvent(new Event('cms-remote-mobile-ready'));
})();
