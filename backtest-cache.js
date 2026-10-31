(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestCache=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 const maxBytes=32*1024*1024;
 const fields=['time','open','high','low','close','volume'];
 function packCandles(rows){
  const values=new Float64Array(rows.length*6);for(let i=0;i<rows.length;i++)for(let j=0;j<6;j++){const n=rows[i][fields[j]];if(!Number.isFinite(n))throw Error('저장할 캔들 값이 올바르지 않습니다.');values[i*6+j]=n;}return {kind:'ohlcv-page-v2',count:rows.length,values};
 }
 function unpackCandles(page){
  if(page?.kind!=='ohlcv-page-v2'||!Number.isSafeInteger(page.count)||page.count<0||!ArrayBuffer.isView(page.values)||page.values.BYTES_PER_ELEMENT!==8||page.values.length!==page.count*6)return null;
  const rows=Array.from({length:page.count},(_,i)=>Object.fromEntries(fields.map((key,j)=>[key,page.values[i*6+j]])));return rows.every(r=>fields.every(k=>Number.isFinite(r[k])))?rows:null;
 }
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const complete=tx=>{const done=new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||Error('브라우저 저장 실패'));});done.catch(()=>{});return done;};
 function memory({limit=maxBytes}={}){const pages=new Map(),jobs=new Map();let bytes=0;return {persistent:false,async get(key,now=Date.now()){const p=pages.get(key);if(!p||p.expires<now)return null;pages.delete(key);pages.set(key,p);return structuredClone(p.data);},async put(key,data,{expires=Date.now()+86400000,bytes:size=JSON.stringify(data).length*2}={}){if(size>limit)return;bytes-=pages.get(key)?.bytes||0;pages.delete(key);pages.set(key,{data:structuredClone(data),expires,bytes:size});bytes+=size;for(const [k,v]of pages){if(bytes<=limit)break;pages.delete(k);bytes-=v.bytes;}},async deletePage(key){const old=pages.get(key);if(old){bytes-=old.bytes;pages.delete(key);}},async saveJob(job){jobs.set(job.id,structuredClone(job));const sorted=[...jobs.values()].sort((a,b)=>b.updated-a.updated);for(const j of sorted.slice(3))jobs.delete(j.id);},async latestJob(){return structuredClone([...jobs.values()].sort((a,b)=>b.updated-a.updated)[0]||null);},async info(){return {bytes,maxBytes:limit,persistent:false};},async clearPages(){pages.clear();bytes=0;}};}
 async function open({indexedDB=root.indexedDB,limit=maxBytes}={}){
  if(!indexedDB)return memory({limit});let db;try{const req=indexedDB.open('funding-chart-batch-v1',1);req.onupgradeneeded=()=>{const d=req.result,p=d.createObjectStore('pages',{keyPath:'key'});p.createIndex('touched','touched');d.createObjectStore('meta',{keyPath:'key'});const j=d.createObjectStore('jobs',{keyPath:'id'});j.createIndex('updated','updated');};db=await request(req);}catch{return memory({limit});}
  db.onversionchange=()=>db.close();const fallback=memory({limit:Math.min(limit,4*1024*1024)});let persistent=true;
  async function protect(action,alternative){if(!persistent)return alternative();try{return await action();}catch{persistent=false;return alternative();}}
  return {get persistent(){return persistent;},
   get(key,now=Date.now()){return protect(async()=>{const tx=db.transaction('pages','readwrite'),done=complete(tx),store=tx.objectStore('pages'),value=await request(store.get(key));if(value&&value.expires>=now){value.touched=now;store.put(value);}await done;return value&&value.expires>=now?value.data:null;},()=>fallback.get(key,now));},
   put(key,data,{expires=Date.now()+86400000,bytes=JSON.stringify(data).length*2}={}){if(bytes>limit)return Promise.resolve();return protect(async()=>{const tx=db.transaction(['pages','meta'],'readwrite'),done=complete(tx),pages=tx.objectStore('pages'),meta=tx.objectStore('meta'),[old,stats]=await Promise.all([request(pages.get(key)),request(meta.get('bytes'))]);let total=(stats?.value||0)-(old?.bytes||0)+bytes;pages.put({key,data,expires,bytes,touched:Date.now()});if(total>limit)await new Promise((resolve,reject)=>{const cursor=pages.index('touched').openCursor();cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const item=cursor.result;if(!item||total<=limit){resolve();return;}total-=item.value.bytes;item.delete();item.continue();};});meta.put({key:'bytes',value:total});await done;},()=>fallback.put(key,data,{expires,bytes}));},
   deletePage(key){return protect(async()=>{const tx=db.transaction(['pages','meta'],'readwrite'),done=complete(tx),pages=tx.objectStore('pages'),meta=tx.objectStore('meta'),[old,stats]=await Promise.all([request(pages.get(key)),request(meta.get('bytes'))]);pages.delete(key);meta.put({key:'bytes',value:Math.max(0,(stats?.value||0)-(old?.bytes||0))});await done;},()=>fallback.deletePage(key));},
   saveJob(job){return protect(async()=>{const tx=db.transaction('jobs','readwrite'),done=complete(tx),store=tx.objectStore('jobs');store.put(job);let count=0;const cursor=store.index('updated').openCursor(null,'prev');cursor.onsuccess=()=>{const item=cursor.result;if(!item)return;if(++count>3)item.delete();item.continue();};await done;},()=>fallback.saveJob(job));},
   latestJob(){return protect(async()=>{const tx=db.transaction('jobs','readonly'),done=complete(tx),value=await request(tx.objectStore('jobs').index('updated').openCursor(null,'prev'));const job=value?.value||null;await done;return job;},()=>fallback.latestJob());},
   info(){return protect(async()=>{const tx=db.transaction('meta','readonly'),done=complete(tx),stats=await request(tx.objectStore('meta').get('bytes'));await done;return {bytes:stats?.value||0,maxBytes:limit,persistent};},()=>fallback.info());},
   clearPages(){return protect(async()=>{const tx=db.transaction(['pages','meta'],'readwrite'),done=complete(tx);tx.objectStore('pages').clear();tx.objectStore('meta').put({key:'bytes',value:0});await done;},()=>fallback.clearPages());}
  };
 }
 const sleep=(ms,signal)=>new Promise((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});
 function adapter({candlePage,fundingPage,store,now=Date.now,wait=sleep,onCache=()=>{},minimumDelay=500}){
  let next=0,queue=Promise.resolve();
  async function paced(ex,signal,producer,kind){const task=queue.then(async()=>{signal.throwIfAborted();const delay=Math.max(0,next-now());if(delay)await wait(delay,signal);signal.throwIfAborted();next=now()+Math.max(minimumDelay,ex==='BINGX'?1200:0,ex==='BINANCE'&&kind==='funding'?750:0);return await producer();});queue=task.catch(()=>{});return task;}
  async function page(kind,args,producer){
   const signal=args.at(-1),candle=kind==='candles',key=JSON.stringify([candle?'page-v2':'page-v1',kind,...args.slice(0,-1)]);signal.throwIfAborted();const saved=await store.get(key,now());signal.throwIfAborted();
   if(saved!==null){const rows=candle?unpackCandles(saved):saved;if(rows!==null){onCache();return rows;}}
   if(candle){const legacyKey=JSON.stringify(['page-v1',kind,...args.slice(0,-1)]),legacy=await store.get(legacyKey,now());signal.throwIfAborted();if(Array.isArray(legacy)){const packed=packCandles(legacy),edge=Number(args[3]),expires=now()+(edge<now()-2*86400000&&legacy.length?30*86400000:60000);await store.put(key,packed,{expires,bytes:packed.values.byteLength+key.length*2+128});if(store.deletePage)await store.deletePage(legacyKey);signal.throwIfAborted();onCache();return legacy;}}
   const rows=await paced(args[0],signal,producer,kind);signal.throwIfAborted();const edge=Number(candle?args[3]:args[2]),old=edge<now()-2*86400000,expires=now()+(old&&rows.length?30*86400000:60000);
   if(candle){const packed=packCandles(rows);await store.put(key,packed,{expires,bytes:packed.values.byteLength+key.length*2+128});}else await store.put(key,rows,{expires});signal.throwIfAborted();return rows;
  }
  return {candlePage:(ex,symbol,tf,end,signal)=>page('candles',[ex,symbol,tf,end,signal],()=>candlePage(ex,symbol,tf,end,signal)),fundingPage:(ex,symbol,cursor,number,signal)=>page('funding',[ex,symbol,cursor,number,signal],()=>fundingPage(ex,symbol,cursor,number,signal))};
 }
 return {maxBytes,memory,open,adapter,packCandles,unpackCandles};
});
