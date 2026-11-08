'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../backtest-results.js'),E=require('../backtest-engine.js'),T=require('../timeframes.js'),D=require('../backtest-data.js'),B=require('../backtest-bars.js'),C=require('../backtest-cache.js'),Batch=require('../backtest-batch.js'),M=require('../dashboard-model.js');
const base=Date.UTC(2024,0,1)/1000,market={exchange:'BYBIT',symbol:'BTCUSDT'},rows=Array.from({length:5000},(_,i)=>{const close=100+7*Math.sin(i/8);return {time:base+i*60,open:close,high:close+1,low:close-1,close,volume:2};}),funding=Array.from({length:140},(_,i)=>({time:base+(i-48)*3600,rate:-.6,intervalHours:1,intervalSource:'official-history'}));
const config=E.normalizeConfig({timeframe:'1m',startTime:base+200*60,endTime:base+5000*60,cacheRangeEnd:base+10*86400,rsiPeriod:6,rsiOversold:50,entryTrigger:'rsi_oversold',precomputeTimeframes:false});
function computed(c=config,tf=c.timeframe){const candles=tf==='1m'?rows:T.resample(rows,tf),result=E.runBacktest(candles,funding,{...c,timeframe:tf},{equityMaxPoints:5000});return {result,meta:{market:{ex:market.exchange,symbol:market.symbol,int:tf},coverage:{[tf]:{first:c.startTime,last:T.start(c.endTime,tf)-T.seconds[tf]}},fundingCoverage:{first:funding[0].time,last:funding.at(-1).time,count:funding.length},gaps:0,startTime:c.startTime,endTime:c.endTime,source:'test-generated',config:result.config}};}
test('compressed completed results retain exact trades, signals, equity, statistics and frozen conditions',async()=>{
 const store=R.memory(),o=computed();assert.ok(o.result.trades.length>0);await store.save(market,config,o.result,o.meta);const heads=await store.find(market,config),actual=await R.fromHeads(store,heads,config,{detail:true});assert.deepEqual(actual.result,o.result);assert.equal(actual.meta.reuse.networkRequests,0);assert.equal(actual.meta.reuse.recalculated,false);assert.equal(actual.meta.reuse.snapshotEnd,config.endTime);assert.ok((await store.info()).bytes<JSON.stringify(o).length);
});
test('reuse isolates exchange, symbol, timeframe, dates, fees, every strategy switch and engine version',async()=>{
 const store=R.memory(),o=computed();await store.save(market,config,o.result,o.meta);
 for(const c of [{...config,timeframe:'3m'},{...config,feePct:.2},{...config,takeProfitPct:4},{...config,oneEntryPerFunding:true},{...config,entryCooldownBars:150},{...config,startTime:config.startTime+60},{...config,cacheRangeEnd:config.cacheRangeEnd+86400}])assert.equal(await store.find(market,c),null);
 assert.equal(await store.find({...market,exchange:'BINANCE'},config),null);assert.equal(await store.find({...market,symbol:'ETHUSDT'},config),null);const exported=await store.exportAll();exported.entries[0].head.version=0;await assert.rejects(R.memory().importAll(exported),/백업/);
});
test('every engine strategy value participates in saved result identity and validation',async()=>{
 const variants={timeframe:'3m',fundingIntervalHours:4,fundingIntervalBasis:'chart',minFundingRate:-.6,maxFundingRate:-2,fundingWindowSeconds:7200,fundingTransitionLookbackSeconds:7200,oneEntryPerFunding:true,entryCooldownBars:4,requireFreshFundingAfterCooldown:false,rsiPeriod:8,rsiOversold:45,rsiSource:'hl2',entryTrigger:'rsi_cross_up',splitCount:10,splitTrigger:'bar',splitStepPct:2,dcaMethod:'martingale',stopLossMode:'after_all_dca',exitType:'composite',takeProfitPct:3,stopLossPct:4,rsiExitLevel:55,maxHoldBars:301,feePct:.08,slippagePct:.06,includeFundingPayment:false,initialCapital:12000,allocationPerTradePct:70,positionSizing:'first_entry',firstEntryAmount:12};
 assert.deepEqual(Object.keys(variants).sort(),Object.keys(E.defaultStrategyConfig).sort());
 const store=R.memory(),{result,meta}=computed();await store.save(market,config,result,meta);
 assert.ok(await store.find(market,config));assert.ok(R.matchesExecution(result,config,config.timeframe,{strictTrades:true}));
 for(const [field,value] of Object.entries(variants)){
  const changed=E.normalizeConfig({...config,[field]:value});assert.notEqual(changed[field],config[field],field);
  assert.equal(await store.find(market,changed),null,field);
  assert.equal(R.matchesExecution(result,changed,changed.timeframe,{strictTrades:true}),false,field);
 }
});

