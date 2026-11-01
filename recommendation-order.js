/* Library ordering uses the same explicit-favorite/history/rediscovery weights
 * as Smart selection, without sampling, mutating records or replacing a queue. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./shared/recommendation-engine.js'):root.CMSRecommendationEngine);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CmsRecommendationOrdering=api;
})(typeof globalThis==='undefined'?this:globalThis,function(engine){
  'use strict';
  function order(records,state={},referenceTime=new Date().toISOString()){
    const prepared=engine.prepareCandidates({records,history:state.history||[],preferences:state.preferences||[],
      referenceTime,timezone:'Asia/Tokyo',allowLegacyBaseline:true,scope:{type:'library'}});
    const weights=new Map(prepared.candidates.map(item=>[item.contentKey,item.weight]));
    return records.map((record,index)=>({record,index,weight:weights.get(engine.normalizeContentKey(record))??-Infinity}))
      .sort((a,b)=>b.weight-a.weight||a.index-b.index).map(item=>item.record);
  }
  return Object.freeze({order});
});
