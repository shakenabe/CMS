/* Playback policy v2, shared by Web, extension and PC. Old records stay identifiable. */
(function(root){
  'use strict';
  const classify=event=>{
    const outcome=String(event?.outcome||'').toLowerCase();
    if(outcome==='partial' && event.countedAsPlay===false && Number(event.listenedSeconds)>=30)return 'partial';
    if(event?.countedAsPlay===false || ['skipped','failed','error','technicalerror','cancelled','not-counted'].includes(outcome))return 'ignored';
    if(event?.countedAsPlay===true || outcome==='counted')return 'completed';
    return !outcome && ['web','extension','chrome-extension'].includes(event?.source)?'legacy':'unknown';
  };
  // Position deltas avoid charging seek jumps, buffering and suspended timers.
  function sample(previous,position,playing,now=Date.now()){
    const state={...(previous||{}),position:Number(position)||0,at:now,playing:playing===true,seconds:Number(previous?.seconds)||0};
    if(previous?.playing && playing && now>=previous.at){
      const delta=state.position-previous.position,elapsed=(now-previous.at)/1000;
      if(delta>0 && delta<=Math.min(10,elapsed*2+1))state.seconds+=Math.min(delta,elapsed*2);
    }
    return state;
  }
  const fields=(completed,seconds)=>({playbackPolicyVersion:2,completion:completed?'ended':'interrupted',
    countedAsPlay:completed,outcome:completed?'counted':'partial',listenedSeconds:Math.max(0,Number(seconds)||0)});
  const periodStart=(days,now=Date.now())=>{const local=new Date(now+9*3600000);return Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-(Math.max(1,days)-1))-9*3600000;};
  const dateKey=value=>{const time=Date.parse(value);return Number.isFinite(time)?new Date(time+9*3600000).toISOString().slice(0,10):'';};
  const api={VERSION:2,PARTIAL_SECONDS:30,classify,sample,fields,periodStart,dateKey};
  root.CmsListeningHistory=api;if(typeof module==='object')module.exports=api;
})(globalThis);