test('snapshot reuse is explicit and distinguishes the saved cutoff from a newer requested end',async()=>{
 const store=R.memory(),o=computed();await store.save(market,config,o.result,o.meta);const newer={...config,endTime:config.endTime+3600};assert.equal(await store.find(market,newer,{snapshot:false}),null);assert.ok(await store.find(market,newer));const saved=await R.fromHeads(store,await store.find(market,newer),newer,{detail:true});assert.equal(saved.result.config.endTime,config.endTime);assert.equal(saved.meta.reuse.snapshotEnd,config.endTime);
});
test('139 cached coin summaries prefill in one batch without invoking any collection or engine task',async()=>{
 const store=R.memory(),jobStore=C.memory(),o=computed(),markets=Array.from({length:139},(_,i)=>({exchange:'BYBIT',symbol:'DEMO'+i+'USDT'}));for(const m of markets)await store.save(m,config,o.result,{...o.meta,market:{ex:m.exchange,symbol:m.symbol,int:'1m'}});let calls=0,updates=0;
 const batch=Batch.create({store:jobStore,execute:async()=>{calls++;throw Error('must not run');},lookup:async(ms,c)=>{const hs=await store.findMany(ms,c);return Promise.all(hs.map(h=>R.fromHeads(store,h,c)));},onUpdate:()=>updates++});const start=performance.now();await batch.start(markets,config);assert.equal(calls,0);assert.equal(batch.snapshot().status,'done');assert.equal(batch.snapshot().items.filter(i=>i.status==='done').length,139);assert.equal(updates,1);console.log('139 cached summaries in memory: '+(performance.now()-start).toFixed(1)+'ms');
});
test('refresh deliberately bypasses prefill; only missing coins collect and previously failed symbols remain visible',async()=>{
 const o=computed(),cached={summary:o.result.summary,meta:{...o.meta,reuse:{snapshotEnd:config.endTime}}};let calls=[];const batch=Batch.create({store:C.memory(),lookup:async()=>[cached,null],execute:async m=>{calls.push(m.symbol);return {...cached,meta:{...cached.meta,market:{ex:m.exchange,symbol:m.symbol,int:'1m'}}};}}),markets=[market,{...market,symbol:'ETHUSDT'}];await batch.start(markets,config);assert.deepEqual(calls,['ETHUSDT']);calls=[];await batch.start(markets,{...config,reuseCompleted:false});assert.deepEqual(calls,['BTCUSDT','ETHUSDT']);
});
test('result backups restore full details across sessions and prune heads and payloads together within the byte limit',async()=>{
 const probe=R.memory(),o=computed();await probe.save(market,config,o.result,o.meta);const limit=Math.ceil((await probe.info()).bytes*3.25),store=R.memory({limit});for(let i=0;i<20;i++)await store.save({...market,symbol:'DEMO'+i+'USDT'},config,o.result,{...o.meta,market:{ex:market.exchange,symbol:'DEMO'+i+'USDT',int:'1m'}});const info=await store.info();assert.ok(info.bytes<=limit);assert.equal(await store.find({...market,symbol:'DEMO0USDT'},config),null);const exported=JSON.parse(JSON.stringify(await store.exportAll())),restored=R.memory({limit}),result=await restored.importAll(exported);assert.equal(result.skipped,0);assert.ok(result.imported>0);const heads=await restored.find({...market,symbol:'DEMO19USDT'},config);assert.deepEqual((await restored.read(heads[0])).result,o.result);const before=(await restored.info()).bytes;await restored.importAll(exported);assert.equal((await restored.info()).bytes,before);
});
test('a seed dataset resamples real minute bars without reloading funding or minute history and preserves native RSI warmup',async()=>{
 const calls=[],source=D.create({candlePage:async(ex,s,tf,edge)=>{calls.push(tf);return (tf==='1m'?rows:T.resample(rows,tf)).filter(r=>r.time*1000<=edge).slice(-1000);},fundingPage:async(ex,s,edge,p)=>{calls.push('funding');return p===1?funding:[];}}),opts={exchange:market.exchange,packed:true,startTime:config.startTime,endTime:config.endTime,rsiPeriod:config.rsiPeriod},seed=await source.loadBacktestDataset(market.symbol,{...opts,intervals:['1m']}),before=calls.length;
 const derived=await source.loadBacktestDataset(market.symbol,{...opts,intervals:['3m','1h'],fastResample:true,seedDataset:seed});assert.ok(!calls.slice(before).includes('1m')&&!calls.slice(before).includes('funding'));const native=await source.loadBacktestDataset(market.symbol,{...opts,intervals:['3m','1h']});for(const tf of ['3m','1h'])assert.deepEqual(E.runBacktest(derived.timeframeCandles[tf],derived.fundingRecords,{...config,timeframe:tf}),E.runBacktest(native.timeframeCandles[tf],native.fundingRecords,{...config,timeframe:tf}));
 await assert.rejects(source.loadBacktestDataset('ETHUSDT',{...opts,intervals:['3m'],seedDataset:seed}),/종목·기간/);
});
function worker(cache,{precompute=false,detail=false,fresh=false,tf='1m',settings={},alterResult=x=>x}={}){let resolve,loads=0,calculations=0;const done=new Promise(r=>resolve=r),source=D.create({candlePage:async(ex,s,t,edge)=>(t==='1m'?rows:T.resample(rows,t)).filter(r=>r.time*1000<=edge).slice(-1000),fundingPage:async(ex,s,edge,p)=>p===1?funding:[]}),scope={importScripts(){},postMessage(v){if(v.output||v.error)resolve(v);},AbortController,Date,TimeframeEngine:T,BacktestResults:{...R,getDefault:async()=>cache},BacktestCache:{open:async()=>C.memory(),adapter:()=>({})},MarketAPI:{},BacktestData:{create:()=>({loadBacktestDataset:(s,o)=>{loads++;return source.loadBacktestDataset(s,o);}})},DashboardModel:M,BacktestEngine:{...E,runBacktest(...args){calculations++;return alterResult(E.runBacktest(...args));}},BacktestBars:B};vm.createContext(scope);vm.runInContext(fs.readFileSync(require.resolve('../backtest-batch-worker.js'),'utf8'),scope);scope.onmessage({data:{id:1,market,config:{...config,...settings,timeframe:tf,precomputeTimeframes:precompute,reuseCompleted:!fresh},detail}});return done.then(v=>({...v,loads,calculations}));}
test('a new worker opens saved detail without loading data or recalculating, while latest refresh really recalculates',async()=>{
 const cache=R.memory(),first=await worker(cache);assert.ok(!first.error,first.error?.message);assert.ok(first.loads&&first.calculations);const detail=await worker(cache,{detail:true});assert.ok(!detail.error,detail.error?.message);assert.equal(detail.loads,0);assert.equal(detail.calculations,0);assert.ok(detail.output.result.trades.length);const fresh=await worker(cache,{detail:true,fresh:true});assert.ok(fresh.loads&&fresh.calculations);
});
test('one minute execution prepares other timeframe results once; subsequent 3m detail opens without any data work',async()=>{
 const cache=R.memory(),first=await worker(cache,{precompute:true});assert.ok(!first.error,first.error?.message);assert.ok(first.output.meta.preparedTimeframes?.includes('3m'));const next=await worker(cache,{tf:'3m',detail:true});assert.ok(!next.error,next.error?.message);assert.equal(next.loads,0);assert.equal(next.calculations,0);assert.equal(next.output.result.config.timeframe,'3m');const monthly=await worker(cache,{tf:'1M',detail:true});assert.match(monthly.error?.message||'',/완성|제공/);assert.equal(monthly.loads,0);
});
test('single-frame and full-frame workers really fill 5 and 10 entries and reject 1-split results labeled as 5',async()=>{
 const cache=R.memory(),setup={takeProfitPct:0,stopLossPct:0,maxHoldBars:24,splitTrigger:'bar',minFundingRate:-.55,rsiOversold:40,feePct:.12,slippagePct:.07,allocationPerTradePct:25,initialCapital:16000,dcaMethod:'martingale'};
 const previous=await worker(cache,{tf:'1m',detail:true,settings:{...setup,splitCount:1}});
 assert.equal(previous.error,undefined,previous.error?.message);assert.ok(previous.output.result.trades.length>0);
 assert.ok(previous.output.result.trades.every(t=>t.splitTarget===1));
 for(const [count,tf] of [[5,'1m'],[10,'all']]){
  const settings={...setup,splitCount:count},execution=await worker(cache,{tf,detail:true,settings});
  assert.equal(execution.error,undefined,execution.error?.message);assert.ok(execution.calculations>0);
  for(const frame of tf==='all'?['1m','3m']:['1m']){
   const requested={...config,...settings,timeframe:frame},heads=await cache.find(market,requested),saved=await R.fromHeads(cache,heads,requested,{detail:true});
   assert.ok(saved?.result,frame);const result=saved.result;
   assert.ok(R.matchesExecution(result,requested,frame,{strictTrades:true}));
   assert.ok(result.trades.some(t=>t.entries.length===count),frame+' should reach the configured split limit');
   assert.ok(result.trades.every(t=>t.splitTarget===count&&t.entries.length<=count));
   for(const [name,value] of Object.entries(settings))assert.equal(result.config[name],value);
  }
 }
 const empty=R.memory(),bad=await worker(empty,{detail:true,settings:{...setup,splitCount:5},alterResult:r=>({...r,trades:r.trades.map(t=>({...t,splitTarget:1}))})});
 assert.match(bad.error?.message||'',/전략|분할/);assert.equal(await empty.find(market,{...config,...setup,splitCount:5}),null);
});

