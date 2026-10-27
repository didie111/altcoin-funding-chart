'use strict';
importScripts('funding.js?v=20261027-cycle-coverage-1','timeframes.js?v=20261025-backtest-1','indicators.js?v=20261025-backtest-1','backtest-engine.js?v=20261027-layout-funding-1');
onmessage=event=>{
 const {id,mode,dataset,config}=event.data;
 try{
  let result;
  if(mode==='compare')result=BacktestEngine.runAllTimeframes(dataset.timeframeCandles,dataset.fundingRecords,config);
  else if(mode==='optimize')result=BacktestEngine.optimizeStrategy(dataset.timeframeCandles[config.timeframe],dataset.fundingRecords,{baseConfig:config,minTrades:2,minuteCandles:dataset.timeframeCandles['1m']});
  else result=BacktestEngine.runBacktest(dataset.timeframeCandles[config.timeframe],dataset.fundingRecords,config,{minuteCandles:dataset.timeframeCandles['1m']});
  postMessage({id,result});
 }catch(error){postMessage({id,error:error.message});}
};
