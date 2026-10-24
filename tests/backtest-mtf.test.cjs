'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../backtest-engine.js'),T=require('../timeframes.js'),Overlay=require('../backtest-overlay.js');
// Deterministic time-order fixtures; never shipped as exchange history.
const base=Date.UTC(2026,9,20)/1000;
function dataset({hours=3,deep=false,stopAfterDca=false}={}){
 const minute=[];let previous=100;
 for(let i=-120;i<hours*60;i++){
  const close=i===61?deep?95:99:i===62?deep?89:98:i>=63?deep?95:99:100;
  minute.push({time:base+i*60,open:previous,high:Math.max(previous,close),low:stopAfterDca&&i===64?93:Math.min(previous,close),close,volume:1});previous=close;
 }
 const main=[{time:base-7200,open:120,high:120,low:120,close:120,volume:60},{time:base-3600,open:110,high:110,low:110,close:110,volume:60},...Array.from({length:hours},(_,i)=>{
  const bars=minute.filter(b=>b.time>=base+i*3600&&b.time<base+(i+1)*3600);return {time:base+i*3600,open:bars[0].open,high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low)),close:bars.at(-1).close,volume:60};
 })];
 const config={timeframe:'1h',startTime:base,endTime:base+hours*3600,rsiPeriod:2,rsiOversold:30,entryTrigger:'rsi_oversold',splitTrigger:'rsi_cross_up_1m',splitCount:2,takeProfitPct:0,stopLossPct:0,maxHoldBars:0,feePct:0,slippagePct:0,initialCapital:1000,fundingIntervalHours:1,fundingWindowSeconds:86400};
 return {main,minute,config,funding:[{time:base-60,rate:-.5,fundingIntervalHours:1,markPrice:100}]};
}
const run=(d,extra={})=>E.runBacktest(d.main,d.funding,{...d.config,...extra},{minuteCandles:d.minute});
test('1h first entry follows the 1h close; a closed 1m RSI cross adds at 01:04 instead of the next hour',()=>{
 const d=dataset(),r=run(d),trade=r.trades[0];
 assert.equal(trade.entryTime,base+3600);assert.equal(trade.entries[1].time,base+64*60);assert.equal(trade.entries[1].price,99);
 assert.equal(r.model.executionTimeframe,'1m');assert.equal(r.model.dcaTimeframe,'1m');assert.equal(r.config.timeframe,'1h');
 assert.ok(trade.entries[1].time<base+7200);
});
test('current-timeframe RSI and percentage-drop DCA keep their existing independent rules',()=>{
 const d=dataset();const chart=run(d,{splitTrigger:'rsi_cross_up'}).trades[0],drop=run(d,{splitTrigger:'step_pct',splitStepPct:1}).trades[0];
 assert.equal(chart.dcaSteps,1);assert.equal(drop.dcaSteps,2);assert.equal(drop.entries[1].time,base+7200);
});
test('one-minute RSI DCA never reuses an earlier hourly high as the new weighted-average TP',()=>{
 const d=dataset({deep:true}),trade=run(d,{takeProfitPct:2}).trades[0];
 assert.equal(trade.entries[1].time,base+64*60);assert.equal(trade.entries[1].price,95);assert.equal(trade.exitReason,'END_OF_TEST');assert.equal(trade.dcaSteps,2);
 assert.ok(d.main[3].high>trade.entries[1].takeProfit);
});
test('after-all-DCA SL activates on the final minute fill, not on a prior minute low',()=>{
 const d=dataset({deep:true,stopAfterDca:true}),trade=run(d,{stopLossMode:'after_all_dca',stopLossPct:3}).trades[0];
 assert.equal(trade.dcaSteps,2);assert.equal(trade.entries[0].stopLoss,null);assert.equal(trade.exitTime,base+64*60);assert.equal(trade.exitReason,'STOP_LOSS');
 assert.ok(trade.exitPrice>93&&trade.exitPrice<95);
});
test('maximum holding bars in a 1h test still counts hours when DCA uses minutes',()=>{
 const d=dataset({hours:4}),trade=run(d,{maxHoldBars:2}).trades[0];
 assert.equal(trade.exitReason,'TIMEOUT');assert.equal(trade.exitTime,base+3*3600);assert.equal(trade.holdBars,2);
});
test('missing, truncated or gapped minute history cannot silently become an hourly-only test',()=>{
 const d=dataset();assert.throws(()=>E.runBacktest(d.main,d.funding,d.config),/실제 1분봉/);
 const gap={...d,minute:d.minute.filter(b=>b.time!==base+61*60)};assert.throws(()=>run(gap),/1분봉 기록에 공백/);
 assert.throws(()=>run({...d,minute:d.minute.filter(b=>b.time!==base-60)}),/RSI 준비 구간에 공백/);
 assert.throws(()=>run({...d,minute:d.minute.slice(0,-1)}),/종료까지의 1분봉/);
});
test('a 1m test uses the same RSI crossing and fills for chart-RSI and fixed-1m modes',()=>{
 const d=dataset(),cfg={...d.config,timeframe:'1m',splitCount:3};
 const a=E.runBacktest(d.minute,d.funding,{...cfg,splitTrigger:'rsi_cross_up'}),b=E.runBacktest(d.minute,d.funding,{...cfg,splitTrigger:'rsi_cross_up_1m'});
 assert.deepEqual(a.trades,b.trades);assert.deepEqual(a.signals,b.signals);
});
test('comparison and strategy search pass the shared actual minute series to the engine',()=>{
 const d=dataset(),comparison=E.runAllTimeframes({'1m':d.minute,'1h':d.main},d.funding,d.config);
 assert.equal(comparison.results['1h'].trades[0].entries[1].time,base+64*60);
 const found=E.optimizeStrategy(d.main,d.funding,{baseConfig:d.config,minuteCandles:d.minute,splitCounts:[2],rsiOversolds:[30],takeProfitPcts:[0],stopLossPcts:[0],splitTriggers:['rsi_cross_up_1m'],minTrades:1});
 assert.equal(found.totalEvaluated,1);assert.equal(found.bestWinRate.params.splitTrigger,'rsi_cross_up_1m');assert.equal(found.topRankings[0].summary.avgDcaSteps,2);
});
test('minute fills stay at their true time in trades but markers use an existing displayed hourly candle',()=>{
 const d=dataset(),r={...run(d),market:{ex:'BITGET',symbol:'BTCUSDT',int:'1h'}},markers=Overlay.markers(r,d.main);
 assert.ok(markers.some(m=>m.text==='DCA 2'&&m.time===base+3600));assert.ok(markers.every(m=>T.indexAt(d.main,m.time,'1h')>=0&&d.main.some(b=>b.time===m.time)));
 assert.equal(r.signals.find(s=>s.type==='DCA_BUY').time,base+64*60);
});