test('a minute captured before its close never reappears as a completed cached candle after the clock crosses the boundary',async()=>{
 const edge=base*1000+59000;let clock=edge,calls=0;const store=C.memory(),adapter=C.adapter({store,now:()=>clock,wait:async()=>{},candlePage:async()=>{calls++;const forming={...rows[0],volume:calls===1?1:100};if(calls===1)clock+=2000;return [{...rows[0],time:base-60},forming];}}),signal=new AbortController().signal;
 await adapter.candlePage(market.exchange,market.symbol,'1m',edge,signal);const complete=await adapter.candlePage(market.exchange,market.symbol,'1m',clock,signal);assert.equal(calls,2);assert.equal(complete.at(-1).volume,100);
});
test('under storage pressure the requested one minute detail is kept ahead of automatically prepared frames',async()=>{
 const first=computed(),derived=computed(config,'3m'),probe=R.memory();await probe.save(market,config,first.result,first.meta);await probe.save(market,config,derived.result,derived.meta);const limit=(await probe.info()).bytes+1000,store=R.memory({limit});await store.save(market,config,first.result,first.meta);
 for(let i=0;i<5;i++)await store.save({...market,symbol:'DEMO'+i+'USDT'},config,derived.result,derived.meta);
 assert.ok(await store.find(market,config));assert.equal(await store.find({...market,symbol:'DEMO0USDT'},{...config,timeframe:'3m'}),null);assert.ok(await store.find({...market,symbol:'DEMO4USDT'},{...config,timeframe:'3m'}));assert.ok((await store.info()).bytes<=limit);
});

