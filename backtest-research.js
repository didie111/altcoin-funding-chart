(function(root,factory){
 'use strict';
 const c=typeof module==='object'&&module.exports,api=factory(c?require('./backtest-research-store.js'):root.BacktestResearchStore,c?require('./timeframes.js'):root.TimeframeEngine,c?require('./backtest-bars.js'):root.BacktestBars,c?require('./funding.js'):root.FundingEngine);
 if(c)module.exports=api;else root.BacktestResearch=api;
})(globalThis,function(S,T,B,F){
 'use strict';
 const earliest=Date.UTC(2009,0,1)/1000,day=86400,fundingLookback=10*day,frames=Object.keys(T.seconds);
 const hasRange=(ranges,lo,hi)=>hi<=lo||!S.missing(ranges,lo,hi).length;
 const intervalAt=(ranges,t)=>ranges.find(([a,b])=>a<t&&b>=t);
 const aborted=()=>new AbortController().signal;
 function coverageOf(rows,first,last,inside,start,end,tf){
  return {first,last,count:inside,warmup:rows-inside,startMissing:first>T.end(T.start(start,tf),tf),endMissing:T.end(last,tf)<T.start(end,tf),resampled:tf!=='1m'};
 }
 async function carryLegacy(store,entries,{item,cutoff=Math.floor(Date.now()/1000),signal=aborted(),Cache,Archive,onProgress=()=>{}}={}){
  const wanted=item?S.market(item).id:null,seen=new Map(),warnings=[];let pages=0;
  function remember(m,k,count){const row=seen.get(m.id)||{...m,candles:0,funding:0};row[k]+=count;seen.set(m.id,row);}
  const material=typeof entries==='function'?entries():entries;
  for await(const entry of material){
   signal.throwIfAborted();let key;try{key=JSON.parse(entry.key);if(!Array.isArray(key))continue;}catch{continue;}
   try{
    let m,kind,rows,checked;
    if(key[0]==='candles-v3'&&key[3]==='1m'){
     m=S.market({exchange:key[1],symbol:key[2]});if(wanted&&wanted!==m.id)continue;
     const data=await entry.read();if(!data?.closedVerified||data.timeframe!=='1m')continue;
     rows=(Cache.unpackCandles(data)||[]).filter(r=>r.time+60<=cutoff);kind='candles';
    }else if(key[0]==='page-v1'&&key[1]==='funding'){
     m=S.market({exchange:key[2],symbol:key[3]});if(wanted&&wanted!==m.id)continue;
     const data=await entry.read();if(!Array.isArray(data))continue;rows=data.filter(r=>r.time<cutoff);kind='funding';
    }else if(key[0]==='binance-official-zip-v1'&&Archive){
     const url=new URL(key[1]),parts=url.pathname.split('/'),symbol=parts[6],tf=parts[7];if(tf!=='1m'||!Archive.allowedUrl(key[1],symbol,tf)||key[1].endsWith('.CHECKSUM'))continue;
     m=S.market({exchange:'BINANCE',symbol});if(wanted&&wanted!==m.id)continue;
     const saved=await entry.read();if(!saved?.zip||!/^[0-9a-f]{64}$/i.test(saved.checksum)||await Archive.sha256(saved.zip)!==saved.checksum.toLowerCase())continue;
     const kindName=parts[4],date=parts[8].slice((symbol+'-1m-').length,-4),from=Date.parse(date+(kindName==='monthly'?'-01':'')+'T00:00:00Z')/1000,to=T.end(from,kindName==='monthly'?'1M':'1d');
     const spec={from,to,kind:kindName,timeframe:'1m',csv:parts[8].replace(/\.zip$/,'.csv')};
     const raw=await Archive.unpack(saved.zip,spec,{signal}),first=/^\s*(\d{13}),/m.exec(new TextDecoder().decode(raw.subarray(0,4096)));if(first)spec.listedAt=Number(first[1])/1000;
     rows=Archive.parseCsv(raw,spec,signal).filter(r=>r.time+60<=cutoff);kind='candles';
    }else continue;
    if(!rows?.length)continue;
    rows=kind==='candles'?T.sorted(rows):F.merge(rows);
    if(kind==='candles'){
     checked=[];let first=rows[0].time,previous=first;
     for(let i=1;i<rows.length;i++){if(rows[i].time!==previous+60){checked.push([first,previous+60]);first=rows[i].time;}previous=rows[i].time;}checked.push([first,previous+60]);
    }else checked=[[rows[0].time,rows.at(-1).time+1]];
    await store.put(m,kind,rows,{checked,preferStored:true});remember(m,kind,rows.length);onProgress({phase:'legacy-source',pages:++pages,text:'기존 백업·캐시에 남은 실제 원본 '+pages.toLocaleString()+'묶음 확인'});
   }catch(error){signal.throwIfAborted();if(error.name==='QuotaExceededError')throw error;if(warnings.length<5)warnings.push(error.message);}
  }
  return {pages,markets:[...seen.values()],warnings};
 }
 function cacheEntries(cache){return async function*(){for(const key of await cache.keys())yield {key,read:()=>cache.get(key)};};}

 async function collect({store,item,from=earliest,to,knownListing=null,candlePage,fundingPage,signal=aborted(),onProgress=()=>{},now=Date.now}){
  const m=S.market(item),ex=m.exchange,symbol=m.symbol,start=T.start(from,'1m'),end=T.start(Math.min(to,now()/1000),'1m');
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=end)throw Error('원본을 모을 기간을 확인하세요.');
  let pages=0,fundingPages=0,received=0,settlements=0;
  const listing=Number.isFinite(knownListing)&&knownListing>=start&&knownListing<end?Math.ceil(knownListing/60)*60:null;
  if(listing>start)await store.put(m,'candles',[],{checked:[[start,listing]]});
  const gapPlan=S.missing((await store.state(m))?.candles.ranges,start,end).reverse();
  let staged=[],checked=[];
  async function flush(){if(staged.length||checked.length){await store.put(m,'candles',staged,{checked});staged=[];checked=[];}}
  for(const [lo,hi] of gapPlan){
   let cursor=hi;
   while(cursor>lo){
    signal.throwIfAborted();const raw=await candlePage(ex,symbol,'1m',cursor*1000-1,signal),all=T.sorted(raw),rows=all.filter(r=>r.time+60<=cursor);pages++;
    if(!rows.length){
     if(all.length)throw Error('원본 1분봉 API의 과거 커서가 진행되지 않습니다.');
     // On MEXC the REST call looks at a bounded window; an empty response
     // cannot certify the months or years before that window.
     const emptyFrom=ex==='MEXC'?Math.max(lo,cursor-2000*60):lo;
     if(cursor<end)checked.push([emptyFrom,cursor]);
     await flush();break;
    }
    const next=rows[0].time;if(next>=cursor)throw Error('원본 1분봉 API의 과거 커서가 진행되지 않습니다.');
    const keep=rows.filter(r=>r.time>=lo),actualTo=cursor===end?Math.min(cursor,rows.at(-1).time+60):cursor;
    if(Math.max(lo,next)<actualTo)checked.push([Math.max(lo,next),actualTo]);staged.push(...keep);received+=keep.length;
    if(staged.length>=4096||next<=lo||checked.length>=12)await flush();
    cursor=Math.max(lo,next);
    onProgress({phase:'research-candles',timeframe:'1m',pages,count:received,text:'원본 1분봉 '+received.toLocaleString()+'봉 추가 확인 · '+pages.toLocaleString()+'묶음 · 저장 구간 건너뜀'});
   }
   await flush();
  }
  let state=await store.state(m);
  if(!state?.candles.count)throw Error('이 거래소에서 보관할 실제 1분봉을 받지 못했습니다.');
  // Do not use an unclosed or not-yet-returned last minute as the data cutoff.
  const savedEnd=Math.min(end,state.candles.last+60),scan=intervalAt(state.candles.ranges,savedEnd);
  if(!scan)throw Error('보관한 1분봉의 실제 범위를 확인하지 못했습니다. 원본 수집을 이어서 실행하세요.');
  const checkedStart=Math.max(start,scan[0]),first=Math.max(checkedStart,state.candles.first),fundingFrom=Math.max(0,first-fundingLookback),gaps=S.missing(state.funding.ranges,fundingFrom,savedEnd);
  function reportFunding(){onProgress({phase:'research-funding',pages:fundingPages,count:settlements,text:'공식 펀딩 정산 '+settlements.toLocaleString()+'건 추가 확인 · '+fundingPages.toLocaleString()+'페이지'});}
  async function putFunding(rows,lo,hi){
   if(lo>=hi)return;
   const actual=rows.filter(r=>r.time>=lo&&r.time<hi);settlements+=actual.length;
   await store.put(m,'funding',actual,{checked:[[lo,hi]]});reportFunding();
  }
  if(ex==='BINANCE'){
   for(const [lo,hi] of gaps){
    let cursor=lo*1000,covered=lo;
    while(covered<hi){
     signal.throwIfAborted();const rows=F.merge(await fundingPage(ex,symbol,cursor,1,signal));fundingPages++;
     if(!rows.length){await putFunding([],covered,hi);break;}
     const next=F.nextHistoryCursor(ex,rows);if(next<=cursor)throw Error('원본 펀딩 이력 API의 과거 커서가 진행되지 않습니다.');
     const to=Math.min(hi,Math.ceil(next/1000));await putFunding(rows,covered,to);covered=to;cursor=next;
    }
   }
  }else if(['BITGET','MEXC'].includes(ex)&&gaps.length){
   // Numbered endpoints cannot jump to an arbitrary old settlement date.
   // Traverse pages once and save only missing slices.
   let edge=savedEnd,previous=Infinity,page=1;
   const oldest=gaps[0][0];
   while(edge>oldest){
    signal.throwIfAborted();const rows=F.merge(await fundingPage(ex,symbol,edge*1000-1,page++,signal));fundingPages++;
    const next=rows.length?rows[0].time:oldest;
    if(rows.length&&next>=previous)throw Error('원본 펀딩 이력 API가 같은 페이지를 반복했습니다.');
    previous=next;const floor=Math.max(oldest,Math.min(next,edge));
    for(const [a,b] of gaps)await putFunding(rows,Math.max(a,floor),Math.min(b,edge));
    if(!rows.length)break;edge=Math.min(edge,next);
   }
  }else{
   for(const [lo,hi] of gaps.reverse()){
    let edge=hi;
    while(edge>lo){
     signal.throwIfAborted();const all=F.merge(await fundingPage(ex,symbol,edge*1000-1,1,signal)),rows=all.filter(r=>r.time<edge);fundingPages++;
     if(!rows.length&&all.length)throw Error('원본 펀딩 이력 API의 과거 커서가 진행되지 않습니다.');
     const next=rows.length?rows[0].time:ex==='BINGX'?edge-90*day:lo,lower=Math.max(lo,next);
     if(lower>=edge)throw Error('원본 펀딩 이력 API의 과거 커서가 진행되지 않습니다.');
     await putFunding(rows,lower,edge);edge=lower;
    }
   }
  }
  const completed={from:checkedStart,to:savedEnd,fundingFrom};
  if(!await store.complete(m,completed))throw Error('선택 범위에서 계산에 사용할 실제 정산 이력이 부족합니다. 보관한 캔들은 유지합니다.');
  state=await store.state(m);
  return {market:m,state,requested:{from:start,to:end},pages,fundingPages,received,settlements,incomplete:checkedStart>start||savedEnd<end||state.candles.first>start&&(!listing||state.candles.first!==listing)};
 }
 function scope(state,config,{localOnly=false}={}){
  const done=state?.completed;if(!done)return null;
  const start=config.startTime,end=T.start(config.endTime,'1m'),to=localOnly?Math.min(end,done.to):end;
  if(!Number.isFinite(start)||!Number.isFinite(to)||to<=start||to>done.to)return null;
  // The archived calculation never fetches a missing warmup or funding page.
  const needsFunding=Math.max(0,start-Math.max(48*3600,Math.min(fundingLookback,Number(config.fundingWindowSeconds)||0))),fundFrom=Math.max(done.fundingFrom,needsFunding),fundTo=Math.min(done.to,to+(config.fundingIntervalBasis==='chart'?48*3600:0));
  if(!hasRange(state.candles.ranges,Math.max(done.from,T.start(start,'1m')),to)||!hasRange(state.funding.ranges,fundFrom,fundTo))return null;
  if(!localOnly&&start<done.from)return null;
  return {start,to,fundFrom,fundTo,checkedFrom:done.from,signature:state.signature,cutoffDiffers:to<T.start(config.researchRequestedEnd??config.endTime,'1m')};
 }
 function profile(state,config,{localOnly=false}={}){
  const period=scope(state,config,{localOnly});if(!period)return null;
  const cacheRangeEnd=['raw-v1',period.signature,period.checkedFrom,period.fundFrom,period.fundTo,period.to].join(':');
  return {period,config:{...config,endTime:period.to,cacheRangeEnd,cacheMaxEnd:period.to,researchRequestedEnd:config.researchRequestedEnd??config.endTime,precomputeTimeframes:false}};
 }
 function checkBatch(items,states,config){
  const byId=new Map(states.map(state=>[state.id,state])),ready=[],missing=[];
  for(const item of items){
   const state=byId.get(S.market(item).id),period=scope(state,config,{localOnly:true});
   const from=Math.max(period?.start??Infinity,state?.candles.first??Infinity),to=period?.to??-Infinity,tf=config.timeframe==='all'?'1m':config.timeframe;
   if(period&&state.candles.count>0&&state.funding.count>0&&from<to&&T.closedRange(from,to,tf).count>0)ready.push(item);
   else missing.push({item,reason:state?.completed?'period':'source'});
  }
  return {ready,missing,total:items.length};
 }
 function candleSink(tf,from,to,onBar){
  let bucket=null,next=0,last=-Infinity,count=0,bar={};
  const flush=()=>{if(bucket!==null&&last===next-60&&count===(next-bucket)/60&&bucket>=from&&next<=to)onBar(bar);};
  return {
   push(r){
    if(r.time<from||r.time+60>to)return;
    if(tf==='1m'){onBar(r);return;}
    if(bucket===null||r.time>=next){
     flush();bucket=T.start(r.time,tf);next=T.end(bucket,tf);last=r.time-60;count=0;bar={time:bucket,open:r.open,high:r.high,low:r.low,close:r.close,volume:0};
    }
    // Count all required minutes; a partial candle, including the current one,
    // cannot be used as a complete candle on any timeframe.
    bar.high=Math.max(bar.high,r.high);bar.low=Math.min(bar.low,r.low);bar.close=r.close;bar.volume+=r.volume;last=r.time;count++;
   },
   flush
  };
 }
 async function dataset(store,item,config,{state,period,signal=aborted(),onProgress=()=>{},maxBars=B.recommendedMaxBars()}={}){
  const m=S.market(item),stored=state||await store.state(m),p=period||scope(stored,config,{localOnly:true});
  if(!p)throw Error('이 코인·기간에 확인된 원본이 없습니다. 즐겨찾기에서 원본 수집·이어서를 실행하세요.');
  const selected=config.timeframe==='all'?frames:[config.timeframe],required=[...new Set([...selected,...(config.splitTrigger==='rsi_cross_up_1m'?['1m']:[])])];
  if(required.some(tf=>!Object.hasOwn(T.seconds,tf)))throw Error('보관 원본으로 계산할 주기를 확인하세요.');
  const {start,to,fundFrom,fundTo}=p,timeframeCandles={},coverage={},gaps=[],sinks=new Map();let total=0,gapsCount=0,sourceRows=0,previousMinute=null;
  for(const tf of required){
   const from=Math.max(0,T.shift(T.start(start,tf),tf,-Math.max(80,(config.rsiPeriod||14)*3))),packed=B.builder({ascending:true});let first=null,last=null,inside=0,previous=null;
   const sink=candleSink(tf,from,to,r=>{
    if(++total>maxBars)throw Error('메모리 보호 기준을 초과했습니다. 원본은 유지되며 일부만 계산하지 않았습니다.');
    if(previous!==null&&T.end(previous,tf)<r.time){gapsCount++;if(gaps.length<2000)gaps.push({timeframe:tf,from:T.end(previous,tf),to:r.time});}
    previous=r.time;packed.push(r);if(r.time>=start){first??=r.time;last=r.time;inside++;}
   });
   sinks.set(tf,{from,sink,finish(){
    sink.flush();if(!inside){coverage[tf]={error:'보관한 원본에서 '+tf+' 완성 캔들을 만들 수 없습니다.'};return;}
    timeframeCandles[tf]=packed.finish();coverage[tf]=coverageOf(packed.length,first,last,inside,start,to,tf);
   }});
  }
  const lo=Math.min(...[...sinks.values()].map(v=>v.from)),scratch={};
  for await(const {head,values} of store.series(m,'candles',lo,to,{signal})){
   for(let i=0;i<head.count;i++){
    const r=S.rowAt(values,i,scratch);if(r.time<lo||r.time+60>to)continue;
    if(!sinks.has('1m')&&previousMinute!==null&&r.time>previousMinute+60&&r.time>=start){gapsCount++;if(gaps.length<2000)gaps.push({timeframe:'1m',from:previousMinute+60,to:r.time});}
    previousMinute=r.time;for(const {sink} of sinks.values())sink.push(r);sourceRows++;
   }
   onProgress({phase:'research-read',text:'보관 원본으로 '+(config.timeframe==='all'?'선택 범위의 주기별 봉':config.timeframe+' 기준 봉')+' 준비 · 읽은 1분봉 '+sourceRows.toLocaleString()+'봉 · 거래소 재조회 없음'});
  }
  for(const {finish} of sinks.values())finish();
  if(!Object.keys(timeframeCandles).length||config.timeframe!=='all'&&!timeframeCandles[config.timeframe]?.length||config.splitTrigger==='rsi_cross_up_1m'&&!timeframeCandles['1m']?.length)throw Error(coverage[config.timeframe]?.error||'보관한 원본에서 필요한 완성 캔들을 만들 수 없습니다.');
  const records=[];for await(const {values} of store.series(m,'funding',fundFrom,fundTo,{signal}))for(const r of values)if(r.time>=fundFrom&&r.time<fundTo)records.push(r);
  if(!records.length)throw Error('보관한 원본에 해당 기간의 공식 펀딩 정산 기록이 없습니다.');
  const available=Object.entries(coverage).filter(([,v])=>Number.isFinite(v.first)),priceStart=Math.min(...available.map(([,v])=>v.first)),priceEnd=Math.max(...available.map(([tf,v])=>T.end(v.last,tf)));
  const first=records[0].time,last=records.at(-1).time;let longGaps=0;
  for(let i=1;i<records.length;i++)if(records[i].time-records[i-1].time>day+60&&records[i].time>priceStart&&records[i-1].time<priceEnd)longGaps++;
  return {symbol:m.symbol,exchange:m.exchange,startTime:start,endTime:to,timeframeCandles,coverage,gaps,gapsCount,fundingRecords:records,source:'verified-local-minute-and-funding',fundingCoverage:{first,last,count:records.length,startMissing:first>priceStart+2*day,endMissing:last<priceEnd-2*day,longGaps},research:{through:to,storedThrough:stored.completed.to,checkedFrom:p.checkedFrom,sourceRows,cutoffDiffers:p.cutoffDiffers}};
 }
 return {earliest,carryLegacy,cacheEntries,collect,scope,profile,checkBatch,dataset};
});
