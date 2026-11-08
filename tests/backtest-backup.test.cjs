'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Backup=require('../backtest-backup.js'),Cache=require('../backtest-cache.js'),Favorites=require('../coin-favorites.js');
const Batch=require('../backtest-batch.js');
const payload=()=>({version:1,app:'funding-chart-batch-v1',exportedAt:1,pages:[],jobs:[],favorites:['BINANCE:AKEUSDT','BYBIT:BTCUSDT']});
function downloadEnvironment(picker){
 const calls=[],links=[],env={
  Blob,
  URL:{createObjectURL(file){calls.push('url');links.push(file);return 'blob:test';},revokeObjectURL(){calls.push('revoke');}},
  setTimeout(fn,ms){assert.ok(ms>=60000);env.cleanup=fn;},
  document:{body:{appendChild(){calls.push('append');}},createElement(){return {click(){calls.push('click');},remove(){calls.push('remove');}};}}
 };
 if(picker)env.showSaveFilePicker=picker;return {env,calls,links};
}
test('the save picker is invoked synchronously before any asynchronous cache reads or serialization',async()=>{
 const order=[],written=[],env={Blob,showSaveFilePicker(){order.push('picker');return Promise.resolve({async createWritable(){return {async write(file){written.push(file);},async close(){order.push('close');}};}});}};
 const p=Backup.save({environment:env,readBackup:async()=>{order.push('read');return payload();}});assert.deepEqual(order,['picker']);const result=await p;assert.deepEqual(order,['picker','read','close']);assert.equal(result.method,'file');assert.equal(result.favorites,2);assert.deepEqual(JSON.parse(await written[0].text()),payload());
});
test('Firefox downloads and blocked picker contexts both produce a complete, attached downloadable file',async()=>{
 for(const picker of [undefined,()=>Promise.reject(Object.assign(Error('activation blocked'),{name:'SecurityError'})),()=>{throw Object.assign(Error('unsupported'),{name:'NotAllowedError'});}]){
  const {env,calls,links}=downloadEnvironment(picker),result=await Backup.save({environment:env,readBackup:async()=>payload()});assert.equal(result.method,'download');assert.deepEqual(calls,['url','append','click','remove']);assert.deepEqual(JSON.parse(await links[0].text()),payload());env.cleanup();assert.equal(calls.at(-1),'revoke');
 }
});
test('cancelling the save dialog reads no data and does not start an unexpected fallback download',async()=>{
 let reads=0;const {env,calls}=downloadEnvironment(()=>Promise.reject(Object.assign(Error('cancelled'),{name:'AbortError'})));await assert.rejects(Backup.save({environment:env,readBackup:async()=>{reads++;return payload();}}),{name:'AbortError'});assert.equal(reads,0);assert.deepEqual(calls,[]);
});
test('disk write failure aborts a partial file and is surfaced instead of reporting a successful backup',async()=>{
 let aborted=false;const env={Blob,showSaveFilePicker:()=>({createWritable:async()=>({write:async()=>{throw Error('disk full');},close:async()=>{},abort:async()=>{aborted=true;}})})};await assert.rejects(Backup.save({environment:env,readBackup:async()=>payload()}),/disk full/);assert.equal(aborted,true);
});
test('large backups yield between chunks and retain all pages and metadata exactly',async()=>{
 const p={...payload(),pages:Array.from({length:251},(_,i)=>({key:'page-'+i,data:{price:.12345678901234+i}}))};let yields=0;const file=await Backup.blob(p,{yieldControl:async()=>{yields++;}});assert.equal(yields,2);assert.deepEqual(JSON.parse(await file.text()),p);assert.match(Backup.filename(Date.UTC(2026,10,6,16,3,4)),/2026-11-07-01-03-04-KST.dat$/);
});
test('backup restores favorites, fixed strategy and progress with exact Float64 data and replaces the prior watchlist',async()=>{
 const store=Cache.memory(),favorites=Favorites.create(),target=Cache.memory(),other=Favorites.create();favorites.change(['BINANCE:AKEUSDT','BYBIT:BTCUSDT'],true);other.change(['MEXC:SNTUSDT'],true);
 const bars=[{time:1,open:.000000123456789,high:2,low:0,close:1,volume:100}],config={timeframe:'3m',startTime:100,endTime:200,minFundingRate:-.6,entryCooldownBars:150},job={id:'job',updated:1,status:'paused',config,items:[{exchange:'BINANCE',symbol:'AKEUSDT',status:'done',summary:{netPnl:12}}]};await store.put('bars',Cache.packCandles(bars));await store.saveJob(job);
 const p={...await store.exportAll(),favorites:favorites.snapshot().keys},serialized=JSON.parse(await (await Backup.blob(p)).text());const result=await Backup.restore(serialized,{store:target,favorites:other,parseKey:Favorites.parseKey});assert.equal(result.addedFavorites,2);assert.deepEqual(other.snapshot().keys,['BINANCE:AKEUSDT','BYBIT:BTCUSDT']);assert.deepEqual(Cache.unpackCandles(await target.get('bars')),bars);assert.deepEqual(await target.latestJob(),job);const before=(await target.info()).bytes;await Backup.restore(serialized,{store:target,favorites:other,parseKey:Favorites.parseKey});assert.equal((await target.info()).bytes,before);assert.equal(other.snapshot().size,2);
});
test('old backups without favorites remain readable; malformed favorites or market pages cannot modify existing data',async()=>{
 const store=Cache.memory(),favorites=Favorites.create();favorites.change(['BINANCE:AKEUSDT'],true);const options={store,favorites,parseKey:Favorites.parseKey},old={...payload()};delete old.favorites;await Backup.restore(old,options);
 await assert.rejects(Backup.restore({...payload(),favorites:['WRONG:BTCUSDT']},options),/즐겨찾기/);await assert.rejects(Backup.restore({...payload(),pages:[{key:'x',data:{kind:'ohlcv-page-v2',count:2,values:[]}}]},options),/캔들/);assert.deepEqual(favorites.snapshot().keys,['BINANCE:AKEUSDT']);assert.deepEqual(await store.keys(),[]);
});

