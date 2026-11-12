'use strict';
importScripts('relay-config.js?v=20261013-relay-1','market-shared.js?v=20261025-mtf-1','market-api.js?v=20261026-context-data-ruler-1','funding.js?v=20261027-funding-cursor-1','timeframes.js?v=20261107-result-reuse-1','indicators.js?v=20261025-backtest-1','backtest-bars.js?v=20261107-research-1','backtest-engine.js?v=20261112-support-grade-1','backtest-data.js?v=20261112-support-grade-1','backtest-cache.js?v=20261108-current-batch-settings-1','backtest-archive.js?v=20261107-responsive-backup-1','dashboard-model.js?v=20261108-restore-raw-first-1','backtest-results.js?v=20261112-support-grade-1','backtest-research-store.js?v=20261109-verified-backtest-1','backtest-research.js?v=20261109-verified-backtest-1');
const coverageError=reason=>Object.assign(Error('원본 확인 보류 · '+reason),{name:'DataCoverageError'});
let active=false,requestNumber=0,retainedDataset=null,temporaryStore;const pendingRequests=new Map();
onmessage=async event=>{
 if(event.data.marketResponse){const response=event.data.marketResponse,pending=pendingRequests.get(response.requestId);if(pending){pendingRequests.delete(response.requestId);response.error?pending.reject(Object.assign(Error(response.error.message),response.error)):pending.resolve(response.data);}return;}
 const {id,market,detail=false,deviceMemory,strictSnapshot=false,purpose='backtest'}=event.data,config={...event.data.config};config.cacheRangeEnd??=config.endTime;config.endTime=Math.min(config.endTime,Date.now()/1000);if(active)return;active=true;const signal=new AbortController().signal;let last=0,cached=0;
 const progress=value=>{const now=Date.now();if(now-last>=250||value.phase==='prepare'||value.kind||value.text){last=now;postMessage({id,progress:{...value,cached}});}};
 try{
  const TF = typeof TimeframeEngine !== 'undefined' ? TimeframeEngine : (typeof globalThis !== 'undefined' && globalThis.TimeframeEngine ? globalThis.TimeframeEngine : null);
  const latest=purpose==='backtest'&&config.verifyLatest===true&&!strictSnapshot;
  const requestedEnd=latest?TF.start(config.endTime,'1m'):config.endTime;
  if(latest&&requestedEnd<=config.startTime)throw coverageError('선택 기간에 완료된 캔들이 없습니다.');
  if(latest)Object.assign(config,{endTime:requestedEnd,cacheRangeEnd:requestedEnd,cacheMaxEnd:requestedEnd,reuseCompleted:false,researchOnly:false});
  const isAllFrames = config.timeframe === 'all';
  const allFrames = TF ? Object.keys(TF.seconds) : ['1m','3m','5m','15m','30m','1h','2h','4h','1d','1w','1M'];
  const store=await (temporaryStore??=BacktestCache.open()),adapter=BacktestCache.adapter({candlePage:BacktestData.candlePage,fundingPage:BacktestData.fundingPage,store,onCache:()=>cached++}),m={ex:market.exchange,symbol:market.symbol,int:config.timeframe};
  MarketAPI.json=(url,params={})=>new Promise((resolve,reject)=>{const requestId=++requestNumber;pendingRequests.set(requestId,{resolve,reject});postMessage({id,marketRequest:{requestId,url,params}});});
  const results=typeof BacktestResults!=='undefined'?await BacktestResults.getDefault():null;
  let partial=null;
  const resultApi=typeof BacktestResults!=='undefined'?BacktestResults:null,lookForSaved=purpose==='backtest'&&results&&(strictSnapshot&&detail||config.reuseCompleted!==false);
  const readFrames=(heads,rows=[])=>resultApi.framePlan([...rows,...(heads||[]).map(resultApi.frameRecord)],market,config);
  if(lookForSaved&&isAllFrames&&!strictSnapshot)partial=readFrames(null,market.frameReuse?.rows);
  if(lookForSaved&&!config.researchOnly){
   const heads=await results.find(market,config,{snapshot:!strictSnapshot,partial:isAllFrames});
   if(isAllFrames)partial=readFrames(heads,partial?.rows);
   const saved=isAllFrames?(partial&&!partial.missing.length?resultApi.combineFrames(partial.rows,config,{detail,reused:true}):null):(detail&&heads||resultApi.readyFor(heads,config,strictSnapshot))?await resultApi.fromHeads(results,heads,config,{detail}):null;
   if(saved){progress({phase:'reuse',text:'저장된 완료 결과 · 원본 재조회 0회 · 재계산 없음'});postMessage({id,output:saved});return;}
  }
  if(partial){config.researchRequestedEnd=config.endTime;config.endTime=partial.snapshotEnd;config.cacheMaxEnd=partial.snapshotEnd;}
  const research=typeof BacktestResearch!=='undefined'?BacktestResearch:null;
  const history=research?await BacktestResearchStore.getDefault().catch(error=>{if(purpose==='collect-research'||config.researchOnly)throw error;return null;}):null;
  if(latest&&!research?.verifySnapshot)throw Error('최신 원본 검사를 시작하지 못했습니다. 페이지를 새로고침하세요.');
  let archived=null,state=null;
  if(history){
   if(purpose==='collect-research')await research.carryLegacy(history,research.cacheEntries(store),{item:market,signal,Cache:BacktestCache,Archive:BacktestArchive,onProgress:progress});
   state=await history.state(market);
   if(purpose==='backtest')archived=research.executionProfile(state,config,{strictSnapshot:latest||strictSnapshot||Boolean(partial)});
  }
  if(config.researchOnly&&!archived)throw Error('이 코인·기간에 계산할 보관 원본이 없습니다. 원본 수집·이어서를 실행하거나 보관 범위 안의 기간을 선택하세요.');
  if(archived){
   Object.assign(config,archived.config);
   if(latest&&results){
    const all=await results.find(market,config,{snapshot:false,partial:isAllFrames}),heads=all?.filter(h=>h.meta?.verification?.version===1&&h.meta.verification.through===requestedEnd&&h.meta.verification.signature===state.signature);
    const matched=isAllFrames&&heads?.length?readFrames(heads):null;
    const saved=isAllFrames?(matched&&!matched.missing.length?resultApi.combineFrames(matched.rows,config,{detail,reused:true}):null):heads?.[0]?.success?await resultApi.fromHeads(results,heads,config,{detail}):null;
    if(saved){progress({phase:'reuse',text:'같은 확정 시점·설정의 검증 결과 · 재계산 없음'});postMessage({id,output:saved});return;}
   }else if(results&&config.reuseCompleted!==false){
    const heads=await results.find(market,config,{snapshot:false,partial:isAllFrames});
    if(isAllFrames){const candidate=readFrames(heads,partial?.rows);if(candidate&&(!partial||candidate.rows.length>=partial.rows.length))partial=candidate;}
    const saved=isAllFrames?(partial&&!partial.missing.length?resultApi.combineFrames(partial.rows,config,{detail,reused:true}):null):await resultApi.fromHeads(results,heads,config,{detail});
    if(saved){progress({phase:'reuse',text:'보관 원본에서 계산했던 동일 조건 결과 · 거래소 재조회 없음'});postMessage({id,output:saved});return;}
   }
  }
  const extend=!archived&&purpose==='backtest'&&!strictSnapshot&&history&&research.canExtend(state,config);
  const fillGaps=!archived&&!extend&&purpose==='backtest'&&!strictSnapshot&&history&&(isAllFrames||m.int==='1m'||config.splitTrigger==='rsi_cross_up_1m')&&research.hasStoredMinutes(state,config);
  let effectiveStartTime=extend?state.completed.to:config.startTime,knownListingTime=null;
  if(!archived&&!extend&&m.ex==='BINANCE'&&config.startTime<1567296000&&(purpose!=='collect-research'||!state?.candles.count||BacktestResearchStore.missing(state.candles.ranges,config.startTime,state.candles.first).length)){
   try{
    let listingSec=null;
    const saved=await store.get(JSON.stringify(['listing-time-v1',m.symbol]),Date.now()).catch(()=>null);
    if(Number.isFinite(saved)&&saved>0)listingSec=saved;
    else{
     const probe=await MarketAPI.json('https://fapi.binance.com/fapi/v1/klines',{symbol:m.symbol,interval:'1m',startTime:0,limit:1});
     if(Array.isArray(probe)&&probe.length&&Number.isFinite(probe[0]?.[0])){
      listingSec=Math.floor(probe[0][0]/1000);
      await store.put(JSON.stringify(['listing-time-v1',m.symbol]),listingSec,{expires:Date.now()+365*86400000}).catch(()=>{});
     }
    }
    if(listingSec){
     effectiveStartTime=Math.max(effectiveStartTime,listingSec);knownListingTime=listingSec;
    }
   }catch(error){if(error.name==='RateLimitError')throw error;}
  }
  const archive=!archived&&typeof BacktestArchive!=='undefined'&&m.ex==='BINANCE'&&config.useBinanceArchive!==false&&TF?BacktestArchive.create({candlePage:adapter.candlePage,store,lower:tf=>Math.max(0,TF.shift(TF.start(effectiveStartTime,tf),tf,-Math.max(80,config.rsiPeriod*3))),loadAsset:(url,kind)=>new Promise((resolve,reject)=>{const requestId=++requestNumber;pendingRequests.set(requestId,{resolve,reject});postMessage({id,archiveRequest:{requestId,url,kind}});}),onProgress:progress,onCache:()=>cached++}):null;
  const source=BacktestData.create(archive?{...adapter,candlePage:archive.candlePage}:adapter);
  if(purpose==='collect-research'){
   if(!history)throw Error('원본 보관소를 열 수 없습니다.');
   retainedDataset=null;
   const output=await research.collect({store:history,item:market,from:config.startTime,to:config.endTime,knownListing:knownListingTime,candlePage:archive?archive.candlePage:BacktestData.candlePage,fundingPage:BacktestData.fundingPage,signal,onProgress:progress});
   postMessage({id,output});return;
  }
  if(extend){
   const old=state.completed;
   progress({phase:'research-tail',text:'보관한 과거 원본 재사용 · 저장 이후 구간만 거래소 확인'});
   const updated=await research.collect({store:history,item:market,from:old.from,to:config.endTime,keepFundingFrom:old.fundingFrom,candlePage:archive?archive.candlePage:BacktestData.candlePage,fundingPage:BacktestData.fundingPage,signal,onProgress:progress});
   state=updated.state;archived=research.profile(state,config,{preferSaved:!latest,strictSnapshot:latest});
   if(!archived)throw (latest?coverageError('요청한 확정 시점까지 1분봉·펀딩 원본이 아직 도착하지 않았습니다.'):Error('갱신한 원본에서 요청한 주기의 완성 캔들을 만들 수 없습니다.'));
   Object.assign(config,archived.config);
  }
  if(fillGaps){
   progress({phase:'research-gaps',text:'보관한 1분봉 재사용 · 빠진 구간만 거래소 확인'});
   const updated=await research.collect({store:history,item:market,from:config.startTime,to:config.endTime,knownListing:knownListingTime,candlePage:archive?archive.candlePage:adapter.candlePage,fundingPage:adapter.fundingPage,signal,onProgress:progress});
   state={...updated.state,completed:updated.verified};archived=research.profile(state,config,{localOnly:!latest,strictSnapshot:latest});
   if(!archived)throw (latest?coverageError('요청 기간 전체의 확정 원본을 확보하지 못했습니다.'):Error('보관 원본과 추가로 확인한 자료에서 요청한 주기의 완성 캔들을 만들 수 없습니다.'));
   Object.assign(config,archived.config);
  }
  if(partial)progress({phase:'reuse-frames',text:'저장 주기 '+partial.rows.length+'개 재사용 · 없는 '+partial.missing.length+'개 주기만 계산'});
  else if(!archived)progress({phase:'missing-source',text:'일치하는 저장 결과 없음 · 계산에 필요한 자료 확인'});
  const intervals=isAllFrames?(partial?.missing??allFrames):[m.int],maxBars=BacktestBars.recommendedMaxBars(deviceMemory);
  let dataset,calculationContext,verification,gapsRepaired=false;
  async function readArchived(){
   const key=JSON.stringify([market.exchange,market.symbol,config.timeframe,config.startTime,config.cacheRangeEnd,config.rsiPeriod,config.rsiSource,config.splitTrigger==='rsi_cross_up_1m',latest,intervals]);
   if(retainedDataset?.key===key)dataset=retainedDataset.data;
   else{
    retainedDataset=null;
    dataset=await research.dataset(history,market,config,{state,period:archived.period,intervals,allowEmpty:Boolean(partial),signal,onProgress:progress,maxBars});
    retainedDataset={key,data:dataset,prepared:new Map()};
   }
   calculationContext=retainedDataset;
  }
  if(archived)await readArchived();
  else{
   retainedDataset=null;
   dataset=await source.loadBacktestDataset(m.symbol,{packed:true,maxBars,verifyLatest:latest,exchange:m.ex,intervals,requireMinuteData:isAllFrames||config.splitTrigger==='rsi_cross_up_1m',fastResample:isAllFrames||config.splitTrigger==='rsi_cross_up_1m',allowMissing:isAllFrames,startTime:effectiveStartTime,endTime:config.endTime,rsiPeriod:config.rsiPeriod,requestedStartTime:config.startTime,knownListingTime,fundingWindowSeconds:config.fundingWindowSeconds,fundingIntervalBasis:config.fundingIntervalBasis,signal,onProgress:progress});
  }
  if(latest){
   let audit=research.verifySnapshot(dataset,config,{state,knownListing:knownListingTime,through:requestedEnd});
   if(archived&&audit.candles.length+audit.funding.length>0&&audit.candles.length+audit.funding.length<=24){
    progress({phase:'verify-gaps',text:'누락 후보 확인 · 캔들 '+audit.candles.length+'구간 / 펀딩 '+audit.funding.length+'구간만 다시 조회'});
    const from=Math.min(archived.period.checkedFrom,...audit.candles.map(r=>r[0]));
    const repaired=await research.collect({store:history,item:market,from,to:requestedEnd,keepFundingFrom:archived.period.fundFrom,candlePage:BacktestData.candlePage,fundingPage:BacktestData.fundingPage,repair:audit,signal,onProgress:progress});
    state=repaired.state;archived=research.profile(state,config,{strictSnapshot:true});
    if(!archived)throw coverageError('공백 재조회 후에도 요청한 확정 시점까지 원본을 확보하지 못했습니다.');
    Object.assign(config,archived.config);gapsRepaired=true;await readArchived();audit=research.verifySnapshot(dataset,config,{state,knownListing:knownListingTime,through:requestedEnd});
   }
   if(audit.errors.length||audit.candles.length||audit.funding.length){
    const kst=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}),describe=(kind,spans)=>spans.length?kind+' '+spans.length+'구간 · '+kst.format(spans[0][0]*1000)+' ~ '+kst.format(spans[0][1]*1000)+' KST':null;
    throw coverageError([describe('1분봉',audit.candles),describe('펀딩',audit.funding),...audit.errors.slice(0,3)].filter(Boolean).join(' / '));
   }
   verification={version:1,through:requestedEnd,signature:archived?state.signature:null};
  }
  if(partial&&TF.start(dataset.endTime,'1m')!==TF.start(partial.snapshotEnd,'1m'))throw Error('빠진 주기를 저장 결과와 같은 자료 시점까지 확인하지 못했습니다.');
  let retention,retentionWarning;
  if(history&&!archived&&!strictSnapshot&&(config.timeframe==='1m'||isAllFrames)&&dataset.rawBounds){
   try{retention=await research.retainDataset(history,market,dataset,{signal,onProgress:progress});}
   catch(error){retentionWarning=error.name==='QuotaExceededError'?'브라우저 공간 부족으로 이번 원본을 모두 저장하지 못했습니다.':error.message;}
  }
  // 다이버전스: 신호보다 큰 주기(4시간→일봉 등)의 캔들을 따로 불러와 지지 확인에 쓴다. 보관 원본·계산 결과와 무관하게 거래소(또는 캐시)에서 가져온다.
  const supportCache=new Map(),supportMap={};
  async function supportFor(tf,data){
   const plan=BacktestEngine.supportPlan({...config,timeframe:tf});if(!plan||plan.timeframe===tf)return undefined;
   const key=[plan.timeframe,plan.bars,data.startTime,data.endTime].join('|');
   if(!supportCache.has(key)){progress({phase:'support',text:'지지 확인용 '+plan.timeframe+' 캔들 불러오는 중'});supportCache.set(key,await source.loadContextCandles(m.symbol,{exchange:m.ex,timeframe:plan.timeframe,startTime:data.startTime,endTime:data.endTime,bars:plan.bars,signal}));}
   supportMap[plan.timeframe]=supportCache.get(key);return supportMap[plan.timeframe];
  }
  async function calculate(tf,data){
   progress({phase:'prepare',timeframe:tf});
   const controls={...calculationContext,minuteCandles:data.timeframeCandles['1m'],supportCandles:await supportFor(tf,data),equityMaxPoints:typeof BacktestResults==='undefined'?5000:BacktestResults.equityPoints,onProgress:progress};
   const result=BacktestEngine.runBacktest(data.timeframeCandles[tf],data.fundingRecords,{...config,timeframe:tf,endTime:data.endTime},controls);if(calculationContext)calculationContext.minutePrepared=controls.minutePrepared;
   if(typeof BacktestResults!=='undefined'&&!BacktestResults.matchesExecution(result,config,tf,{strictTrades:true}))throw Error('실행한 전략과 '+tf+' 계산 결과의 전략 또는 분할 수가 일치하지 않습니다.');
   const meta={market:{...m,int:tf},coverage:{[tf]:{...data.coverage[tf],...(!result.success?{error:result.reason}:{})}},fundingCoverage:data.fundingCoverage,gaps:data.gapsCount,startTime:data.startTime,endTime:data.endTime,source:data.source,...(verification?{verification}:{}),...(data.research?{research:{...data.research,...(extend?{tailRefreshed:true}:fillGaps||gapsRepaired?{gapsFilled:true}:{})}}:{}),...(retention?{retainedSource:retention}:{}),...(retentionWarning?{retentionWarning}:{}),...(archive?{archive:archive.info()}:{}),config:result.config};
   let saved=false;if(results){try{saved=await results.save(market,config,result,meta);}catch{}}
   return {result,summary:result.summary,meta,warnings:result.warnings,diagnostics:result.diagnostics,cache:{hits:cached,resultSaved:saved,...await store.info()}};
  }
  async function saveMissing(data){
   const records=[];if(!results)return records;
   for(const [tf,coverage]of Object.entries(data.coverage))if(coverage.error){
    const c=BacktestEngine.normalizeConfig({...config,timeframe:tf,endTime:data.endTime}),result={success:false,reason:coverage.error,summary:null,config:c,trades:[],signals:[],equityCurve:[],unavailable:true};
    const meta={market:{...m,int:tf},coverage:{[tf]:coverage},fundingCoverage:data.fundingCoverage,gaps:data.gapsCount,startTime:data.startTime,endTime:data.endTime,source:data.source,...(verification?{verification}:{}),config:c};
    try{await results.save(market,config,result,meta);}catch{}
    const record=resultApi.frameRecord({success:false,reason:coverage.error,meta});if(record)records.push(record);
   }
   return records;
  }
  let output;
  if(isAllFrames){
   const records=await saveMissing(dataset),outputs=[];
   for(const tf of intervals)if(dataset.timeframeCandles[tf])outputs.push(await calculate(tf,dataset));
   if(resultApi){
    for(const o of outputs){const row=resultApi.frameRecord({summary:o.summary,meta:o.meta,success:o.result.success,reason:o.result.reason});if(row)records.push(row);}
    const kept=partial?.rows??[];
    output=resultApi.combineFrames([...kept,...records],config,{detail,carried:kept.length});
    if(!output)throw Error('선택한 기간에 계산을 완료할 수 있는 주기가 없습니다.');
    output.meta.coverage={...dataset.coverage,...output.meta.coverage};
    const verified=new Set([...kept,...records].map(row=>row.timeframe)),unverifiedFrames=allFrames.filter(tf=>!verified.has(tf));
    if(unverifiedFrames.length)output.meta.unverifiedFrames=unverifiedFrames;
    output.cache=outputs.find(o=>o.result.config.timeframe===output.summary.bestTimeframe)?.cache||outputs[0]?.cache;
   }else{
    const comparisonResult=BacktestEngine.runAllTimeframes(dataset.timeframeCandles,dataset.fundingRecords,config,{summaryOnly:true,supportCandles:supportMap}),best=comparisonResult.bestByTotalReturn||comparisonResult.bestByWinRate||comparisonResult.comparison[0];
    if(!best)throw Error('선택한 기간에 계산을 완료할 수 있는 주기가 없습니다.');
    const selected=outputs.find(o=>o.result.config.timeframe===best.timeframe)||outputs[0];
    output={summary:{...best,timeframe:'all',bestTimeframe:best.timeframe},meta:{...selected.meta,market:m,coverage:dataset.coverage,config:{...config,timeframe:'all'}},comparison:comparisonResult.comparison,comparisonResult:detail?comparisonResult:undefined,cache:selected.cache};
   }
  }else{
   DashboardModel.validateBacktestDataset(dataset,m);output=await calculate(m.int,dataset);
   if(!output.result.success)throw Error(output.result.reason);
   if(results&&!latest&&!archived&&m.int==='1m'&&config.precomputeTimeframes!==false&&!strictSnapshot){
    try{
     progress({phase:'prepare-frames',text:'완료한 1분봉 재사용 · 다른 주기 상세 결과 미리 준비'});
     const derived=await source.loadBacktestDataset(m.symbol,{packed:true,maxBars:BacktestBars.recommendedMaxBars(deviceMemory),exchange:m.ex,intervals:allFrames,fastResample:true,allowMissing:true,seedDataset:dataset,knownListingTime,startTime:dataset.startTime,endTime:dataset.endTime,rsiPeriod:config.rsiPeriod,fundingWindowSeconds:config.fundingWindowSeconds,fundingIntervalBasis:config.fundingIntervalBasis,signal,onProgress:progress});
     await saveMissing(derived);
     const prepared=['1m'];for(const tf of allFrames)if(tf!=='1m'&&derived.timeframeCandles[tf]){const preparedResult=await calculate(tf,derived);if(preparedResult.cache.resultSaved&&preparedResult.result.success)prepared.push(tf);}
     output.meta.preparedTimeframes=prepared;if(output.cache.resultSaved)await results.save(market,config,output.result,output.meta);
    }catch(error){output.meta.preparationWarning=error.message;}
   }
   if(!detail)delete output.result;
  }
  postMessage({id,output});
 }catch(error){postMessage({id,error:{message:error.message,name:error.name,retryAt:error.retryAt}});}
 finally{active=false;}
};
