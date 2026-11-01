/* Reuse live controls, never clone input IDs or attach duplicate handlers. */
(() => {
  'use strict';
  let scheduled=0;
  const nav=document.querySelector('#library-nav-wrapper .controls-wrapper');
  const filter=document.querySelector('#library-nav-wrapper .filter-option');
  const sort=document.getElementById('widget-sort-select');
  function update(){
    scheduled=0;
    const launcher=document.querySelector('.cms-rec-launcher');
    const fixed=document.body.classList.contains('is-pc')&&!document.body.classList.contains('window-mode');
    const target=fixed&&launcher?launcher:nav;
    const windowMode=document.body.classList.contains('window-mode');
    const slot=document.getElementById('recommendation-toolbar-slot');
    const slotParent=windowMode?document.getElementById('library-nav-wrapper'):document.getElementById('widget-library');
    if(slot&&slotParent&&slot.parentElement!==slotParent){
      if(windowMode)slotParent.append(slot);
      else slotParent.insertBefore(slot,slotParent.querySelector('.library-lists-container'));
    }
    if(target){for(const control of [filter,sort])if(control&&control.parentElement!==target)target.append(control);}
    document.body.classList.toggle('cms-fixed-toolbar',fixed&&!!launcher);
    // Keep the remaining Kiite grouping controls accessible without the old nav.
    if(target){for(const id of ['vocaloid-group-back','vocaloid-group-mode']){
      const control=document.getElementById(id);if(control&&control.parentElement!==target)target.append(control);
    }}
  }
  function schedule(){if(!scheduled)scheduled=requestAnimationFrame(update);}
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  const slot=document.getElementById('recommendation-toolbar-slot');
  if(slot)new MutationObserver(schedule).observe(slot,{childList:true});
  window.addEventListener('resize',schedule);window.addEventListener('cms-state-change',schedule);
  let rankingTimer=0;
  window.addEventListener('cms-recommendation-state',()=>{
    clearTimeout(rankingTimer);
    rankingTimer=setTimeout(()=>window.CmsWebPlayer?.refreshRecommendedOrder?.(),100);
  });
  update();
})();
