(function () {
  'use strict';
  const store = () => window.CmsRecommendationStore;
  window.CMSRecommendationAdapter = {
    async state() {
      const records = window.CmsWebPlayer.getRecords();
      if (!records.length) throw new Error('先にライブラリを読み込んでください。');
      const data = await store().ensure(records);
      return { records, history: data.history, preferences: store().preferences(data), migration: data.migration,
        folders: data.folders, currentContentKey: CMSRecommendationEngine.normalizeContentKey(window.CmsWebPlayer.getCurrentItem()),
        activeQueue:window.CmsWebPlayer.getActiveRecommendationQueue(),
        sessionRecentContentKeys: data.sessionRecentContentKeys, historyLimit: 2000 };
    },
    preference: (key, field, value) => store().setPreference(key, field, value),
    saveQueue: queue => store().saveQueue(queue),
    saveFolder: (queue, name) => store().saveFolder(queue, name),
    updateFolder:(folderId,revision,queue)=>store().updateFolder(folderId,revision,queue),
    async folderVersion(folderId,revision) {
      let version=await store().folderVersion(folderId,revision);
      const owner=store().namespace();
      if(!version && owner.startsWith('user:')) {
        version=await window.CmsWebFirebase.fetchRecommendationFolderVersion(folderId,revision);
        if(owner!==store().namespace()) throw new Error('保存先が変わりました。再確認してください。');
        if(version) await store().cacheFolderVersion(version);
      }
      if(!version) throw new Error('この旧版を取得できません。保存した端末で同期してから再試行してください。');
      return version;
    },
    sync: () => window.CmsWebFirebase.syncRecommendations({refreshHistory:true}),
    async play(items, context, queue) {
      await store().setActiveQueue(queue || { items, ...context });
      window.CmsWebPlayer.startRecommendation(items, { ...context, finite: true }, queue);
    },
    async append(items, queue, expected) {
      const result=window.CmsWebPlayer.appendRecommendation(items,queue,expected);
      await store().setActiveQueue(result);
    },
    rowRecord(row) { return window.CmsWebPlayer.getVisibleRecords()[Number(row.dataset.index)]; },
    rowSelector: '.w-t-item[data-index]'
    ,historyContainer: () => document.querySelector('#stats-modal .stats-scroll-area')
  };
})();
