'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../backtest-research-store.js'),H=require('../backtest-research.js'),File=require('../backtest-research-file.js'),C=require('../backtest-cache.js'),R=require('../backtest-results.js'),Batch=require('../backtest-batch.js'),B=require('../backtest-bars.js'),T=require('../timeframes.js'),E=require('../backtest-engine.js'),D=require('../backtest-data.js'),M=require('../dashboard-model.js');
const day=86400,start=Date.UTC(2025,0,1)/1000,m={exchange:'BYBIT',symbol:'AKEUSDT'},base=E.normalizeConfig({timeframe:'3m',startTime:start,endTime:start+7*day,rsiPeriod:6,rsiOversold:30,splitCount:1,positionSizing:'budget',splitTrigger:'step_pct',stopLossPct:0});
const minute=(time,i)=>{const open=100+6*Math.sin((i-1)/13),close=100+6*Math.sin(i/13);return {time,open,high:Math.max(open,close)+.3,low:Math.min(open,close)-.3,close,volume:1+i%17+.000000123456789};};
const candles=(from,to)=>Array.from({length:(to-from)/60},(_,i)=>minute(from+i*60,(from-start)/60+i));
const funding=(from,to)=>Array.from({length:Math.floor((to-from)/3600)},(_,i)=>({time:from+i*3600,rate:i%3?-.61:-.51321,markPrice:101.00000123456789,intervalHours:1,intervalSource:'official-history'}));
function source(rows,records){
 const calls=[];
 return {calls,candlePage:async(ex,s,tf,edge)=>{calls.push({ex,s,tf,edge});return rows.filter(r=>r.time*1000<=edge).slice(-1000);},fundingPage:async(ex,s,edge)=>{calls.push({ex,s,tf:'funding',edge});const available=ex==='BINANCE'?records.filter(r=>(r.timeMs??r.time*1000)>=edge).slice(0,37):records.filter(r=>r.time*1000<=edge).slice(-37);return available;}};
}
async function seed(store,item,from,to,{bars=candles(from,to),records=funding(from-2*day,to)}={}){
 const fundingFrom=from-2*day;await store.put(item,'candles',bars,{checked:[[from,to]]});await store.put(item,'funding',records,{checked:[[fundingFrom,to]]});assert.equal(await store.complete(item,{from,to,fundingFrom}),true);return {bars,records};
}
const legacy=()=>({app:'funding-chart-batch-v1',version:1,exportedAt:1,pages:[],jobs:[],favorites:['BYBIT:AKEUSDT']});

test('old verified candle and funding pages are carried over; collection skips known ranges and appends only the tail',async()=>{
 const cache=C.memory(),archive=S.memory(),end=start+3*day,all=candles(start,end+360),settled=funding(start-2*day,end+3600),middle=all.slice(480,1800),part=settled.slice(0,48);
 const candleKey=JSON.stringify(['candles-v3',m.exchange,m.symbol,'1m',middle[0].time,middle.at(-1).time]),fundingKey=JSON.stringify(['page-v1','funding',m.exchange,m.symbol,end*1000,1]);
 await cache.put(candleKey,{...C.packCandles(middle),timeframe:'1m',closedVerified:true});await cache.put(fundingKey,part);
 const p=JSON.parse(JSON.stringify(await cache.exportAll())),migration=await H.carryLegacy(archive,C.backupHistoryEntries(p),{Cache:C,cutoff:end+60});
 assert.equal(migration.pages,2);assert.equal((await archive.state(m)).candles.count,middle.length);
 const io=source(all,settled),o={store:archive,item:m,from:start,to:end,candlePage:io.candlePage,fundingPage:io.fundingPage,now:()=>(end+7200)*1000};
 const a=await H.collect(o);assert.equal(a.state.candles.count,(end-start)/60);assert.equal(a.state.completed.to,end);assert.equal(a.received,(end-start)/60-middle.length);
 assert.ok(io.calls.filter(c=>c.tf!=='funding').every(c=>c.tf==='1m'&&(c.edge<middle[0].time*1000||c.edge>middle.at(-1).time*1000)));
 const n=io.calls.length;const repeat=await H.collect(o);assert.equal(io.calls.length,n);assert.equal(repeat.received,0);
 const more=await H.collect({...o,to:end+360});assert.equal(more.received,6);assert.equal(more.pages,1);assert.equal(more.state.candles.count,a.state.candles.count+6);assert.equal(more.state.completed.to,end+360);
});

