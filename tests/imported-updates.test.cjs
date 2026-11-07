'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../timeframes.js'),B=require('../backtest-bars.js'),D=require('../backtest-data.js'),C=require('../backtest-cache.js'),E=require('../backtest-engine.js'),M=require('../dashboard-model.js');
// Generated prices are isolated test inputs; the normal application never uses them.
const base=Date.UTC(2024,0,1)/1000,signal=()=>new AbortController().signal;
function bar(time,i=0){const close=100+Math.sin(i/7)*4,open=100+Math.sin((i-1)/7)*4;return {time,open,high:Math.max(open,close)+.5,low:Math.min(open,close)-.5,close,volume:i%7+.5};}
function page(rows,edge){let l=0,r=rows.length;while(l<r){const m=(l+r)>>>1;if(rows[m].time*1000<=edge)l=m+1;else r=m;}return rows.slice(Math.max(0,l-1000),l);}
for(const tf of Object.keys(T.seconds).filter(tf=>tf!=='1m'))test(tf+' resampling preserves complete UTC buckets and rejects missing or partial source minutes',()=>{
 const first=T.start(base,tf),end=T.shift(first,tf,3),rows=Array.from({length:(end-first)/60},(_,i)=>bar(first+i*60,i)),expected=[];
 for(let t=first;t<end;t=T.end(t,tf)){const group=rows.filter(r=>r.time>=t&&r.time<T.end(t,tf));expected.push({time:t,open:group[0].open,high:group.reduce((n,r)=>Math.max(n,r.high),-Infinity),low:group.reduce((n,r)=>Math.min(n,r.low),Infinity),close:group.at(-1).close,volume:group.reduce((n,r)=>n+r.volume,0)});}
 assert.deepEqual(T.resample(rows,tf),expected);assert.deepEqual(T.resample(B.pack(rows),tf,'1m',B.get),expected);
 const missing=rows.filter((_,i)=>i!==1);assert.deepEqual(T.resample(missing,tf),expected.slice(1));assert.deepEqual(T.resample(rows.slice(1,-1),tf),expected.slice(1,-1));
});
test('fast collection keeps the same native RSI warmup and every trade as independent timeframe collection',async()=>{
 const start=base+100*3600,end=start+36*3600,minute=Array.from({length:136*60},(_,i)=>bar(base+i*60,i)),hour=T.resample(minute,'1h'),funding=Array.from({length:140},(_,i)=>({time:base+i*3600,rate:-.6,fundingIntervalHours:1,markPrice:100})),calls=[];
 const source=D.create({fundingPage:async(ex,s,cursor)=>funding.filter(r=>r.time*1000<=cursor).slice(-1000),candlePage:async(ex,s,tf,edge)=>{calls.push({tf,edge});return page(tf==='1m'?minute:hour,edge);}}),options={exchange:'BYBIT',intervals:['1h'],startTime:start,endTime:end,packed:true};
 const normal=await source.loadBacktestDataset('BTCUSDT',options),fast=await source.loadBacktestDataset('BTCUSDT',{...options,fastResample:true});
 assert.equal(fast.coverage['1h'].warmup,80);assert.equal(fast.coverage['1h'].count,36);assert.equal(fast.coverage['1h'].resampled,true);assert.equal(fast.gapsCount,0);
 assert.deepEqual(B.toArray(fast.timeframeCandles['1h']),B.toArray(normal.timeframeCandles['1h']));
 const config={timeframe:'1h',startTime:start,endTime:end,rsiPeriod:6,rsiOversold:45,entryTrigger:'rsi_oversold',fundingIntervalHours:1,fundingWindowSeconds:3600,minFundingRate:-.5,takeProfitPct:2,stopLossPct:3,feePct:.05,slippagePct:.03};
 assert.deepEqual(E.runBacktest(fast.timeframeCandles['1h'],fast.fundingRecords,config),E.runBacktest(normal.timeframeCandles['1h'],normal.fundingRecords,config));
 assert.ok(calls.some(c=>c.tf==='1h'&&c.edge<start*1000));
});
test('resampled frames count toward the existing memory limit instead of returning a partial successful test',async()=>{
 const rows=Array.from({length:1000},(_,i)=>bar(base+i*60,i)),source=D.create({fundingPage:async(ex,s,cursor)=>cursor>=base*1000?[{time:base,rate:-.6}]:[],candlePage:async(ex,s,tf,edge)=>page(tf==='1m'?rows:T.resample(rows,tf),edge)});
 await assert.rejects(source.loadBacktestDataset('BTCUSDT',{exchange:'BYBIT',intervals:['1h'],fastResample:true,startTime:base+80*60,endTime:base+1000*60,packed:true,maxBars:1001}),/일부만 계산하지 않고 중단/);
});
test('content caches share overlapping cursors and sessions without crossing venue, symbol or requested timeframe',async()=>{
 const rows=Array.from({length:1000},(_,i)=>bar(base+i*60,i)),store=C.memory(),calls=[],make=()=>C.adapter({store,wait:async()=>{},candlePage:async(ex,s,tf,edge)=>{calls.push([ex,s,tf]);return page(tf==='1m'?rows:T.resample(rows,'3m'),edge);}});
 const first=make();await first.candlePage('MEXC','BTCUSDT','3m',(base+1000*60)*1000-1,signal());const a=await first.candlePage('MEXC','BTCUSDT','1m',(base+1000*60)*1000-1,signal());assert.equal(calls.length,2);assert.equal(a.length,1000);
 const overlapping=await make().candlePage('MEXC','BTCUSDT','1m',(base+500*60)*1000-1,signal());assert.equal(calls.length,2);assert.equal(overlapping.length,500);assert.equal(overlapping.at(-1).time,base+499*60);
 await make().candlePage('BYBIT','BTCUSDT','1m',(base+1000*60)*1000-1,signal());await make().candlePage('MEXC','ETHUSDT','1m',(base+1000*60)*1000-1,signal());assert.equal(calls.length,4);
});
test('expired recent data is refreshed even when the new page has identical time boundaries',async()=>{
 let now=Date.now(),version=0,calls=0;const rows=Array.from({length:10},(_,i)=>bar(T.start(now/1000,'1m')-i*60,i)).reverse(),store=C.memory(),adapter=C.adapter({store,now:()=>now,wait:async()=>{},candlePage:async()=>{calls++;return rows.map(r=>({...r,volume:r.volume+version}));}}),edge=now;
 await adapter.candlePage('BINANCE','BTCUSDT','1m',edge,signal());now+=60001;version=50;const changed=await adapter.candlePage('BINANCE','BTCUSDT','1m',edge,signal());assert.equal(calls,2);assert.equal(changed[0].volume,rows[0].volume+50);
});
test('data export/import preserves Float64 prices, bounds storage, merges safely and supports cursor reuse',async()=>{
 assert.equal(C.maxBytes,32*1048576);const store=C.memory(),rows=Array.from({length:100},(_,i)=>bar(base+i*60,i)),adapter=C.adapter({store,wait:async()=>{},candlePage:async()=>rows});await adapter.candlePage('BINANCE','BTCUSDT','1m',(base+100*60)*1000-1,signal());
 const payload=await store.exportAll(),restored=C.memory();await restored.importAll(payload);const once=(await restored.info()).bytes;await restored.importAll(payload);assert.equal((await restored.info()).bytes,once);
 const reused=C.adapter({store:restored,candlePage:async()=>{throw Error('should reuse');}});assert.deepEqual(await reused.candlePage('BINANCE','BTCUSDT','1m',(base+50*60)*1000-1,signal()),rows.slice(0,50));
 const small=C.memory({limit:1024});await small.put('existing',[1],{bytes:20});payload.pages[0].bytes=1;const info=await small.importAll(payload);assert.equal(info.importedPages,0);assert.equal(info.skippedPages,1);assert.ok((await small.info()).bytes<=1024);assert.deepEqual(await small.get('existing'),[1]);await assert.rejects(small.importAll({app:'wrong'}));
});
test('the all-timeframe selector normalizes a real base frame without sending all into the single-frame engine',()=>{
 const source=fs.readFileSync(require.resolve('../backtest-batch-ui.js'),'utf8'),ctx={getConfig:()=>E.normalizeConfig({timeframe:'3m'}),root:{BacktestEngine:E},$:id=>id==='btBatchFrame'?{value:'all'}:{checked:true}};vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function config()'),source.indexOf('  function controls(')),ctx);const c=ctx.config();assert.equal(c.timeframe,'all');assert.equal(c.rsiPeriod,14);assert.equal(c.useBinanceArchive,true);
});
test('summary-only multi-frame comparisons preserve the same statistics without retaining trade arrays per coin',()=>{
 const rows=Array.from({length:3000},(_,i)=>bar(base+i*60,i)),funding=Array.from({length:55},(_,i)=>({time:base+(i-2)*3600,rate:-.6,fundingIntervalHours:1})),map={'1m':B.pack(rows),'3m':B.pack(T.resample(rows,'3m'))},options={rsiPeriod:6,rsiOversold:45,entryTrigger:'rsi_oversold',fundingIntervalHours:1,fundingWindowSeconds:3600,minFundingRate:-.5};
 const full=E.runAllTimeframes(map,funding,options),compact=E.runAllTimeframes(map,funding,options,{summaryOnly:true,equityMaxPoints:50});assert.deepEqual(compact.comparison,full.comparison);for(const r of Object.values(compact.results))assert.equal(r.trades.length,0);
});
test('the actual all-frame batch worker loads every requested timeframe and emits compact, comparable results',async()=>{
 const start=T.start(base,'1w'),rows=Array.from({length:3*1440},(_,i)=>bar(start+i*60,i)),funding=Array.from({length:80},(_,i)=>({time:start+(i-2)*3600,rate:-.6,intervalHours:1,intervalSource:'official-history'}));let resolve,options;const done=new Promise(r=>resolve=r);
 const source=D.create({candlePage:async(ex,s,tf,edge)=>page(tf==='1m'?rows:T.resample(rows,tf),edge),fundingPage:async(ex,s,edge,p)=>p===1?funding:[]}),scope={importScripts(){},postMessage(v){if(v.output||v.error)resolve(v);},AbortController,Date,TimeframeEngine:T,BacktestCache:{open:async()=>C.memory(),adapter:()=>({})},MarketAPI:{},BacktestData:{create:()=>({loadBacktestDataset:(s,o)=>{options=o;return source.loadBacktestDataset(s,o);}})},DashboardModel:M,BacktestEngine:E,BacktestBars:B};vm.createContext(scope);vm.runInContext(fs.readFileSync(require.resolve('../backtest-batch-worker.js'),'utf8'),scope);
 const config={...E.normalizeConfig({timeframe:'1m',startTime:start+120*60,endTime:start+3*86400}),timeframe:'all'};scope.onmessage({data:{id:9,market:{exchange:'BYBIT',symbol:'BTCUSDT'},config}});const result=await done;assert.ok(!result.error,JSON.stringify(result.error));assert.deepEqual(Array.from(options.intervals),Object.keys(T.seconds));assert.equal(options.fastResample,true);assert.equal(result.output.meta.config.timeframe,'all');assert.equal(result.output.summary.timeframe,'all');assert.ok(result.output.comparison.some(r=>r.timeframe==='3m'));assert.equal(result.output.results,undefined);assert.equal(result.output.result,undefined);
});