test('a file replaces the watchlist exactly, including an explicitly empty list, with local undo',async()=>{
 const store=Cache.memory(),favorites=Favorites.create(),options={store,favorites,parseKey:Favorites.parseKey};
 favorites.replace(['BINANCE:AKEUSDT','MEXC:SNTUSDT']);
 const swapped=await Backup.restore(payload(),options);assert.equal(swapped.addedFavorites,1);assert.equal(swapped.removedFavorites,1);assert.deepEqual(favorites.snapshot().keys,payload().favorites);
 assert.equal(favorites.undo(),true);assert.deepEqual(favorites.snapshot().keys,['BINANCE:AKEUSDT','MEXC:SNTUSDT']);
 const cleared=await Backup.restore({...payload(),favorites:[]},options);assert.equal(cleared.localFavorites,0);assert.equal(cleared.removedFavorites,2);
});

test('twelve new saved views retain the original all-frame result, and restore prefers complete results to a partial attempt',async()=>{
 const store=Cache.memory(),markets=Array.from({length:173},(_,i)=>({exchange:'BYBIT',symbol:'MULTI'+i+'USDT'})),config={timeframe:'all',startTime:100,endTime:200},source={id:'full',status:'done',updated:1,config,items:markets.map(m=>({...m,status:'done',summary:{totalTrades:2,netPnl:1}}))};
 const partial={...source,id:'partial',updated:2,status:'paused',config:{...config,timeframe:'3m'},items:source.items.map((m,i)=>i?{...m,status:'pending'}:m)};
 await store.importAll({...payload(),activeJobId:partial.id,jobs:[source,partial]});assert.equal((await store.activeJob()).id,source.id);
 for(let i=0;i<12;i++)await store.saveJob({...source,id:'view-'+i,updated:i+3,config:{...config,timeframe:'1m'},sourceJobId:source.id});
 assert.equal((await store.listJobs()).length,3);assert.deepEqual(await store.getJob(source.id),source);assert.equal((await store.activeJob()).id,'view-11');
});

