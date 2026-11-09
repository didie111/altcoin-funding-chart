'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const S=require('../backtest-research-store.js'),H=require('../backtest-research.js'),File=require('../backtest-research-file.js'),C=require('../backtest-cache.js'),R=require('../backtest-results.js'),Batch=require('../backtest-batch.js'),B=require('../backtest-bars.js'),T=require('../timeframes.js'),E=require('../backtest-engine.js'),D=require('../backtest-data.js'),M=require('../dashboard-model.js');
const day=86400,start=Date.UTC(2025,0,1)/1000,m={exchange:'BYBIT',symbol:'AKEUSDT'},base=E.normalizeConfig({timeframe:'3m',startTime:start,endTime:start+7*day,rsiPeriod:6,rsiOversold:30,splitCount:1,positionSizing:'budget',splitTrigger:'step_pct',stopLossPct:0});
const minute=(time,i)=>{const open=100+6*Math.sin((i-1)/13),close=100+6*Math.sin(i/13);return {time,open,high:Math.max(open,close)+.3,low:Math.min(open,close)-.3,close,volume:1+(i%17+17)%17+.000000123456789};};
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

function realWorker(store,results,io){
 const calls={network:0,datasets:0,compute:0},pending=new Map(),mod={...H,async dataset(...args){calls.datasets++;return H.dataset(...args);}},ctx={importScripts(){},postMessage(event){if(event.marketRequest||event.archiveRequest){calls.network++;pending.get(event.id)?.({error:{message:'unexpected exchange request'}});}if(event.error||event.output)pending.get(event.id)?.(event);},AbortController,Date,TimeframeEngine:T,BacktestCache:{...C,open:async()=>C.memory()},BacktestResults:{...R,getDefault:async()=>results},BacktestResearch:mod,BacktestResearchStore:{...S,getDefault:async()=>store},BacktestData:{...D,...(io?{candlePage:io.candlePage,fundingPage:io.fundingPage}:{}),create:()=>({loadBacktestDataset(){calls.network++;throw Error('the entire dataset was fetched');}})},MarketAPI:{},DashboardModel:M,BacktestEngine:{...E,runBacktest(...args){calls.compute++;return E.runBacktest(...args);}},BacktestBars:B};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../backtest-batch-worker.js'),'utf8'),ctx);
 let id=0;return {calls,run(config){return new Promise(resolve=>{const current=++id;pending.set(current,resolve);void ctx.onmessage({data:{id:current,market:m,detail:true,config:{...config,researchOnly:config.researchOnly??true}}});});}};
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

test('the batch worker changes entry multipliers from archived inputs without fetching or preparing the candles twice',async()=>{
 const archive=S.memory(),results=R.memory(),end=start+day;await seed(archive,m,start,end);
 const worker=realWorker(archive,results),settings={...base,endTime:end,rsiOversold:50,splitCount:3,splitTrigger:'bar',dcaMethod:'cumulative',takeProfitPct:0,stopLossPct:0,maxHoldBars:12,positionSizing:'first_entry',firstEntryAmount:1000};
 const first=await worker.run({...settings,dcaMultipliers:[2,2]}),changed=await worker.run({...settings,dcaMultipliers:[1,2]});
 assert.equal(first.error,undefined,first.error?.message);assert.equal(changed.error,undefined,changed.error?.message);
 assert.deepEqual(first.output.result.trades.find(t=>t.entries.length===3).entries.map(e=>e.cost),[1000,2000,4000]);
 assert.deepEqual(changed.output.result.trades.find(t=>t.entries.length===3).entries.map(e=>e.cost),[1000,1000,2000]);
 assert.deepEqual(worker.calls,{network:0,datasets:1,compute:2});
 const repeated=await worker.run({...settings,dcaMultipliers:[1,2]});assert.equal(repeated.output.meta.reuse.networkRequests,0);assert.deepEqual(worker.calls,{network:0,datasets:1,compute:2});
});

test('ordinary execution after restoring raw inputs calculates current settings through the saved cutoff, then reuses the new result',async()=>{
 const original=S.memory(),archive=S.memory(),results=R.memory(),end=start+3*day;
 await seed(original,m,start,end);const parts=[];await File.write(original,legacy(),{write:p=>parts.push(p)});await File.restore(new Blob(parts),archive);
 const worker=realWorker(archive,results),settings={...base,endTime:end+day,rsiOversold:42,splitCount:5,researchOnly:false,reuseCompleted:true};
 const outcome=await worker.run(settings);
 assert.equal(outcome.error,undefined,outcome.error?.message);assert.equal(outcome.output.result.config.endTime,end);assert.equal(outcome.output.result.config.splitCount,5);
 assert.equal(outcome.output.result.config.rsiOversold,42);assert.equal(outcome.output.meta.research.cutoffDiffers,true);assert.equal(outcome.output.meta.research.through,end);
 assert.deepEqual(worker.calls,{network:0,datasets:1,compute:1});
 const same=await worker.run(settings);assert.equal(same.output.meta.reuse.networkRequests,0);assert.deepEqual(worker.calls,{network:0,datasets:1,compute:1});
 const target=H.executionProfile(await archive.state(m),settings),found=await R.findBatch(results,[],[m],settings,{archivedPairs:async()=>[{market:m,config:target.config}]});
 assert.equal(found[0].meta.reuse.networkRequests,0);assert.equal(found[0].meta.config.splitCount,5);
 assert.equal(H.executionProfile(await archive.state(m),{...settings,startTime:start-60}),null,'must not silently omit an earlier requested period');
 assert.equal(H.executionProfile(await archive.state(m),settings,{strictSnapshot:true}),null,'must not pass off an older cutoff as the archived exact result');
});

test('an explicit fresh backtest extends a portable archive with only the missing candle and funding pages',async()=>{
 const archive=S.memory(),results=R.memory(),end=start+3*day,tail=end+6*60;await seed(archive,m,start,end);
 const io=source(candles(start,tail),funding(start-2*day,end+3600)),worker=realWorker(archive,results,io);
 const outcome=await worker.run({...base,endTime:tail,reuseCompleted:false,researchOnly:false,splitCount:10});
 assert.equal(outcome.error,undefined,outcome.error?.message);assert.equal(outcome.output.result.config.endTime,tail);assert.equal(outcome.output.result.config.splitCount,10);
 assert.equal(outcome.output.meta.research.tailRefreshed,true);assert.deepEqual(worker.calls,{network:0,datasets:1,compute:1});
 assert.deepEqual(io.calls.map(c=>c.tf),['1m','funding']);assert.ok(io.calls.every(c=>c.edge>=end*1000));
 const state=await archive.state(m);assert.equal(state.completed.to,tail);assert.equal(state.candles.count,(tail-start)/60);assert.equal(state.funding.last,end);
});

test('verified archived execution keeps all trades, balances and current strategy and reuses an identical verified run',async()=>{
 const archive=S.memory(),results=R.memory(),end=start+day,from=start-6*3600;
 await seed(archive,m,from,end);
 const worker=realWorker(archive,results),settings={...base,endTime:end,rsiOversold:50,splitCount:3,splitTrigger:'bar',dcaMethod:'cumulative',dcaMultipliers:[2,4],takeProfitPct:0,maxHoldBars:12,positionSizing:'first_entry',firstEntryAmount:300,feePct:.05,slippagePct:.03};
 const original=await worker.run(settings);
 const verified=await worker.run({...settings,researchOnly:false,verifyLatest:true});
 assert.equal(original.error,undefined,original.error?.message);assert.equal(verified.error,undefined,verified.error?.message);
 const a=original.output.result,b=verified.output.result;
 assert.ok(a.trades.some(t=>t.entries.length===3));assert.deepEqual(b.trades.find(t=>t.entries.length===3).entries.map(e=>e.cost),[300,600,2400]);
 for(const key of ['trades','signals','summary','equityCurve','warnings'])assert.deepEqual(b[key],a[key],key);
 assert.equal(verified.output.meta.verification.through,end);
 assert.deepEqual(worker.calls,{network:0,datasets:2,compute:2});
 const repeated=await worker.run({...settings,researchOnly:false,verifyLatest:true});
 assert.equal(repeated.error,undefined,repeated.error?.message);
 assert.equal(repeated.output.meta.reuse.networkRequests,0);assert.equal(repeated.output.meta.verification.through,end);
 assert.deepEqual(repeated.output.result.trades,b.trades);assert.deepEqual(worker.calls,{network:0,datasets:2,compute:2});
});

test('verified execution repairs actual archived candle and settlement gaps without downloading the whole history',async()=>{
 const archive=S.memory(),complete=S.memory(),end=start+day,from=start-6*3600,candleGap=start+192*60,fundingGap=start+7*3600;
 const {bars,records}=await seed(complete,m,from,end);
 await seed(archive,m,from,end,{bars:bars.filter(r=>r.time!==candleGap),records:records.filter(r=>r.time!==fundingGap)});
 const io=source(bars,records),worker=realWorker(archive,R.memory(),io),config={...base,endTime:end,researchOnly:false,verifyLatest:true};
 const expected=await realWorker(complete,R.memory()).run(config),repaired=await worker.run(config);
 assert.equal(expected.error,undefined,expected.error?.message);assert.equal(repaired.error,undefined,repaired.error?.message);
 assert.deepEqual(repaired.output.result.trades,expected.output.result.trades);
 assert.deepEqual(repaired.output.result.summary,expected.output.result.summary);
 assert.equal(repaired.output.meta.research.gapsFilled,true);
 assert.deepEqual(io.calls.map(c=>[c.tf,c.edge]),[['1m',(candleGap+60)*1000-1],['funding',(fundingGap+3600)*1000-1]]);
 assert.deepEqual(worker.calls,{network:0,datasets:2,compute:1});
 assert.equal((await archive.state(m)).candles.count,bars.length);
 assert.equal((await archive.state(m)).funding.count,records.length);
});

test('verified execution preserves the requested cutoff and never publishes a result for a persistent raw-data gap',async()=>{
 const archive=S.memory(),results=R.memory(),end=start+day,from=start-6*3600,gap=start+180*60;
 const {bars,records}=await seed(archive,m,from,end,{bars:candles(from,end).filter(r=>r.time!==gap)});
 const io=source(bars,records),worker=realWorker(archive,results,io),config={...base,endTime:end,researchOnly:false,verifyLatest:true};
 const saved=await worker.run({...config,verifyLatest:false,reuseCompleted:true});
 assert.equal(saved.error,undefined,saved.error?.message);
 const before=worker.calls.compute,blocked=await worker.run(config);
 assert.equal(blocked.error?.name,'DataCoverageError');assert.match(blocked.error.message,/1분봉 1구간/);
 assert.equal(blocked.output,undefined);assert.equal(worker.calls.compute,before);
 const behind=await worker.run({...config,endTime:end+60});
 assert.equal(behind.error?.name,'DataCoverageError');assert.match(behind.error.message,/확정 시점까지/);
 assert.equal(behind.output,undefined);assert.equal(worker.calls.compute,before);
});

test('a missing RSI preparation range is repaired without shortening the strategy period',async()=>{
 const archive=S.memory(),end=start+day,from=start-6*3600;
 const {records}=await seed(archive,m,start,end);
 const io=source(candles(from,end),records),worker=realWorker(archive,R.memory(),io);
 const out=await worker.run({...base,endTime:end,verifyLatest:true,researchOnly:false});
 assert.equal(out.error,undefined,out.error?.message);
 assert.equal(out.output.result.config.startTime,start);assert.equal(out.output.meta.coverage['3m'].warmup,80);
 assert.deepEqual(io.calls.map(c=>[c.tf,c.edge]),[['1m',start*1000-1]]);
});

test('a confirmed change in settlement interval is not treated as an empty funding window',()=>{
 const records=[{time:start-8*3600,intervalHours:4},{time:start-4*3600,intervalHours:4},{time:start,intervalHours:4},{time:start+8*3600,intervalHours:8},{time:start+16*3600,intervalHours:8}].map(r=>({...r,rate:-.6,intervalSource:'official-history'}));
 const end=start+17*3600,data={endTime:end,coverage:{'3m':{first:start}},fundingRecords:records};
 assert.deepEqual(H.verifySnapshot(data,{...base,endTime:end}),{candles:[],funding:[],errors:[]});
 assert.deepEqual(H.verifySnapshot({...data,fundingRecords:records.filter(r=>r.time!==start+8*3600)},{...base,endTime:end}).funding,[[start+8*3600-60,start+16*3600]]);
});

test('a cold verified run distinguishes the earliest provided history from a missing start of a fixed period',async()=>{
 const end=start+day,first=start+60,io=source(candles(first,end),funding(start-2*day,end));
 const data=await D.create(io).loadBacktestDataset(m.symbol,{exchange:m.exchange,intervals:['1m'],packed:true,verifyLatest:true,startTime:start,endTime:end});
 const settings={...base,timeframe:'1m',endTime:end};
 assert.equal(data.oldestProvided['1m'],true);
 assert.match(H.verifySnapshot(data,settings).errors.join(' '),/요청 시작 구간/);
 assert.deepEqual(H.verifySnapshot(data,{...settings,allHistory:true}),{candles:[],funding:[],errors:[]});
 assert.deepEqual(H.verifySnapshot(data,settings,{knownListing:first}),{candles:[],funding:[],errors:[]});
});

test('ordinary one-minute execution fills only the gaps in restored legacy candle and funding fragments',async()=>{
 const archive=S.memory(),ready=start+2*day,end=ready+6*60,from=start-10*day,io=source(candles(start,end),funding(from,ready+3600));
 await archive.put(m,'candles',candles(start,ready),{checked:[[start,ready]]});
 await archive.put(m,'funding',funding(from,ready),{checked:[[from,ready]]});
 assert.equal((await archive.state(m)).completed,null);
 const worker=realWorker(archive,R.memory(),io),out=await worker.run({...base,timeframe:'1m',endTime:end,researchOnly:false,precomputeTimeframes:false});
 assert.equal(out.error,undefined,out.error?.message);assert.equal(out.output.meta.research.gapsFilled,true);
 assert.deepEqual(worker.calls,{network:0,datasets:1,compute:1});assert.deepEqual(io.calls.map(c=>c.tf),['1m','funding']);assert.ok(io.calls.every(c=>c.edge>=ready*1000));
 assert.equal((await archive.state(m)).candles.count,(end-start)/60);
});

test('ordinary 1m downloads can be kept and transferred as verified raw source instead of downloading twice',async()=>{
 const end=start+day,price=candles(start,end),settled=funding(start-2*day,end),io=source(price,settled),adapter=D.create(io);
 const data=await adapter.loadBacktestDataset(m.symbol,{exchange:m.exchange,intervals:['1m'],packed:true,startTime:start,endTime:end});
 assert.deepEqual(data.rawBounds,{from:start,to:end,fundingFrom:start-2*day,fundingTo:end});
 const src=S.memory();assert.deepEqual(await H.retainDataset(src,m,data),{from:start,to:end,fundingFrom:start-2*day});
 const state=await src.state(m),calls=io.calls.length;await H.retainDataset(src,m,data);assert.equal((await src.state(m)).signature,state.signature);
 const picked=[];let activated=false;
 const environment={showSaveFilePicker(){activated=true;return Promise.resolve({async createWritable(){return {write:p=>picked.push(p),close(){}};}});}};
 const saving=File.save(Promise.resolve(src),async includeRaw=>{assert.equal(includeRaw,true);return legacy();},{environment,optional:true});
 assert.equal(activated,true);const saved=await saving;assert.equal(saved.includesRaw,true);assert.equal(saved.favorites,1);
 const dst=S.memory();await File.restore(new Blob(picked),dst);
 const worker=realWorker(dst,R.memory()),output=await worker.run({...base,timeframe:'3m',endTime:end+60,researchOnly:false,splitCount:5});
 assert.equal(output.error,undefined,output.error?.message);assert.equal(output.output.result.config.endTime,end);assert.equal(worker.calls.network,0);
 assert.equal(io.calls.length,calls);
});

test('the same backup action falls back to a valid result file when no raw blocks are saved',async()=>{
 const written=[],environment={showSaveFilePicker:async()=>({async createWritable(){return {write:p=>written.push(p),close(){}};}})};
 const result=await File.save(S.memory(),async raw=>{assert.equal(raw,false);return legacy();},{environment,optional:true});
 const file=new Blob(written);assert.equal(result.includesRaw,false);assert.equal(await File.isResearch(file),false);assert.deepEqual(JSON.parse(await file.text()),legacy());
});

test('a refused native write switches to disk-backed worker parts and produces one restorable backup',async()=>{
 const src=S.memory(),dst=S.memory();await seed(src,m,start,start+day);
 const before=(await src.state(m)).signature,partSize=4096,parts=[],dirs=new Map(),removed=[],progress=[];
 let saved,downloaded=0,aborts=0,directWrites=0,shortWrites=0,cleanup,terminations=0;
 dirs.set('unrelated-origin-data',{kind:'directory'});
 const stale='tmp-research-export-'+(Date.now()-2*day*1000)+'-test.dat';dirs.set(stale,{kind:'file'});
 const dir={
  async *entries(){yield* dirs;},
  async getDirectoryHandle(name){
   const handle={kind:'directory',async getFileHandle(){
    let size=0;const body=new Uint8Array(partSize),entry={
     async createSyncAccessHandle(){return {write(chunk,{at}){assert.equal(at,size);const count=Math.min(733,chunk.length);if(count<chunk.length)shortWrites++;body.set(chunk.subarray(0,count),at);size+=count;return count;},flush(){},close(){}};},
     async getFile(){return new Blob([body.subarray(0,size)]);}
    };parts.push(entry);return entry;
   }};
   dirs.set(name,handle);return handle;
  },
  async removeEntry(name){dirs.delete(name);removed.push(name);}
 };
 const navigator={storage:{getDirectory:async()=>dir}};
 const environment={
  navigator,showSaveFilePicker:async()=>({async createWritable(){return {
   write(){if(++directWrites===8)throw new DOMException('Cannot modify the file','NoModificationAllowedError');},
   close(){assert.fail('The rejected write must not commit');},abort(){aborts++;}
  };}}),
  document:{baseURI:'https://example.test/project/index.html',body:{append(){}},createElement(){return {click(){assert.match(this.download,/\.dat$/);downloaded++;},remove(){}};}},
  URL:{createObjectURL(file){saved=file;return 'blob:fixture';},revokeObjectURL(){}},setTimeout(fn){cleanup=fn;},
  Worker:class{
   constructor(url){
    assert.match(url,/\/project\/backtest-export-worker\.js\?/);
    this.ctx=vm.createContext({navigator,Blob,Uint8Array,onmessage:null,postMessage:data=>this.onmessage({data})});
    vm.runInContext(fs.readFileSync(require.resolve('../backtest-export-worker.js'),'utf8'),this.ctx);
   }
   postMessage(message){void this.ctx.onmessage({data:{...message,limit:partSize}});}
   terminate(){terminations++;}
  }
 };
 const savedInfo=await File.save(src,async()=>legacy(),{environment,onProgress:p=>progress.push(p.phase)});
 assert.deepEqual({method:savedInfo.method,bytes:savedInfo.bytes,aborts,downloaded,terminations},{method:'download',bytes:saved.size,aborts:1,downloaded:1,terminations:1});
 assert.ok(parts.length>1&&shortWrites>0);assert.ok(progress.includes('archive-staging'));assert.deepEqual(removed,[stale]);assert.ok(dirs.has('unrelated-origin-data'));
 assert.equal((await File.restore(saved,dst)).markets,1);assert.equal((await dst.state(m)).signature,before);assert.equal((await src.state(m)).signature,before);
 cleanup();await Promise.resolve();assert.equal(dirs.size,1);assert.ok(dirs.has('unrelated-origin-data'));
});

test('canceling the native file picker never starts another download',async()=>{
 let opened=false;
 const environment={showSaveFilePicker:async()=>{throw new DOMException('Canceled','AbortError');},Worker:class{constructor(){assert.fail('Canceled picker must not start a worker');}}};
 await assert.rejects(File.save({snapshot(){opened=true;}},async()=>legacy(),{environment}),{name:'AbortError'});
 assert.equal(opened,false);
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
