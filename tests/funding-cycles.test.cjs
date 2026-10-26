'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),F=require('../funding.js');
const start=Date.UTC(2026,0,1)/1000;
function rows(gaps){let time=start;return [{time,rate:-.5},...gaps.map(hours=>({time:time+=hours*3600,rate:-.5}))];}
test('an isolated two-hour gap at a 1h to 4h boundary stays unknown and never creates a 2h to 4h marker',()=>{
 const records=rows([1,1,2,4,4]),periods=F.observedCycles(records);
 assert.deepEqual(periods.map(p=>p.hours),[1,1,null,4,4]);assert.equal(periods[2].observedHours,2);assert.equal(periods[2].source,'unconfirmed');
 assert.ok(F.cycleTransitions(periods).every(t=>t.from!==2&&t.to!==2));assert.ok(records.every(r=>r.rate===-.5));
});
test('a missing hourly settlement does not turn into a two-hour period',()=>{
 const periods=F.observedCycles(rows([1,1,2,1,1]));assert.equal(periods[2].hours,null);assert.equal(F.cycleTransitions(periods).length,0);
});
test('repeated actual two-hour records remain supported as observations rather than official changes',()=>{
 const periods=F.observedCycles(rows([2,2,4,4]));assert.deepEqual(periods.map(p=>p.hours),[2,2,4,4]);
 const changes=F.cycleTransitions(periods);assert.equal(changes.length,1);assert.deepEqual(changes[0],{time:start+8*3600,from:2,to:4,source:'observed'});
 assert.ok(periods.every(p=>p.source==='observed'));
});
test('all supported observed intervals need consecutive repetition and an incomplete tail stays unknown',()=>{
 for(const hours of [1,2,4,6,8,12,24]){
  assert.equal(F.observedCycles(rows([hours]))[0].hours,null);
  assert.ok(F.observedCycles(rows([hours,hours])).every(p=>p.hours===hours));
 }
 assert.equal(F.observedCycles(rows([1,1,2])).at(-1).hours,null);
});
function chartHarness(gaps){
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8'),T=require('../timeframes.js'),records=rows(gaps);let markers=[],data=[];
 const ctx={FundingEngine:F,ChartData:require('../chart-data.js'),TimeframeEngine:T,historyState:{},fundingSession:null,officialCycle:null,otherCycles:[],rates:records,all:Array.from({length:gaps.reduce((a,b)=>a+b,0)+1},(_,i)=>({time:start+i*3600})),cycleCaption:{},updateCycleBadge(){},duration:T.seconds,$:()=>({value:'1h'}),settlementCycle:{setData:values=>data=values},cycleMarkers:{setMarkers:values=>markers=values},lowerBound:(a,t)=>{const index=a.findIndex(r=>r.time>=t);return index<0?a.length:index;}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function observedCycles('),source.indexOf('function resetScales(')),ctx);ctx.rebuildCycles();ctx.renderCycles(ctx.all);return {ctx,markers:()=>markers,data:()=>data};
}
test('the chart leaves an isolated 2h interval blank and removes its misleading transition marker',()=>{
 const h=chartHarness([1,1,2,4,4]);assert.equal(h.ctx.cycleValues.has(start+2*3600),false);assert.equal(h.ctx.cycleValues.has(start+3*3600),false);
 assert.equal(h.data().find(r=>r.time===start+2*3600).value,undefined);assert.ok(h.markers().every(m=>!m.text.includes('2h')));
});
test('the chart labels repeated historical changes as observations, not official settlement policy',()=>{
 const h=chartHarness([2,2,4,4]);assert.equal(h.ctx.cycleValues.get(start).hours,2);assert.equal(h.markers().length,1);assert.equal(h.markers()[0].text,'관측 2h → 4h');
});
test('the current badge separates official two-hour data, observed estimates and unavailable values',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 const badge={style:{},classList:{toggle(){}}},ctx={cycleBadge:badge,cycleHistory:[{hours:2}],cycleTransitions:[],officialCycle:null,otherCycles:[],currentCyclePeriod:()=>null,$:()=>({value:'BYBIT',selectedOptions:[{text:'Bybit'}]}),cycleColor:()=> '#a78bfa'};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function updateCycleBadge('),source.indexOf('const CYCLE_EXCHANGES=')),ctx);
 ctx.updateCycleBadge();assert.equal(badge.hidden,true,'old observations cannot masquerade as current official data');
 ctx.currentCyclePeriod=()=>({hours:2,source:'observed'});ctx.updateCycleBadge();assert.match(badge.textContent,/2h 추정/);assert.doesNotMatch(badge.textContent,/공식 현재/);
 ctx.officialCycle={hours:2};ctx.otherCycles=[{ex:'BYBIT',name:'Bybit',hours:4}];ctx.updateCycleBadge();assert.match(badge.textContent,/공식 현재 · Bybit 2h/);assert.doesNotMatch(badge.textContent,/4h/);
});