test('interrupted collection retains committed history and resumes below the saved edge',async()=>{
 const store=S.memory(),end=start+8*day,rows=candles(start,end),io=source(rows,funding(start-2*day,end)),controller=new AbortController(),config={store,item:m,from:start,to:end,candlePage:io.candlePage,fundingPage:io.fundingPage,now:()=>end*1000};
 await assert.rejects(H.collect({...config,signal:controller.signal,onProgress:p=>{if(p.phase==='research-candles'&&p.count>=5000)controller.abort();}}),{name:'AbortError'});
 const before=await store.state(m);assert.ok(before.candles.count>=5000);assert.equal(before.completed,null);
 io.calls.length=0;await H.collect(config);assert.ok(io.calls.find(c=>c.tf==='1m').edge<before.candles.first*1000);assert.equal((await store.state(m)).candles.count,rows.length);
});

test('a temporarily missing newest minute is not marked permanently covered',async()=>{
 const store=S.memory(),end=start+day,io=source(candles(start,end-60),funding(start-2*day,end)),common={store,item:m,from:start,to:end,fundingPage:io.fundingPage,now:()=>end*1000};
 const first=await H.collect({...common,candlePage:io.candlePage});assert.equal(first.state.completed.to,end-60);assert.equal(first.incomplete,true);
 const complete=source(candles(start,end),funding(start-2*day,end));
 const again=await H.collect({...common,candlePage:complete.candlePage});assert.equal(again.received,1);assert.equal(again.state.completed.to,end);
});

test('stored minute records aggregate exactly across week and month boundaries without filling a gap',async()=>{
 const store=S.memory(),end=Date.UTC(2025,2,1)/1000,rows=candles(start,end);rows.splice(137,1);
 const seeded=await seed(store,m,start,end,{bars:rows}),config={...base,timeframe:'all',endTime:end};
 const offline=await H.dataset(store,m,config),from=offline.coverage;
 for(const tf of Object.keys(T.seconds)){
  const expected=tf==='1m'?rows:T.resample(rows,tf);
  assert.equal(from[tf].count,expected.length,tf);
  assert.deepEqual(B.toArray(offline.timeframeCandles[tf]),expected,tf);
 }
 assert.equal(offline.coverage['1M'].count,1);assert.ok(offline.gapsCount>0);
 const single=await H.dataset(store,m,{...config,timeframe:'3m'});
 assert.deepEqual(Object.keys(single.timeframeCandles),['3m']);assert.deepEqual(single.fundingRecords,seeded.records);
 const micro=await H.dataset(store,m,{...config,timeframe:'1h',splitTrigger:'rsi_cross_up_1m'});assert.deepEqual(Object.keys(micro.timeframeCandles),['1h','1m']);
});

test('one portable file restores exact raw data, chosen settings and stable result identity into a blank store',async()=>{
 const src=S.memory(),restored=S.memory(),end=start+day+360,settings={...base,endTime:end,timeframe:'3m'},old=legacy(),series=await seed(src,m,start,end);
 old.jobs=[{id:'saved-run',config:{...settings,splitCount:10},items:[],status:'done',updated:1}];
 const parts=[],saved=await File.write(src,old,{write:p=>parts.push(p)}),file=new Blob(parts),out=await File.restore(file,restored);
 assert.equal(saved.bytes,file.size);assert.equal(out.markets,1);assert.deepEqual(out.legacy,old);
 assert.equal((await restored.state(m)).signature,(await src.state(m)).signature);
 const config=H.profile(await restored.state(m),settings,{localOnly:true}).config,expected=H.profile(await src.state(m),settings,{localOnly:true}).config;
 assert.equal(config.cacheRangeEnd,expected.cacheRangeEnd);
 const loaded=await H.dataset(restored,m,settings);assert.deepEqual(loaded.fundingRecords,series.records);assert.deepEqual(B.toArray(loaded.timeframeCandles['3m']),T.resample(series.bars,'3m'));
 const count=(await restored.snapshot()).keys.length;await File.restore(file,restored);assert.equal((await restored.snapshot()).keys.length,count);assert.equal((await restored.state(m)).signature,(await src.state(m)).signature);
 assert.equal(await File.isResearch(new Blob([JSON.stringify(old)])),false);
});

