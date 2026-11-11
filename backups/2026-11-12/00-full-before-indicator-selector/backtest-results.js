(function(root,factory){'use strict';const api=factory(root,typeof module==='object'&&module.exports?require('./timeframes.js'):root.TimeframeEngine,typeof module==='object'&&module.exports?require('./backtest-engine.js'):root.BacktestEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestResults=api;})(globalThis,function(root,T,E){
 'use strict';
 // Bump when an existing strategy's results would change.
 const equityPoints=512,version=1,maxBytes=64*1048576,maxRawBytes=64*1048576,frames=Object.keys(T.seconds),decoder=new TextDecoder(),encoder=new TextEncoder();
 const strategyFields=Object.keys(E.defaultStrategyConfig).sort();
 function strategyValues(c,tf,effective=false){
  const normalized=E.normalizeConfig({...c,timeframe:tf}),values=strategyFields.map(k=>[k,effective&&k==='splitCount'?Math.max(1,normalized[k]):normalized[k]]);
  // Only the new mode adds a field. Keep the exact keys of older results and backups.
  if(normalized.dcaMethod==='cumulative')values.push(['dcaMultipliers',normalized.dcaMultipliers.join(',')]);
  return values;
 }
 // The engine gives 0 and 1 the same single entry. Preserve both legacy file keys.
 const strategySignature=(c,tf)=>JSON.stringify(strategyValues(c,tf,true));
 function sameStrategy(a,b,tf=a?.timeframe){if(!a||!b)return false;const frame=tf==='all'?'1m':tf;try{return strategySignature(a,frame)===strategySignature(b,frame);}catch{return false;}}
 function strategyDifferences(saved,current,tf=current?.timeframe){
  const frame=tf==='all'?'1m':tf;
  try{const prior=new Map(strategyValues(saved,frame,true));return strategyValues(current,frame,true).filter(([key,value])=>value!==prior.get(key)).map(([key])=>key);}
  catch{return [];}
 }
 function identity(m,c,tf=c.timeframe){return [version,m.exchange||m.ex,m.symbol,strategyValues(c,tf),c.startTime,c.cacheRangeEnd??c.endTime];}
 const requestKey=(m,c,tf)=>JSON.stringify(identity(m,c,tf));
 const scopeKey=parts=>JSON.stringify([parts[0],...parts.slice(3)]);
 function byRequest(heads,maxEnd=Infinity){const found=new Map();for(const h of heads)if(h.snapshotEnd<=maxEnd&&(!found.has(h.requestKey)||found.get(h.requestKey).snapshotEnd<h.snapshotEnd))found.set(h.requestKey,h);return found;}
 const key=(m,c,tf=c.timeframe)=>JSON.stringify([...identity(m,c,tf),T.start(c.endTime,tf)]);
 async function bytes(stream,limit){const reader=stream.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('완료 결과가 보관 한도를 초과합니다.');parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}const out=new Uint8Array(size);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;}
 async function encode(result){const data=encoder.encode(JSON.stringify(result));if(data.length>maxRawBytes)return null;if(typeof root.CompressionStream==='function')return {encoding:'gzip',data:await bytes(new Blob([data]).stream().pipeThrough(new root.CompressionStream('gzip')),maxRawBytes)};return {encoding:'json',data};}
 async function decode(payload){if(!payload||!['gzip','json'].includes(payload.encoding)||!(payload.data instanceof Uint8Array))throw Error('저장된 완료 결과 형식이 올바르지 않습니다.');const data=payload.encoding==='gzip'?await bytes(new Blob([payload.data]).stream().pipeThrough(new root.DecompressionStream('gzip')),maxRawBytes):payload.data;if(data.length>maxRawBytes)throw Error('완료 결과 크기를 확인하세요.');return JSON.parse(decoder.decode(data));}
 const base64=data=>{let s='';for(let i=0;i<data.length;i+=32768)s+=String.fromCharCode(...data.subarray(i,i+32768));return btoa(s);};
 const unbase64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
 const clone=value=>structuredClone(value);
 function valid(head){return head?.version===version&&typeof head.key==='string'&&typeof head.requestKey==='string'&&frames.includes(head.timeframe)&&Number.isFinite(head.snapshotEnd)&&head.meta?.market?.symbol&&head.meta.market.ex&&head.meta.market.int===head.timeframe&&head.meta.config?.timeframe===head.timeframe&&Number.isFinite(head.meta.config.startTime)&&Number.isFinite(head.meta.config.endTime);}
 function matchesExecution(result,config,tf,{strictTrades=false}={}){
  if(result?.config?.timeframe!==tf||!sameStrategy(config,result.config,tf)||!Array.isArray(result.trades))return false;
  const max=Math.max(1,E.normalizeConfig({...config,timeframe:tf}).splitCount);
  return result.trades.every(t=>t&&(strictTrades?t.splitTarget===max&&Number.isInteger(t.dcaSteps)&&t.dcaSteps>=1&&t.dcaSteps<=max&&t.entries?.length===t.dcaSteps:(!Number.isFinite(t.splitTarget)||t.splitTarget===max)&&(!Number.isFinite(t.dcaSteps)||t.dcaSteps<=max)&&(!Array.isArray(t.entries)||t.entries.length<=max)));
 }
 function matchesResult(head,result){
  return matchesExecution(result,head.meta.config,head.timeframe)&&result.config.startTime===head.meta.config.startTime&&result.config.endTime===head.meta.config.endTime&&Array.isArray(result.signals);
 }
 function storageBytes(head,payload){const {bytes:_,touched:__,...fields}=head;return payload.data.byteLength+encoder.encode(JSON.stringify(fields)).byteLength+256;}
 function restorePlan(previous,entries,limit){
  const imported=new Map(entries.map(row=>[row.head.key,row])),heads=new Map(previous.map(head=>[head.key,head]));for(const {head} of imported.values())heads.set(head.key,head);
  // A portable backup that fits must be recoverable even if this browser already has a full cache.
  const order=[...heads.values()].reverse().sort((a,b)=>Number(imported.has(b.key))-Number(imported.has(a.key))||(b.priority||0)-(a.priority||0)||(b.touched||0)-(a.touched||0));
  const kept=new Set();let total=0;for(const head of order)if(total+head.bytes<=limit){total+=head.bytes;kept.add(head.key);}
  const writes=[...imported.values()].filter(row=>kept.has(row.head.key));return {kept,writes,total,imported:writes.length,skipped:imported.size-writes.length};
 }
 function wrap(backend){
  async function findPairs(pairs,{snapshot=true,maxEnd=Infinity,targeted=false,partial=false}={}){
   const queries=[],profiles=new Map();
   const groups=pairs.map(pair=>!pair?[]:(pair.config.timeframe==='all'?frames:[pair.config.timeframe]).map(tf=>{
    const c=pair.config,at=queries.length;let byFrame=profiles.get(c);if(!byFrame)profiles.set(c,byFrame=new Map());
    let descriptors=byFrame.get(tf);if(!descriptors){
     const parts=identity({},c,tf),split=parts[3].find(([name])=>name==='splitCount')[1];
     const versions=split<=1?[parts,identity({},{...c,splitCount:1-split},tf)]:[parts],end=T.start(c.endTime,tf);
     descriptors=versions.map(row=>({parts:row.slice(3),scope:scopeKey(row),end}));byFrame.set(tf,descriptors);
    }
    for(const p of descriptors){const parts=[version,pair.market.exchange||pair.market.ex,pair.market.symbol,...p.parts];queries.push({request:JSON.stringify(parts),key:JSON.stringify([...parts,p.end]),scope:p.scope});}
    return [at,queries.length];
   }));
   const found=queries.length?await backend.find(queries,snapshot,maxEnd,targeted):[];
   return groups.map(group=>{
    const hits=group.map(([a,b])=>{let best=null;for(let i=a;i<b;i++){const h=found[i];if(h&&(!best||h.snapshotEnd>best.snapshotEnd))best=h;}return best;});
    return hits.some(Boolean)&&(partial||hits.every(Boolean))?hits:null;
   });
  }
  function findMany(markets,c,options={}){return findPairs(markets.map(market=>({market,config:c})),{maxEnd:c.cacheMaxEnd??Infinity,...options});}
  return {
   findMany,async find(m,c,options){return (await findMany([m],c,options))[0];},
   async findConfigured(pairs,options={}){return findPairs(pairs,{snapshot:false,...options});},
   async save(m,c,result,meta){if(!sameStrategy(c,result.config,result.config.timeframe))return false;const payload=await encode(result);if(!payload)return false;const tf=result.config.timeframe,identityParts=identity(m,c,tf),head={scope:scopeKey(identityParts),version,priority:c.timeframe===tf||c.timeframe==='all'?1:0,key:key(m,{...c,endTime:meta.endTime},tf),requestKey:requestKey(m,c,tf),timeframe:tf,snapshotEnd:meta.endTime,created:Date.now(),success:result.success,reason:result.reason,summary:clone(result.summary),meta:clone({...meta,market:{ex:m.exchange||m.ex,symbol:m.symbol,int:tf},config:result.config})};head.bytes=storageBytes(head,payload);return backend.put(head,payload);},
   async read(head){if(!valid(head))throw Error('완료 결과의 거래소·종목·주기를 확인하세요.');const payload=await backend.read(head.key);if(!payload)return null;const result=await decode(payload);if(!matchesResult(head,result))throw Error('완료 결과와 실행 조건이 일치하지 않습니다.');return {result,summary:result.summary,meta:{...clone(head.meta),reuse:{kind:'completed-result',snapshotEnd:head.snapshotEnd,networkRequests:0,recalculated:false}}};},
   info:()=>backend.info(),clear:()=>backend.clear(),
   async exportAll(){const entries=[];for(const head of await backend.all()){const payload=await backend.read(head.key);if(payload)entries.push({head,payload:{encoding:payload.encoding,b64:base64(payload.data)}});}return {version,entries};},
   async importAll(value){if(!value)return {imported:0,skipped:0};if(value.version!==version||!Array.isArray(value.entries))throw Error('완료 결과 백업 형식이 올바르지 않습니다.');const rows=[];let rejected=0;for(const entry of value.entries){if(!valid(entry.head)||entry.head.key!==key(entry.head.meta.market,entry.head.meta.config,entry.head.timeframe)||entry.head.requestKey!==requestKey(entry.head.meta.market,entry.head.meta.config,entry.head.timeframe)||!['gzip','json'].includes(entry.payload?.encoding)||typeof entry.payload.b64!=='string')throw Error('완료 결과 백업 항목을 확인하세요.');const payload={encoding:entry.payload.encoding,data:unbase64(entry.payload.b64)},result=await decode(payload);if(!matchesResult(entry.head,result)){rejected++;continue;}const head={...entry.head,scope:scopeKey(JSON.parse(entry.head.requestKey)),priority:entry.head.priority===1?1:0};head.bytes=storageBytes(head,payload);rows.push({head,payload});}const restored=rows.length?await backend.restore(rows):{imported:0,skipped:0};return {...restored,skipped:restored.skipped+rejected};}
  };
 }
 function memory({limit=maxBytes}={}){const rows=new Map();let size=0;return wrap({
  async find(queries,snapshot,maxEnd){const index=snapshot?byRequest([...rows.values()].map(r=>r.head),maxEnd):null;return queries.map(q=>{const h=snapshot?index.get(q.request):rows.get(q.key)?.head;return h&&h.snapshotEnd<=maxEnd?clone(h):null;});},
  async put(head,payload){if(head.bytes>limit)return false;size-=rows.get(head.key)?.head.bytes||0;rows.delete(head.key);rows.set(head.key,{head:clone(head),payload:clone(payload)});size+=head.bytes;if(size>limit)for(const [k,r]of [...rows].sort((a,b)=>(a[1].head.priority||0)-(b[1].head.priority||0))){if(size<=limit)break;rows.delete(k);size-=r.head.bytes;}return rows.has(head.key);},
  async restore(entries){const {kept,writes,total,imported,skipped}=restorePlan([...rows.values()].map(r=>r.head),entries,limit);for(const key of rows.keys())if(!kept.has(key))rows.delete(key);for(const r of writes){rows.delete(r.head.key);rows.set(r.head.key,clone(r));}size=total;return {imported,skipped};},
  async read(k){const row=rows.get(k);if(row){rows.delete(k);rows.set(k,row);}return row?clone(row.payload):null;},async all(){return [...rows.values()].map(r=>clone(r.head));},async info(){return {bytes:size,maxBytes:limit,persistent:false};},async clear(){rows.clear();size=0;}
 });}
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const complete=tx=>{const p=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error||Error('완료 결과 보관 실패'));});p.catch(()=>{});return p;};
 async function open({indexedDB=root.indexedDB,name='funding-chart-results-v1',limit=maxBytes}={}){
  if(!indexedDB)return memory({limit});let db;try{const r=indexedDB.open(name,2);r.onupgradeneeded=event=>{const d=r.result,h=event.oldVersion<1?d.createObjectStore('heads',{keyPath:'key'}):r.transaction.objectStore('heads');if(event.oldVersion<1){h.createIndex('requestKey','requestKey');d.createObjectStore('payloads');d.createObjectStore('meta');}if(!h.indexNames.contains('retention'))h.createIndex('retention',['priority','touched']);h.createIndex('scope','scope');if(event.oldVersion>0){const cursor=h.openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row)return;const old=row.value;row.update({...old,scope:scopeKey(JSON.parse(old.requestKey)),priority:old.priority===1?1:0});row.continue();};}};db=await request(r);}catch{return memory({limit});}db.onversionchange=()=>db.close();const fallback=memory({limit});let persistent=true;
  async function protect(fn,other){if(!persistent)return other();try{return await fn();}catch{persistent=false;return other();}}
  return wrap({
   find(queries,snapshot,maxEnd,targeted){return protect(async()=>{const tx=db.transaction('heads','readonly'),done=complete(tx),h=tx.objectStore('heads');
    if(snapshot&&!targeted&&queries.length>16){const scopes=[...new Set(queries.map(q=>q.scope))],rows=await Promise.all(scopes.map(s=>request(h.index('scope').getAll(s))));await done;const index=byRequest(rows.flat(),maxEnd);return queries.map(q=>index.get(q.request)||null);}
    const groups=await Promise.all(queries.map(q=>request(snapshot?h.index('requestKey').getAll(q.request):h.get(q.key))));await done;return groups.map(g=>snapshot?(g.filter(h=>h.snapshotEnd<=maxEnd).sort((a,b)=>b.snapshotEnd-a.snapshotEnd)[0]||null):(g&&g.snapshotEnd<=maxEnd?g:null));
   },async()=>{const all=(await fallback.exportAll()).entries.map(e=>e.head),index=snapshot?byRequest(all,maxEnd):new Map(all.map(h=>[h.key,h]));return queries.map(q=>{const h=index.get(snapshot?q.request:q.key);return h&&h.snapshotEnd<=maxEnd?h:null;});});},
   put(head,payload){if(head.bytes>limit)return Promise.resolve(false);return protect(async()=>{const tx=db.transaction(['heads','payloads','meta'],'readwrite'),done=complete(tx),h=tx.objectStore('heads'),p=tx.objectStore('payloads'),m=tx.objectStore('meta'),[old,size]=await Promise.all([request(h.get(head.key)),request(m.get('bytes'))]);let total=(size||0)-(old?.bytes||0)+head.bytes,retained=true;h.put({...head,scope:head.scope||scopeKey(JSON.parse(head.requestKey)),priority:head.priority===1?1:0,touched:Date.now()});p.put(payload,head.key);if(total>limit)await new Promise((resolve,reject)=>{const q=h.index('retention').openCursor();q.onerror=()=>reject(q.error);q.onsuccess=()=>{const row=q.result;if(!row||total<=limit){resolve();return;}total-=row.value.bytes;if(row.value.key===head.key)retained=false;p.delete(row.value.key);row.delete();row.continue();};});m.put(total,'bytes');await done;return retained;},async()=>{const data={version,entries:[{head,payload:{encoding:payload.encoding,b64:base64(payload.data)}}]};return (await fallback.importAll(data)).imported===1;});},
   restore(entries){return protect(async()=>{const tx=db.transaction(['heads','payloads','meta'],'readwrite'),done=complete(tx),h=tx.objectStore('heads'),p=tx.objectStore('payloads'),previous=await request(h.getAll()),{kept,writes,total,imported,skipped}=restorePlan(previous,entries,limit),touched=Date.now();for(const old of previous)if(!kept.has(old.key)){h.delete(old.key);p.delete(old.key);}for(const {head,payload} of writes){h.put({...head,touched});p.put(payload,head.key);}tx.objectStore('meta').put(total,'bytes');await done;return {imported,skipped};},()=>fallback.importAll({version,entries:entries.map(({head,payload})=>({head,payload:{encoding:payload.encoding,b64:base64(payload.data)}}))}));},
   read(k){return protect(async()=>{const tx=db.transaction(['heads','payloads'],'readwrite'),done=complete(tx),h=tx.objectStore('heads'),[head,payload]=await Promise.all([request(h.get(k)),request(tx.objectStore('payloads').get(k))]);if(head)h.put({...head,touched:Date.now()});await done;return payload||null;},async()=>{const all=await fallback.exportAll(),entry=all.entries.find(e=>e.head.key===k);return entry?{encoding:entry.payload.encoding,data:unbase64(entry.payload.b64)}:null;});},
   all(){return protect(()=>request(db.transaction('heads','readonly').objectStore('heads').getAll()),async()=>(await fallback.exportAll()).entries.map(e=>e.head));},
   info(){return protect(async()=>({bytes:await request(db.transaction('meta','readonly').objectStore('meta').get('bytes'))||0,maxBytes:limit,persistent}),()=>fallback.info());},
   clear(){return protect(async()=>{const tx=db.transaction(['heads','payloads','meta'],'readwrite'),done=complete(tx);for(const s of ['heads','payloads','meta'])tx.objectStore(s).clear();await done;},()=>fallback.clear());}
  });
 }
 function output(head){return {summary:clone(head.summary),meta:{...clone(head.meta),reuse:{kind:'completed-result',snapshotEnd:head.snapshotEnd,networkRequests:0,recalculated:false}}};}
 function compare(heads){const comparison=heads.filter(h=>h.summary).map(h=>({timeframe:h.timeframe,...h.summary,trades:h.summary.totalTrades,fundingEarned:h.summary.totalFundingEarned,...(h.snapshotEnd?{snapshotEnd:h.snapshotEnd}:{})})),best=k=>[...comparison].filter(r=>r.totalTrades>0).sort((a,b)=>(b[k]??Infinity)-(a[k]??Infinity))[0]||null;return {comparison,bestByWinRate:best('winRatePct'),bestByProfitFactor:best('profitFactor'),bestByTotalReturn:best('totalReturnPct')};}
 async function fromHeads(store,heads,c,{detail=false}={}){if(!heads)return null;if(c.timeframe!=='all'){const h=heads[0];if(!h.success)throw Error(h.reason);return detail?store.read(h):output(h);}const comparisonResult=compare(heads),best=comparisonResult.bestByTotalReturn||comparisonResult.bestByWinRate||comparisonResult.comparison[0],first=output(heads.find(h=>h.timeframe===best.timeframe)||heads[0]);return {...first,summary:{...best,timeframe:'all',bestTimeframe:best.timeframe},meta:{...first.meta,market:{...first.meta.market,int:'all'},config:{...first.meta.config,timeframe:'all'},coverage:Object.assign({},...heads.map(h=>h.meta.coverage)),snapshotByTimeframe:Object.fromEntries(heads.map(h=>[h.timeframe,h.snapshotEnd]))},comparison:comparisonResult.comparison,comparisonResult:detail?comparisonResult:undefined};}
 const readyFor=(heads,c,strict=false)=>Boolean(heads&&(strict||c.timeframe!=='1m'||c.precomputeTimeframes!==true||heads[0].meta.preparedTimeframes?.length));
 function batchCandidate(job,item,tf){
  if(!job?.config||item?.status!=='done')return null;
  const market={ex:item.exchange,symbol:item.symbol,int:tf},previous=item.meta?.market;
  if(previous&&(previous.ex!==market.ex||previous.symbol!==market.symbol))return null;
  const frameRange=item.meta?.frameRanges?.[tf],endTime=frameRange?.endTime??item.meta?.snapshotByTimeframe?.[tf]??item.comparison?.find(r=>r.timeframe===tf)?.snapshotEnd??item.meta?.endTime??job.config.endTime;
  const config={...job.config,...item.meta?.config,...frameRange,timeframe:tf,endTime,cacheRangeEnd:frameRange?.cacheRangeEnd??item.meta?.config?.cacheRangeEnd??job.config.cacheRangeEnd??(job.allHistory?'latest':job.config.endTime)};
  if(!Number.isFinite(config.startTime)||!Number.isFinite(endTime)||endTime<=config.startTime)return null;
  let summary=job.config.timeframe===tf?item.summary:job.config.timeframe==='all'?item.comparison?.find(r=>r.timeframe===tf):null;
  if(tf==='all'&&job.config.timeframe==='all'&&!usableSummary(summary)&&Array.isArray(item.comparison)){const valid=item.comparison.filter(usableSummary),best=valid.find(r=>r.timeframe===summary?.bestTimeframe)||valid.slice().sort((a,b)=>(b.totalReturnPct??b.netPnl)-(a.totalReturnPct??a.netPnl))[0];if(best)summary={...best,timeframe:'all',bestTimeframe:best.timeframe};}
  const meta={...item.meta,market,config,startTime:item.meta?.startTime??config.startTime,endTime,coverage:item.meta?.coverage||{},fundingCoverage:item.meta?.fundingCoverage||{},gaps:item.meta?.gaps||0};
  return {market,config,meta,summary,sourceJobId:job.sourceJobId||job.id,comparison:tf==='all'?item.comparison:undefined};
 }
 function batchCandidates(jobs,market,c,{sameRange=false,allowJobRange=c.researchOnly!==true}={}){
  const tf=c.timeframe==='all'?'1m':c.timeframe,signature=strategySignature(c,tf),rows=[];
  for(const job of jobs||[]){
   const item=job.items?.find(i=>i.exchange===(market.exchange||market.ex)&&i.symbol===market.symbol&&i.status==='done'),row=batchCandidate(job,item,c.timeframe);if(!row)continue;
   try{if(strategySignature(row.config,tf)!==signature)continue;}catch{continue;}
   const requestEnd=c.cacheRangeEnd??c.endTime,originalEnd=job.config.cacheRangeEnd??(job.allHistory?'latest':job.config.endTime);
   const sameWholeHistory=requestEnd==='latest'&&(job.allHistory===true||originalEnd==='latest');
   const rangeMatches=row.config.startTime===c.startTime&&row.config.cacheRangeEnd===requestEnd||allowJobRange&&job.config.startTime===c.startTime&&(originalEnd===requestEnd||sameWholeHistory);
   if((!sameRange||rangeMatches)&&row.config.endTime<=(c.cacheMaxEnd??Infinity))rows.push({...row,rangeMatches});
  }
  return rows.sort((a,b)=>Number(b.rangeMatches)-Number(a.rangeMatches));
 }
 const usableSummary=value=>Number.isSafeInteger(value?.totalTrades)&&Number.isFinite(value.netPnl);
 function savedSummary(row){
  if(!usableSummary(row?.summary)||row.summary.timeframe&&row.summary.timeframe!==row.market.int)return null;
  return {summary:row.summary,comparison:row.comparison,summaryOnly:true,detailRequest:{market:row.market,config:row.config},meta:{...row.meta,reuse:{kind:'batch-summary',sourceJobId:row.sourceJobId,snapshotEnd:row.meta.endTime,rangeDiffers:row.rangeMatches===false,networkRequests:0,recalculated:false}}};
 }
 const knownUnavailable=reason=>typeof reason==='string'&&/완성(?:된)? 캔들|완성 봉|캔들 기록을 거래소가 제공하지|RSI 계산을 위한 캔들 데이터가 부족/.test(reason)&&!/HTTP|연결 실패|API |진행되지/.test(reason);
 function frameRecord(out){
  const meta=out?.meta,tf=meta?.market?.int;
  if(!frames.includes(tf)||meta.config?.timeframe!==tf||!Number.isFinite(meta.endTime)||meta.config.endTime!==meta.endTime)return null;
  const reason=out.reason??meta.coverage?.[tf]?.error,success=out.success!==false&&usableSummary(out.summary)&&(!out.summary.timeframe||out.summary.timeframe===tf);
  return success||knownUnavailable(reason)?{timeframe:tf,snapshotEnd:meta.endTime,success,summary:success?out.summary:null,reason,meta}:null;
 }
 function framePlan(records,market,c){
  const ex=market.exchange||market.ex,groups=new Map(),limit=Math.min(c.endTime,c.cacheMaxEnd??Infinity);
  for(const input of Array.isArray(records)?records:[]){
   const row=frameRecord(input);if(!row||row.timeframe!==input.timeframe||row.snapshotEnd!==input.snapshotEnd||!frames.includes(row.timeframe)||row.snapshotEnd>limit||row.snapshotEnd<=c.startTime||row.meta.config.startTime!==c.startTime||row.meta.market.ex!==ex||row.meta.market.symbol!==market.symbol||!sameStrategy(c,row.meta.config,row.timeframe))continue;
   let group=groups.get(row.snapshotEnd);if(!group)groups.set(row.snapshotEnd,group=new Map());
   if(!group.has(row.timeframe)||!group.get(row.timeframe).success&&row.success)group.set(row.timeframe,row);
  }
  const ranked=[...groups].filter(([,group])=>[...group.values()].some(row=>row.success)).sort((a,b)=>b[1].size-a[1].size||b[0]-a[0]);
  if(!ranked.length)return null;const [snapshotEnd,group]=ranked[0],missing=frames.filter(tf=>!group.has(tf));
  return {snapshotEnd,missing,rows:frames.map(tf=>group.get(tf)).filter(Boolean)};
 }
 function combineFrames(records,c,{detail=false,reused=false,carried=0}={}){
  records=[...records].sort((a,b)=>frames.indexOf(a.timeframe)-frames.indexOf(b.timeframe));
  const comparisonResult=compare(records),best=comparisonResult.bestByTotalReturn||comparisonResult.bestByWinRate||comparisonResult.comparison[0];
  if(!best)return null;
  const first=records.find(row=>row.timeframe===best.timeframe),{reuse:previous,...base}=first.meta;
  const frameRanges=Object.fromEntries(records.map(r=>[r.timeframe,{startTime:r.meta.config.startTime,endTime:r.snapshotEnd,cacheRangeEnd:r.meta.config.cacheRangeEnd??r.meta.config.endTime}]));
  const meta={...base,market:{...base.market,int:'all'},config:{...base.config,timeframe:'all'},coverage:Object.assign({},...records.map(r=>r.meta.coverage)),snapshotByTimeframe:Object.fromEntries(records.map(r=>[r.timeframe,r.snapshotEnd])),frameRanges,...(reused?{reuse:{kind:'completed-frames',snapshotEnd:first.snapshotEnd,networkRequests:0,recalculated:false}}:{}),...(carried?{carriedFrames:carried}:{})};
  return {summary:{...best,timeframe:'all',bestTimeframe:best.timeframe},meta,comparison:comparisonResult.comparison,comparisonResult:detail?comparisonResult:undefined};
 }
 async function findBatch(store,jobs,markets,c,{archivedPairs,withPartial=false}={}){
  const request={...c,cacheMaxEnd:c.cacheMaxEnd??c.endTime},isAll=c.timeframe==='all',records=markets.map(()=>[]),results=markets.map(m=>{
   for(const row of batchCandidates(jobs,m,request,{sameRange:true,allowJobRange:true})){
    if(isAll&&row.meta.unverifiedFrames?.length)continue;
    const saved=savedSummary(row);if(saved)return {summary:saved.summary,meta:saved.meta,comparison:saved.comparison};
   }
   return null;
  });
  const remaining=()=>results.flatMap((out,i)=>out?[]:[i]);
  async function fill(indices,heads,configs){
   await Promise.all(indices.map(async(index,i)=>{
    const rows=heads[i],config=configs?.[i]??request;if(!rows)return;
    if(!isAll){if(rows[0]?.success&&usableSummary(rows[0].summary))results[index]=await fromHeads(store,rows,config);return;}
    for(const h of rows)if(h){const row=frameRecord(h);if(row)records[index].push(row);}
    const plan=framePlan(records[index],markets[index],request);
    if(plan&&!plan.missing.length)results[index]=combineFrames(plan.rows,request,{reused:true});
   }));
  }
  let missing=remaining();
  if(store&&missing.length){
   const heads=await store.findMany(missing.map(i=>markets[i]),request,{targeted:missing.length*2<=markets.length,partial:isAll});
   await fill(missing,heads);
   missing=remaining();if(archivedPairs&&missing.length){const pairs=await archivedPairs(missing.map(i=>markets[i]));await fill(missing,await store.findConfigured(pairs,{partial:isAll}),pairs.map(p=>p?.config));}
  }
  if(isAll)for(const index of remaining()){
   const market=markets[index];
   for(const tf of frames){
    for(const row of batchCandidates(jobs,market,{...request,timeframe:tf},{sameRange:true,allowJobRange:true})){
     const saved=frameRecord(row);if(saved)records[index].push(saved);
    }
   }
   const plan=framePlan(records[index],market,request);
   if(plan)results[index]=!plan.missing.length?combineFrames(plan.rows,request,{reused:true}):withPartial?{frameReuse:plan}:null;
  }
  return results;
 }
 async function readDetail(store,market,c,snapshot=true){
  if(!store)return null;
  try{const h=(await store.find(market,c,{snapshot,maxEnd:snapshot?c.cacheMaxEnd:c.endTime}))?.[0];return h?.success&& (snapshot||h.snapshotEnd===c.endTime)?await store.read(h):null;}catch{return null;}
 }
 async function openBatchResult(store,row){
  const saved=await readDetail(store,row.market,row.config,false);
  if(!saved)return savedSummary(row);
  return {...saved,meta:{...saved.meta,reuse:{...saved.meta.reuse,kind:'batch-completed-result',rangeDiffers:row.rangeMatches===false}}};
 }
 async function openIndividual(store,market,c,{listJobs=async()=>[],signal,sameRange=false}={}){
  if(c.reuseCompleted===false||c.timeframe==='all')return null;
  signal?.throwIfAborted();const exact=await readDetail(store,market,c);signal?.throwIfAborted();if(exact)return exact;
  const candidates=batchCandidates(await listJobs(),market,c,{sameRange});signal?.throwIfAborted();let summary=null;
  for(const row of candidates){const output=await openBatchResult(store,row);signal?.throwIfAborted();if(output&&!output.summaryOnly)return output;summary??=output;}
  return summary;
 }
 let shared;return {readyFor,equityPoints,version,maxBytes,frames,key,requestKey,sameStrategy,strategyDifferences,matchesExecution,memory,open,output,compare,fromHeads,frameRecord,framePlan,combineFrames,batchCandidate,batchCandidates,savedSummary,findBatch,openBatchResult,openIndividual,getDefault:()=>shared??=open()};
});
