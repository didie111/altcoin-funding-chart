'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const E=require('../backtest-engine.js'),T=require('../timeframes.js'),B=require('../backtest-bars.js');
// Deterministic regression candles only; never used as exchange data by the app.
const base=T.parseKst('2026-02-03','10:00');
function scenario(extra={},records){
 const closes=[100,95,90,85,80,85,90,95],bars=Array.from({length:120},(_,i)=>{const close=closes[i%closes.length];return {time:base+(i-40)*180,open:close,high:close,low:close,close,volume:1};});
 const config={timeframe:'3m',startTime:base,endTime:base+4*3600,rsiPeriod:2,rsiOversold:30,entryTrigger:'rsi_cross_up',fundingIntervalHours:1,minFundingRate:-.5,fundingWindowSeconds:4*3600,splitCount:1,takeProfitPct:0,stopLossPct:0,maxHoldBars:1,feePct:0,slippagePct:0,initialCapital:1000,...extra};
 return {bars,config,records:records||[{time:base,rate:-.6,hours:1},{time:base+3600,rate:-.7,hours:1},{time:base+7200,rate:-.2,hours:1}]};
}
const run=s=>E.runBacktest(s.bars,s.records,s.config);
test('3m RSI can open only one trade per qualifying 1h settlement, even after the first trade closes',()=>{
 const s=scenario({oneEntryPerFunding:true}),r=run(s),legacy=run({...s,config:{...s.config,oneEntryPerFunding:false}});
 assert.deepEqual(r.trades.map(t=>t.fundingCondition.settleTime),[base,base+3600]);assert.ok(legacy.trades.length>r.trades.length);
 assert.ok(r.diagnostics.rejected.funding_reuse>0);assert.ok(r.diagnostics.samples.some(s=>s.reason==='funding_reuse'));
 assert.ok(r.trades[1].entryTime>=base+3600);assert.ok(r.trades.every(t=>t.entryTime<t.exitTime));
});
test('the new option is off by default, preserves old trades when disabled, and never treats a string as enabled',()=>{
 const s=scenario(),a=run(s),b=run({...s,config:{...s.config,oneEntryPerFunding:false}});
 assert.equal(E.normalizeConfig().oneEntryPerFunding,false);assert.equal(E.normalizeConfig({oneEntryPerFunding:'false'}).oneEntryPerFunding,false);
 assert.deepEqual(a.trades,b.trades);assert.ok(a.trades.length>2);
});
test('a new record at exactly -0.5% rearms entry, while a weak rate or a wrong interval cannot rearm it',()=>{
 const records=[{time:base,rate:-.6,hours:1},{time:base+3600,rate:-.2,hours:1},{time:base+7200,rate:-.8,hours:4},{time:base+10800,rate:-.5,hours:1}],r=run(scenario({oneEntryPerFunding:true},records));
 assert.deepEqual(r.trades.map(t=>t.fundingCondition.settleTime),[base,base+10800]);assert.ok(r.trades[1].entryTime>=base+10800);
 assert.ok(r.diagnostics.rejected.funding_cycle>0);assert.ok(r.diagnostics.rejected.funding_reuse>0);
});
test('falling back to an older unused, longer-lived window never counts as a new funding opportunity',()=>{
 const records=[{time:base,rate:-.8,hours:8},{time:base+3600,rate:-.7,hours:1},{time:base+7200,rate:.01,hours:1}],r=run(scenario({oneEntryPerFunding:true,startTime:base+3600,fundingIntervalHours:0,fundingWindowSeconds:0},records));
 assert.deepEqual(r.trades.map(t=>t.fundingCondition.settleTime),[base+3600]);assert.ok(r.diagnostics.rejected.funding_reuse>0);
});
test('a capital-rejected order does not consume the new settlement without an actual first BUY',()=>{
 const r=run(scenario({oneEntryPerFunding:true,positionSizing:'first_entry',firstEntryAmount:1000,feePct:10}));
 assert.equal(r.trades.length,1);assert.ok(r.trades[0].netPnl<0);assert.ok(r.warnings.skippedInsufficientCapital>1);
 assert.ok(r.diagnostics.samples.filter(s=>s.fundingTime===base+3600&&s.reason==='match').length>1);
});
test('a gap that cancels an unfilled entry still permits a later signal from the same settlement',()=>{
 const s=scenario({oneEntryPerFunding:true}),before=run(s),entryTime=before.trades[0].entryTime;s.bars=s.bars.filter(b=>b.time!==entryTime);const after=run(s);
 assert.equal(after.trades[0].fundingCondition.settleTime,base);assert.ok(after.trades[0].entryTime>entryTime);assert.ok(after.warnings.dataGaps>0);
});
test('ongoing DCA still follows its configured rule after the settlement has been used for the initial BUY',()=>{
 for(const splitTrigger of ['bar','rsi_cross_up','step_pct','rsi_cross_up_1m']){
  const s=scenario({oneEntryPerFunding:true,splitCount:3,splitTrigger,maxHoldBars:24}),minuteCandles=s.bars.flatMap(b=>[0,60,120].map(offset=>({...b,time:b.time+offset}))),context={minuteCandles};
  const r=E.runBacktest(s.bars,s.records,s.config,context),legacy=E.runBacktest(s.bars,s.records,{...s.config,oneEntryPerFunding:false},context);
  assert.ok(r.trades[0].dcaSteps>1,splitTrigger);assert.deepEqual(r.trades[0].entries,legacy.trades[0].entries,splitTrigger);
 }
});
test('comparison and optimization keep the option per run, and a new run starts with no consumed settlements',()=>{
 const s=scenario({oneEntryPerFunding:true}),r=run(s),again=run(s);assert.deepEqual(r.trades,again.trades);
 const compared=E.runAllTimeframes({'3m':s.bars},s.records,s.config);assert.deepEqual(compared.results['3m'].trades,r.trades);
 const found=E.optimizeStrategy(s.bars,s.records,{baseConfig:s.config,splitCounts:[1],rsiOversolds:[30],takeProfitPcts:[0],stopLossPcts:[0],splitTriggers:['bar'],minTrades:1});
 assert.equal(found.topRankings[0].summary.totalTrades,r.trades.length);assert.equal(found.totalEvaluated,1);
});
function pack(rows){const b=B.builder();for(let i=rows.length-1;i>=0;i--)b.push(rows[i]);return b.finish();}
test('packed long-range candles keep the same blocked entries and exact trade results',()=>{
 const s=scenario({oneEntryPerFunding:true}),plain=run(s),packed=E.runBacktest(pack(s.bars),s.records,s.config);
 assert.deepEqual(packed.trades,plain.trades);assert.deepEqual(packed.diagnostics,plain.diagnostics);
});
test('the real worker applies the option in single, comparison and optimization modes',()=>{
 const s=scenario({oneEntryPerFunding:true}),answers=[],ctx={onmessage:null,postMessage:value=>answers.push(value)};vm.createContext(ctx);
 ctx.importScripts=(...urls)=>{for(const url of urls)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',url.split('?')[0]),'utf8'),ctx);};
 vm.runInContext(fs.readFileSync(require.resolve('../backtest-worker.js'),'utf8'),ctx);
 const dataset={timeframeCandles:{'3m':pack(s.bars)},fundingRecords:s.records};
 for(const mode of ['single','compare','optimize']){
  ctx.onmessage({data:{id:mode,mode,dataset,config:s.config}});const packet=answers.at(-1);assert.equal(packet.error,undefined,mode);
  if(mode==='single'){assert.equal(packet.result.config.oneEntryPerFunding,true);assert.equal(packet.result.trades.length,2);}
  else if(mode==='compare'){assert.equal(packet.result.results['3m'].config.oneEntryPerFunding,true);assert.equal(packet.result.results['3m'].trades.length,2);}
  else{assert.ok(packet.result.topRankings.length>0);assert.ok(packet.result.topRankings.every(r=>r.summary.totalTrades<=2));}
 }
});
test('the actual settings functions read, save and restore both states of the new checkbox',()=>{
 const source=fs.readFileSync(require.resolve('../backtest-ui.js'),'utf8'),nodes=new Map(),values=new Map(),market={ex:'BITGET',symbol:'BTCUSDT',int:'3m'};
 const ctx={E,M:require('../dashboard-model.js'),strategy:E.normalizeConfig(),follow:true,custom:null,target:()=>market,chartWorkspace:{activeMarket:()=>market},$:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},form:{elements:{capital:{value:'1000'},orderSize:{value:'10'},commission:{value:'0.05'},slippage:{value:'0.03'}}},root:{localStorage:{setItem:(k,v)=>values.set(k,v)}},key:'test-settings',toggleTarget(){},preview(){},updateTarget(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  const names='),source.indexOf('  function preview()'))+source.slice(source.indexOf('  function populateSettings()'),source.indexOf("  form.addEventListener('input'")),ctx);
 ctx.populateSettings();assert.equal(nodes.get('btOneEntryPerFunding').checked,false);
 for(const enabled of [true,false]){nodes.get('btOneEntryPerFunding').checked=enabled;const next=ctx.readSettings();assert.equal(next.strategy.oneEntryPerFunding,enabled);ctx.settingsSaved(next);ctx.strategy=E.normalizeConfig(JSON.parse(values.get('test-settings')));nodes.get('btOneEntryPerFunding').checked=!enabled;ctx.populateSettings();assert.equal(nodes.get('btOneEntryPerFunding').checked,enabled);}
});