test('truncated or damaged raw backups never mark partial data as ready',async()=>{
 const src=S.memory(),dst=S.memory(),parts=[];await seed(src,m,start,start+day);await File.write(src,legacy(),{write:p=>parts.push(p)});
 const file=new Blob(parts),cut=file.slice(0,-8);await assert.rejects(File.restore(cut,dst),/끝까지/);assert.equal((await dst.snapshot()).keys.length,0);
 const raw=new Uint8Array(await file.arrayBuffer());raw[raw.length-32]^=1;
 await assert.rejects(File.restore(new Blob([raw]),dst),/무결성/);assert.notEqual((await dst.state(m))?.completed?.to,start+day);
});

function realWorker(store,results){
 const calls={network:0,datasets:0,compute:0},pending=new Map(),mod={...H,async dataset(...args){calls.datasets++;return H.dataset(...args);}},ctx={importScripts(){},postMessage(event){if(event.marketRequest||event.archiveRequest){calls.network++;pending.get(event.id)?.({error:{message:'unexpected exchange request'}});}if(event.error||event.output)pending.get(event.id)?.(event);},AbortController,Date,TimeframeEngine:T,BacktestCache:{...C,open:async()=>C.memory()},BacktestResults:{...R,getDefault:async()=>results},BacktestResearch:mod,BacktestResearchStore:{...S,getDefault:async()=>store},BacktestData:{...D,create:()=>({loadBacktestDataset(){calls.network++;throw Error('original data was fetched');}})},MarketAPI:{},DashboardModel:M,BacktestEngine:{...E,runBacktest(...args){calls.compute++;return E.runBacktest(...args);}},BacktestBars:B};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../backtest-batch-worker.js'),'utf8'),ctx);
 let id=0;return {calls,run(config){return new Promise(resolve=>{const current=++id;pending.set(current,resolve);void ctx.onmessage({data:{id:current,market:m,detail:true,config:{...config,researchOnly:true}}});});}};
}
test('actual worker changes RSI and split values on archived candles, reuses the same data and never calls an exchange',async()=>{
 const archive=S.memory(),results=R.memory(),end=start+3*day;await seed(archive,m,start,end);
 const worker=realWorker(archive,results),config={...base,endTime:end},old=await worker.run({...config,splitCount:10,rsiOversold:45});
 assert.ok(!old.error,old.error?.message);assert.equal(old.output.result.config.splitCount,10);
 const current=await worker.run({...config,splitCount:1,rsiOversold:25});assert.ok(!current.error,current.error?.message);
 assert.ok(current.output.result.trades.length>0);assert.equal(current.output.result.config.rsiOversold,25);
 assert.notEqual(old.output.result.summary.totalTrades,current.output.result.summary.totalTrades);
 assert.ok(current.output.result.trades.every(t=>t.entries.length===1&&t.splitTarget===1));
 assert.deepEqual(worker.calls,{network:0,datasets:1,compute:2});
 const same=await worker.run({...config,splitCount:1,rsiOversold:25});assert.ok(same.output.meta.reuse);assert.deepEqual(worker.calls,{network:0,datasets:1,compute:2});
 const other=await worker.run({...config,timeframe:'1h',splitCount:1,rsiOversold:25});assert.equal(other.output.result.config.timeframe,'1h');assert.deepEqual(worker.calls,{network:0,datasets:2,compute:3});
});

