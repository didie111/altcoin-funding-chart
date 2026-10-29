'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../backtest-engine.js');
const base=Date.UTC(2026,9,20)/1000;
const records=[{time:base-5*3600,rate:.01,hours:4},{time:base-3600,rate:-.6,hours:4},{time:base,rate:.01,hours:1},{time:base+3600,rate:.01,hours:1}];
const config={fundingIntervalHours:1,minFundingRate:-.5,fundingWindowSeconds:3600,fundingTransitionLookbackSeconds:3600};
test('a negative settlement exactly one hour before 4h→1h confirmation arms RSI only from confirmation',()=>{
 const windows=E.identifyFundingSessions(records,config);assert.equal(windows.length,1);const w=windows[0];
 assert.equal(w.startTime,base);assert.equal(w.endTime,base+3600);assert.equal(w.settleTime,base-3600);assert.equal(w.transitionTime,base);
 assert.equal(E.fundingSessionAt(windows,base-1),null);assert.equal(E.fundingSessionAt(windows,base),w);assert.equal(E.fundingSessionAt(windows,base+3599),w);assert.equal(E.fundingSessionAt(windows,base+3600),null);
 assert.equal(E.identifyFundingSessions(records,{...config,fundingTransitionLookbackSeconds:0}).length,0);
});
test('transition carry never borrows future confirmation, weak rates, older records or an unrelated cycle',()=>{
 assert.equal(E.identifyFundingSessions(records.slice(0,2),config).length,0);
 assert.equal(E.identifyFundingSessions(records.map(r=>r.rate<0?{...r,rate:-.49}:r),config).length,0);
 assert.equal(E.identifyFundingSessions(records,{...config,fundingTransitionLookbackSeconds:3599}).length,0);
 assert.equal(E.identifyFundingSessions(records,{...config,fundingIntervalHours:8}).length,0);
});
test('an existing longer signal window keeps its original expiry and a fresh negative at transition uses its own record',()=>{
 const kept=E.identifyFundingSessions(records,{...config,fundingWindowSeconds:4*3600});assert.equal(kept[0].validUntil,base+3*3600);assert.equal(kept[0].transitionTime,undefined);
 const fresh=E.identifyFundingSessions(records.map(r=>r.time===base?{...r,rate:-.7}:r),config);assert.equal(fresh[0].settleTime,base);assert.equal(fresh[0].transitionTime,undefined);
});
test('a reverse transition can use the same rule for the chosen 4h target',()=>{
 const reverse=records.map(r=>({...r,hours:r.time<base?1:4}));const w=E.identifyFundingSessions(reverse,{...config,fundingIntervalHours:4});assert.equal(w[0].startTime,base);assert.equal(w[0].intervalHours,4);
});
test('the carried settlement retains its identity under the no-reuse and candle-cooldown options',()=>{
 const bars=Array.from({length:160},(_,i)=>{const time=base+(i-80)*60,close=200-i*.1;return {time,open:close,high:close,low:close*.98,close,volume:1};});
 const options={...config,timeframe:'1m',startTime:base,endTime:base+3600,rsiPeriod:2,entryTrigger:'rsi_oversold',splitCount:1,takeProfitPct:0,stopLossPct:1,feePct:0,slippagePct:0,oneEntryPerFunding:true,entryCooldownBars:3,requireFreshFundingAfterCooldown:false};
 const r=E.runBacktest(bars,records,options);assert.equal(r.trades.length,1);assert.equal(r.trades[0].fundingCondition.settleTime,base-3600);assert.equal(r.trades[0].fundingCondition.transitionTime,base);assert.ok(r.diagnostics.rejected.funding_reuse>0);assert.ok(r.diagnostics.rejected.entry_cooldown>0);
});
