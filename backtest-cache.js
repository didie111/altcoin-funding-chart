(function(root,factory){'use strict';const T=typeof module==='object'&&module.exports?require('./timeframes.js'):(root.TimeframeEngine||globalThis.TimeframeEngine);const api=factory(root,T);if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestCache=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root,T){
 'use strict';
 const maxBytes=32*1024*1024;
 const fields=['time','open','high','low','close','volume'];
 function uint8ToBase64(u8){let s='',len=u8.byteLength;for(let i=0;i<len;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,Math.min(i+0x8000,len)));return btoa(s);}
 function base64ToUint8(b64){const s=atob(b64),len=s.length,bytes=new Uint8Array(len);for(let i=0;i<len;i++)bytes[i]=s.charCodeAt(i);return bytes;}
 function serializeData(val){if(!val||typeof val!=='object')return val;if(val instanceof Uint8Array||(typeof Buffer!=='undefined'&&Buffer.isBuffer(val)))return {__type:'Uint8Array',b64:uint8ToBase64(new Uint8Array(val.buffer,val.byteOffset,val.byteLength))};if(val instanceof Float64Array)return {__type:'Float64Array',count:val.length,b64:uint8ToBase64(new Uint8Array(val.buffer,val.byteOffset,val.byteLength))};if(Array.isArray(val))return val.map(serializeData);const out={};for(const [k,v]of Object.entries(val))out[k]=serializeData(v);return out;}
 function deserializeData(val){if(!val||typeof val!=='object')return val;if(val.__type==='Uint8Array')return base64ToUint8(val.b64);if(val.__type==='Float64Array'){const u8=base64ToUint8(val.b64);const buf=u8.byteOffset%8===0?u8.buffer:u8.buffer.slice(u8.byteOffset,u8.byteOffset+u8.byteLength);const offset=u8.byteOffset%8===0?u8.byteOffset:0;return new Float64Array(buf,offset,val.count||(u8.byteLength/8));}if(Array.isArray(val))return val.map(deserializeData);const out={};for(const [k,v]of Object.entries(val))out[k]=deserializeData(v);return out;}
 function estimateBytes(data,key=''){
  const size=value=>{if(value===null||value===undefined)return 8;if(ArrayBuffer.isView(value)||value instanceof ArrayBuffer)return value.byteLength+32;if(typeof value==='string')return value.length*2+16;if(typeof value==='number'||typeof value==='boolean')return 8;if(Array.isArray(value))return 32+value.reduce((n,v)=>n+size(v),0);if(typeof value==='object')return 32+Object.entries(value).reduce((n,[k,v])=>n+k.length*2+size(v),0);return 16;};
  return key.length*2+128+size(data);
 }
 function backupPages(payload){
  if(payload?.app!=='funding-chart-batch-v1'||payload.version!==1||!Array.isArray(payload.pages)||!Array.isArray(payload.jobs))throw Error('지원하지 않는 백업 파일 형식입니다.');
  const entries=new Map();for(const p of payload.pages){if(typeof p.key!=='string'||p.key.length>2048)throw Error('시장자료 키가 올바르지 않습니다.');const data=deserializeData(p.data);if(data?.kind==='ohlcv-page-v2'&&!unpackCandles(data))throw Error('백업 캔들 값이 올바르지 않습니다.');entries.set(p.key,{key:p.key,data,expires:Number.isFinite(p.expires)?p.expires:Date.now()+30*86400000,bytes:estimateBytes(data,p.key)});}
  for(const j of payload.jobs)if(typeof j.id!=='string'||!Array.isArray(j.items)||!j.config||!T.seconds[j.config.timeframe]&&j.config.timeframe!=='all')throw Error('백업 작업 요약이 올바르지 않습니다.');
  return [...entries.values()];
 }
 async function restoreBackup(store,payload){
  const pages=backupPages(payload);for(const p of pages)if(p.expires>=Date.now())await store.put(p.key,p.data,{expires:p.expires,bytes:p.bytes});
  for(const job of payload.jobs)await store.saveJob(job);
  const retained=new Set(await store.keys());return {importedPages:pages.filter(p=>retained.has(p.key)).length,importedJobs:Math.min(3,payload.jobs.length),skippedPages:pages.filter(p=>!retained.has(p.key)).length};
 }
 function packCandles(rows){
  const values=new Float64Array(rows.length*6);for(let i=0;i<rows.length;i++)for(let j=0;j<6;j++){const n=rows[i][fields[j]];if(!Number.isFinite(n))throw Error('저장할 캔들 값이 올바르지 않습니다.');values[i*6+j]=n;}return {kind:'ohlcv-page-v2',count:rows.length,values};
 }
 function unpackCandles(page){
  if(page?.kind!=='ohlcv-page-v2'||!Number.isSafeInteger(page.count)||page.count<0||!ArrayBuffer.isView(page.values)||page.values.BYTES_PER_ELEMENT!==8||page.values.length!==page.count*6)return null;
  const rows=Array.from({length:page.count},(_,i)=>Object.fromEntries(fields.map((key,j)=>[key,page.values[i*6+j]])));return rows.every(r=>fields.every(k=>Number.isFinite(r[k])))?rows:null;
 }
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const complete=tx=>{const done=new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||Error('브라우저 저장 실패'));});done.catch(()=>{});return done;};
 function memory({limit=maxBytes}={}){const pages=new Map(),jobs=new Map(),requestIndex=new Map();let bytes=0;const api={persistent:false,async keys(){return [...pages.keys()];},async get(key,now=Date.now()){const p=pages.get(key);if(!p||p.expires<now)return null;pages.delete(key);pages.set(key,p);return structuredClone(p.data);},async put(key,data,{expires=Date.now()+86400000,bytes:size=estimateBytes(data,key)}={}){if(size>limit)return;bytes-=pages.get(key)?.bytes||0;pages.delete(key);pages.set(key,{data:structuredClone(data),expires,bytes:size});bytes+=size;for(const [k,v]of pages){if(bytes<=limit)break;pages.delete(k);bytes-=v.bytes;}},async deletePage(key){const old=pages.get(key);if(old){bytes-=old.bytes;pages.delete(key);}},async getRequestIndex(reqKey){return requestIndex.get(reqKey)||null;},async putRequestIndex(reqKey,contentKey){requestIndex.delete(reqKey);requestIndex.set(reqKey,contentKey);while(requestIndex.size>1024)requestIndex.delete(requestIndex.keys().next().value);},async saveJob(job){jobs.set(job.id,structuredClone(job));const sorted=[...jobs.values()].sort((a,b)=>b.updated-a.updated);for(const j of sorted.slice(3))jobs.delete(j.id);},async latestJob(){return structuredClone([...jobs.values()].sort((a,b)=>b.updated-a.updated)[0]||null);},async info(){return {bytes,maxBytes:limit,persistent:false};},async clearPages(){pages.clear();requestIndex.clear();bytes=0;},async exportAll(){const pageEntries=[];for(const [key,item]of pages)pageEntries.push({key,data:serializeData(item.data),expires:item.expires,bytes:item.bytes});return {version:1,app:'funding-chart-batch-v1',exportedAt:Date.now(),pages:pageEntries,jobs:[...jobs.values()]};},async importAll(payload){return restoreBackup(api,payload);}};return api;}
 async function open({indexedDB=root.indexedDB,limit=maxBytes}={}){
  if(!indexedDB)return memory({limit});let db;try{const req=indexedDB.open('funding-chart-batch-v1',2);req.onupgradeneeded=ev=>{const d=req.result;if(ev.oldVersion<1){const p=d.createObjectStore('pages',{keyPath:'key'});p.createIndex('touched','touched');d.createObjectStore('meta',{keyPath:'key'});const j=d.createObjectStore('jobs',{keyPath:'id'});j.createIndex('updated','updated');}if(ev.oldVersion<2){d.createObjectStore('requestIndex',{keyPath:'reqKey'});}};db=await request(req);}catch{return memory({limit});}
  db.onversionchange=()=>db.close();const fallback=memory({limit:Math.min(limit,4*1024*1024)});let persistent=true;
  async function protect(action,alternative){if(!persistent)return alternative();try{return await action();}catch{persistent=false;return alternative();}}
  await protect(async()=>{
   const tx=db.transaction(['pages','meta'],'readwrite'),done=complete(tx),pages=tx.objectStore('pages'),meta=tx.objectStore('meta'),version=await request(meta.get('byte-accounting-v3'));
   if(!version){let total=0;
    await new Promise((resolve,reject)=>{const cursor=pages.openCursor();cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const item=cursor.result;if(!item){resolve();return;}const p=item.value;p.bytes=estimateBytes(p.data,p.key);if(p.expires<Date.now()||p.bytes>limit)item.delete();else{total+=p.bytes;item.update(p);}item.continue();};});
    if(total>limit)await new Promise((resolve,reject)=>{const cursor=pages.index('touched').openCursor();cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const item=cursor.result;if(!item||total<=limit){resolve();return;}total-=item.value.bytes;item.delete();item.continue();};});
    meta.put({key:'bytes',value:total});meta.put({key:'byte-accounting-v3',value:1});
   }
   await done;
  },async()=>{});
  const api={get persistent(){return persistent;},
   keys(){return protect(async()=>{const tx=db.transaction('pages','readonly'),done=complete(tx),keys=await request(tx.objectStore('pages').getAllKeys());await done;return keys;},()=>fallback.keys());},
   get(key,now=Date.now()){return protect(async()=>{const tx=db.transaction('pages','readwrite'),done=complete(tx),store=tx.objectStore('pages'),value=await request(store.get(key));if(value&&value.expires>=now){value.touched=now;store.put(value);}await done;return value&&value.expires>=now?value.data:null;},()=>fallback.get(key,now));},
   put(key,data,{expires=Date.now()+86400000,bytes=estimateBytes(data,key)}={}){if(bytes>limit)return Promise.resolve();return protect(async()=>{const tx=db.transaction(['pages','meta'],'readwrite'),done=complete(tx),pages=tx.objectStore('pages'),meta=tx.objectStore('meta'),[old,stats]=await Promise.all([request(pages.get(key)),request(meta.get('bytes'))]);let total=(stats?.value||0)-(old?.bytes||0)+bytes;pages.put({key,data,expires,bytes,touched:Date.now()});if(total>limit)await new Promise((resolve,reject)=>{const cursor=pages.index('touched').openCursor();cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const item=cursor.result;if(!item||total<=limit){resolve();return;}total-=item.value.bytes;item.delete();item.continue();};});meta.put({key:'bytes',value:total});await done;},()=>fallback.put(key,data,{expires,bytes}));},
   deletePage(key){return protect(async()=>{const tx=db.transaction(['pages','meta'],'readwrite'),done=complete(tx),pages=tx.objectStore('pages'),meta=tx.objectStore('meta'),[old,stats]=await Promise.all([request(pages.get(key)),request(meta.get('bytes'))]);pages.delete(key);meta.put({key:'bytes',value:Math.max(0,(stats?.value||0)-(old?.bytes||0))});await done;},()=>fallback.deletePage(key));},
   getRequestIndex(reqKey){return protect(async()=>{const tx=db.transaction('requestIndex','readonly'),done=complete(tx),value=await request(tx.objectStore('requestIndex').get(reqKey));await done;return value?.contentKey||null;},()=>fallback.getRequestIndex(reqKey));},
   putRequestIndex(reqKey,contentKey){return protect(async()=>{const tx=db.transaction('requestIndex','readwrite'),done=complete(tx);const index=tx.objectStore('requestIndex');index.put({reqKey,contentKey});const keys=await request(index.getAllKeys());for(const key of keys.slice(0,Math.max(0,keys.length-1024)))index.delete(key);await done;},()=>fallback.putRequestIndex(reqKey,contentKey));},
   saveJob(job){return protect(async()=>{const tx=db.transaction('jobs','readwrite'),done=complete(tx),store=tx.objectStore('jobs');store.put(job);let count=0;const cursor=store.index('updated').openCursor(null,'prev');cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;if(++count>3)item.delete();item.continue();};await done;},()=>fallback.saveJob(job));},
   latestJob(){return protect(async()=>{const tx=db.transaction('jobs','readonly'),done=complete(tx),value=await request(tx.objectStore('jobs').index('updated').openCursor(null,'prev'));const job=value?.value||null;await done;return job;},()=>fallback.latestJob());},
   info(){return protect(async()=>{const tx=db.transaction('meta','readonly'),done=complete(tx),stats=await request(tx.objectStore('meta').get('bytes'));await done;return {bytes:stats?.value||0,maxBytes:limit,persistent};},()=>fallback.info());},
   clearPages(){return protect(async()=>{const tx=db.transaction(['pages','meta','requestIndex'],'readwrite'),done=complete(tx);tx.objectStore('pages').clear();tx.objectStore('requestIndex').clear();tx.objectStore('meta').put({key:'bytes',value:0});await done;},()=>fallback.clearPages());},
    exportAll(){return protect(async()=>{const tx=db.transaction(['pages','jobs'],'readonly'),pagesStore=tx.objectStore('pages'),jobsStore=tx.objectStore('jobs'),[pageRows,jobRows]=await Promise.all([request(pagesStore.getAll()),request(jobsStore.getAll())]);const pageEntries=pageRows.map(p=>({key:p.key,data:serializeData(p.data),expires:p.expires,bytes:p.bytes}));return {version:1,app:'funding-chart-batch-v1',exportedAt:Date.now(),pages:pageEntries,jobs:jobRows};},()=>fallback.exportAll());},
    importAll(payload){return restoreBackup(api,payload);}
  };return api;
 }
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});
 function adapter({candlePage,fundingPage,store,now=Date.now,wait=sleep,onCache=()=>{},minimumDelay=500}){
  let next=0,queue=Promise.resolve();
  async function paced(ex,signal,producer,kind){const task=queue.then(async()=>{signal.throwIfAborted();const delay=Math.max(0,next-now());if(delay)await wait(delay,signal);signal.throwIfAborted();next=now()+Math.max(minimumDelay,ex==='BINGX'?1200:0,ex==='BINANCE'&&kind==='funding'?750:0);return await producer();});queue=task.catch(()=>{});return task;}

  async function cachedRange(ex,symbol,tf,end,signal){
   if(!store.keys)return null;const last=T.start(end/1000,tf),prefix=JSON.stringify(['candles-v3',ex,symbol,tf]).slice(0,-1)+',',candidates=[];
   for(const key of await store.keys())if(key.startsWith(prefix)){try{const k=JSON.parse(key);if(k[4]<=last&&k[5]>=last)candidates.push({key,first:k[4]});}catch{}}
   candidates.sort((a,b)=>b.first-a.first);
   for(const c of candidates){signal.throwIfAborted();const page=await store.get(c.key,now()),all=unpackCandles(page);if(!all)continue;const rows=all.filter(r=>r.time*1000<=end);if(rows.at(-1)?.time===last&&rows.every((r,i)=>T.start(r.time,tf)===r.time&&(!i||T.end(rows[i-1].time,tf)===r.time)))return rows;}
   return null;
  }
  async function page(kind,args,producer){
   const signal=args.at(-1),candle=kind==='candles',key=JSON.stringify([candle?'page-v2':'page-v1',kind,...args.slice(0,-1)]);signal.throwIfAborted();const saved=await store.get(key,now());signal.throwIfAborted();
   if(saved!==null){const rows=candle?unpackCandles(saved):saved;if(rows!==null){onCache();return rows;}}
   if(candle){
    const [ex,symbol,tf,end]=args,reqKey=JSON.stringify(['req',ex,symbol,tf,end]);if(store.getRequestIndex){const hit=await store.getRequestIndex(reqKey);if(hit){const p=await store.get(hit,now()),rows=p?.timeframe===tf?unpackCandles(p):null;if(rows){onCache();return rows;}}}const shared=await cachedRange(ex,symbol,tf,end,signal);if(shared){onCache();return shared;}
    const legacyKey=JSON.stringify(['page-v1',kind,...args.slice(0,-1)]),legacy=await store.get(legacyKey,now());signal.throwIfAborted();
    if(Array.isArray(legacy)){const packed=packCandles(legacy),expires=now()+(end<now()-2*86400000&&legacy.length?30*86400000:60000);await store.put(key,packed,{expires,bytes:estimateBytes(packed,key)});if(store.deletePage)await store.deletePage(legacyKey);onCache();return legacy;}
   }
   const rows=await paced(args[0],signal,producer,kind);signal.throwIfAborted();const edge=Number(candle?args[3]:args[2]),expires=now()+(edge<now()-2*86400000&&rows.length?30*86400000:60000);
   if(candle&&rows.length){const contentKey=JSON.stringify(['candles-v3',args[0],args[1],args[2],rows[0].time,rows.at(-1).time]),packed={...packCandles(rows),timeframe:args[2]};await store.put(contentKey,packed,{expires,bytes:estimateBytes(packed,contentKey)});if(store.putRequestIndex)await store.putRequestIndex(JSON.stringify(['req',args[0],args[1],args[2],args[3]]),contentKey);}
   else if(!candle||!rows.length)await store.put(key,candle?packCandles(rows):rows,{expires});
   signal.throwIfAborted();return rows;
  }
  return {candlePage:(ex,symbol,tf,end,signal)=>page('candles',[ex,symbol,tf,end,signal],()=>candlePage(ex,symbol,tf,end,signal)),fundingPage:(ex,symbol,cursor,number,signal)=>page('funding',[ex,symbol,cursor,number,signal],()=>fundingPage(ex,symbol,cursor,number,signal))};
 }
 return {maxBytes,memory,open,adapter,packCandles,unpackCandles,estimateBytes};
});