test('reimporting a 139-coin completed backup opens that run ahead of newer empty or partial attempts',async()=>{
 const store=Cache.memory(),favorites=Favorites.create(),options={store,favorites,parseKey:Favorites.parseKey},config={timeframe:'1m',startTime:100,endTime:200,cacheRangeEnd:'latest',minFundingRate:-.6};
 const markets=Array.from({length:139},(_,i)=>({exchange:'BINANCE',symbol:'DEMO'+i+'USDT'})),items=markets.map((m,i)=>({...m,status:'done',summary:{totalTrades:7+i,netPnl:i-4}}));
 const completed={id:'saved-full',updated:1,status:'done',allHistory:true,config,items},legacy={...payload(),jobs:[completed],favorites:markets.map(m=>m.exchange+':'+m.symbol)},runner=Batch.create({store,execute:()=>{throw Error('restoring must not execute');}});
 await store.saveJob({...completed,id:'new-blank',updated:9,status:'paused',config:{...config,timeframe:'3m'},items:markets.map(m=>({...m,status:'pending'}))});
 assert.equal((await Backup.restore(legacy,options)).restoredJobId,completed.id);assert.deepEqual(await runner.restore(),completed);assert.equal(favorites.snapshot().size,139);
 for(let i=10;i<14;i++)await store.saveJob({...completed,id:'attempt-'+i,updated:i,status:'paused',config:{...config,timeframe:i%2?'3m':'1m'},items:markets.map((m,j)=>({...m,status:j===0?'done':'pending'}))});
 assert.equal((await runner.restore()).id,'attempt-13');assert.deepEqual(await runner.restore(completed.id),completed);
 const stale={...completed,updated:20,status:'paused',items:items.slice(0,70).concat(markets.slice(70).map(m=>({...m,status:'pending'})))};
 await Backup.restore({...legacy,jobs:[stale]},options);assert.deepEqual(await runner.restore(),completed);
 const restored=await Backup.restore(legacy,options);assert.equal(restored.restoredJobId,completed.id);assert.deepEqual(await runner.restore(),completed);assert.equal((await store.exportAll()).activeJobId,completed.id);
});

test('a new backup remembers the selected completed run even when another completed run is newer',async()=>{
 const store=Cache.memory(),config={timeframe:'1m',startTime:100,endTime:200},item={exchange:'BYBIT',symbol:'BTCUSDT',status:'done',summary:{totalTrades:1,netPnl:2}};
 const first={id:'first',updated:1,status:'done',config,items:[item]};await store.saveJob(first);await store.saveJob({...first,id:'later',updated:2,config:{...config,timeframe:'3m'}});await store.selectJob(first.id);
 const target=Cache.memory(),data=JSON.parse(await (await Backup.blob(await store.exportAll())).text());assert.equal((await target.importAll(data)).restoredJobId,first.id);assert.deepEqual(await target.activeJob(),first);
});

test('restoring 173 favorites chooses the matching completed run over a selected, completed 139-coin run',async()=>{
 const store=Cache.memory(),favorites=Favorites.create(),config={timeframe:'all',startTime:100,endTime:200,splitCount:1};
 const items=Array.from({length:173},(_,i)=>({exchange:'BINANCE',symbol:'COIN'+i+'USDT',status:'done',summary:{totalTrades:i}})),keys=items.map(i=>i.exchange+':'+i.symbol);
 const legacy={id:'older-139',updated:2,status:'done',config,items:items.slice(0,139)},full={...legacy,id:'full-173',updated:1,items};
 favorites.replace(keys.slice(0,139));await store.saveJob(legacy);
 const file={...payload(),activeJobId:legacy.id,jobs:[legacy,full],favorites:keys};
 assert.deepEqual(Backup.readFavorites(file,Favorites.parseKey),keys);
 const restored=await Backup.restore(file,{store,favorites,parseKey:Favorites.parseKey});
 assert.equal(restored.localFavorites,173);assert.equal(restored.addedFavorites,34);assert.equal(restored.restoredJobId,full.id);
 assert.deepEqual(favorites.snapshot().keys,keys);assert.deepEqual(await store.activeJob(),full);assert.deepEqual(await store.getJob(legacy.id),legacy);
});

test('starting a different strategy after an all-frame replay preserves the original portable run',async()=>{
 const store=Cache.memory(),config={timeframe:'all',startTime:100,endTime:200,splitCount:1},items=[{exchange:'BYBIT',symbol:'BTCUSDT',status:'done',summary:{totalTrades:1}}];
 const original={id:'all-original',updated:1,status:'done',config,items};await store.saveJob(original);
 const replay={...original,id:'all-replay',updated:2,sourceJobId:original.id,items:items.map(i=>({...i,meta:{reuse:{snapshotEnd:200}}}))};await store.saveJob(replay);
 await store.saveJob({...replay,id:'view-1m',updated:3,config:{...config,timeframe:'1m'}});
 await store.saveJob({...original,id:'new-10-split',updated:4,status:'paused',config:{...config,splitCount:10},items:items.map(i=>({...i,status:'pending'}))});
 assert.equal((await store.activeJob()).id,'new-10-split');assert.deepEqual(await store.getJob(original.id),original);
});
