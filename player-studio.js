/* Device-local presentation only: artwork never enters Firebase or the remote protocol. */
(() => {
  'use strict';
  const key='cms_studio_appearance_v1';
  const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){}
  const options={enabled:saved.enabled!==false,background:saved.background==='manual'?'manual':'artwork',blur:clamp(saved.blur,0,60,28),opacity:clamp(saved.opacity,0,100,35)};
  const node=(tag,text,parent)=>{const value=document.createElement(tag);if(text)value.textContent=text;parent?.append(value);return value;};
  const ambient=node('div',null,document.body);ambient.id='cms-artwork-ambient';ambient.setAttribute('aria-hidden','true');
  const backdrop=node('img',null,ambient);backdrop.alt='';backdrop.decoding='async';
  const controlPanel=document.getElementById('widget-controls');
  const playerBackdrop=node('div',null,controlPanel);playerBackdrop.className='cms-player-artwork';playerBackdrop.setAttribute('aria-hidden','true');
  const playerImage=node('img',null,playerBackdrop);playerImage.alt='';playerImage.decoding='async';
  const tags=node('div',null);tags.className='cms-player-tags';tags.setAttribute('aria-label','再生中の曲のタグ');document.getElementById('widget-artist')?.after(tags);
  const section=node('section',null,controlPanel);section.className='cms-next-preview';section.setAttribute('aria-label','次に再生');
  node('h3','次に再生',section);const nextList=node('div',null,section);
  let artwork='',currentKey='',queueSignature='',frame=0;
  function apply(){
    document.body.classList.toggle('cms-studio',options.enabled);
    document.body.classList.toggle('cms-artwork-background',options.background==='artwork' && Boolean(artwork));
    ambient.style.setProperty('--cms-art-blur',options.blur+'px');ambient.style.opacity=String(options.background==='artwork'?options.opacity/100:0);
    playerBackdrop.style.filter='blur('+options.blur+'px)';playerBackdrop.style.opacity=String(options.background==='artwork'?options.opacity/100:0);
  }
  function render(){
    frame=0;
    const source=document.getElementById('widget-art')?.getAttribute('src')||'';
    if(source!==artwork){artwork=source;backdrop.src=source;playerImage.src=source;apply();}
    const item=window.CmsWebPlayer?.getCurrentItem?.();const itemKey=item?.id+':'+item?.url+':'+JSON.stringify(item?.tags||[]);
    if(itemKey!==currentKey){currentKey=itemKey;tags.replaceChildren();for(const tag of (Array.isArray(item?.tags)?item.tags:[]).slice(0,6))node('span',String(tag),tags);}
    const queue=window.CmsWebPlayer?.getQueuePreview?.(3);
    const signature=JSON.stringify(queue);
    if(signature===queueSignature)return;queueSignature=signature;nextList.replaceChildren();
    if(!queue?.items?.length){node('p','次の曲はありません',nextList);return;}
    for(const [index,item] of queue.items.entries()){
      const button=node('button',null,nextList);button.type='button';button.className='cms-next-track';
      node('span',String(index+1),button).className='cms-next-number';
      if(item.thumbnail){const image=node('img',null,button);image.src=item.thumbnail;image.alt='';image.loading='lazy';}
      const info=node('span',null,button);node('strong',item.title||'タイトル未取得',info);node('small',item.artist||'',info);
      button.addEventListener('click',()=>{try{window.CmsWebPlayer.remotePlayback('track',{queueId:queue.queueId,queueRevision:queue.queueRevision,queueItemId:item.queueItemId});}catch(error){window.CmsUI?.notify?.(error.message,{type:'warning'});}});
    }
  }
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(render);};
  // Essential controls remain readable offline, without the external icon font.
  function localIcon(icon){
    const names=[['fa-backward-step','previous'],['fa-forward-step','next'],['fa-play','play'],['fa-pause','pause'],['fa-cog','settings'],['fa-search','search'],['fa-chart-column','stats'],['fa-plus','plus'],['fa-lock','lock'],['fa-filter','general']];
    const name=names.find(([className])=>icon.classList.contains(className))?.[1];
    if(!name)return;if(!icon.classList.contains('cms-local-icon'))icon.classList.add('cms-local-icon');
    if(icon.dataset.studioIcon===name)return;
    icon.dataset.studioIcon=name;icon.replaceChildren(window.CmsIcons.create(name,'cms-icon-plain'));
  }
  document.querySelectorAll('#main-app i,#stats-modal i').forEach(localIcon);
  new MutationObserver(changes=>{for(const change of changes)if(change.target.matches?.('i'))localIcon(change.target);})
    .observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']});
  const panel=document.getElementById('tab-advanced') || document.querySelector('#settings-modal .setting-scroll-area');
  if(panel){
    const settings=node('fieldset',null,panel);settings.className='cms-artwork-settings';node('legend','サムネイル背景とリニューアル表示',settings);
    const enabledLabel=node('label','画像案に合わせたプレーヤー表示 ',settings),enabled=node('input',null,enabledLabel);enabled.type='checkbox';enabled.checked=options.enabled;
    const label=node('label','背景の種類 ',settings),mode=node('select',null,label);mode.setAttribute('aria-label','背景の種類');
    for(const [value,text] of [['artwork','再生中のサムネイル'],['manual','従来の背景画像・背景色']]){const option=node('option',text,mode);option.value=value;}mode.value=options.background;
    const ranges=[];
    for(const [name,title,max] of [['blur','背景のぼかし',60],['opacity','サムネイル背景の濃さ',100]]){
      const row=node('label',title+' ',settings),input=node('input',null,row),output=node('output',null,row);input.type='range';input.min='0';input.max=String(max);input.value=String(options[name]);input.setAttribute('aria-label',title);
      const update=()=>{options[name]=Number(input.value);output.textContent=input.value+(name==='blur'?' px':'%');apply();};input.addEventListener('input',update);update();ranges.push(input);
    }
    const help=node('p','この端末の表示設定です。手動の背景画像・色は保持します。変更はこの欄の保存ボタンで確定します。',settings);help.className='setting-help';
    const save=node('button','背景・表示設定を保存',settings);save.type='button';save.className='theme-btn';
    enabled.addEventListener('change',()=>{options.enabled=enabled.checked;apply();});mode.addEventListener('change',()=>{options.background=mode.value;apply();});
    save.addEventListener('click',()=>{try{localStorage.setItem(key,JSON.stringify(options));help.textContent='背景・表示設定をこの端末に保存しました。';}catch(_){help.textContent='保存できませんでした。ブラウザの保存領域を確認してください。';}});
  }
  new MutationObserver(schedule).observe(document.getElementById('widget-art'),{attributes:true,attributeFilter:['src']});
  window.addEventListener('cms-state-change',schedule);apply();render();
})();
