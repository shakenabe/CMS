/* The extension owns processing inside media frames. The page never reads audio. */
(() => {
  'use strict';
  let state={supported:false,limiter:false,leveling:false,reason:'CMS拡張機能との接続を確認しています。'},pending=null;
  const listeners=new Set();
  const publish=()=>{for(const listener of listeners)listener({...state});window.dispatchEvent(new Event('cms-state-change'));};
  function request(operation,settings={}){
    return new Promise((resolve,reject)=>{
      const id=crypto.randomUUID();let timer;
      const finish=(error,value)=>{clearTimeout(timer);window.removeEventListener('message',receive);error?reject(error):resolve(value);};
      const receive=event=>{
        if(event.source!==window || event.origin!==location.origin || event.data?.type!=='CMS_PUBLIC_AUDIO_RESPONSE' || event.data.id!==id)return;
        if(event.data.error)return finish(new Error(String(event.data.error).slice(0,300)));
        const value=event.data.result;
        if(!value || typeof value.supported!=='boolean')return finish(new Error('音声処理の応答を確認できませんでした。'));
        finish(null,{supported:value.supported,limiter:value.limiter===true,leveling:value.leveling===true,reason:String(value.reason||'').slice(0,300)});
      };
      window.addEventListener('message',receive);
      timer=setTimeout(()=>finish(new Error('CMS拡張機能を有効にしてPCのCMSタブを再読み込みしてください。')),2500);
      window.postMessage({type:'CMS_PUBLIC_AUDIO_REQUEST',id,request:{operation,...settings}},location.origin);
    });
  }
  async function refresh(){
    if(pending)return pending;
    pending=request('status').then(value=>{state=value;}).catch(error=>{state={supported:false,limiter:false,leveling:false,reason:error.message};}).finally(()=>{pending=null;publish();});return pending;
  }
  async function setSettings(settings){
    if(!state.supported && state.reason!=='not-started')throw new Error(state.reason||'この再生経路は音声処理に対応していません。');
    if(typeof settings?.limiter!=='boolean'||typeof settings?.leveling!=='boolean')throw new Error('音声処理の設定が不正です。');
    try{state=await request('settings',{limiter:settings.limiter,leveling:settings.leveling});}
    catch(error){state={...state,supported:false,reason:error.message};publish();throw error;}
    publish();
    if(!state.supported && state.reason!=='not-started')throw new Error(state.reason||'この再生経路は音声処理に対応していません。');return {...state};
  }
  window.CmsWebAudio=Object.freeze({getState:()=>({...state}),refresh,setSettings});
  const parent=document.getElementById('tab-basic');
  if(parent){
    const section=document.createElement('section');section.className='cms-audio-settings';
    section.innerHTML='<h3>PCの音声を整える</h3><label><input type="checkbox" id="cms-audio-limiter"> 大きな音を抑える</label><label><input type="checkbox" id="cms-audio-leveling"> 曲ごとの音量差を小さくする</label><p id="cms-audio-reason" role="status"></p><button type="button" id="cms-audio-refresh">対応状況を確認</button>';
    parent.append(section);
    const limiter=section.querySelector('#cms-audio-limiter'),leveling=section.querySelector('#cms-audio-leveling');
    const update=value=>{limiter.checked=value.limiter;leveling.checked=value.leveling;limiter.disabled=leveling.disabled=!value.supported&&value.reason!=='not-started';section.querySelector('p').textContent=value.reason==='not-started'?'音声処理はOFFです。操作するとすぐにPCの音声へ適用します。':value.reason||(value.supported?'PCの再生音声に適用します。音量を上げず、大きな音だけを抑えます。':'現在の音声には適用できません。');};
    listeners.add(update);update(state);
    for(const input of [limiter,leveling])input.addEventListener('change',()=>{limiter.disabled=leveling.disabled=true;setSettings({limiter:limiter.checked,leveling:leveling.checked}).catch(error=>{section.querySelector('p').textContent=error.message;}).finally(()=>update(state));});
    section.querySelector('button').onclick=()=>void refresh();
  }
  let mediaKey='',mediaTimer;
  window.addEventListener('cms-state-change',()=>{
    const item=window.CmsWebPlayer?.getCurrentItem?.(),key=String(item?.id||'')+'|'+String(item?.url||'');
    if(key===mediaKey)return;mediaKey=key;clearTimeout(mediaTimer);mediaTimer=setTimeout(()=>void refresh(),1200);
  });
  window.addEventListener('focus',()=>void refresh());
  setInterval(()=>{if(!document.hidden)void refresh();},15000);void refresh();
})();
