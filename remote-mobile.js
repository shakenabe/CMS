/* Stable parent-document controls: no iframe events or remotely supplied HTML. */
(() => {
  'use strict';
  const root=document.getElementById('remote-mobile');
  const transport=window.CmsRemoteTransport;
  let model=null,connected=false,view='library',smartTab='saved',folder='__all',limit=80,listKey='',touchBusy=false,selectionDirty=false,generating=false;
  let renderedListContext='';
  const scrollPositions=new Map();
  const $=id=>document.getElementById(id);
  const el=(tag,text,parent)=>{const node=document.createElement(tag);if(text!=null)node.textContent=text;if(parent)parent.append(node);return node;};
  const button=(text,action,parent)=>{const node=el('button',text,parent);node.type='button';node.onclick=action;return node;};
  const hasCapability=name=>model?.capabilities?.[name]!==false&&(model?.source!=='pc-native'||model.capabilities?.[name]===true);
  const send=(action,args={})=>{
    const capability=action.startsWith('smart.')?'smart':action==='favorite'?'favorites':action.startsWith('cloud.')?'cloud':action==='settings'?'settings':action==='audio.settings'?'audio':null;
    if(capability&&!hasCapability(capability)){transport.notify('この接続先では、この操作に対応していません。');return Promise.resolve(false);}
    return Promise.resolve(transport.send(action,args));
  };
  const phoneSorts=['pc','custom','newest','oldest','playCount_desc','title_asc','title_desc'];
  let localSort='pc';try{const saved=sessionStorage.getItem('cms-remote-phone-sort');if(phoneSorts.includes(saved))localSort=saved;}catch(_){}
  function icon(node,name){
    const paths={play:'M8 5l11 7-11 7z',pause:'M8 5v14M16 5v14',previous:'M6 5v14M18 5L8 12l10 7z',next:'M18 5v14M6 5l10 7-10 7z',volume:'M4 9h4l5-4v14l-5-4H4zM17 8c3 2 3 6 0 8'};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width',name==='pause'?'4':'2');svg.setAttribute('stroke-linecap','round');path.setAttribute('d',paths[name]||paths.play);svg.append(path);node.replaceChildren(svg);
  }
  const time=value=>Math.floor(Math.max(0,Number(value)||0)/60)+':'+String(Math.floor(Math.max(0,Number(value)||0)%60)).padStart(2,'0');
  root.innerHTML=`
    <section class="native-player" aria-label="PCで再生中">
      <div class="native-player-heading"><span>再生中の曲 · PC PLAYER</span><button type="button" id="native-lock">▣ ロック</button></div>
      <div class="native-artwork"><img id="native-art" alt="再生中の曲のサムネイル"><span id="native-art-empty" aria-hidden="true">♫</span></div>
      <div class="native-now"><div><h1 id="native-title">曲を選んでください</h1><p id="native-artist"></p><small id="native-source">音声はPCから出ます</small></div><button type="button" id="native-star" aria-label="再生中の曲をお気に入りに">☆</button></div>
      <p id="native-playback-notice" role="status" hidden></p>
      <div class="native-time"><span id="native-time">0:00</span><input type="range" id="native-seek" min="0" max="1000" value="0" aria-label="PCの再生位置"><span id="native-duration">0:00</span></div>
      <div class="native-controls"><button type="button" id="native-prev" aria-label="PCで前の曲">⏮</button><button type="button" id="native-play" aria-label="PCで再生">▶</button><button type="button" id="native-next" aria-label="PCで次の曲">⏭</button><button type="button" id="native-volume-toggle" aria-label="PCの音量調整" aria-expanded="false">♫</button></div>
      <label class="native-volume" hidden id="native-volume-panel">PCの音量<input id="native-volume" type="range" min="0" max="100" aria-label="PCの音量"><output id="native-volume-value"></output></label>
    </section>
    <nav class="native-nav" aria-label="遠隔画面"><button type="button" data-view="library">ライブラリ</button><button type="button" data-view="smart">選曲・★</button><button type="button" data-view="settings">設定</button></nav>
    <section class="native-pane"><div class="native-toolbar"><button type="button" id="native-back" hidden>⌄ 再生画面へ</button><button type="button" id="native-folders" aria-haspopup="dialog" aria-expanded="false">▱ フォルダ</button><strong id="native-list-title">すべて</strong><button type="button" id="native-expand" aria-label="一覧を全画面表示">⤢</button></div>
      <div id="native-library-tools" class="native-search"><input id="native-search" type="search" placeholder="曲名・投稿者・タグを検索" aria-label="曲を検索"><select id="native-sort" aria-label="曲の並び順"><option value="pc">PCと同じ並び順</option><option value="custom">登録順</option><option value="newest">新しい順</option><option value="oldest">古い順</option><option value="playCount_desc">再生回数順</option><option value="title_asc">名前順（昇順）</option><option value="title_desc">名前順（降順）</option></select></div>
      <nav id="native-smart-tabs" class="native-nav" hidden><button type="button" data-smart="saved">保存した選曲</button><button type="button" data-smart="favorites">★ お気に入り</button><button type="button" data-smart="create">新しく選曲</button></nav>
      <p class="native-gesture-hint" id="native-gesture-hint">曲一覧を上にスクロールして拡大</p><div id="native-list" class="native-list"></div><section id="native-create" class="native-form" hidden></section><section id="native-settings" class="native-form" hidden></section>
    </section>
    <dialog id="native-folder-dialog" aria-labelledby="native-folder-heading"><header><h2 id="native-folder-heading">フォルダを選択</h2><button type="button" id="native-folder-close" aria-label="フォルダ選択を閉じる">×</button></header><p>PCのライブラリと同じ並び順</p><div id="native-folder-list"></div></dialog>
    <dialog id="native-confirm"><form method="dialog"><h2 id="native-confirm-title"></h2><p id="native-confirm-text"></p><input id="native-confirm-name" maxlength="120" aria-label="フォルダ名" hidden><div class="native-confirm-actions"><button value="cancel">キャンセル</button><button id="native-confirm-ok" value="ok">実行</button></div></form></dialog>`;
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
  function navigate(next) {view=next;limit=80;listKey='';fullscreen(false);render();}
  root.querySelectorAll('[data-view]').forEach(node=>node.onclick=()=>navigate(node.dataset.view));
  root.querySelectorAll('[data-smart]').forEach(node=>node.onclick=()=>{smartTab=node.dataset.smart;limit=80;listKey='';render();});
  $('native-play').onclick=()=>void send('play',{playing:model?.player.intent!=='playing'});
  $('native-prev').onclick=()=>void send('previous');$('native-next').onclick=()=>void send('next');
  $('native-lock').onclick=()=>void send('lock',{locked:!model?.player.locked});
  $('native-seek').onchange=()=>void send('seek',{ratio:Number($('native-seek').value)/1000});
  $('native-volume').onchange=()=>void send('volume',{volume:Number($('native-volume').value)});
  $('native-volume').oninput=()=>{$('native-volume-value').textContent=$('native-volume').value+'%';};
  $('native-star').onclick=()=>{const item=model?.player.item;if(item)void send('favorite',{contentKey:item.contentKey,favorite:!model.records.find(row=>row.contentKey===item.contentKey)?.favorite});};
  $('native-volume-toggle').onclick=()=>{const panel=$('native-volume-panel');panel.hidden=!panel.hidden;$('native-volume-toggle').setAttribute('aria-expanded',String(!panel.hidden));};
  for(const [id,name]of [['native-play','play'],['native-prev','previous'],['native-next','next'],['native-volume-toggle','volume']])icon($(id),name);
  function returnToPlaying(){
    if(!model?.player.playlist?.length)return;
    view='library';folder='__smart_queue';limit=Math.max(80,Math.ceil(((Number(model.player.index)||0)+1)/80)*80);listKey='';fullscreen(false);render();
    requestAnimationFrame(()=>list.querySelector('.is-playing')?.scrollIntoView({block:'center'}));
  }
  $('native-title').tabIndex=0;$('native-title').setAttribute('role','button');$('native-title').setAttribute('aria-label','再生中の曲順へ戻る');
  let titleTap=0;
  $('native-title').addEventListener('pointerup',event=>{if(event.pointerType==='mouse')return;const now=Date.now();if(now-titleTap<350){returnToPlaying();titleTap=0;}else titleTap=now;});
  $('native-title').addEventListener('dblclick',returnToPlaying);
  $('native-title').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();returnToPlaying();}});
  const folderDialog=$('native-folder-dialog');
  $('native-folders').onclick=()=>{renderFolders();folderDialog.showModal();$('native-folders').setAttribute('aria-expanded','true');};
  $('native-folder-close').onclick=()=>folderDialog.close();
  folderDialog.addEventListener('close',()=>{$('native-folders').setAttribute('aria-expanded','false');$('native-folders').focus({preventScroll:true});});
  const fullscreen=value=>{
    root.classList.toggle('native-fullscreen',value);$('native-back').hidden=!value;$('native-expand').hidden=value;
    $('native-gesture-hint').textContent=value?'一覧の先頭から下にスワイプして再生画面へ':'曲一覧を上にスクロールして拡大';
  };
  $('native-expand').onclick=()=>fullscreen(true);$('native-back').onclick=()=>fullscreen(false);
  $('native-sort').value=localSort;
  $('native-search').oninput=()=>{limit=80;listKey='';renderList();};$('native-sort').onchange=()=>{localSort=phoneSorts.includes($('native-sort').value)?$('native-sort').value:'pc';try{sessionStorage.setItem('cms-remote-phone-sort',localSort);}catch(_){}limit=80;listKey='';renderList();};
  const list=$('native-list');
  // These gestures change the phone view only. They never forward scroll/DOM
  // events to the PC. Keep touch fallback for Safari's native pointercancel.
  let pointerStart=null,touchStart=null,suppressClickUntil=0,collapseUntil=0,releaseTimer;
  const atStart=()=>list.scrollTop<=8;
  const begin=(x,y,id)=>({x,y,id,expanded:root.classList.contains('native-fullscreen'),atStart:atStart()});
  const move=(start,x,y,event)=>{
    if(!start)return;
    const dx=x-start.x,dy=y-start.y;
    if(Math.abs(dy)<16 || Math.abs(dy)<=Math.abs(dx)*1.1)return;
    suppressClickUntil=Date.now()+500;
    if(start.expanded && start.atStart && atStart() && dy>0){
      collapseUntil=Date.now()+450;fullscreen(false);if(event.cancelable)event.preventDefault();
    }else if(dy<0 && Date.now()>collapseUntil)fullscreen(true);
  };
  const finish=()=>{clearTimeout(releaseTimer);releaseTimer=setTimeout(()=>{touchBusy=false;pointerStart=null;touchStart=null;renderList();},100);};
  list.addEventListener('pointerdown',event=>{if(event.isPrimary===false)return;clearTimeout(releaseTimer);pointerStart=begin(event.clientX,event.clientY,event.pointerId);touchBusy=true;},{passive:true});
  list.addEventListener('pointermove',event=>{if(pointerStart?.id===event.pointerId)move(pointerStart,event.clientX,event.clientY,event);},{passive:false});
  list.addEventListener('touchstart',event=>{if(event.touches.length!==1)return;clearTimeout(releaseTimer);const point=event.touches[0];touchStart=begin(point.clientX,point.clientY);touchBusy=true;},{passive:true});
  list.addEventListener('touchmove',event=>{if(event.touches.length===1){const point=event.touches[0];move(touchStart,point.clientX,point.clientY,event);}},{passive:false});
  list.addEventListener('click',event=>{if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
  for(const name of ['pointerup','pointercancel','touchend','touchcancel'])window.addEventListener(name,finish,{passive:true});
  list.addEventListener('wheel',event=>{
    if(event.deltaY< -8 && atStart() && root.classList.contains('native-fullscreen')){collapseUntil=Date.now()+450;fullscreen(false);if(event.cancelable)event.preventDefault();}
    else if(event.deltaY>8 && Date.now()>collapseUntil)fullscreen(true);
  },{passive:false});
  // Snapshot renders and current-song following also scroll this element.
  // Only explicit wheel/swipe gestures may expand it, never a scroll event.
  window.addEventListener('keydown',event=>{if(event.key==='Escape')fullscreen(false);});
  let folderKey='';
  function renderFolders(){
    if(!model)return;const key=JSON.stringify([model.folders,folder]);if(key===folderKey)return;folderKey=key;
    const target=$('native-folder-list');target.replaceChildren();
    // PC snapshot order is authoritative; never alphabetize on the phone.
    for(const item of model.folders){const pick=button('',()=>{folder=item.id;limit=80;listKey='';folderDialog.close();render();},target);pick.className='native-folder';pick.dataset.folderId=item.id;pick.setAttribute('aria-current',String(item.id===folder));el('span',(item.id===folder?'✓ ':'▱ ')+item.name,pick);el('strong',String(item.count),pick);}
  }
  function row(item,parent,playAction) {
    const article=el('article',null,parent);article.className='native-row';article.dataset.queueItemId=item.queueItemId||'';
    const art=el('img',null,article);art.alt='';art.loading='lazy';safeArt(art,item.thumbnail);
    const main=button('',playAction,article);main.className='native-row-title';el('strong',item.title,main);el('small',item.artist || '',main);
    const star=button(item.favorite?'★':'☆',()=>void send('favorite',{contentKey:item.contentKey,favorite:!item.favorite}),article);star.setAttribute('aria-label',item.title+'のお気に入り');star.setAttribute('aria-pressed',String(Boolean(item.favorite)));
    star.hidden=!hasCapability('favorites');
    article.classList.toggle('is-playing',folder==='__smart_queue' && item.queueItemId ? item.queueItemId===model.player.currentQueueItemId : item.contentKey===model.player.item?.contentKey);return article;
  }
  function filteredSongs() {
    const query=$('native-search').value.trim().toLocaleLowerCase();
    const source=folder==='__smart_queue'?model.player.playlist:model.records;
    const virtualKeys=model.folders.find(item=>item.id===folder)?.contentKeys;
    const membership=Array.isArray(virtualKeys)?new Set(virtualKeys):null;
    let songs=source.filter(item=>(folder==='__all'||folder==='__smart_queue'||(membership?membership.has(item.contentKey):item.folders.includes(folder)))&&(!query||(item.title+' '+item.artist+' '+(item.tags || []).join(' ')).toLocaleLowerCase().includes(query)));
    if(folder==='__smart_queue')return songs;
    const sort=localSort;
    if(sort==='pc' && folder!=='__smart_queue' && Array.isArray(model.player.sortKeys)){
      const ranks=new Map(model.player.sortKeys.map((key,index)=>[key,index]));songs=songs.slice().sort((a,b)=>(ranks.get(a.contentKey)??Infinity)-(ranks.get(b.contentKey)??Infinity));
    }else if(!['pc','custom'].includes(sort))songs=songs.slice().sort((a,b)=>sort==='newest'?b.savedAt-a.savedAt:sort==='oldest'?a.savedAt-b.savedAt:sort==='playCount_desc'?b.playCount-a.playCount:sort==='title_desc'?b.title.localeCompare(a.title):a.title.localeCompare(b.title));
    return songs;
  }
  const activeSort=()=>{
    const selected=localSort;
    return selected!=='pc'?selected:['custom','newest','oldest','title_asc','title_desc','playCount_desc','recommended'].includes(model.player.sort)?model.player.sort:'custom';
  };
  function renderList() {
    if(!model || touchBusy)return;
    if(view==='settings'||view==='smart'&&smartTab==='create')return;
    const songs=view==='library'?filteredSongs():model.records.filter(item=>item.favorite);
    if(view==='library' && folder==='__smart_queue')limit=Math.max(limit,Math.ceil(((Number(model.player.index)||0)+1)/80)*80);
    const rows=view==='smart'&&smartTab==='saved'?model.smart.folders:songs;
    const key=JSON.stringify([model.source,model.capabilities,view,smartTab,folder,limit,rows,model.player.item?.contentKey,model.player.queueId,model.player.queueRevision,model.player.currentQueueItemId]);if(key===listKey)return;listKey=key;
    const context=JSON.stringify([view,smartTab,folder,$('native-sort').value,$('native-search').value,folder==='__smart_queue'?model.player.queueId:'']);
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
    } else {
      for(const item of songs.slice(0,limit))row(item,list,()=>void send('track',{contentKey:item.contentKey,folderId:view==='smart'?'__all':folder,sort:activeSort(),...(folder==='__smart_queue' && item.queueItemId?{queueItemId:item.queueItemId,queueId:model.player.queueId,queueRevision:model.player.queueRevision}:{})}));
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
  // Forms, as well as the track list, expand only for deliberate phone gestures.
  for(const panel of [settings,create]) {
    let start=null;
    panel.addEventListener('touchstart',event=>{if(event.touches.length!==1 || event.target.closest('select,input[type=range]')){start=null;return;}start={y:event.touches[0].clientY,expanded:root.classList.contains('native-fullscreen'),atTop:panel.scrollTop<=8};},{passive:true});
    panel.addEventListener('touchmove',event=>{if(!start || event.touches.length!==1)return;const dy=event.touches[0].clientY-start.y;if(Math.abs(dy)<48)return;
      if(start.expanded && start.atTop && panel.scrollTop<=8 && dy>0){fullscreen(false);start=null;if(event.cancelable)event.preventDefault();}
      else if(!start.expanded && dy<0){fullscreen(true);start=null;}
    },{passive:false});
    panel.addEventListener('touchend',()=>{start=null;},{passive:true});
    panel.addEventListener('wheel',event=>{if(event.deltaY>8)fullscreen(true);else if(event.deltaY< -8 && panel.scrollTop<=8)fullscreen(false);},{passive:true});
  }
  const cloud=el('section',null,settings);cloud.className='native-cloud';el('h3','Firebaseライブラリ',cloud);el('p','',cloud).id='native-cloud-status';el('small','',cloud).id='native-cloud-time';
  button('PCで更新を確認',()=>void send('cloud.refresh'),cloud).id='native-cloud-refresh';
  el('p','Google接続はPCで一度行います。JSON読み込みはPCの手動・復旧用として残っています。',cloud);
  const theme=select('テーマ',[['sf','SF'],['modern','現代風'],['nerv','EVA風']],settings,'native-theme');theme.onchange=()=>void send('settings',{theme:theme.value});
  const audioSection=el('section',null,settings);el('h3','PCの音声を整える',audioSection);
  const audioControls=[];
  for(const [key,label]of [['limiter','大きな音を抑える'],['leveling','曲ごとの音量差を小さくする']]){
    const wrap=el('label',null,audioSection),input=el('input',null,wrap);input.type='checkbox';input.id='native-audio-'+key;input.dataset.audio=key;el('span',label,wrap);
    input.onchange=()=>void send('audio.settings',{limiter:$('native-audio-limiter').checked,leveling:$('native-audio-leveling').checked});audioControls.push(input);
  }
  el('p','CMS拡張機能との接続を確認しています。',audioSection).id='native-audio-reason';
  const settingsControls=[];
  for(const [key,label] of [['performanceMode','軽量化モード'],['dataSaverMode','通信量を抑える'],['musicMode','音楽モード'],['showThumbnails','サムネイルを表示'],['showClock','時計を表示'],['resumeLastPlayback','前回の再生位置を保持']]) {
    const wrap=el('label',null,settings),input=el('input',null,wrap);input.type='checkbox';input.dataset.setting=key;el('span',label,wrap);input.onchange=()=>void send('settings',{[key]:input.checked});settingsControls.push(input);
  }
  const diagnostics=el('details',null,settings);el('summary','接続診断',diagnostics);el('p','',diagnostics).id='native-diagnostics';
  function render() {
    if(!model)return;markTabs();
    root.querySelector('[data-view="smart"]').hidden=!hasCapability('smart');
    $('native-star').hidden=!hasCapability('favorites');
    cloud.hidden=!hasCapability('cloud');theme.closest('label').hidden=!hasCapability('settings');
    for(const input of settingsControls)input.closest('label').hidden=!hasCapability('settings');
    audioSection.hidden=!hasCapability('audio');
    $('native-smart-tabs').hidden=view!=='smart';$('native-library-tools').hidden=view!=='library';$('native-folders').hidden=view!=='library';
    list.hidden=view==='settings'||view==='smart'&&smartTab==='create';create.hidden=view!=='smart'||smartTab!=='create';settings.hidden=view!=='settings';
    $('native-list-title').textContent=view==='settings'?'設定':view==='smart'?smartTab==='saved'?'保存した選曲':smartTab==='favorites'?'すべてのお気に入り':'新しく選曲':model.folders.find(item=>item.id===folder)?.name || 'すべて';
    $('native-gesture-hint').hidden=view!=='library' && !(view==='smart'&&smartTab==='favorites');
    renderList();renderPreview();renderFolders();
  }
  let foldersKey='',initialized=false,lastKey='';
  function update(next) {
    model={...next,player:{...next.player,settings:next.player?.settings||{}},cloud:next.cloud||{connected:false,auto:false,message:'PC保存音源のリモコン'},smart:next.smart||{settings:{mode:'smartRandom',profile:'standard',length:200,scope:'library',excludedFolders:[],excludedTags:[]},folders:[],preview:null}};
    if(view==='smart'&&!hasCapability('smart')){view='library';listKey='';}
    const p=model.player;
    if(!initialized && model.folders.some(item=>item.id===p.folderId))folder=p.folderId;
    const sortName={custom:'登録順',newest:'新しい順',oldest:'古い順',title_asc:'名前順 ↑',title_desc:'名前順 ↓',playCount_desc:'再生回数順',recommended:'おすすめ順'}[p.sort] || '登録順';
    $('native-sort').querySelector('[value="pc"]').textContent='PC：'+sortName;
    $('native-sort').value=localSort;
    $('native-title').textContent=p.item?.title || '曲を選んでください';$('native-artist').textContent=p.item?.artist || '音声はPCから出ます';safeArt($('native-art'),p.item?.thumbnail);
    const artwork=transport.safeImageUrl(p.item?.thumbnail);root.style.setProperty('--native-artwork',artwork?'url('+JSON.stringify(artwork)+')':'none');
    root.dataset.theme=['sf','modern','nerv'].includes(p.settings.theme)?p.settings.theme:'sf';
    document.body.dataset.theme=root.dataset.theme;
    $('native-art-empty').hidden=Boolean(artwork);$('native-source').textContent='再生元：'+(model.folders.find(item=>item.id===(p.playbackFolderId||p.folderId))?.name || p.item?.folders?.[0] || 'PCの再生キュー');
    icon($('native-play'),p.intent==='playing'?'pause':'play');$('native-play').setAttribute('aria-label',p.intent==='playing'?'PCで一時停止':'PCで再生');
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
    for(const input of audioControls){input.checked=model.audio?.[input.dataset.audio]===true;input.disabled=!connected||!model.audio?.supported&&model.audio?.reason!=='not-started';}
    $('native-audio-reason').textContent=model.audio?.reason==='not-started'?'音声処理はOFFです。操作するとすぐにPCへ適用します。':model.audio?.reason||(model.audio?.supported?'PCの音声に適用します。スマホから音は出ません。':'この再生経路は音声処理に対応していません。');
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
    for(const input of audioControls)input.disabled=!value||busy||!model?.audio?.supported&&model?.audio?.reason!=='not-started';
    $('native-sort').disabled=!value||folder==='__smart_queue';
  }
  window.CmsRemoteMobile=Object.freeze({update,setConnected});window.dispatchEvent(new Event('cms-remote-mobile-ready'));
})();
