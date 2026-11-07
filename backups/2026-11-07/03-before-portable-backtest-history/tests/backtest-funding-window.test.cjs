'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../backtest-engine.js');
// Regression fixtures only: the application always loads actual exchange records.
const base=Date.UTC(2026,9,22)/1000;
const records=[{time:base-4*3600,rate:.01},{time:base,rate:-1},{time:base+3600,rate:-.1},{time:base+7200,rate:.01},{time:base+10800,rate:-.1},{time:base+14400,rate:-.1}];
function run(tf='1m',cross=base+90*60,extra={},funding=records){
 const step=tf==='1m'?60:180,count=70,bars=Array.from({length:count},(_,i)=>{const time=cross+(i-45)*step,close=i<45?150-i:105+(i-44)*4;return {time,open:close,high:close,low:close,close,volume:1};});
 return E.runBacktest(bars,funding,{timeframe:tf,rsiPeriod:14,rsiOversold:30,entryTrigger:'rsi_cross_up',fundingIntervalHours:1,fundingWindowSeconds:240*60,minFundingRate:-.5,splitCount:1,splitTrigger:'step_pct',takeProfitPct:0,stopLossPct:0,maxHoldBars:0,feePct:0,slippagePct:0,...extra});
}
test('1m and 3m can use a still-valid negative settlement after the observed funding interval changes from 4h to 1h',()=>{
 for(const tf of ['1m','3m']){
  const r=run(tf);assert.equal(r.trades.length,1,tf);const condition=r.trades[0].fundingCondition;
  assert.equal(condition.settleTime,base);assert.equal(condition.rate,-1);assert.equal(condition.intervalHours,1);assert.ok(condition.signalTime>=base+3600);assert.equal(condition.validUntil,base+14400);
  assert.equal(r.diagnostics.entrySignals,1);assert.equal(r.diagnostics.samples.find(s=>s.reason==='match').fundingRate,-1);
  assert.equal(run(tf,base+90*60,{fundingIntervalHours:4}).trades.length,0,'4h no longer matches a known 1h signal-time interval');
 }
});
test('a newer positive or small negative settlement does not erase the configured 240-minute signal window',()=>{
 for(const rate of [.01,-.1]){const f=records.map(r=>r.time>base?{...r,rate}:r);assert.equal(run('3m',base+150*60,{},f).trades.length,1);}
});
test('the 1h condition never borrows the next settlement to classify an earlier RSI cross',()=>{
 const before=base+20*60,a=run('1m',before),b=run('1m',before,{},records.filter(r=>r.time<=base));
 assert.equal(a.trades.length,0);assert.equal(b.trades.length,0);assert.equal(a.diagnostics.rejected.funding_cycle,1);assert.equal(a.diagnostics.samples[0].intervalHours,4);
 assert.equal(run('1m',before,{fundingIntervalHours:4}).trades.length,1);
});
test('an expired negative settlement is rejected, even if the current interval and RSI match',()=>{
 const r=run('3m',base+5*3600);assert.equal(r.trades.length,0);assert.equal(r.diagnostics.rejected.funding_window,1);assert.equal(r.diagnostics.samples[0].validUntil,base+14400);
});
test('overlapping windows can fall back to an older longer-lived signal without exceeding its expiry',()=>{
 const f=[{time:base,rate:-.8,hours:8},{time:base+3600,rate:-.7,hours:1},{time:base+7200,rate:.01,hours:1},{time:base+10800,rate:.01,hours:1}];
 const r=run('1m',base+200*60,{fundingWindowSeconds:0},f);assert.equal(r.trades.length,1);assert.equal(r.trades[0].fundingCondition.settleTime,base);assert.equal(r.trades[0].fundingCondition.validUntil,base+8*3600);
});
test('a later 4h interval gates the same still-valid signal in the reverse direction',()=>{
 const f=[{time:base,rate:-1,hours:1},{time:base+4*3600,rate:.01,hours:4}];
 assert.equal(run('3m',base+5*3600,{fundingWindowSeconds:8*3600,fundingIntervalHours:1},f).trades.length,0);
 assert.equal(run('3m',base+5*3600,{fundingWindowSeconds:8*3600,fundingIntervalHours:4},f).trades.length,1);
});
test('the threshold remains inclusive and future negative rates cannot create an earlier entry',()=>{
 for(const [rate,expected]of [[-.5,1],[-.499999,0]])assert.equal(run('1m',base+90*60,{},records.map(r=>r.time===base?{...r,rate}:r)).trades.length,expected);
 assert.equal(run('1m',base+20*60,{},[{time:base,rate:.01,hours:1},{time:base+3600,rate:-1,hours:1}]).trades.length,0);
});
test('session expiry is exclusive and an unknown interval is never replaced with a future interval',()=>{
 const windows=E.identifyFundingSessions(records,{fundingIntervalHours:1,fundingWindowSeconds:14400,minFundingRate:-.5});
 assert.equal(windows.length,1);assert.equal(windows[0].startTime,base+3600);assert.equal(windows[0].endTime,base+14400);
 assert.equal(E.identifyFundingSessions([{time:base,rate:-1}],{fundingIntervalHours:1}).length,0);
});
test('optional chart comparison matches historical observations and explicitly identifies the future-interval input',()=>{
 for(const tf of ['1m','3m']){
  assert.equal(run(tf,base+20*60).trades.length,0);
  const r=run(tf,base+20*60,{fundingIntervalBasis:'chart'});assert.equal(r.trades.length,1);assert.equal(r.model.futureIntervalObservations,true);
  assert.equal(r.trades[0].fundingCondition.intervalSource,'retrospective');assert.equal(r.trades[0].fundingCondition.intervalHours,1);assert.equal(r.trades[0].fundingCondition.settleTime,base);
 }
 assert.equal(run('1m',base-20*60,{fundingIntervalBasis:'chart'}).trades.length,0,'even retrospective interval matching cannot borrow a future negative rate');
 assert.equal(run().model.futureIntervalObservations,false);assert.throws(()=>E.normalizeConfig({fundingIntervalBasis:'made-up'}),/fundingIntervalBasis/);
});
test('chart comparison leaves isolated 2h gaps unknown, using the same observations as the chart',()=>{
 let time=base;const f=[{time,rate:-1},...[1,1,2,4,4].map(h=>({time:time+=h*3600,rate:-1}))];
 const sessions=E.identifyFundingSessions(f,{fundingIntervalBasis:'chart',fundingIntervalHours:2,fundingWindowSeconds:86400});assert.deepEqual(sessions,[]);
});