const history={...config,startTime:Date.UTC(2009,0,1)/1000,cacheRangeEnd:'latest'};
function historicalJob(o){return {id:'saved-1m',status:'done',allHistory:true,config:history,items:[{...market,status:'done',summary:o.result.summary,meta:o.meta}]};}
test('individual execution can open a completed whole-history batch detail with a different date preset and no other-frame marker',async()=>{
 const store=R.memory(),o=computed(history),job=historicalJob(o),request={...config,precomputeTimeframes:true},listJobs=async()=>[job];
 assert.ok(o.result.trades.length>0);await store.save(market,history,o.result,o.meta);
 const saved=await R.openIndividual(store,market,request,{listJobs});assert.deepEqual(saved.result,o.result);assert.equal(saved.meta.reuse.snapshotEnd,history.endTime);assert.equal(saved.meta.reuse.rangeDiffers,true);
 for(const [m,c] of [[{...market,exchange:'BINANCE'},request],[{...market,symbol:'ETHUSDT'},request],[market,{...request,feePct:.12}],[market,{...request,rsiPeriod:20}],[market,{...request,timeframe:'3m'}],[market,{...request,reuseCompleted:false}]])assert.equal(await R.openIndividual(store,m,c,{listJobs}),null);
 assert.equal(await R.openIndividual(store,market,request,{listJobs,sameRange:true}),null);
 const exact=computed(config);await store.save(market,config,exact.result,exact.meta);assert.deepEqual((await R.openIndividual(store,market,request,{listJobs})).result,exact.result);
});
test('older backups open the real summary immediately and never substitute 1m statistics for 3m trades',async()=>{
 const store=R.memory(),o=computed(history),job=historicalJob(o),c={...config,timeframe:'3m'},listJobs=async()=>[job];
 const row=R.batchCandidate(job,job.items[0],'1m'),saved=await R.openBatchResult(store,row);assert.equal(saved.summaryOnly,true);assert.equal(saved.result,undefined);assert.deepEqual(saved.summary,o.result.summary);assert.equal(saved.detailRequest.config.cacheRangeEnd,'latest');assert.equal(saved.detailRequest.config.endTime,history.endTime);
 assert.equal((await R.openIndividual(store,market,config,{listJobs})).summaryOnly,true);assert.equal(await R.openIndividual(store,market,c,{listJobs}),null);
 const derived=computed(history,'3m');await store.save(market,history,derived.result,derived.meta);const opened=await R.openIndividual(store,market,c,{listJobs});assert.deepEqual(opened.result,derived.result);assert.equal(opened.meta.market.int,'3m');
});
test('starting a different timeframe from a restored range reuses the original snapshot instead of a later run',async()=>{
 const resultStore=R.memory(),jobStore=C.memory(),o=computed(history),job=historicalJob(o),derived=computed(history,'3m'),after={...history,timeframe:'3m',endTime:history.endTime+86400},newer=computed(after);
 await resultStore.save(market,history,derived.result,derived.meta);await resultStore.save(market,after,newer.result,newer.meta);
 assert.equal((await resultStore.find(market,after))[0].snapshotEnd,after.endTime);
 await jobStore.importAll({app:'funding-chart-batch-v1',version:1,pages:[],jobs:[job]});let calls=0;
 const batch=Batch.create({store:jobStore,execute:()=>{calls++;throw Error('unexpected collection');},lookup:async(markets,c)=>Promise.all((await resultStore.findMany(markets,c)).map(h=>R.fromHeads(resultStore,h,c)))});
 await batch.restore();await batch.start([market],{...config,timeframe:'3m'},{allHistory:true,fixedRange:history});
 const saved=batch.snapshot();assert.equal(saved.config.startTime,history.startTime);assert.equal(saved.config.endTime,history.endTime);assert.equal(saved.config.cacheRangeEnd,'latest');assert.equal(saved.items[0].meta.reuse.snapshotEnd,history.endTime);assert.deepEqual(saved.items[0].summary,derived.result.summary);assert.equal(calls,0);assert.deepEqual(await jobStore.getJob(job.id),job);
});
test('a portable backup that fits restores prepared frames even when the destination has a full cache',async()=>{
 const source=R.memory(),o=computed(history),derived=computed(history,'3m');await source.save(market,history,o.result,o.meta);await source.save(market,history,derived.result,derived.meta);
 const limit=(await source.info()).bytes,restored=R.memory({limit});for(let i=0;i<8;i++)await restored.save({...market,symbol:'OTHER'+i+'USDT'},history,o.result,o.meta);
 assert.deepEqual(await restored.importAll(await source.exportAll()),{imported:2,skipped:0});assert.equal((await restored.info()).bytes,limit);
 const head=(await restored.find(market,{...history,timeframe:'3m'}))[0];assert.deepEqual((await restored.read(head)).result,derived.result);
});

