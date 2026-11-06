'use strict';
importScripts('relay-config.js?v=20261013-relay-1','market-shared.js?v=20261025-mtf-1','market-api.js?v=20261026-context-data-ruler-1','funding.js?v=20261027-funding-cursor-1','timeframes.js?v=20261107-responsive-backup-1','indicators.js?v=20261025-backtest-1','backtest-bars.js?v=20261107-responsive-backup-1','backtest-engine.js?v=20261107-responsive-backup-1','backtest-data.js?v=20261107-responsive-backup-1','backtest-cache.js?v=20261107-responsive-backup-1','backtest-archive.js?v=20261107-responsive-backup-1','dashboard-model.js?v=20261107-responsive-backup-1');
let active=false,requestNumber=0;const pendingRequests=new Map();
onmessage=async event=>{
 if(event.data.marketResponse){const response=event.data.marketResponse,pending=pendingRequests.get(response.requestId);if(pending){pendingRequests.delete(response.requestId);response.error?pending.reject(Object.assign(Error(response.error.message),response.error)):pending.resolve(response.data);}return;}
 const {id,market,config,detail=false,deviceMemory}=event.data;if(active)return;active=true;const signal=new AbortController().signal;let last=0,cached=0;
 const progress=value=>{const now=Date.now();if(now-last>=250||value.phase==='prepare'||value.kind){last=now;postMessage({id,progress:{...value,cached}});}};
 try{
  const TF = typeof TimeframeEngine !== 'undefined' ? TimeframeEngine : (typeof globalThis !== 'undefined' && globalThis.TimeframeEngine ? globalThis.TimeframeEngine : null);
  const isAllFrames = config.timeframe === 'all';
  const allFrames = TF ? Object.keys(TF.seconds) : ['1m','3m','5m','15m','30m','1h','2h','4h','1d','1w','1M'];
  const store=await BacktestCache.open(),adapter=BacktestCache.adapter({candlePage:BacktestData.candlePage,fundingPage:BacktestData.fundingPage,store,onCache:()=>cached++}),m={ex:market.exchange,symbol:market.symbol,int:config.timeframe};
  MarketAPI.json=(url,params={})=>new Promise((resolve,reject)=>{const requestId=++requestNumber;pendingRequests.set(requestId,{resolve,reject});postMessage({id,marketRequest:{requestId,url,params}});});
  let effectiveStartTime=config.startTime;
  if(m.ex==='BINANCE'&&config.startTime<1567296000){
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
     effectiveStartTime=Math.max(effectiveStartTime,listingSec);
    }
   }catch(error){if(error.name==='RateLimitError')throw error;}
  }
  const archive=typeof BacktestArchive!=='undefined'&&m.ex==='BINANCE'&&config.useBinanceArchive!==false&&TF?BacktestArchive.create({candlePage:adapter.candlePage,store,lower:tf=>Math.max(0,TF.shift(TF.start(effectiveStartTime,tf),tf,-Math.max(80,config.rsiPeriod*3))),loadAsset:(url,kind)=>new Promise((resolve,reject)=>{const requestId=++requestNumber;pendingRequests.set(requestId,{resolve,reject});postMessage({id,archiveRequest:{requestId,url,kind}});}),onProgress:progress,onCache:()=>cached++}):null;
  const source=BacktestData.create(archive?{...adapter,candlePage:archive.candlePage}:adapter);
  const intervals=isAllFrames?allFrames:[m.int];
  const dataset=await source.loadBacktestDataset(m.symbol,{packed:true,maxBars:BacktestBars.recommendedMaxBars(deviceMemory),exchange:m.ex,intervals,requireMinuteData:isAllFrames||config.splitTrigger==='rsi_cross_up_1m',fastResample:isAllFrames||config.splitTrigger==='rsi_cross_up_1m',allowMissing:isAllFrames,startTime:effectiveStartTime,endTime:config.endTime,rsiPeriod:config.rsiPeriod,fundingWindowSeconds:config.fundingWindowSeconds,fundingIntervalBasis:config.fundingIntervalBasis,signal,onProgress:progress});
  if(isAllFrames){
   progress({phase:'prepare',timeframe:'all'});
   const multiResult=BacktestEngine.runAllTimeframes(dataset.timeframeCandles,dataset.fundingRecords,{...config,endTime:dataset.endTime},{minuteCandles:dataset.timeframeCandles['1m'],summaryOnly:!detail,equityMaxPoints:5000,onProgress:progress});
   const best=multiResult.bestByTotalReturn||multiResult.bestByWinRate||multiResult.comparison[0]||{totalTrades:0,winRatePct:0,profitFactor:0,netPnl:0,finalCapital:config.initialCapital,maxDrawdownPct:0};
   const summary={...best,timeframe:'all',bestTimeframe:best.timeframe,netPnl:best.netPnl,winRatePct:best.winRatePct,profitFactor:best.profitFactor,totalTrades:best.totalTrades,finalCapital:best.finalCapital,maxDrawdownPct:best.maxDrawdownPct,riskRewardRatio:best.riskRewardRatio};
   const meta={market:m,coverage:dataset.coverage,fundingCoverage:dataset.fundingCoverage,gaps:dataset.gapsCount,startTime:dataset.startTime,endTime:dataset.endTime,source:dataset.source,...(archive?{archive:archive.info()}:{}),config:{...config,timeframe:'all',bestTimeframe:best.timeframe}};
   postMessage({id,output:{summary,meta,comparison:multiResult.comparison,results:detail?multiResult.results:undefined,cache:{hits:cached,...await store.info()},...(detail&&best.timeframe&&multiResult.results[best.timeframe]?{result:multiResult.results[best.timeframe]}:{})}});
  }else{
   DashboardModel.validateBacktestDataset(dataset,m);
   progress({phase:'prepare',timeframe:m.int});
   const result=BacktestEngine.runBacktest(dataset.timeframeCandles[m.int],dataset.fundingRecords,{...config,endTime:dataset.endTime},{minuteCandles:dataset.timeframeCandles['1m'],summaryOnly:!detail,equityMaxPoints:5000,onProgress:progress});
   if(!result.success||result.config.timeframe!==m.int)throw Error(result.reason||'실행 주기를 확인할 수 없습니다.');
   const meta={market:m,coverage:dataset.coverage,fundingCoverage:dataset.fundingCoverage,gaps:dataset.gapsCount,startTime:dataset.startTime,endTime:dataset.endTime,source:dataset.source,...(archive?{archive:archive.info()}:{}),config:result.config};
   postMessage({id,output:{summary:result.summary,meta,warnings:result.warnings,diagnostics:result.diagnostics,cache:{hits:cached,...await store.info()},...(detail?{result}:{})}});
  }
 }catch(error){postMessage({id,error:{message:error.message,name:error.name,retryAt:error.retryAt}});}
 finally{active=false;}
};
