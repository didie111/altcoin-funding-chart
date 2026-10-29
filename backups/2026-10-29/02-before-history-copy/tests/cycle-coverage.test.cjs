'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('../funding.js'),H=require('../funding-history.js'),T=require('../timeframes.js'),C=require('../chart-data.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function chart({bars,records=[],neighbors=[],session=null,interval='1m'}){
 let data=[];const ctx={FundingEngine:F,ChartData:C,TimeframeEngine:T,historyState:{cycleNeighbors:neighbors},fundingSession:session,officialCycle:null,otherCycles:[],rates:records,all:bars,cycleCaption:{},updateCycleBadge(){},duration:T.seconds,$:()=>({value:interval}),settlementCycle:{setData:rows=>data=rows},cycleMarkers:{setMarkers(){}},lowerBound:(a,t)=>T.lowerBound(a,t)};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function observedCycles('),source.indexOf('function resetScales(')),ctx);ctx.rebuildCycles();ctx.renderCycles(bars);return {ctx,data:()=>data};
}
for(const [ex]of F.exchanges)test(ex+' retains enough cycle context for all eleven chart timeframes, even when a minute window contains no settlement',()=>{
 for(const interval of Object.keys(T.seconds)){
  const begin=T.start(Date.UTC(2026,8,1,3)/1000,interval),end=T.shift(begin,interval,3),bars=Array.from({length:3},(_,i)=>({time:T.shift(begin,interval,i)}));
  const rows=[];for(let time=Math.floor(begin/28800)*28800-3*28800;time<=end+3*28800;time+=28800)rows.push({symbol:F.contract(ex,'BTCUSDT'),instId:F.contract(ex,'BTCUSDT'),fundingTime:time*1000,fundingRateTimestamp:time*1000,settleTime:time*1000,fundingRate:'0.0001'});
  const response=ex==='BINANCE'?rows:ex==='BYBIT'?{result:{list:rows}}:ex==='MEXC'?{data:{resultList:rows}}:{data:rows};
  const records=F.normalizeHistory(ex,response,'BTCUSDT',(end+86400)*1000),split=H.partition(records,begin,end),h=chart({bars,records:split.inside,neighbors:split.neighbors,interval});
  assert.ok(h.data().every(r=>r.value===8),ex+' '+interval+' must show the supported 8h interval');
  assert.ok(split.neighbors.length<=4);assert.ok(split.inside.every(r=>r.time>=begin&&r.time<end));
 }
});
test('a two-minute historical window keeps two observations on each side, without importing their rates into signals',()=>{
 const begin=Date.UTC(2026,8,1,3)/1000,rows=Array.from({length:7},(_,i)=>({time:begin+(i-3)*28800,rate:i===2?-99:.01})),split=H.partition(rows,begin+60,begin+180);
 assert.equal(split.inside.length,0);assert.equal(split.neighbors.length,4);const periods=F.observedCycles(split.neighbors);assert.ok(periods.every(p=>p.hours===8));
 assert.equal(F.minimum(split.inside),null);assert.equal(F.mapToCandles([{time:begin+60}],split.inside,60,-.5,-2).signals.length,0);
});
test('latest settlement context fills BingX current minutes without labeling an inferred interval as official',()=>{
 const now=Date.now()/1000,last=Math.floor(now/28800)*28800,rows=[-2,-1,0].map(i=>({time:last+i*28800,rate:.01})),start=Math.floor(now/60)*60;
 const session={ex:'BINGX',latestRows:rows,entries:new Map([['BINGX',{quote:{fetchedAt:now,nextTime:last+28800,hours:null}}]])},bars=[{time:start-60},{time:start}];
 const h=chart({bars,session});assert.ok(h.data().every(r=>r.value===8));assert.equal(h.ctx.currentCyclePeriod().source,'observed');assert.equal(h.ctx.rates.length,0);
});
test('MEXC historical collectCycle is retained as explicit evidence without stretching it across missing settlements',()=>{
 const end=Date.UTC(2026,8,1,8)/1000,records=F.normalizeHistory('MEXC',{data:{resultList:[{symbol:'BTC_USDT',settleTime:end*1000,fundingRate:'.0001',collectCycle:1},{symbol:'BTC_USDT',settleTime:(end+8*3600)*1000,fundingRate:'.0002',collectCycle:1}]}},'BTCUSDT',(end+86400)*1000),periods=F.observedCycles(records);
 assert.equal(records[0].intervalSource,'official-history');assert.equal(records[0].intervalHours,1);assert.equal(periods[0].start,end-3600);assert.equal(periods[0].hours,1);assert.equal(periods[0].source,'official-history');
 assert.equal(periods[1].hours,null);assert.equal(periods[1].start,end);assert.equal(periods[1].end,end+7*3600);assert.equal(periods[2].hours,1);
 const inferred=records.map(r=>({...r,intervalSource:'observed'}));assert.ok(F.observedCycles(inferred).every(p=>p.hours===null),'derived interval metadata is not official evidence');
});
test('cycle-only changes cause a chart update even when the minute range has no new in-range funding records',()=>{
 const a=[{time:1,rate:.01,intervalHours:4,intervalSource:'official-history'}],b=[{...a[0],intervalHours:1}],ctx={};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function sameRates('),source.indexOf('function renderFundingStudies(')),ctx);assert.equal(ctx.sameRates(a,b),false);assert.equal(ctx.sameRates(a,a),true);
});
