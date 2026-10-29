(function(root,factory){
 'use strict';const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 else{
  let broker;
  try{if(root.parent!==root&&root.parent.location.origin===root.location.origin)broker=root.parent.MarketShared?.broker;}catch{}
  root.MarketShared={...api,broker:broker||api.create()};
 }
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const abortError=()=>new DOMException('요청이 취소됐습니다.','AbortError');
 function copy(value){const result=structuredClone(value);if(value?.__marketFetchedAt)Object.defineProperty(result,'__marketFetchedAt',{value:value.__marketFetchedAt});return result;}
 function create({now=Date.now,wait=(ms,signal)=>new Promise((resolve,reject)=>{const done=()=>{signal.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);reject(signal.reason||abortError());};signal.addEventListener('abort',abort,{once:true});}),maxEntries=48}={}){
  const cache=new Map();let queue=Promise.resolve(),lastStart=-Infinity;
  function request(key,producer,signal=new AbortController().signal,ttl=2000){
   if(signal.aborted)return Promise.reject(signal.reason||abortError());
   let entry=cache.get(key);
   if(entry?.done&&entry.expires>now())return Promise.resolve(copy(entry.value));
   if(!entry||entry.done||entry.controller.signal.aborted){
    entry={controller:new AbortController(),users:0,done:false,expires:0};cache.set(key,entry);
    entry.promise=Promise.resolve().then(()=>{entry.controller.signal.throwIfAborted();return producer(entry.controller.signal);}).then(value=>{
     entry.done=true;entry.value=value;entry.expires=now()+ttl;
     if(entry.controller.signal.aborted&&cache.get(key)===entry)cache.delete(key);
     for(const [oldKey,old]of cache){if(cache.size<=maxEntries)break;if(old.done&&oldKey!==key)cache.delete(oldKey);}
     return value;
    },error=>{entry.done=true;if(cache.get(key)===entry)cache.delete(key);throw error;});
    entry.promise.catch(()=>{});
   }
   entry.users++;
   return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);entry.users--;fn(value);};
    const abort=()=>{finish(reject,signal.reason||abortError());if(!entry.users&&!entry.done)entry.controller.abort(abortError());};
    signal.addEventListener('abort',abort,{once:true});
    entry.promise.then(value=>{if(!settled)finish(resolve,copy(value));},error=>finish(reject,error));
   });
  }
  async function reserveBingx(signal,task){
   const turn=queue.then(async()=>{signal.throwIfAborted();const delay=lastStart+1150-now();if(delay>0)await wait(delay,signal);signal.throwIfAborted();lastStart=now();return {response:task()};});
   queue=turn.catch(()=>{});return turn;
  }
  return {request,reserveBingx};
 }
 function key(base,params){return base+'?'+new URLSearchParams(Object.entries(params||{}).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)));}
 function ttl(base){return /contracts$|exchangeInfo$|instruments-info$|contract\/detail$|public\/instruments$/.test(base)?300000:/ticker|tickers|premiumIndex/.test(base)?8000:/funding/.test(base)?15000:2000;}
 return {create,key,ttl};
});
