'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const T=require('../timeframes.js'),B=require('../backtest-bars.js'),E=require('../backtest-engine.js'),D=require('../backtest-data.js'),M=require('../dashboard-model.js'),RSI=require('../indicators.js');
// Synthetic candles are restricted to automated tests and never used as market data.
const base=Date.UTC(2024,0,1)/1000;
function fixture(){
 const minute=Array.from({length:1560},(_,i)=>{const close=100+(((i*17)%31)-15)*.17+Math.floor(i/100)%7,open=100+((((i-1)*17)%31)-15)*.17+Math.floor(Math.max(0,i-1)/100)%7;return {time:base+(i-120)*60,open,high:Math.max(open,close)+.5,low:Math.min(open,close)-.5,close,volume:1+(i%13)};});
 return {data:{'1m':minute,'3m':T.aggregate(minute,'3m','1m'),'1h':T.aggregate(minute,'1h','1m')},fund:Array.from({length:29},(_,i)=>({time:base+(i-3)*3600,rate:i%4?-.7:.01,fundingIntervalHours:1,markPrice:100}))};
}
function pack(rows){const b=B.builder();for(let i=rows.length-1;i>=0;i--)b.push(rows[i]);return b.finish();}
function config(tf,trigger,source){return {timeframe:tf,startTime:base,endTime:base+24*3600,rsiPeriod:6,rsiOversold:45,rsiSource:source,entryTrigger:'rsi_oversold',splitTrigger:trigger,splitCount:3,splitStepPct:.5,takeProfitPct:2,stopLossPct:4,stopLossMode:'after_all_dca',feePct:.05,slippagePct:.03,fundingIntervalHours:1,fundingWindowSeconds:7200,minFundingRate:-.5,initialCapital:1000,allocationPerTradePct:50,maxHoldBars:30};}
const sha=result=>crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
const oldResults=[
 ['1m','step_pct','close','e1d08f668f6ab28e7284a5497eee487a2084c3530bbdbaf22027514c755cebfa'],
 ['3m','rsi_cross_up','hlc3','31955900a24387add2777cb27a557a634a93fa4768a076a5c1d6b9d52a145199'],
 ['1h','rsi_cross_up_1m','close','34fcfbcc201bcf037620fa35b40fd8491e910091e9ad3d66dcb7db28d8f3a2b2'],
 ['1h','bar','high','fb842804e3eeab33f995b8ec8b481d9f3c6707263f3c3e2a952b1e5d19f35238']
];
for(const [tf,trigger,source,expected]of oldResults)test(tf+' '+trigger+' preserves every trade and statistic from the pre-change engine',()=>{
 const {data,fund}=fixture(),cfg=config(tf,trigger,source),normal=E.runBacktest(data[tf],fund,cfg,{minuteCandles:data['1m']}),compact=E.runBacktest(pack(data[tf]),fund,cfg,{minuteCandles:pack(data['1m'])});
 // Only new option metadata is excluded from the original result snapshot.
 assert.equal(normal.config.entryCooldownBars,0);assert.equal(normal.diagnostics.rejected.entry_cooldown,0);assert.equal(normal.model.entryCooldown.bars,0);
 assert.equal(normal.config.oneEntryPerFunding,false);assert.equal(normal.diagnostics.rejected.funding_reuse,0);assert.equal(normal.model.fundingReentry,'reuse-unexpired-settlement');
 const legacy=structuredClone(normal);delete legacy.config.requireFreshFundingAfterCooldown;delete legacy.diagnostics.rejected.funding_before_cooldown;delete legacy.config.fundingTransitionLookbackSeconds;delete legacy.config.entryCooldownBars;delete legacy.diagnostics.rejected.entry_cooldown;delete legacy.model.entryCooldown;delete legacy.config.oneEntryPerFunding;delete legacy.diagnostics.rejected.funding_reuse;delete legacy.model.fundingReentry;
 assert.equal(sha(legacy),expected);assert.deepEqual(compact,normal);
});
test('the memory-efficient RSI matches the original chart indicator across all sources and after data gaps',()=>{
 const rows=fixture().data['1m'].filter((_,i)=>i!==300&&i!==301&&i!==900),sources=['close','open','high','low','hl2','hlc3','ohlc4','hlcc4'];
 for(const source of sources)for(const period of [2,14,50]){
  const expected=new Float64Array(rows.length).fill(NaN);let begin=0;
  for(let i=1;i<=rows.length;i++)if(i===rows.length||rows[i].time>rows[i-1].time+60){expected.set(RSI.calculate(rows.slice(begin,i),{length:period,source,divergence:false,maType:'None',showMa:false,showBands:false}).rsi,begin);begin=i;}
  assert.deepEqual(E.computeRSI(rows,period,source,'1m'),expected);assert.deepEqual(E.computeRSI(pack(rows),period,source,'1m'),expected);
 }
});
test('packed collection loads over 500,000 candles in chronological order without fabricating or dropping pages',async()=>{
 const start=base+4800,total=600000,first=start-4800,last=first+(total+79)*60,calls=[];
 const api=D.create({fundingPage:async(ex,s,cursor)=>cursor>=(start-3600)*1000?[{time:start-3600,rate:-.7}]:[],candlePage:async(ex,s,tf,edge)=>{
  calls.push(edge);const hi=Math.min(total+79,Math.floor((edge/1000-first)/60));if(hi<0)return [];const lo=Math.max(0,hi-999);
  return Array.from({length:hi-lo+1},(_,j)=>{const i=lo+j,p=100+(i%31)*.01;return {time:first+i*60,open:p,high:p+1,low:p-1,close:p+.1,volume:5};});
 }});
 const d=await api.loadBacktestDataset('BTCUSDT',{exchange:'BYBIT',intervals:['1m'],startTime:start,endTime:start+total*60,packed:true}),bars=d.timeframeCandles['1m'];
 assert.equal(B.isPacked(bars),true);assert.equal(bars.length,total+80);assert.equal(d.coverage['1m'].count,total);assert.equal(d.coverage['1m'].warmup,80);
 assert.equal(B.time(bars,0),first);assert.equal(B.time(bars,bars.length-1),last);assert.equal(d.gapsCount,0);assert.ok(calls.length>600);
 assert.ok(D.transferables(d).length>70);assert.ok(D.transferables(d).reduce((n,b)=>n+b.byteLength,0)<(bars.length+8192)*48);
});
test('packed buffers transfer to a worker without copying candle data and retain exact floating point prices',()=>{
 const rows=fixture().data['1m'],data={timeframeCandles:{'1m':pack(rows)}},buffer=data.timeframeCandles['1m'].blocks[0].buffer,copy=structuredClone(data,{transfer:D.transferables(data)});
 assert.equal(buffer.byteLength,0);assert.deepEqual(B.get(copy.timeframeCandles['1m'],0),rows[0]);assert.deepEqual(B.get(copy.timeframeCandles['1m'],rows.length-1),rows.at(-1));
});
test('the application sends packed buffers to the worker and handles progress before the final result',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../backtest-ui.js'),'utf8'),dataset={timeframeCandles:{'1m':pack(fixture().data['1m'])}},progress=[];let sent;
 class MockWorker{postMessage(message,transfer){sent=structuredClone(message,{transfer});queueMicrotask(()=>{this.onmessage({data:{id:message.id+1,progress:{phase:'ignored'}}});this.onmessage({data:{id:message.id,progress:{phase:'compute',count:1}}});this.onmessage({data:{id:message.id,result:{success:true}}});});}}
 const ctx={root:{BacktestBars:B},Worker:MockWorker,worker:null,job:7};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function execute('),source.indexOf('  async function run(')),ctx);
 const result=await ctx.execute('single',dataset,{timeframe:'1m'},7,p=>progress.push(p));assert.equal(result.success,true);assert.deepEqual(progress,[{phase:'compute',count:1}]);
 assert.equal(dataset.timeframeCandles['1m'].blocks[0].buffer.byteLength,0);assert.deepEqual(B.get(sent.dataset.timeframeCandles['1m'],0),fixture().data['1m'][0]);
});
test('memory protection scales to available RAM and leaves room for a ten-year minute test',()=>{
 assert.ok(B.recommendedMaxBars(2)>5260320);assert.ok(B.recommendedMaxBars(4)>8740000);
 assert.equal(B.recommendedMaxBars(),16000000);assert.equal(B.recommendedMaxBars(8),16000000);assert.ok(B.recommendedMaxBars(2)<B.recommendedMaxBars(4));
});
test('stop requests cancel packed collection without claiming an incomplete result',async()=>{
 const abort=new AbortController(),start=base+6000;let pages=0;
 const api=D.create({fundingPage:async(ex,s,cursor)=>cursor>=(start-3600)*1000?[{time:start-3600,rate:-.5}]:[],candlePage:async(ex,s,tf,end)=>{pages++;const time=Math.floor(end/60000)*60;return [{time,open:100,high:101,low:99,close:100,volume:1}];}});
 await assert.rejects(api.loadBacktestDataset('BTCUSDT',{exchange:'BYBIT',intervals:['1m'],startTime:start,endTime:start+36000,packed:true,signal:abort.signal,onProgress:p=>{if(p.phase==='candles'&&pages===3)abort.abort();}}),{name:'AbortError'});
 assert.equal(pages,3);
});
test('explicit memory limits and actual paging errors still fail instead of returning a partial successful test',async()=>{
 const start=base+4800,api=D.create({fundingPage:async(ex,s,cursor)=>cursor>=(start-3600)*1000?[{time:start-3600,rate:-.5}]:[],candlePage:async(ex,s,tf,end)=>[{time:Math.floor(end/60000)*60,open:100,high:101,low:99,close:100,volume:1}]});
 await assert.rejects(api.loadBacktestDataset('BTCUSDT',{exchange:'BYBIT',intervals:['1m'],startTime:start,endTime:start+36000,packed:true,maxBars:1}),/일부만 계산하지 않고 중단/);
});
test('incomplete price and funding history is exposed to the report rather than described as full coverage',async()=>{
 const start=base,begin=start+4*86400,end=start+12*86400,records=Array.from({length:8*24},(_,i)=>({time:begin+i*3600,open:100,high:101,low:99,close:100,volume:1}));
 const api=D.create({fundingPage:async(ex,s,cursor)=>cursor>=(end-3600)*1000?[{time:end-3600,rate:-.5}]:[],candlePage:async(ex,s,tf,edge)=>records.filter(r=>r.time*1000<=edge).slice(-200)});
 const d=await api.loadBacktestDataset('BTCUSDT',{exchange:'BYBIT',intervals:['1h'],startTime:start,endTime:end,packed:true}),issues=M.backtestCoverageIssues({coverage:d.coverage,fundingCoverage:d.fundingCoverage,gaps:d.gapsCount});
 assert.equal(d.coverage['1h'].startMissing,true);assert.equal(d.fundingCoverage.startMissing,true);assert.equal(issues.hasIssues,true);assert.equal(issues.incomplete,true);assert.deepEqual(issues.frames,['1h']);assert.equal(issues.fundingStart,true);
});
test('long interior gaps in settled funding are visible as gaps even if both period endpoints exist',async()=>{
 const end=base+8*86400,history=[base,base+3600,base+5*86400,end-3600].map(time=>({time,rate:-.5}));
 const api=D.create({fundingPage:async(ex,s,cursor)=>history.filter(r=>r.time*1000<=cursor).slice(-200),candlePage:async(ex,s,tf,edge)=>Array.from({length:8},(_,i)=>({time:base+i*86400,open:100,high:101,low:99,close:100,volume:1})).filter(r=>r.time*1000<=edge)});
 const d=await api.loadBacktestDataset('BTCUSDT',{exchange:'BYBIT',intervals:['1d'],startTime:base,endTime:end,packed:true}),issues=M.backtestCoverageIssues({coverage:d.coverage,fundingCoverage:d.fundingCoverage,gaps:d.gapsCount});
 assert.equal(d.fundingCoverage.startMissing,false);assert.equal(d.fundingCoverage.endMissing,false);assert.equal(d.fundingCoverage.longGaps,2);assert.equal(issues.fundingGaps,2);assert.equal(issues.hasIssues,true);assert.equal(issues.incomplete,false);
});
test('the result banner explicitly marks incomplete history and distinguishes long funding intervals',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../backtest-ui.js'),'utf8'),market={ex:'BITGET',symbol:'BTCUSDT',int:'1h'};
 const ctx={view:'overview',comparison:null,optimized:null,single:{meta:{market,config:{},coverage:{'1h':{}},fundingCoverage:{first:1,last:2,startMissing:true}}},target:()=>market,M,follow:false,followTimeframe:false,lastFailure:false,busy:false,chartWorkspace:{},stamp:t=>String(t),resultContext:{},modeNotice:{},dataNotice:{}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function updateResultContext()'),source.indexOf('  function updateTarget()')),ctx);ctx.updateResultContext();
 assert.equal(ctx.dataNotice.hidden,false);assert.match(ctx.dataNotice.textContent,/완전한 백테스트 결과가 아닙니다/);assert.match(ctx.dataNotice.textContent,/정산 이력 1 ~ 2 KST/);
 ctx.single.meta.fundingCoverage={longGaps:1};ctx.updateResultContext();assert.match(ctx.dataNotice.textContent,/24시간을 넘는 구간 1곳/);assert.doesNotMatch(ctx.dataNotice.textContent,/완전한 백테스트 결과가 아닙니다/);
});
test('page boundaries and missing candles report the same coverage in compact and standard formats',async()=>{
 const rows=[0,1,2,5,6,7].map(i=>({time:base+i*60,open:100,high:101,low:99,close:100,volume:1}));
 const api=D.create({fundingPage:async(ex,s,cursor)=>cursor>=(base-3600)*1000?[{time:base-3600,rate:-.5}]:[],candlePage:async(ex,s,tf,edge)=>rows.filter(r=>r.time*1000<=edge).slice(-2)});
 const options={exchange:'BYBIT',intervals:['1m'],startTime:base,endTime:base+8*60},normal=await api.loadBacktestDataset('BTCUSDT',options),compact=await api.loadBacktestDataset('BTCUSDT',{...options,packed:true});
 assert.deepEqual(compact.coverage,normal.coverage);assert.equal(compact.gapsCount,normal.gapsCount);assert.deepEqual(compact.gaps,normal.gaps);assert.equal(compact.gapsCount,1);
});
test('display sampling bounds equity output while preserving all trades, capital and full-resolution maximum drawdown',()=>{
 const {data,fund}=fixture(),cfg=config('1m','bar','close'),full=E.runBacktest(data['1m'],fund,cfg),limited=E.runBacktest(pack(data['1m']),fund,cfg,{equityMaxPoints:50});
 assert.deepEqual(limited.trades,full.trades);assert.deepEqual(limited.summary,full.summary);assert.deepEqual(limited.signals,full.signals);assert.ok(limited.equityCurve.length<=50);
 assert.equal(limited.model.equityCurveSampled,true);assert.deepEqual(limited.equityCurve.at(-1),full.equityCurve.at(-1));
});
test('comparison and parameter search accept packed bars and preserve the original results',()=>{
 const {data,fund}=fixture(),packed=Object.fromEntries(Object.entries(data).map(([tf,rows])=>[tf,pack(rows)])),cfg=config('3m','rsi_cross_up_1m','close');
 assert.deepEqual(E.runAllTimeframes(packed,fund,cfg),E.runAllTimeframes(data,fund,cfg));
 const grid={baseConfig:cfg,splitCounts:[1,3],rsiOversolds:[30,45],takeProfitPcts:[1],stopLossPcts:[3],splitTriggers:['step_pct','rsi_cross_up_1m'],minTrades:1};
 assert.deepEqual(E.optimizeStrategy(packed['3m'],fund,{...grid,minuteCandles:packed['1m']}),E.optimizeStrategy(data['3m'],fund,{...grid,minuteCandles:data['1m']}));
});
test('long-running computation reports its actual timeframe and condition-search progress',()=>{
 const m={ex:'BYBIT',symbol:'BTCUSDT',int:'1h'};
 assert.match(M.backtestProgress(m,'single',{phase:'compute',timeframe:'1h',executionTimeframe:'1m',count:250000,total:1000000}),/1분 체결 데이터 250,000 \/ 1,000,000봉/);
 assert.match(M.backtestProgress(m,'optimize',{phase:'optimize',count:20,total:324}),/20 \/ 324개 조합/);
});
