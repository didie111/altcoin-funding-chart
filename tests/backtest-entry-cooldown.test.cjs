'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const E=require('../backtest-engine.js'),T=require('../timeframes.js'),B=require('../backtest-bars.js');
// Deterministic fixtures are only for regression tests, never market data.
const base=T.parseKst('2026-02-03','10:00');
function scenario(extra={},records){
 const tf=extra.timeframe||'3m',start=tf==='1M'?Date.UTC(2020,0,1)/1000:T.start(base,tf);
 const bars=Array.from({length:100},(_,i)=>{const close=100-i*.1;return {time:T.shift(start,tf,i-20),open:close,high:close,low:close*.98,close,volume:1};});
 const config={timeframe:tf,startTime:start,endTime:T.shift(start,tf,75),rsiPeriod:2,rsiOversold:30,entryTrigger:'rsi_oversold',fundingIntervalHours:1,minFundingRate:-.5,fundingWindowSeconds:3600,splitCount:1,takeProfitPct:0,stopLossPct:1,maxHoldBars:0,feePct:0,slippagePct:0,initialCapital:1000,...extra};
 return {bars,config,records:records||bars.map(b=>({time:b.time,rate:-.6,hours:config.fundingIntervalHours||1}))};
}
const run=s=>E.runBacktest(s.bars,s.records,s.config),pack=rows=>{const b=B.builder();for(let i=rows.length-1;i>=0;i--)b.push(rows[i]);return b.finish();};
const indices=(s,r)=>r.trades.map(t=>s.bars.findIndex(b=>T.end(b.time,s.config.timeframe)===t.fundingCondition.signalTime));
test('3m waits exactly the next three candle closes, survives immediate SL, and blocked signals never extend the wait',()=>{
 const s=scenario({entryCooldownBars:3}),r=run(s),signals=r.trades.map(t=>t.fundingCondition.signalTime);
 assert.deepEqual(signals.slice(0,3),[base+180,base+900,base+1620]);
 assert.ok(r.trades.every(t=>t.exitReason==='STOP_LOSS'));assert.ok(r.diagnostics.rejected.entry_cooldown>0);
 const first=signals[0];assert.deepEqual(r.diagnostics.samples.filter(v=>v.reason==='entry_cooldown').slice(-3).map(v=>v.reason),['entry_cooldown','entry_cooldown','entry_cooldown']);
 assert.ok(signals.every((t,i)=>!i||t-signals[i-1]===720));assert.equal(first,r.trades[0].entryTime);
});
test('zero is disabled and invalid, fractional or unbounded candle counts are rejected',()=>{
 assert.equal(E.normalizeConfig().entryCooldownBars,0);assert.equal(E.normalizeConfig({entryCooldownBars:'3'}).entryCooldownBars,3);
 for(const value of [-1,1.5,Infinity,NaN,'wrong',1000001])assert.throws(()=>E.normalizeConfig({entryCooldownBars:value}),/entryCooldownBars/);
 const s=scenario(),a=run(s),b=run({...s,config:{...s.config,entryCooldownBars:0}});assert.deepEqual(a,b);assert.ok(a.trades.length>50);assert.equal(a.diagnostics.rejected.entry_cooldown,0);
});
for(const timeframe of Object.keys(T.seconds))test(timeframe+' counts actual test candles, including calendar weeks and months',()=>{
 const s=scenario({timeframe,entryCooldownBars:3}),r=run(s),idx=indices(s,r);
 assert.ok(idx.length>3);assert.ok(idx.every((n,i)=>!i||n-idx[i-1]===4));assert.equal(r.model.entryCooldown.timeframe,timeframe);
});
test('a new qualifying settlement cannot bypass the wait and is not consumed while waiting',()=>{
 const records=[{time:base,rate:-.6,hours:1},{time:base+3600,rate:-.7,hours:1},{time:base+7200,rate:-.2,hours:1}];
 const s=scenario({entryCooldownBars:24,oneEntryPerFunding:true,fundingWindowSeconds:4*3600},records),r=run(s);
 assert.equal(r.trades.length,2);assert.deepEqual(r.trades.map(t=>t.fundingCondition.settleTime),[base,base+3600]);
 assert.equal(r.trades[1].fundingCondition.signalTime,base+180+25*180);assert.ok(r.diagnostics.rejected.entry_cooldown>0);assert.ok(r.diagnostics.rejected.funding_reuse>0);
});
test('finishing the candle wait never rearms an already used settlement when both options are on',()=>{
 const s=scenario({entryCooldownBars:3,oneEntryPerFunding:true,fundingWindowSeconds:4*3600},[{time:base,rate:-.6,hours:1}]),r=run(s);
 assert.equal(r.trades.length,1);assert.ok(r.diagnostics.rejected.entry_cooldown>0);assert.ok(r.diagnostics.rejected.funding_reuse>0);
});
for(const hours of [1,2,4,8,12,24])test(hours+'h settlement reuse rule honors configurable -0.5% and -0.6% thresholds',()=>{
 for(const rate of [-.5,-.6]){
  const records=[{time:base,rate,hours},{time:base+3600,rate:rate+.1,hours},{time:base+7200,rate:rate-.1,hours}];
  const r=run(scenario({fundingIntervalHours:hours,minFundingRate:rate,oneEntryPerFunding:true,fundingWindowSeconds:4*3600},records));
  assert.deepEqual(r.trades.map(t=>t.fundingCondition.settleTime),[base,base+7200]);
 }
});
test('1m execution for fixed-1m DCA still measures the wait using 3m signal candles',()=>{
 const s=scenario({entryCooldownBars:3,splitTrigger:'rsi_cross_up_1m'}),minuteCandles=s.bars.flatMap(b=>[0,60,120].map(offset=>({...b,time:b.time+offset}))),r=E.runBacktest(s.bars,s.records,s.config,{minuteCandles}),idx=indices(s,r);
 assert.equal(r.model.executionTimeframe,'1m');assert.ok(idx.length>3);assert.ok(idx.every((n,i)=>!i||n-idx[i-1]===4));
});
test('DCA remains unchanged for all entry modes while the initial-entry cooldown is active',()=>{
 const closes=[100,95,90,85,80,85,90,95],bars=Array.from({length:120},(_,i)=>{const close=closes[i%8];return {time:base+(i-40)*180,open:close,high:close,low:close,close,volume:1};}),records=[{time:base,rate:-.6,hours:1}],minuteCandles=bars.flatMap(b=>[0,60,120].map(offset=>({...b,time:b.time+offset})));
 for(const splitTrigger of ['bar','rsi_cross_up','step_pct','rsi_cross_up_1m']){
  const config={...scenario().config,entryTrigger:'rsi_cross_up',splitCount:3,splitTrigger,stopLossPct:0,maxHoldBars:24,fundingWindowSeconds:4*3600},legacy=E.runBacktest(bars,records,config,{minuteCandles}),limited=E.runBacktest(bars,records,{...config,entryCooldownBars:1000000,oneEntryPerFunding:true},{minuteCandles});
  assert.ok(limited.trades[0].dcaSteps>1,splitTrigger);assert.deepEqual(limited.trades[0].entries,legacy.trades[0].entries,splitTrigger);
 }
});
test('a failed first fill never starts a new wait',()=>{
 const s=scenario({entryCooldownBars:3,positionSizing:'first_entry',firstEntryAmount:1000}),r=run(s);
 assert.equal(r.trades.length,1);assert.ok(r.warnings.skippedInsufficientCapital>10);
 assert.ok(r.diagnostics.samples.every(v=>v.reason==='match'));
});
test('cancelled pending entry before a gap does not start the wait; actual prior entries keep their wait',()=>{
 const s=scenario({entryCooldownBars:10}),initial=run(s),first=initial.trades[0].entryTime;
 const cancelled=run({...s,bars:s.bars.filter(b=>b.time!==first)});assert.ok(cancelled.trades[0].entryTime>first);assert.ok(cancelled.trades[0].entryTime<first+10*180);
 const missing=first+180,after=run({...s,bars:s.bars.filter(b=>b.time!==missing)}),idx=indices({...s,bars:s.bars.filter(b=>b.time!==missing)},after);
 assert.ok(after.warnings.dataGaps>0);assert.ok(idx.every((n,i)=>!i||n-idx[i-1]>10));
});
test('expired funding and RSI conditions are checked anew after the wait, without queuing old signals',()=>{
 const s=scenario({entryCooldownBars:24,fundingWindowSeconds:3600},[{time:base,rate:-.6,hours:1}]),r=run(s);
 assert.equal(r.trades.length,1);assert.ok(r.diagnostics.rejected.funding_window>0);
 const rising=s.bars.map(b=>b.time>=base+1800?{...b,open:200,high:200,low:200,close:200}:b),noReplay=run({...s,bars:rising,config:{...s.config,fundingWindowSeconds:4*3600}});
 assert.equal(noReplay.trades.length,1);
});
test('packed input, repeated runs, comparison and optimization apply independent candle waits',()=>{
 const s=scenario({entryCooldownBars:3}),plain=run(s),packed=E.runBacktest(pack(s.bars),s.records,s.config);
 assert.deepEqual(packed,plain);assert.deepEqual(run(s),plain);
 const second=scenario({timeframe:'5m',entryCooldownBars:3}),records=[...s.records,...second.records],compared=E.runAllTimeframes({'3m':s.bars,'5m':second.bars},records,s.config);
 for(const [tf,res]of Object.entries(compared.results)){const same=E.runBacktest(tf==='3m'?s.bars:second.bars,records,{...s.config,timeframe:tf});assert.deepEqual(res,same);}
 const found=E.optimizeStrategy(s.bars,s.records,{baseConfig:s.config,splitCounts:[1],rsiOversolds:[30],takeProfitPcts:[0],stopLossPcts:[1],splitTriggers:['bar'],minTrades:1});
 assert.equal(found.topRankings[0].summary.totalTrades,plain.trades.length);
});
test('the real worker keeps the candle wait in single, comparison and optimization calculations',()=>{
 const s=scenario({entryCooldownBars:3}),answers=[],ctx={onmessage:null,postMessage:value=>answers.push(value)};vm.createContext(ctx);
 ctx.importScripts=(...urls)=>{for(const url of urls)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',url.split('?')[0]),'utf8'),ctx);};vm.runInContext(fs.readFileSync(require.resolve('../backtest-worker.js'),'utf8'),ctx);
 const dataset={timeframeCandles:{'3m':pack(s.bars)},fundingRecords:s.records},direct=run(s);
 for(const mode of ['single','compare','optimize']){ctx.onmessage({data:{id:mode,mode,dataset,config:s.config}});const packet=answers.at(-1);assert.equal(packet.error,undefined,mode);
  if(mode==='single')assert.equal(packet.result.summary.totalTrades,direct.summary.totalTrades);
  else if(mode==='compare')assert.equal(packet.result.results['3m'].config.entryCooldownBars,3);
  else assert.ok(packet.result.topRankings.length>0);
 }
});
test('actual UI settings persist the count alongside the independent settlement reuse option',()=>{
 const source=fs.readFileSync(require.resolve('../backtest-ui.js'),'utf8'),nodes=new Map(),values=new Map(),market={ex:'BITGET',symbol:'BTCUSDT',int:'3m'},ctx={E,M:require('../dashboard-model.js'),strategy:E.normalizeConfig(),follow:true,followTimeframe:true,custom:null,target:()=>market,chartWorkspace:{activeMarket:()=>market},$:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},form:{elements:{capital:{value:'1000'},orderSize:{value:'10'},commission:{value:'.05'},slippage:{value:'.03'}}},root:{localStorage:{setItem:(k,v)=>values.set(k,v)}},key:'test-settings',toggleTarget(){},preview(){},updateTarget(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  const names='),source.indexOf('  function preview()'))+source.slice(source.indexOf('  function populateSettings()'),source.indexOf("  form.addEventListener('input'")),ctx);
 ctx.populateSettings();assert.equal(nodes.get('btEntryCooldownBars').value,0);
 for(const [count,once]of [[3,true],[15,false],[0,true]]){nodes.get('btEntryCooldownBars').value=String(count);nodes.get('btOneEntryPerFunding').checked=once;ctx.settingsSaved(ctx.readSettings());ctx.strategy=E.normalizeConfig(JSON.parse(values.get('test-settings')));nodes.get('btEntryCooldownBars').value='999';ctx.populateSettings();assert.equal(nodes.get('btEntryCooldownBars').value,count);assert.equal(nodes.get('btOneEntryPerFunding').checked,once);}
});
