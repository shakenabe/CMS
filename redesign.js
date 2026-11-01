/* Native theme/origin bridge. No duplicate switcher or framework runtime. */
(() => {
    let frame = 0;
    function update() {
        frame = 0;
        const state = window.CmsRedesign.snapshot();
        document.body.classList.add('cms-redesign');
        document.body.classList.toggle('color-light', state.light);
        document.body.classList.toggle('color-dark', !state.light);
        // P1-P4 were coupled visual/layout presets. Themes now have a separate
        // identity from desktop, window and mobile presentation.
        for (const name of ['p1','p2','p3','p4']) document.body.classList.remove('theme-'+name);
        const origin = document.getElementById('cms-playing-origin');
        if (!origin) return;
        const folder = state.folder==='__all'?'すべて':state.folder==='__history'?'再生履歴':state.folder==='__vocaloid'?'ボカロ / Kiite':state.folder==='__smart_queue'?'再生キュー':state.folder;
        const label = '再生元：'+(folder || 'おすすめ / キュー');
        if (origin.textContent!==label) origin.textContent=label;
        origin.disabled=!state.title;
    }
    function schedule() { if (!frame) frame=requestAnimationFrame(update); }
    function setup() {
        const origin=document.createElement('button'); origin.id='cms-playing-origin'; origin.className='cms-playing-origin'; origin.type='button';
        origin.title='再生中の曲へ移動（以後の曲にも自動追従）';
        origin.addEventListener('click',()=>window.CmsRedesign.locate());
        document.getElementById('widget-artist')?.after(origin);
        window.addEventListener('cms-state-change',schedule);
        window.addEventListener('resize',schedule);
        matchMedia('(prefers-color-scheme: light)').addEventListener('change',schedule);
        update();
    }
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',setup,{once:true}); else setup();
})();
