/* Device-local presentation only: artwork never enters Firebase or the remote protocol. */
(() => {
  'use strict';
  const key='cms_studio_appearance_v1';
  document.body.classList.add('cms-experience-v3');
  const clamp=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
  let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}');}catch(_){}
  const normalizeBackground=value=>['image','artwork','color'].includes(value)?value:value==='manual'?'image':hasCustomBackgroundImage?'image':'artwork';
  const options={background:normalizeBackground(appSettings.artworkBackgroundMode || saved.backgroundMode),opacity:100};
  appSettings.artworkBackgroundMode=options.background;appSettings.artworkBlur=0;
  const node=(tag,text,parent)=>{const value=document.createElement(tag);if(text)value.textContent=text;parent?.append(value);return value;};
  const ambient=node('div',null,document.body);ambient.id='cms-artwork-ambient';ambient.setAttribute('aria-hidden','true');
  const backdrop=node('img',null,ambient);backdrop.alt='';backdrop.decoding='async';
  const controlPanel=document.getElementById('widget-controls');
  const playerBackdrop=node('div',null,controlPanel);playerBackdrop.className='cms-player-artwork';playerBackdrop.setAttribute('aria-hidden','true');
  const playerImage=node('img',null,playerBackdrop);playerImage.alt='';playerImage.decoding='async';
  const tags=node('div',null);tags.className='cms-player-tags';tags.setAttribute('aria-label','再生中の曲のタグ');document.getElementById('widget-artist')?.after(tags);
  const section=node('section',null,document.getElementById('widget-container'));section.id='cms-next-preview';section.className='cms-next-preview panel-glass';section.setAttribute('aria-label','次に再生');
  node('h3','次に再生',section);const nextList=node('div',null,section);
  let artwork='',currentKey='',queueSignature='',frame=0,editing=false;
  function apply(){
    document.body.classList.add('cms-studio');
    const hasArtwork=Boolean(artwork)&&!/^data:image\/svg\+xml,[^<]*<svg\b[^>]*\/>$/.test(artwork);
    const useArtwork=hasArtwork&&options.background==='artwork';
    document.body.classList.toggle('cms-artwork-background',useArtwork);
    document.body.dataset.backgroundSource=options.background;
    document.body.style.setProperty('--cms-solid-background',appSettings.blurBaseColor||'#101824');
    ambient.style.setProperty('--cms-art-blur','0px');ambient.style.opacity=String(useArtwork?options.opacity/100:0);
    const accent=getComputedStyle(document.body).getPropertyValue('--experience-accent').trim();
    const rgb=/^#([0-9a-f]{6})$/i.exec(accent);
    if(rgb){const c=[0,2,4].map(i=>parseInt(rgb[1].slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);const l=c[0]*.2126+c[1]*.7152+c[2]*.0722;document.body.style.setProperty('--cms-play-ink',l>.179?'#07131f':'#ffffff');}
    // Only the ambient layer carries artwork: transparent panels must reveal it without a second tint.
    playerBackdrop.style.opacity='0';
  }
  function render(){
    frame=0;
    if(!editing)options.background=normalizeBackground(appSettings.artworkBackgroundMode||options.background);
    const source=document.getElementById('widget-art')?.getAttribute('src')||'';
    if(source!==artwork){artwork=source;backdrop.src=source;playerImage.src=source;apply();}
    const item=window.CmsWebPlayer?.getCurrentItem?.();const itemKey=item?.id+':'+item?.url+':'+JSON.stringify(item?.tags||[]);
    if(itemKey!==currentKey){currentKey=itemKey;tags.replaceChildren();for(const tag of (Array.isArray(item?.tags)?item.tags:[]).slice(0,6))node('span',String(tag),tags);}
    const queue=window.CmsWebPlayer?.getQueuePreview?.(3);
    const signature=JSON.stringify(queue);
    apply();if(signature===queueSignature)return;queueSignature=signature;nextList.replaceChildren();
    if(!queue?.items?.length){node('p','次の曲はありません',nextList);return;}
    for(const [index,item] of queue.items.entries()){
      const button=node('button',null,nextList);button.type='button';button.className='cms-next-track';
      node('span',String(index+1),button).className='cms-next-number';
      if(item.thumbnail){const image=node('img',null,button);image.src=item.thumbnail;image.alt='';image.loading='lazy';}
      const info=node('span',null,button);info.className='cms-next-info';
      const titleWrapper=node('span',null,info);titleWrapper.className='marquee-wrapper';
      node('strong',item.title||'タイトル未取得',titleWrapper).className='marquee-content';
      const artistWrapper=node('span',null,info);artistWrapper.className='marquee-wrapper';
      node('small',item.artist||'',artistWrapper).className='marquee-content';
      button.addEventListener('click',()=>{try{window.CmsWebPlayer.remotePlayback('track',{queueId:queue.queueId,queueRevision:queue.queueRevision,queueItemId:item.queueItemId});}catch(error){window.CmsUI?.notify?.(error.message,{type:'warning'});}});
    }
    window.scheduleMarqueeUpdate?.();
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
    const settings=node('fieldset',null,panel);settings.className='cms-background-settings';node('legend','背景と透過',settings);
    const label=node('label','背景の種類 ',settings),mode=node('select',null,label);mode.setAttribute('aria-label','背景の種類');
    mode.id='set-artwork-background';
    for(const [value,text] of [['artwork','再生中のサムネイル'],['image','保存した背景画像'],['color','背景色']]){const option=node('option',text,mode);option.value=value;}mode.value=options.background;
    const help=node('p','背景素材とパネルの透過は別です。下の「保存して適用」で他の設定とまとめて保存します。',settings);help.className='setting-help';
    mode.addEventListener('change',()=>{options.background=mode.value;apply();});
    for(const id of ['set-bg-img','set-bg-position','btn-edit-bg-position','set-opacity']){const row=document.getElementById(id)?.closest('.setting-row');if(row)settings.append(row);}
    const opacityLabel=document.querySelector('label:has(#op-val)');if(opacityLabel)opacityLabel.firstChild.textContent='パネルの透明度（100で透明）: ';
    window.CmsArtworkSettings={
      open(values){editing=true;options.background=normalizeBackground(values.artworkBackgroundMode||options.background);mode.value=options.background;apply();},
      commit(values){values.artworkBackgroundMode=mode.value;values.artworkBlur=0;editing=false;},
      finish(){editing=false;},
      snapshot:()=>({...options})
    };
  }
  new MutationObserver(schedule).observe(document.getElementById('widget-art'),{attributes:true,attributeFilter:['src']});
  window.addEventListener('cms-state-change',schedule);window.addEventListener('resize',schedule);
  if(document.body.classList.contains('window-mode')&&typeof window.applyWindowMode==='function')window.applyWindowMode();
  apply();render();
})();
