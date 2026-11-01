/* Presentation only; the standard settings transaction owns saving/cancelling. */
function setupSettingsRefinement(){
 if(document.getElementById('set-setting-assist'))return;
 const modal=document.getElementById('settings-modal');
 const assist=document.createElement('label');assist.className='settings-assist-toggle';
 assist.innerHTML='<input id="set-setting-assist" type="checkbox"> アシスト表示';
 modal.querySelector('.settings-tabs').before(assist);
 const input=assist.querySelector('input');input.checked=Boolean(appSettings.settingAssist);
 const apply=()=>document.body.classList.toggle('settings-assist',input.checked);
 input.addEventListener('change',apply);apply();
 // Stable categories retain every existing control and its listener.
 const advanced=document.getElementById('tab-advanced');
 let group;
 for(const child of [...advanced.children]){
   if(!group||child.classList.contains('setting-section-label')||child.classList.contains('cms-background-settings')){
     group=document.createElement('details');group.className='settings-category';group.open=child.classList.contains('cms-background-settings');
     const summary=document.createElement('summary');summary.textContent=child.classList.contains('cms-background-settings')?'背景と透過':child.querySelector('strong')?.textContent||'データと接続';
     if(child.classList.contains('settings-pc-only'))group.classList.add('settings-pc-only');
     group.append(summary);advanced.insertBefore(group,child);
   }
   group.append(child);
 }
 const referenceWidths={'widget-controls':450,'widget-player':450,'widget-folder-list-wrapper':250,'widget-track-list-wrapper':410,'cms-next-preview':250,'library-nav-wrapper':676,'widget-clock':230};
 const referenceHeights={'widget-controls':300,'widget-player':300,'widget-folder-list-wrapper':526,'widget-track-list-wrapper':526,'cms-next-preview':190,'library-nav-wrapper':150,'widget-clock':120};
 const resize=new ResizeObserver(entries=>{for(const {target,contentRect} of entries){
   const scale=Math.min(1.8,Math.max(.8,Math.sqrt(contentRect.width/(referenceWidths[target.id]||400)*contentRect.height/(referenceHeights[target.id]||300))));
   target.style.setProperty('--cms-window-scale',String(scale));
 }});
 for(const id of Object.keys(referenceWidths)){const panel=document.getElementById(id);if(panel)resize.observe(panel);}
}
