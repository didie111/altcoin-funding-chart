'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const T=require('../timeframes.js'),D=require('../backtest-data.js'),B=require('../backtest-bars.js'),C=require('../backtest-cache.js'),Batch=require('../backtest-batch.js'),E=require('../backtest-engine.js'),M=require('../dashboard-model.js');
const start=T.parseKst('2026-01-01','00:00'),end=T.parseKst('2026-10-31','00:00'),now=Date.UTC(2026,9,31,1),signal=()=>new AbortController().signal;
const cases=[['1m',436320,80,437],['3m',145440,80,146],['5m',87264,80,88],['15m',29088,80,30],['30m',14544,80,15],['1h',7272,80,8],['2h',3635,81,4],['4h',1817,81,2],['1d',302,81,1],['1w',42,81,1],['1M',9,81,1]];
function fixture(tf){const first=T.shift(T.start(start,tf),tf,-80),last=T.closedRange(first,end,tf),rows=Array.from({length:last.count},(_,i)=>({time:T.shift(first,tf,i),open:1.234567891234567,high:1.4,low:1.1,close:1.3,volume:123456.123456789}));return rows;}
function pageFrom(rows,calls=[]){return async(ex,s,tf,edge)=>{calls.push({ex,s,tf,edge});let l=0,r=rows.length;while(l<r){const m=(l+r)>>>1;if(rows[m].time*1000<=edge)l=m+1;else r=m;}return rows.slice(Math.max(0,l-1000),l);};}
const fundingPage=async(ex,s,cursor)=>cursor>=(start-3600)*1000?[{time:start-3600,rate:-.6,fundingIntervalHours:1}]:[];
for(const [tf,count,warmup,pages]of cases)test(tf+' Jan–Oct KST collection keeps every requested closed candle and only its RSI warmup',async()=>{
 const estimate=D.estimate({exchange:'BINANCE',intervals:[tf],startTime:start,endTime:end,now:now/1000}),f=estimate.frames[tf];assert.equal(f.count,count);assert.equal(f.warmup,warmup);assert.equal(f.expectedPages,pages);
 const rows=fixture(tf),calls=[],progress=[],data=await D.create({candlePage:pageFrom(rows,calls),fundingPage}).loadBacktestDataset('BTCUSDT',{exchange:'BYBIT',intervals:[tf],startTime:start,endTime:end,packed:true,onProgress:p=>progress.push(p)}),got=data.timeframeCandles[tf];
 assert.equal(data.coverage[tf].count,count);assert.equal(data.coverage[tf].warmup,warmup);assert.equal(got.length,count+warmup);assert.equal(data.gapsCount,0);assert.equal(calls.length,pages);assert.ok(calls.every(c=>c.tf===tf&&c.s==='BTCUSDT'));
 assert.equal(B.time(got,0),rows[0].time);assert.equal(B.time(got,got.length-1),rows.at(-1).time);assert.ok(T.end(B.time(got,got.length-1),tf)<=end);const last=progress.filter(p=>p.phase==='candles').at(-1);assert.equal(last.count,count+warmup);assert.equal(last.expectedCount,count+warmup);assert.equal(last.first,rows[0].time);assert.equal(last.last,rows.at(-1).time);
});
test('all six venue plans account for native aggregation and page capacities across every timeframe',()=>{
 for(const exchange of ['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'])for(const tf of Object.keys(T.seconds)){
  const estimate=D.estimate({exchange,intervals:[tf],startTime:start,endTime:end,now:now/1000}),f=estimate.frames[tf],capacity=exchange==='BITGET'?200:exchange==='OKX'?300:exchange==='MEXC'?2000:1000,plan=T.plan(exchange,tf);
  assert.equal(estimate.exchange,exchange);assert.equal(f.nativeTimeframe,plan.source);assert.equal(f.expectedPages,Math.ceil(f.totalCount/Math.floor(capacity/plan.factor)));assert.equal(Object.keys(estimate.frames).length,1);
 }
});
test('calendar boundaries use UTC Monday weeks and actual month lengths, including leap February',()=>{
 const a=Date.UTC(2024,1,1)/1000,b=Date.UTC(2024,2,1)/1000;assert.equal(T.closedRange(a,b,'1m').count,29*1440);assert.equal(T.closedRange(a,b,'1M').count,1);
 const w=T.closedRange(start,end,'1w');assert.equal(new Date(w.first*1000).getUTCDay(),1);assert.equal(new Date(w.first*1000).getUTCHours(),0);assert.throws(()=>T.closedRange(end,start,'3m'));
});
test('fixed-minute execution adds one shared auxiliary 1m series only when requested',()=>{
 const plain=D.estimate({exchange:'BINANCE',startTime:start,endTime:end,intervals:['3m']}),fixed=D.estimate({exchange:'BINANCE',startTime:start,endTime:end,intervals:['3m','1m','3m'],requireMinuteData:true});
 assert.deepEqual(Object.keys(plain.frames),['3m']);assert.deepEqual(Object.keys(fixed.frames),['3m','1m']);assert.equal(fixed.totalCount,145520+436400);assert.equal(fixed.expectedPages,146+437);
});
test('configured batch periods are the default and explicit all-history runs stay frozen across resume',async()=>{
 const store=C.memory(),markets=[{exchange:'BINANCE',symbol:'BTCUSDT'},{exchange:'BINANCE',symbol:'IOSTUSDT'}],seen=[];let runner,pause=true;
 runner=Batch.create({store,now:()=>now,execute:async(m,c,s)=>{seen.push(c);if(pause){pause=false;runner.pause();s.throwIfAborted();}return {summary:{},meta:{market:{ex:m.exchange,symbol:m.symbol,int:c.timeframe}}};}});
 const config={timeframe:'3m',startTime:start,endTime:end,useBinanceArchive:true};assert.equal(runner.createJob(markets,config).config.startTime,start);assert.equal(runner.createJob(markets,config).config.endTime,end);const whole=runner.createJob(markets,config,{allHistory:true});assert.equal(whole.config.startTime,Date.UTC(2009,0,1)/1000);assert.equal(whole.config.endTime,now/1000);
 await runner.start(markets,config,{allHistory:true});config.startTime=end-86400;config.timeframe='1m';config.useBinanceArchive=false;await runner.restore();await runner.resume();assert.ok(seen.every(c=>c.startTime===whole.config.startTime&&c.endTime===whole.config.endTime&&c.timeframe==='3m'&&c.useBinanceArchive===true));assert.equal(runner.snapshot().items.length,2);
});
test('a 139-coin full-history job keeps every contract rather than capping the watchlist for speed',async()=>{
 const markets=Array.from({length:139},(_,i)=>({exchange:'BINANCE',symbol:'TEST'+i+'USDT'})),seen=[],runner=Batch.create({store:C.memory(),now:()=>now,execute:async(m,c)=>{seen.push(m.symbol);assert.equal(c.startTime,Date.UTC(2009,0,1)/1000);assert.equal(c.endTime,now/1000);return {summary:{},meta:{market:{ex:m.exchange,symbol:m.symbol,int:c.timeframe}}};}});
 await runner.start(markets,{timeframe:'3m',startTime:start,endTime:end},{allHistory:true});assert.equal(runner.snapshot().status,'done');assert.deepEqual(seen,markets.map(m=>m.symbol));assert.equal(runner.snapshot().items.length,139);
});
test('the displayed plan matches configured dates and exposes auxiliary minute collection separately',()=>{
 const source=fs.readFileSync(require.resolve('../backtest-batch-ui.js'),'utf8'),scope={$:()=>({value:'settings'}),F:{store:{snapshot:()=>({markets:[{exchange:'BINANCE'},{exchange:'MEXC'}]})}},root:{BacktestData:D},Date};vm.createContext(scope);vm.runInContext(source.slice(source.indexOf('function plan('),source.indexOf('  function renderPlan(')),scope);
 const p=scope.plan({startTime:start,endTime:end,timeframe:'3m',splitTrigger:'step_pct'});assert.equal(p.startTime,start);assert.equal(p.endTime,end);assert.equal(p.allHistory,false);assert.equal(p.estimates[0].totalCount,145520);assert.equal(p.estimates[1].frames['3m'].nativeTimeframe,'1m');
 const fixed=scope.plan({startTime:start,endTime:end,timeframe:'3m',splitTrigger:'rsi_cross_up_1m'});assert.equal(fixed.estimates[0].totalCount,581920);
});
test('Float64 page storage preserves every field without rounding',()=>{
 const rows=fixture('1d'),packed=C.packCandles(rows);assert.equal(packed.values.byteLength,rows.length*48);assert.deepEqual(C.unpackCandles(packed),rows);assert.equal(C.unpackCandles({...packed,count:rows.length+1}),null);assert.equal(C.unpackCandles({...packed,values:new Float32Array(packed.values)}),null);
});
test('legacy candle cache migrates locally without issuing a network request',async()=>{
 const rows=fixture('1d').slice(0,4),store=C.memory(),edge=rows.at(-1).time*1000,old=JSON.stringify(['page-v1','candles','BINANCE','BTCUSDT','1d',edge]),key=JSON.stringify(['page-v2','candles','BINANCE','BTCUSDT','1d',edge]);await store.put(old,rows,{expires:now+86400000});let calls=0;
 const a=C.adapter({store,now:()=>now,candlePage:async()=>{calls++;throw Error('must not fetch');}});assert.deepEqual(await a.candlePage('BINANCE','BTCUSDT','1d',edge,signal()),rows);assert.equal(calls,0);assert.equal(await store.get(old,now),null);assert.deepEqual(C.unpackCandles(await store.get(key,now)),rows);
});
test('Binance funding requests leave headroom under the shared history endpoint quota',async()=>{
 let clock=now;const times=[],a=C.adapter({store:C.memory(),now:()=>clock,wait:async ms=>{clock+=ms;},fundingPage:async()=>{times.push(clock);return [];}});
 for(let i=0;i<3;i++)await a.fundingPage('BINANCE','BTCUSDT',1000+i,1,signal());assert.deepEqual(times,[now,now+750,now+1500]);
});
test('a complete Jan–Oct 3m run fits in 8MiB and repeats with zero candle HTTP requests',async()=>{
 const rows=fixture('3m'),store=C.memory({limit:8*1048576}),calls=[],a=C.adapter({store,now:()=>now,wait:async()=>{},candlePage:pageFrom(rows,calls),fundingPage});
 const source=D.create(a),options={exchange:'BYBIT',intervals:['3m'],startTime:start,endTime:end,packed:true},first=await source.loadBacktestDataset('BTCUSDT',options);assert.equal(first.coverage['3m'].count,145440);assert.equal(calls.length,146);assert.ok((await store.info()).bytes<8*1048576);
 const second=await source.loadBacktestDataset('BTCUSDT',options);assert.equal(calls.length,146);assert.deepEqual(second.coverage,first.coverage);assert.deepEqual(B.get(second.timeframeCandles['3m'],second.timeframeCandles['3m'].length-1),rows.at(-1));
});
test('progress distinguishes full reference candles, auxiliary 1m, official archive files and REST pages',()=>{
 const market={ex:'BINANCE',symbol:'IOSTUSDT',int:'3m'},base={phase:'candles',count:145520,expectedCount:145520,pages:146,expectedPages:146,first:start,last:end-180};
 assert.match(M.backtestProgress(market,'single',{...base,timeframe:'3m'}),/3분 기준 캔들 145,520/);assert.match(M.backtestProgress(market,'single',{...base,timeframe:'1m'}),/보조 1분봉/);assert.match(M.backtestProgress(market,'single',{...base,timeframe:'3m',archiveFiles:10,restPages:2}),/공식 과거 10파일 · API 2페이지/);assert.match(M.backtestProgress(market,'single',{phase:'archive',kind:'monthly'}),/전체 기간 유지/);
});
