'use strict';
importScripts('relay-config.js?v=20261013-relay-1','market-shared.js?v=20261025-mtf-1','market-api.js?v=20261026-context-data-ruler-1','funding.js?v=20261027-funding-cursor-1','timeframes.js?v=20261031-batch-range-1','indicators.js?v=20261025-backtest-1','backtest-bars.js?v=20261028-long-backtest-1','backtest-engine.js?v=20261029-funding-history-1','backtest-data.js?v=20261031-batch-range-1','backtest-cache.js?v=20261031-batch-range-1','backtest-archive.js?v=20261031-archive-speed-1','dashboard-model.js?v=20261031-batch-range-1');
let active=false,requestNumber=0;const pendingRequests=new Map();
onmessage=async event=>{
 if(event.data.marketResponse){const response=event.data.marketResponse,pending=pendingRequests.get(response.requestId);if(pending){pendingRequests.delete(response.requestId);response.error?pending.reject(Object.assign(Error(response.error.message),response.error)):pending.resolve(response.data);}return;}
 const {id,market,config,detail=false,deviceMemory}=event.data;if(active)return;active=true;const signal=new AbortController().signal;let last=0,cached=0;
 const progress=value=>{const now=Date.now();if(now-last>=250||value.phase==='prepare'||value.kind){last=now;postMessage({id,progress:{...value,cached}});}};
 try{
  const store=await BacktestCache.open(),adapter=BacktestCache.adapter({candlePage:BacktestData.candlePage,fundingPage:BacktestData.fundingPage,store,onCache:()=>cached++}),m={ex:market.exchange,symbol:market.symbol,int:config.timeframe};
  // Reuse the parent chart's shared request broker, including its global BingX
  // pacing, request deduplication and exchange-wide rate-limit cooldowns.
  MarketAPI.json=(url,params={})=>new Promise((resolve,reject)=>{const requestId=++requestNumber;pendingRequests.set(requestId,{resolve,reject});postMessage({id,marketRequest:{requestId,url,params}});});
  const archive=typeof BacktestArchive!=='undefined'&&m.ex==='BINANCE'&&config.useBinanceArchive!==false?BacktestArchive.create({candlePage:adapter.candlePage,store,lower:tf=>Math.max(0,TimeframeEngine.shift(TimeframeEngine.start(config.startTime,tf),tf,-Math.max(80,config.rsiPeriod*3))),loadAsset:(url,kind)=>new Promise((resolve,reject)=>{const requestId=++requestNumber;pendingRequests.set(requestId,{resolve,reject});postMessage({id,archiveRequest:{requestId,url,kind}});}),onProgress:progress,onCache:()=>cached++}):null;
  const source=BacktestData.create(archive?{...adapter,candlePage:archive.candlePage}:adapter);
  const dataset=await source.loadBacktestDataset(m.symbol,{packed:true,maxBars:BacktestBars.recommendedMaxBars(deviceMemory),exchange:m.ex,intervals:[m.int],requireMinuteData:config.splitTrigger==='rsi_cross_up_1m',startTime:config.startTime,endTime:config.endTime,rsiPeriod:config.rsiPeriod,fundingWindowSeconds:config.fundingWindowSeconds,fundingIntervalBasis:config.fundingIntervalBasis,signal,onProgress:progress});
  DashboardModel.validateBacktestDataset(dataset,m);progress({phase:'prepare',timeframe:m.int});
  const result=BacktestEngine.runBacktest(dataset.timeframeCandles[m.int],dataset.fundingRecords,{...config,endTime:dataset.endTime},{minuteCandles:dataset.timeframeCandles['1m'],summaryOnly:!detail,equityMaxPoints:5000,onProgress:progress});
  if(!result.success||result.config.timeframe!==m.int)throw Error(result.reason||'실행 주기를 확인할 수 없습니다.');
  const meta={market:m,coverage:dataset.coverage,fundingCoverage:dataset.fundingCoverage,gaps:dataset.gapsCount,startTime:dataset.startTime,endTime:dataset.endTime,source:dataset.source,...(archive?{archive:archive.info()}:{}),config:result.config};
  postMessage({id,output:{summary:result.summary,meta,warnings:result.warnings,diagnostics:result.diagnostics,cache:{hits:cached,...await store.info()},...(detail?{result}:{})}});
 }catch(error){postMessage({id,error:{message:error.message,name:error.name,retryAt:error.retryAt}});}
 finally{active=false;}
};
