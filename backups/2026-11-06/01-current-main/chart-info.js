(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ChartInfo=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const storageKey='funding-chart-info-v1',ids=['chartTopInfo','chartBottomInfo'];
 function expanded(saved,id,height){return typeof saved?.[id]==='boolean'?saved[id]:height>=820;}
 function bind(win){
  const doc=win.document;if(doc.documentElement.classList.contains('chart-embedded'))return;
  let saved;try{saved=JSON.parse(win.localStorage.getItem(storageKey)||'{}');}catch{}
  const values={};
  for(const id of ids){const panel=doc.getElementById(id);if(!panel)continue;panel.open=expanded(saved,id,win.innerHeight);values[id]=panel.open;
   panel.addEventListener('toggle',()=>{values[id]=panel.open;try{win.localStorage.setItem(storageKey,JSON.stringify(values));}catch{}});
  }
 }
 return {bind,expanded};
});
