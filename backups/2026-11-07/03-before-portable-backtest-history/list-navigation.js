(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ListNavigation=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function create(){
  const positions=new Map();
  function get(key){return {...(positions.get(key)||{page:0,scroll:0,left:0,anchor:null,offset:0})};}
  function save(key,container,page=0){
   if(!key||!container||container.clientHeight===0)return get(key);
   const top=container.getBoundingClientRect().top,first=[...container.querySelectorAll('[data-list-key]')].find(n=>n.getBoundingClientRect().bottom>top);
   const value={page,scroll:container.scrollTop,left:container.scrollLeft,anchor:first?.dataset.listKey||null,offset:first?first.getBoundingClientRect().top-top:0};positions.set(key,value);return {...value};
  }
  function restore(key,container){const p=get(key);if(!container)return p;container.scrollTop=p.scroll;container.scrollLeft=p.left;const anchor=p.anchor&&[...container.querySelectorAll('[data-list-key]')].find(n=>n.dataset.listKey===p.anchor);if(anchor&&container.clientHeight)container.scrollTop+=anchor.getBoundingClientRect().top-container.getBoundingClientRect().top-p.offset;return p;}
  function top(key){positions.set(key,{page:0,scroll:0,left:0,anchor:null,offset:0});return get(key);}
  return {get,save,restore,top,clear:()=>positions.clear()};
 }
 return {create};
});
