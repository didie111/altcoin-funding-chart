'use strict';
importScripts('relay-config.js?v=20261013-relay-1','market-shared.js?v=20261025-mtf-1','market-api.js?v=20261026-context-data-ruler-1','funding.js?v=20261027-funding-cursor-1','timeframes.js?v=20261107-result-reuse-1','indicators.js?v=20261025-backtest-1','backtest-bars.js?v=20261107-research-1','backtest-engine.js?v=20261107-responsive-backup-1','backtest-data.js?v=20261107-result-reuse-1','backtest-cache.js?v=20261107-research-1','backtest-archive.js?v=20261107-responsive-backup-1','dashboard-model.js?v=20261107-result-reuse-1','backtest-results.js?v=20261107-research-1','backtest-research-store.js?v=20261107-research-1','backtest-research.js?v=20261107-research-preflight-1');
let active=false,requestNumber=0,retainedDataset=null,temporaryStore;const pendingRequests=new Map();
onmessage=async event=>{
 if(event.data.marketResponse){const response=event.data.marketResponse,pending=pendingRequests.get(response.requestId);if(pending){pendingRequests.delete(response.requestId);response.error?pending.reject(Object.assign(Error(response.error.message),response.error)):pending.resolve(response.data);}return;}
 const {id,market,detail=false,deviceMemory,strictSnapshot=false,purpose='backtest'}=event.data,config={...event.data.config};config.cacheRangeEnd??=config.endTime;config.endTime=Math.min(config.endTime,Date.now()/1000);if(active)return;active=true;const signal=new AbortController().signal;let last=0,cached=0;
 const progress=value=>{const now=Date.now();if(now-last>=250||value.phase==='prepare'||value.kind||value.text){last=now;postMessage({id,progress:{...value,cached}});}};
 try{
  const TF = typeof TimeframeEngine !== 'undefined' ? TimeframeEngine : (typeof globalThis !== 'undefined' && globalThis.TimeframeEngine ? globalThis.TimeframeEngine : null);
  const isAllFrames = config.timeframe === 'all';
  const allFrames = TF ? Object.keys(TF.seconds) : ['1m','3m','5m','15m','30m','1h','2h','4h','1d','1w','1M'];
  const store=await (temporaryStore??=BacktestCache.open()),adapter=BacktestCache.adapter({candlePage:BacktestData.candlePage,fundingPage:BacktestData.fundingPage,store,onCache:()=>cached++}),m={ex:market.exchange,symbol:market.symbol,int:config.timeframe};
  MarketAPI.json=(url,params={})=>new Promise((resolve,reject)=>{const requestId=++requestNumber;pendingRequests.set(requestId,{resolve,reject});postMessage({id,marketRequest:{requestId,url,params}});});
  const results=typeof BacktestResults!=='undefined'?await BacktestResults.getDefault():null;
  if(purpose==='backtest'&&!config.researchOnly&&results&&(strictSnapshot&&detail||config.reuseCompleted!==false)){const heads=await results.find(market,config,{snapshot:!strictSnapshot});const saved=(detail&&heads||BacktestResults.readyFor(heads,config,strictSnapshot))?await BacktestResults.fromHeads(results,heads,config,{detail}):null;if(saved){progress({phase:'reuse',text:'저장된 완료 결과 · 원본 재조회 0회 · 재계산 없음'});postMessage({id,output:saved});return;}}
  const research=typeof BacktestResearch!=='undefined'?BacktestResearch:null;
  const history=research?await BacktestResearchStore.getDefault().catch(error=>{if(purpose==='collect-research'||config.researchOnly)throw error;return null;}):null;
  let archived=null,state=null;
  if(history){
   if(purpose==='collect-research')await research.carryLegacy(history,research.cacheEntries(store),{item:market,signal,Cache:BacktestCache,Archive:BacktestArchive,onProgress:progress});
   state=await history.state(market);
   if(purpose==='backtest')archived=research.profile(state,config,{localOnly:Boolean(config.researchOnly)});
  }
  if(config.researchOnly&&!archived)throw Error('이 코인·기간에 계산할 보관 원본이 없습니다. 원본 수집·이어서를 실행하거나 보관 범위 안의 기간을 선택하세요.');
  if(archived){
   Object.assign(config,archived.config);
   if(results&&config.reuseCompleted!==false){
    const heads=await results.find(market,config,{snapshot:false}),saved=await BacktestResults.fromHeads(results,heads,config,{detail});
    if(saved){progress({phase:'reuse',text:'보관 원본에서 계산했던 동일 조건 결과 · 거래소 재조회 없음'});postMessage({id,output:saved});return;}
   }
  }
  let effectiveStartTime=config.startTime,knownListingTime=null;
  if(!archived&&m.ex==='BINANCE'&&config.startTime<1567296000&&(purpose!=='collect-research'||!state?.candles.count||BacktestResearchStore.missing(state.candles.ranges,config.startTime,state.candles.first).length)){
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
  const intervals=isAllFrames?allFrames:[m.int],maxBars=BacktestBars.recommendedMaxBars(deviceMemory);
  let dataset,calculationContext;
  if(archived){
   const key=JSON.stringify([market.exchange,market.symbol,config.timeframe,config.startTime,config.cacheRangeEnd,config.rsiPeriod,config.rsiSource,config.splitTrigger==='rsi_cross_up_1m']);
   if(retainedDataset?.key===key)dataset=retainedDataset.data;
   else{
    retainedDataset=null;
    dataset=await research.dataset(history,market,config,{state,period:archived.period,signal,onProgress:progress,maxBars});
    retainedDataset={key,data:dataset,prepared:new Map()};
   }
   calculationContext=retainedDataset;
  }else{
   retainedDataset=null;
   dataset=await source.loadBacktestDataset(m.symbol,{packed:true,maxBars,exchange:m.ex,intervals,requireMinuteData:isAllFrames||config.splitTrigger==='rsi_cross_up_1m',fastResample:isAllFrames||config.splitTrigger==='rsi_cross_up_1m',allowMissing:isAllFrames,startTime:effectiveStartTime,endTime:config.endTime,rsiPeriod:config.rsiPeriod,fundingWindowSeconds:config.fundingWindowSeconds,fundingIntervalBasis:config.fundingIntervalBasis,signal,onProgress:progress});
  }
  async function calculate(tf,data){
   progress({phase:'prepare',timeframe:tf});
   const controls={...calculationContext,minuteCandles:data.timeframeCandles['1m'],equityMaxPoints:typeof BacktestResults==='undefined'?5000:BacktestResults.equityPoints,onProgress:progress};
   const result=BacktestEngine.runBacktest(data.timeframeCandles[tf],data.fundingRecords,{...config,timeframe:tf,endTime:data.endTime},controls);if(calculationContext)calculationContext.minutePrepared=controls.minutePrepared;
   const meta={market:{...m,int:tf},coverage:{[tf]:{...data.coverage[tf],...(!result.success?{error:result.reason}:{})}},fundingCoverage:data.fundingCoverage,gaps:data.gapsCount,startTime:data.startTime,endTime:data.endTime,source:data.source,...(data.research?{research:data.research}:{}),...(archive?{archive:archive.info()}:{}),config:result.config};
   let saved=false;if(results){try{saved=await results.save(market,config,result,meta);}catch{}}
   return {result,summary:result.summary,meta,warnings:result.warnings,diagnostics:result.diagnostics,cache:{hits:cached,resultSaved:saved,...await store.info()}};
  }
  async function saveMissing(data){
   if(!results)return;
   for(const [tf,coverage]of Object.entries(data.coverage))if(coverage.error){
    const c=BacktestEngine.normalizeConfig({...config,timeframe:tf,endTime:data.endTime}),result={success:false,reason:coverage.error,summary:null,config:c,trades:[],signals:[],equityCurve:[],unavailable:true};
    const meta={market:{...m,int:tf},coverage:{[tf]:coverage},fundingCoverage:data.fundingCoverage,gaps:data.gapsCount,startTime:data.startTime,endTime:data.endTime,source:data.source,config:c};
    try{await results.save(market,config,result,meta);}catch{}
   }
  }
  let output;
  if(isAllFrames){
   await saveMissing(dataset);
   const outputs=[];
   for(const tf of allFrames)if(dataset.timeframeCandles[tf])outputs.push(await calculate(tf,dataset));
   const heads=outputs.map(o=>({summary:o.summary,timeframe:o.result.config.timeframe,snapshotEnd:o.meta.endTime})),comparisonResult=typeof BacktestResults!=='undefined'?BacktestResults.compare(heads):BacktestEngine.runAllTimeframes(dataset.timeframeCandles,dataset.fundingRecords,config,{summaryOnly:true});
   const best=comparisonResult.bestByTotalReturn||comparisonResult.bestByWinRate||comparisonResult.comparison[0],selected=outputs.find(o=>o.result.config.timeframe===best.timeframe)||outputs[0];
   output={summary:{...best,timeframe:'all',bestTimeframe:best.timeframe},meta:{...selected.meta,market:m,coverage:dataset.coverage,config:{...config,timeframe:'all'}},comparison:comparisonResult.comparison,comparisonResult:detail?comparisonResult:undefined,cache:selected.cache};
  }else{
   DashboardModel.validateBacktestDataset(dataset,m);output=await calculate(m.int,dataset);
   if(!output.result.success)throw Error(output.result.reason);
   if(results&&!archived&&m.int==='1m'&&config.precomputeTimeframes!==false&&!strictSnapshot){
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
