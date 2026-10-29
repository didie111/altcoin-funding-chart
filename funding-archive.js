(function(root,factory){'use strict';const api=factory(typeof module==='object'&&module.exports?require('./funding.js'):FundingEngine,typeof module==='object'&&module.exports?require('./backtest-engine.js'):root.BacktestEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.FundingArchive=api;})(typeof globalThis!=='undefined'?globalThis:this,function(F,E){
 'use strict';
 const venues=['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'],day=86400;
 const marketKey=m=>m.exchange+':'+m.symbol;
 function options(value={}){
  const number=(v,f,min,max)=>v===undefined?f:Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):NaN;
  const c={exchange:value.exchange||'ALL',mode:value.mode||'both',hours:number(value.hours,1,0,24),transitionMinutes:number(value.transitionMinutes,60,0,1440),rate:number(value.rate,-.5,-100,100),from:number(value.from,0,0,1e12),to:value.to?number(value.to,0,0,1e12):0,query:String(value.query||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'')};
  if(!['ALL',...venues].includes(c.exchange)||!['rate','cycle','both'].includes(c.mode)||Object.values(c).some(v=>typeof v==='number'&&!Number.isFinite(v))||(c.to&&c.to<=c.from))throw Error('펀딩 이력의 거래소·기간·수치 조건을 확인하세요.');return c;
 }
 function keyFor(value,now=Date.now()){const c=options(value);return JSON.stringify({...c,day:c.to?0:Math.floor((now/1000+9*3600)/day)});}
 function matches(records,c){
  const rows=F.merge(records),cycles=new Map(F.observedCycles(rows).map(p=>[p.end,p]));
  const found=rows.flatMap(r=>{const cycle=cycles.get(r.time),hours=cycle?.hours??null,source=cycle?.source||'unknown';return (c.mode==='cycle'||r.rate<=c.rate)&&(c.mode==='rate'||!c.hours||hours===c.hours)?[{time:r.time,rate:r.rate,hours,source}]:[];});
  if(c.mode==='both'&&c.hours>0&&c.transitionMinutes>0){for(const w of E.identifyFundingSessions(rows,{fundingIntervalHours:c.hours,minFundingRate:c.rate,fundingWindowSeconds:3600,fundingTransitionLookbackSeconds:c.transitionMinutes*60}))if(w.transitionTime&&w.startTime===w.transitionTime)found.push({time:w.transitionTime,rate:w.rate,hours:w.intervalHours,source:'transition',settleTime:w.settleTime,transitionTime:w.transitionTime});}
  return [...new Map(found.map(r=>[r.time,r])).values()].sort((a,b)=>a.time-b.time);
 }
 function memoryStore(){
  const runs=new Map(),states=new Map(),events=new Map();
  return {persistent:false,async getRun(key){return runs.get(key);},async putRun(run){runs.set(run.key,structuredClone(run));},async states(job){return [...states.values()].filter(s=>s.job===job);},
   async save(job,market,next,rows){const key=job+'|'+marketKey(market),old=states.get(key)||{matches:0,minRate:null},state={...old,...next,job,market:marketKey(market),exchange:market.exchange,symbol:market.symbol,id:key};
    for(const r of rows){const id=key+'|'+r.time;if(!events.has(id)){if(events.size>=200000)throw Error('임시 메모리 저장 한도에 도달했습니다. 브라우저의 로컬 데이터 저장을 허용한 후 다시 검색하세요.');state.matches++;state.minRate=state.minRate===null?r.rate:Math.min(state.minRate,r.rate);}events.set(id,{...r,id,job,market:state.market,exchange:market.exchange,symbol:market.symbol});}states.set(key,structuredClone(state));return state;},
   async query(job,{market=null,page=0,size=50}={}){const all=[...events.values()].filter(r=>r.job===job&&(!market||r.market===market)).sort((a,b)=>b.time-a.time||a.market.localeCompare(b.market)),start=page*size;return {rows:all.slice(start,start+size),more:all.length>start+size};}
  };
 }
 async function storage(indexedDB=globalThis.indexedDB){
  if(!indexedDB)return memoryStore();let db;
  try{db=await new Promise((resolve,reject)=>{const r=indexedDB.open('funding-chart-history-v1',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('runs',{keyPath:'key'});const s=d.createObjectStore('states',{keyPath:'id'});s.createIndex('job','job');const m=d.createObjectStore('events',{keyPath:'id'});m.createIndex('time',['job','time','market']);m.createIndex('market',['job','market','time']);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('이력 저장소를 다른 탭에서 사용 중입니다.'));});}catch{return memoryStore();}
  function read(store,key){return new Promise((resolve,reject)=>{const tx=db.transaction(store),r=tx.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  return {persistent:true,getRun:key=>read('runs',key),putRun:run=>new Promise((resolve,reject)=>{const tx=db.transaction('runs','readwrite');tx.objectStore('runs').put(run);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);}),
   states:job=>new Promise((resolve,reject)=>{const tx=db.transaction('states'),r=tx.objectStore('states').index('job').getAll(job);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}),
   save(job,market,next,rows){return new Promise((resolve,reject)=>{
    const tx=db.transaction(['states','events'],'readwrite'),states=tx.objectStore('states'),events=tx.objectStore('events'),key=job+'|'+marketKey(market),request=states.get(key);let state;
    request.onsuccess=()=>{const old=request.result||{matches:0,minRate:null};state={...old,...next,job,market:marketKey(market),exchange:market.exchange,symbol:market.symbol,id:key};let left=rows.length;
     if(!left)states.put(state);for(const r of rows){const id=key+'|'+r.time,get=events.get(id);get.onsuccess=()=>{if(!get.result){state.matches++;state.minRate=state.minRate===null?r.rate:Math.min(state.minRate,r.rate);}events.put({...r,id,job,market:state.market,exchange:market.exchange,symbol:market.symbol});if(!--left)states.put(state);};}
    };tx.oncomplete=()=>resolve(state);tx.onabort=()=>reject(tx.error||Error('과거 이력 저장에 실패했습니다.'));tx.onerror=()=>{};
   });},
   query(job,{market=null,page=0,size=50}={}){return new Promise((resolve,reject)=>{
    const tx=db.transaction('events'),index=tx.objectStore('events').index(market?'market':'time'),range=market?IDBKeyRange.bound([job,market,0],[job,market,Number.MAX_SAFE_INTEGER]):IDBKeyRange.bound([job,0],[job,Number.MAX_SAFE_INTEGER,'\uffff']),rows=[];let skip=Math.max(0,page)*size;
    const r=index.openCursor(range,'prev');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const cursor=r.result;if(!cursor)return resolve({rows,more:false});if(skip){const n=skip;skip=0;cursor.advance(n);return;}if(rows.length===size)return resolve({rows,more:true});rows.push(cursor.value);cursor.continue();};
   });}
  };
 }
 function sleep(ms,signal){return new Promise((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});}
 function create({page,catalog,store=memoryStore(),now=Date.now,pause=sleep}){
  let serial=0;
  async function scan(value,{signal=new AbortController().signal,fresh=false,onProgress=()=>{}}={}){
   const c=options(value),key=keyFor(c,now());let run=fresh?null:await store.getRun(key);signal.throwIfAborted();
   if(!run){
    const result=await catalog(c.exchange,signal),rows=result.rows.filter(m=>!c.query||m.symbol.includes(c.query));
    if(c.query&&!rows.length){const symbol=c.query.replace(/USDT$/,'')+'USDT';if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))throw Error('정확한 코인 심볼을 입력하세요.');for(const ex of c.exchange==='ALL'?venues:[c.exchange])rows.push({exchange:ex,symbol});}
    if(!rows.length)throw Error('검색할 USDT 무기한 계약 목록이 없습니다.');
    run={key,id:key+'@'+now()+':'+(++serial),config:c,to:Math.min(c.to||now()/1000,now()/1000),createdAt:now(),status:'partial',markets:rows.map(({exchange,symbol,listedAt})=>({exchange,symbol,...(listedAt?{listedAt}:{})})),catalogErrors:(result.exchangeStates||[]).filter(s=>['error','stale'].includes(s.status)).map(s=>s.exchange)};await store.putRun(run);
   }
   if(run.catalogErrors?.length&&!fresh){const retry=await catalog(c.exchange,signal),markets=new Map(run.markets.map(m=>[marketKey(m),m]));for(const m of retry.rows||[])if(!c.query||m.symbol.includes(c.query))markets.set(marketKey(m),{exchange:m.exchange,symbol:m.symbol,...(m.listedAt?{listedAt:m.listedAt}:{})});run.markets=[...markets.values()];run.catalogErrors=(retry.exchangeStates||[]).filter(s=>['error','stale'].includes(s.status)).map(s=>s.exchange);await store.putRun(run);}
   const states=new Map((await store.states(run.id)).map(s=>[s.market,s]));let completed=[...states.values()].filter(s=>s.status==='done').length;const blocked=new Set(),failures=new Map();
   const progress=extra=>onProgress({run,states,total:run.markets.length,completed,persistent:store.persistent,...extra});progress();
   if(run.status==='done')return {run,states:[...states.values()]};
   for(const market of run.markets){
    signal.throwIfAborted();const id=marketKey(market),ex=market.exchange;let state=states.get(id);if(state?.status==='done'||blocked.has(ex))continue;
    const lower=Math.max(c.from||Date.UTC(2009,0,1)/1000,market.listedAt||0),fetchLower=Math.max(market.listedAt||Date.UTC(2009,0,1)/1000,lower-Math.max(48*3600,c.transitionMinutes*60+24*3600)),initial=ex==='BINANCE'?fetchLower*1000:Math.floor(run.to*1000);
    state={matches:0,minRate:null,page:1,cursor:initial,neighbors:[],first:null,last:null,records:0,pages:0,...state,status:'partial',error:null};
    try{for(;;){
     signal.throwIfAborted();const rows=F.merge(await page(ex,market.symbol,state.cursor,state.page,signal));signal.throwIfAborted();
     const signature=rows.length?rows[0].time+':'+rows.at(-1).time+':'+rows.length:null;if(signature&&signature===state.signature)throw Error('정산 API가 같은 페이지를 반복하여 조회를 멈췄습니다.');
     const combined=F.merge(state.neighbors,rows),hits=matches(combined,c).filter(r=>r.time>=lower&&r.time<=run.to),next={...state,pages:state.pages+1,records:state.records+rows.length,signature};
     if(rows.length){const inside=rows.filter(r=>r.time>=lower&&r.time<=run.to);if(inside.length){next.first=Math.min(state.first??Infinity,inside[0].time);next.last=Math.max(state.last??0,inside.at(-1).time);}next.edge=rows[0].time;next.neighbors=ex==='BINANCE'?combined.slice(-3):combined.slice(0,3);}
     let done=false;
     if(!rows.length){if(ex==='BINGX'&&state.cursor/1000-90*day>fetchLower){next.cursor=state.cursor-90*day*1000;}else done=true;}
     else if(ex==='BINANCE'){next.cursor=F.nextHistoryCursor(ex,rows);if(next.cursor<=state.cursor)throw Error('정산 API의 다음 커서가 진행되지 않습니다.');done=rows.at(-1).time>=run.to;}
     else{done=rows[0].time<=fetchLower;next.cursor=F.nextHistoryCursor(ex,rows);if((!['BITGET','MEXC'].includes(ex)&&next.cursor>=state.cursor)||(['BITGET','MEXC'].includes(ex)&&Number.isFinite(state.edge)&&rows[0].time>=state.edge))throw Error('정산 API의 과거 커서가 진행되지 않습니다.');next.page=state.page+1;}
     next.status=done?'done':'partial';state=await store.save(run.id,market,next,hits);states.set(id,state);if(done)completed++;failures.set(ex,0);progress({market,page:state.pages});
     if(done)break;await pause(ex==='BINGX'?1250:ex==='BINANCE'?750:350,signal);
    }}catch(error){signal.throwIfAborted();if(error.name==='QuotaExceededError'||/저장|메모리/.test(error.message))throw error;state=await store.save(run.id,market,{...state,status:'error',error:error.message},[]);states.set(id,state);failures.set(ex,(failures.get(ex)||0)+1);if(failures.get(ex)>=3||error.name==='RateLimitError')blocked.add(ex);progress({market,error:error.message});}
    await pause(ex==='BINGX'?1250:ex==='BINANCE'?750:350,signal);
   }
   signal.throwIfAborted();run.status=!run.catalogErrors?.length&&run.markets.every(m=>states.get(marketKey(m))?.status==='done')?'done':'partial';run.finishedAt=now();await store.putRun(run);progress();return {run,states:[...states.values()]};
  }
  return {scan,store};
 }
 return {options,keyFor,matches,marketKey,memoryStore,storage,create};
});