test('a restored all-timeframe batch reuses all 143 recorded summaries with no worker, but a changed split never reuses 10-entry results',async()=>{
 const store=C.memory(),config={...base,timeframe:'all',startTime:H.earliest,cacheRangeEnd:'latest',splitCount:10,reuseCompleted:true},markets=Array.from({length:143},(_,i)=>({exchange:'BYBIT',symbol:'TEST'+i+'USDT'})),s={totalTrades:4,netPnl:2,totalReturnPct:1,timeframe:'3m'};
 // Older backup includes genuine comparisons but no complete detail cache.
 const old={id:'original-all',allHistory:true,updated:1,status:'done',config,items:markets.map(m=>({...m,status:'done',summary:{bestTimeframe:'3m'},comparison:[s]}))};
 await store.importAll({...legacy(),jobs:[old]});let executions=0;
 const runner=Batch.create({store,validateStrategy:R.sameStrategy,lookup:async(ms,c)=>ms.map(m=>R.savedSummary(R.batchCandidates([old],m,c,{sameRange:true})[0])),execute:async(m,c)=>{executions++;return {summary:{...s},meta:{market:{ex:m.exchange,symbol:m.symbol,int:c.timeframe},config:c}};}});
 const restored=await runner.restore(),range=Batch.rangeFor('all',config,restored,R.sameStrategy);assert.ok(range.allHistory);assert.equal(range.fixedRange.endTime,config.endTime);
 await runner.start(markets,config,range);assert.equal(executions,0);assert.ok(runner.snapshot().items.every(i=>i.status==='done'&&i.summary.bestTimeframe==='3m'));
 const changed={...config,splitCount:1};assert.equal(Batch.rangeFor('all',changed,restored,R.sameStrategy).fixedRange,null);
 await runner.start(markets.slice(0,2),changed,{allHistory:true});assert.equal(executions,2);assert.ok(runner.snapshot().items.every(i=>i.meta.config.splitCount===1));
});

test('a detail file with a 10-entry body under a 1-entry result key is not accepted',async()=>{
 const rows=T.resample(candles(start,start+day),'3m'),records=funding(start-2*day,start+day),one={...base,endTime:start+day},ten={...one,splitCount:10},detail=E.runBacktest(rows,records,ten),fresh=E.runBacktest(rows,records,one),store=R.memory();
 const meta={market:{ex:m.exchange,symbol:m.symbol,int:'3m'},startTime:start,endTime:one.endTime,coverage:{},fundingCoverage:{}};
 assert.equal(await store.save(m,one,detail,meta),false);
 await store.save(m,ten,detail,meta);await store.save(m,one,fresh,meta);
 const backup=await store.exportAll(),a=backup.entries.find(e=>e.head.meta.config.splitCount===1),b=backup.entries.find(e=>e.head.meta.config.splitCount===10);a.payload=b.payload;
 const target=R.memory(),restored=await target.importAll(backup);assert.equal(restored.imported,1);assert.equal(restored.skipped,1);assert.equal(await target.find(m,one),null);assert.ok(await target.find(m,ten));
});

test('a restored fragment is not ready for a new raw-only batch, and an out-of-range period is distinguished',async()=>{
 const archive=S.memory(),end=start+day,fragment={...m,symbol:'FRAGMENTUSDT'},ready={...m,symbol:'READYUSDT'},absent={...m,symbol:'ABSENTUSDT'};
 const bars=candles(start,end),records=funding(start-2*day,end);
 await archive.put(fragment,'candles',bars.slice(-30),{checked:[[end-30*60,end]]});await archive.put(fragment,'funding',records.slice(-1));
 await seed(archive,ready,start,end,{bars,records});
 const states=await archive.states(),c={...base,timeframe:'all',endTime:end};
 const checked=H.checkBatch([fragment,ready,absent],states,c);assert.deepEqual(checked.ready,[ready]);assert.deepEqual(checked.missing,[{item:fragment,reason:'source'},{item:absent,reason:'source'}]);
 const wrongPeriod=H.checkBatch([ready],states,{...c,startTime:end+60,endTime:end+3600});assert.deepEqual(wrongPeriod.missing,[{item:ready,reason:'period'}]);
 const noMonth=H.checkBatch([ready],states,{...c,timeframe:'1M'});assert.deepEqual(noMonth.missing,[{item:ready,reason:'period'}]);
});