test('a restored 143-market batch fills a 173-market list and only calculates the 30 added contracts',async()=>{
 const now=(config.endTime+86400)*1000,startTime=Date.UTC(2009,0,1)/1000,savedConfig={...config,timeframe:'all',startTime,cacheRangeEnd:'latest',reuseCompleted:true};
 const markets=Array.from({length:173},(_,i)=>({exchange:i%2?'BYBIT':'BINANCE',symbol:'GROW'+i+'USDT'})),saved=markets.slice(0,143),added=markets.slice(143),summary={timeframe:'3m',totalTrades:7,netPnl:4,totalReturnPct:1};
 const backup={app:'funding-chart-batch-v1',version:1,pages:[],jobs:[{id:'restored-143',allHistory:true,status:'done',updated:1,config:savedConfig,items:saved.map(m=>({...m,status:'done',summary:{...summary,timeframe:'all',bestTimeframe:'3m'},comparison:[summary]}))}]};
 const store=C.memory();await store.importAll(JSON.parse(JSON.stringify(backup)));const initial=await store.activeJob(),queries=[],executed=[],updates=[];
 const indexed={findMany:async (requested,c,options)=>{queries.push({requested,options});return requested.map(()=>null);}};
 const runner=Batch.create({store,now:()=>now,validateStrategy:R.sameStrategy,lookup:async (ms,c)=>R.findBatch(indexed,await store.listJobs(),ms,c),onUpdate:j=>updates.push(j.items.filter(i=>i.status==='done').length),execute:async (m,c)=>{
  executed.push(m.symbol);assert.equal(c.endTime,now/1000);return {summary:{...summary,timeframe:c.timeframe},meta:{market:{ex:m.exchange,symbol:m.symbol,int:c.timeframe},config:c}};
 }});
 const options=Batch.rangeFor('all',savedConfig,initial,R.sameStrategy,markets);assert.equal(options.fixedRange,null);
 const next=await runner.prepare(markets,savedConfig,options);assert.equal((await store.activeJob()).id,initial.id);assert.equal(executed.length,0);
 assert.equal(next.items.filter(i=>i.status==='done').length,143);assert.equal(next.items[142].meta.reuse.snapshotEnd,savedConfig.endTime);
 assert.equal(queries.length,1);assert.ok(queries[0].options.targeted);assert.deepEqual(queries[0].requested.map(m=>m.symbol),added.map(m=>m.symbol));
 await runner.startPrepared(next);assert.equal(updates[0],143);assert.equal(updates.at(-1),173);assert.deepEqual(executed,added.map(m=>m.symbol));assert.equal(queries.length,1);assert.deepEqual(await store.getJob(initial.id),initial);
});

test('batch reuse accepts matching finished results without archived raw data and rejects other strategies, exchanges and ranges',async()=>{
 const old=historicalJob(computed(history)),c={...history,researchOnly:true,cacheMaxEnd:history.endTime};let archiveChecks=0;
 const cached=R.memory(),archivedPairs=async markets=>{archiveChecks++;return markets.map(()=>null);};
 const matches=await R.findBatch(cached,[old],[market],c,{archivedPairs});assert.equal(archiveChecks,0);assert.equal(matches[0].meta.reuse.networkRequests,0);
 for(const [m,request] of [[market,{...c,rsiOversold:c.rsiOversold-1}],[{...market,exchange:'BINANCE'},c],[market,{...c,startTime:c.startTime+60}],[market,{...c,cacheMaxEnd:c.endTime-60}],[market,{...c,timeframe:'3m'}]])assert.deepEqual(await R.findBatch(cached,[old],[m],request,{archivedPairs}),[null]);
 assert.equal(archiveChecks,5);
});
