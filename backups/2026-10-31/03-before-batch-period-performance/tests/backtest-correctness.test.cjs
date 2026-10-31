'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../backtest-engine.js'),Overlay=require('../backtest-overlay.js');
// Deterministic accounting fixtures only; never used by the application as market data.
const base=Date.UTC(2026,9,20)/1000;
function scenario(extra={},changes={}){const bars=Array.from({length:12},(_,i)=>{const p=i<3?102-i:100;return {time:base+i*60,open:p,high:p,low:p,close:p,volume:1,...changes[i]};});const config={timeframe:'1m',rsiPeriod:2,rsiOversold:30,entryTrigger:'rsi_oversold',splitTrigger:'bar',splitCount:1,takeProfitPct:0,stopLossPct:0,maxHoldBars:0,feePct:0,slippagePct:0,initialCapital:1000,fundingIntervalHours:1,fundingWindowSeconds:86400,...extra};return {bars,config,funding:[{time:base-60,rate:-.5,fundingIntervalHours:1,markPrice:100}]};}
const run=(s,records=s.funding)=>E.runBacktest(s.bars,records,s.config),first=s=>run(s).trades[0];
test('zero or one split means exactly one entry; counts above ten are rejected',()=>{
 for(const splitCount of [0,1])assert.equal(first(scenario({splitCount})).dcaSteps,1);
 assert.throws(()=>E.normalizeConfig({splitCount:11}),/splitCount/);
});
test('martingale uses 10, 10, 20, 40, 80 dollars and never allocates more than the account',()=>{
 const t=first(scenario({splitCount:5,dcaMethod:'martingale',positionSizing:'first_entry',firstEntryAmount:10}));
 assert.deepEqual(t.entries.map(e=>Math.round(e.cost)),[10,10,20,40,80]);assert.equal(t.totalCost,160);assert.equal(t.avgEntryPrice,100);
 assert.throws(()=>E.normalizeConfig({initialCapital:100,splitCount:5,dcaMethod:'martingale',positionSizing:'first_entry',firstEntryAmount:10}),/초과/);
});
test('stop monitoring starts on the first fill or only once all planned fills complete',()=>{
 const changes={4:{open:97,high:98,low:96,close:97},5:{open:94,high:95,low:93,close:94}},opts={splitCount:3,stopLossPct:1};
 const a=first(scenario({...opts,stopLossMode:'immediate'},changes)),b=first(scenario({...opts,stopLossMode:'after_all_dca'},changes));
 assert.equal(a.exitReason,'STOP_LOSS');assert.equal(a.dcaSteps,1);assert.equal(a.exitPrice,97);
 assert.equal(b.exitReason,'STOP_LOSS');assert.equal(b.dcaSteps,3);assert.equal(b.entries[0].stopLoss,null);assert.equal(b.entries[1].stopLoss,null);assert.ok(b.entries[2].stopLoss>0);
});
test('partial position TP is two percent above the filled weighted average, not the full planned budget',()=>{
 const t=first(scenario({splitCount:5,splitTrigger:'rsi_cross_up',takeProfitPct:2},{4:{open:100,high:103,low:100,close:102}}));
 assert.equal(t.dcaSteps,1);assert.equal(t.exitReason,'TAKE_PROFIT');assert.equal(t.exitPrice,102);assert.equal(t.totalCost,200);assert.ok(Math.abs(t.netPnl-4)<1e-9);
});
test('DCA reweights by quantity and never uses a pre-entry high to invent a same-bar TP',()=>{
 const t=first(scenario({splitCount:2,splitTrigger:'step_pct',splitStepPct:5,takeProfitPct:5,stopLossMode:'after_all_dca'},{4:{open:100,high:103,low:90,close:90},5:{open:90,high:90,low:90,close:90},6:{open:90,high:90,low:90,close:90},7:{open:90,high:90,low:90,close:90},8:{open:90,high:90,low:90,close:90},9:{open:90,high:90,low:90,close:90},10:{open:90,high:90,low:90,close:90},11:{open:90,high:90,low:90,close:90}}));
 assert.equal(t.entries[1].time,base+5*60);assert.ok(Math.abs(t.avgEntryPrice-1000/(500/100+500/90))<1e-9);assert.equal(t.exitReason,'END_OF_TEST');
});
test('a bar touching both TP and SL uses SL; a known opening gap above TP exits at the open first',()=>{
 const a=first(scenario({takeProfitPct:2,stopLossPct:3},{4:{open:100,high:105,low:95,close:100}}));assert.equal(a.exitReason,'STOP_LOSS');assert.equal(a.exitPrice,97);assert.equal(a.ambiguousBar,true);
 const b=first(scenario({takeProfitPct:2,stopLossPct:3},{4:{open:105,high:106,low:90,close:100}}));assert.equal(b.exitReason,'TAKE_PROFIT');assert.equal(b.exitPrice,105);
});
test('funding counts only after entry, includes positive-rate payments, and never credits old settlements',()=>{
 const s=scenario({initialCapital:100}),records=[...s.funding,{time:base+4*60,rate:1,fundingIntervalHours:1,markPrice:100},{time:base+5*60,rate:-2,fundingIntervalHours:1,markPrice:100}];
 const t=run(s,records).trades[0];assert.equal(t.entryTime,base+3*60);assert.equal(t.fundingEventsCount,2);assert.ok(Math.abs(t.fundingEarned-1)<1e-9);assert.ok(Math.abs(t.netPnl-1)<1e-9);
});
test('a profitable SL remains an SL label and a loss-making TP remains a TP label',()=>{
 const s=scenario({stopLossPct:3,initialCapital:100},{4:{open:100,high:100,low:97,close:98}}),r=run(s,[...s.funding,{time:base+4*60,rate:-10,fundingIntervalHours:1,markPrice:100}]);
 assert.equal(r.trades[0].exitReason,'STOP_LOSS');assert.ok(r.trades[0].netPnl>0);assert.match(E.signalLabel(r.signals.find(x=>x.type==='EXIT')),/^SL/);
 const t=first(scenario({takeProfitPct:1,feePct:2},{4:{open:100,high:102,low:100,close:101}}));assert.equal(t.exitReason,'TAKE_PROFIT');assert.ok(t.netPnl<0);assert.match(E.signalLabel({type:'EXIT',reason:t.exitReason}),/^TP/);
});
test('future negative funding never opens a position before the settlement is known',()=>{
 const s=scenario(),r=run(s,[{time:base,rate:.01,fundingIntervalHours:1},{time:base+600,rate:-1,fundingIntervalHours:1}]);
 assert.ok(r.trades.every(t=>t.entryTime>=base+600));assert.ok(r.trades.length>0);
});
test('starting, gross profits, losses and ending money reconcile even with partial DCA and costs',()=>{
 const r=run(scenario({splitCount:3,feePct:.05,slippagePct:.03,takeProfitPct:1,stopLossPct:1},{4:{open:100,high:103,low:100,close:102},5:{open:102,high:102,low:98,close:99}})),s=r.summary;
 assert.ok(Math.abs(s.finalCapital-(s.initialCapital+s.netPnl))<1e-8);assert.ok(Math.abs(s.netPnl-(s.grossProfit-s.grossLoss))<1e-8);
 for(const t of r.trades)assert.ok(Math.abs(t.netPnl-(t.pricePnl-t.entryFees-t.exitFee+t.fundingEarned))<1e-8);
});
test('chart annotations use exit reason and appear only on the matching exchange, symbol and timeframe',()=>{
 const s=scenario({stopLossPct:3},{4:{open:100,high:100,low:97,close:98}}),r={...run(s),market:{ex:'BITGET',symbol:'BTCUSDT',int:'1m'}};
 const markers=Overlay.markers(r,s.bars);assert.match(markers.find(m=>m.text.startsWith('SL')).text,/손절/);
 assert.equal(Overlay.matches(r,{ex:'BITGET',symbol:'BTC-USDT',int:'1m'}),true);assert.equal(Overlay.matches(r,{ex:'BINANCE',symbol:'BTCUSDT',int:'1m'}),false);assert.equal(Overlay.matches(r,{ex:'BITGET',symbol:'BTCUSDT',int:'3m'}),false);
});
