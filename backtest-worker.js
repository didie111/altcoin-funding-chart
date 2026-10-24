'use strict';
importScripts('timeframes.js?v=20261025-backtest-1','indicators.js?v=20261025-backtest-1','backtest-engine.js?v=20261025-backtest-1');
onmessage=event=>{
 const {id,mode,dataset,config}=event.data;
 try{
  let result;
  if(mode==='compare')result=BacktestEngine.runAllTimeframes(dataset.timeframeCandles,dataset.fundingRecords,config);
  else if(mode==='optimize')result=BacktestEngine.optimizeStrategy(dataset.timeframeCandles[config.timeframe],dataset.fundingRecords,{baseConfig:config,minTrades:2});
  else result=BacktestEngine.runBacktest(dataset.timeframeCandles[config.timeframe],dataset.fundingRecords,config);
  postMessage({id,result});
 }catch(error){postMessage({id,error:error.message});}
};
