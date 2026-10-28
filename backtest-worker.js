'use strict';
importScripts('funding.js?v=20261027-funding-cursor-1','timeframes.js?v=20261025-backtest-1','indicators.js?v=20261025-backtest-1','backtest-bars.js?v=20261028-long-backtest-1','backtest-engine.js?v=20261028-long-backtest-1');
onmessage=event=>{
 const {id,mode,dataset,config}=event.data;
 try{
  let result;const onProgress=progress=>postMessage({id,progress});onProgress({phase:'prepare',timeframe:config.timeframe});
  if(mode==='compare')result=BacktestEngine.runAllTimeframes(dataset.timeframeCandles,dataset.fundingRecords,config,{equityMaxPoints:5000,onProgress});
  else if(mode==='optimize')result=BacktestEngine.optimizeStrategy(dataset.timeframeCandles[config.timeframe],dataset.fundingRecords,{baseConfig:config,minTrades:2,minuteCandles:dataset.timeframeCandles['1m'],onProgress});
  else result=BacktestEngine.runBacktest(dataset.timeframeCandles[config.timeframe],dataset.fundingRecords,config,{minuteCandles:dataset.timeframeCandles['1m'],equityMaxPoints:5000,onProgress});
  postMessage({id,result});
 }catch(error){postMessage({id,error:error.message});}
};
