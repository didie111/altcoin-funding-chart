(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestBackup=api;})(globalThis,function(){
 'use strict';
 const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
 function filename(now=Date.now()){return 'funding-chart-backup-'+new Date(now+9*3600000).toISOString().slice(0,19).replace(/[:T]/g,'-')+'-KST.dat';}
 async function blob(payload,{BlobClass=Blob,onProgress=()=>{},yieldControl=pause}={}){
  const {pages,...metadata}=payload,parts=[JSON.stringify(metadata).slice(0,-1)+',"pages":['];
  for(let i=0;i<pages.length;i++){if(i)parts.push(',');parts.push(JSON.stringify(pages[i]));if((i+1)%100===0){onProgress('백업 파일 생성 중 · '+(i+1)+' / '+pages.length+'개 자료');await yieldControl();}}
  parts.push(']}');return new BlobClass(parts,{type:'application/octet-stream'});
 }
 async function save({environment=globalThis,document=environment.document,readBackup,onProgress=()=>{},name=filename()}={}){
  // Invoke the picker in the original click, before IndexedDB reads or timers consume activation.
  let selection;
  if(typeof environment.showSaveFilePicker==='function'){
   try{selection=Promise.resolve(environment.showSaveFilePicker({suggestedName:name,types:[{description:'펀딩 차트 백테스팅 백업',accept:{'application/octet-stream':['.dat']}}]})).then(handle=>({handle}),error=>({error}));}catch(error){selection=Promise.resolve({error});}
  }
  const chosen=selection?await selection:null;if(chosen?.error?.name==='AbortError')throw chosen.error;
  onProgress('즐겨찾기·결과·시장자료를 읽는 중…');const payload=await readBackup(),file=await blob(payload,{onProgress,BlobClass:environment.Blob||Blob});
  if(chosen?.handle){let writable;try{writable=await chosen.handle.createWritable();await writable.write(file);await writable.close();}catch(error){try{await writable?.abort();}catch{}throw error;}}
  else{
   // Firefox and restricted picker contexts use a normal, attached download link.
   const url=environment.URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);
   try{link.click();}finally{link.remove();environment.setTimeout(()=>environment.URL.revokeObjectURL(url),60000);}
  }
  return {method:chosen?.handle?'file':'download',bytes:file.size,pages:payload.pages.length,jobs:payload.jobs.length,favorites:payload.favorites?.length||0};
 }
 async function restore(payload,{store,favorites,parseKey}={}){
  const keys=payload.favorites===undefined?[]:payload.favorites;
  if(!Array.isArray(keys)||keys.some(key=>typeof key!=='string'||!parseKey(key)))throw Error('백업 즐겨찾기 목록이 올바르지 않습니다.');
  const before=new Set(favorites.snapshot().keys),result=await store.importAll(payload),unique=[...new Set(keys)];
  if(unique.length)favorites.change(unique,true);
  return {...result,addedFavorites:unique.filter(key=>!before.has(key)).length,favoritesPersistent:favorites.snapshot().persistent!==false};
 }
 return {filename,blob,save,restore};
});
