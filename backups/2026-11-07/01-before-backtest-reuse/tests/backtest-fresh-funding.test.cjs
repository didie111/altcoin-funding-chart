'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../backtest-engine.js');
const base=Date.UTC(2026,9,20,1)/1000;
function scenario(extra={}){
 const bars=Array.from({length:320},(_,i)=>{const close=200-i*.1;return {time:base+(i-20)*180,open:close,high:close,low:close*.98,close,volume:1};});
 const records=[{time:base,rate:-.6,hours:1},{time:base+7*3600,rate:-.6,hours:1},{time:base+8*3600,rate:-.7,hours:1}],config={timeframe:'3m',startTime:base,endTime:base+12*3600,rsiPeriod:2,rsiOversold:30,entryTrigger:'rsi_oversold',fundingIntervalHours:1,minFundingRate:-.5,fundingWindowSeconds:3600,entryCooldownBars:150,splitCount:1,takeProfitPct:0,stopLossPct:1,feePct:0,slippagePct:0,initialCapital:1000,...extra};
 return {bars,records,config};
}
const run=s=>E.runBacktest(s.bars,s.records,s.config);
test('3m / 150 bars rejects a still-valid settlement from during the wait and accepts a qualifying settlement after the wait',()=>{
 const s=scenario(),r=run(s),legacy=run({...s,config:{...s.config,requireFreshFundingAfterCooldown:false}});
 assert.equal(r.trades[0].fundingCondition.signalTime,base+180);assert.equal(r.trades.length,2);
 assert.equal(r.trades[1].fundingCondition.settleTime,base+8*3600);assert.equal(r.trades[1].fundingCondition.signalTime,base+8*3600);
 assert.equal(legacy.trades[1].fundingCondition.settleTime,base+7*3600);assert.equal(legacy.trades[1].fundingCondition.signalTime,base+152*180);
 assert.ok(r.diagnostics.rejected.funding_before_cooldown>0);assert.ok(r.diagnostics.rejected.entry_cooldown>0);
});
test('no new rate-qualified settlement means no new trade, even with a long original validity window',()=>{
 const s=scenario({fundingWindowSeconds:24*3600});s.records=s.records.slice(0,1);assert.equal(run(s).trades.length,1);
 assert.ok(run({...s,config:{...s.config,requireFreshFundingAfterCooldown:false}}).trades.length>1);
});
test('fresh settlement and its existing validity window are both required; a weak new rate never rearms entry',()=>{
 const s=scenario();s.records=s.records.map(r=>r.time===base+8*3600?{...r,rate:-.2}:r);assert.equal(run(s).trades.length,1);
 const badCycle=scenario();badCycle.records=badCycle.records.map(r=>r.time===base+8*3600?{...r,hours:4}:r);assert.equal(run(badCycle).trades.length,1);
});
test('the settlement exactly at the end of the 150th blocked candle is fresh, and no earlier candle is allowed',()=>{
 const s=scenario(),release=base+151*180;s.records=[s.records[0],{time:release,rate:-.7,hours:1}];const r=run(s);
 assert.equal(r.trades[1].fundingCondition.settleTime,release);assert.equal(r.trades[1].fundingCondition.signalTime,release+180);
});
test('the settlement reuse option remains independent, and zero candle wait imposes no freshness boundary',()=>{
 const s=scenario({oneEntryPerFunding:true}),r=run(s);assert.equal(r.trades.length,2);assert.equal(r.trades[1].fundingCondition.settleTime,base+8*3600);
 const unlimited=scenario({entryCooldownBars:0});unlimited.records=unlimited.records.slice(0,1);const plain=run(unlimited);assert.ok(plain.trades.length>2);assert.equal(plain.diagnostics.rejected.funding_before_cooldown,0);
});
test('new period confirmation does not rebrand an older negative settlement as fresh after the cooldown',()=>{
 const s=scenario();s.records=[s.records[0],{time:base+6*3600,rate:-.7,hours:4},{time:base+8*3600,rate:.01,hours:1}];s.config.fundingTransitionLookbackSeconds=3*3600;
 assert.equal(run(s).trades.length,1);
});
test('freshness uses the main candle wait even when fixed-1m additions execute on minute candles',()=>{
 const s=scenario({splitTrigger:'rsi_cross_up_1m'}),minuteCandles=s.bars.flatMap(b=>[0,60,120].map(offset=>({...b,time:b.time+offset}))),r=E.runBacktest(s.bars,s.records,s.config,{minuteCandles});
 assert.equal(r.model.executionTimeframe,'1m');assert.equal(r.trades[1].fundingCondition.settleTime,base+8*3600);
});
