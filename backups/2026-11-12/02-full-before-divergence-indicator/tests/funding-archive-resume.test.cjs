'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../funding-archive.js');
const base=Date.UTC(2026,9,27)/1000,hour=3600,row=(time,rate=-.6)=>({time,rate,intervalHours:1,intervalSource:'official-history'}),config={exchange:'BINANCE',from:base,rate:-.5,hours:1};
function setup({exchange='BINANCE',size=5,count=100,store=A.memoryStore()}={}){
 let clock=(base+count*hour)*1000,markets=[{exchange,symbol:'AKEUSDT',listedAt:base}],rows=Array.from({length:count},(_,i)=>row(base+i*hour)),catalogs=0;
 const calls=[],page=async(ex,symbol,cursor,number,signal)=>{signal.throwIfAborted();calls.push({ex,symbol,cursor,number});const list=symbol==='NEWUSDT'?[row(base+(count+1)*hour)]:rows;if(ex==='BINANCE')return list.filter(r=>r.time*1000>=cursor&&r.time*1000<=clock).slice(0,size);if(['BITGET','MEXC'].includes(ex))return [...list].reverse().slice((number-1)*size,number*size);return list.filter(r=>r.time*1000<=cursor).slice(-size);};
 const catalog=async()=>{catalogs++;return {rows:markets};},make=()=>A.create({store,page,catalog,now:()=>clock,pause:async()=>{}});
 return {store,calls,make,add:r=>rows.push(r),market:m=>markets.push(m),advance:ms=>clock+=ms,get clock(){return clock;},get catalogs(){return catalogs;}};
}
test('keys survive KST midnight and zero-match contracts are reused after reload',async()=>{
 assert.equal(A.keyFor(config,Date.UTC(2026,9,30,14,59)),A.keyFor(config,Date.UTC(2026,9,30,15,1)));const f=setup(),one=await f.make().scan({...config,rate:-.9}),before=f.calls.length;assert.equal(one.states[0].matches,0);f.advance(86400000);const r=await f.make().restore({...config,rate:-.9});assert.equal(r.run.id,one.run.id);assert.equal(r.states[0].status,'done');assert.equal(f.calls.length,before);const update=await f.make().scan({...config,rate:-.9});assert.equal(update.reused,1);assert.ok(f.calls.slice(before).every(c=>c.cursor>=(base+52*hour)*1000));
});
test('legacy daily ALL searches migrate matches and zero-match Binance checkpoints with no API request',async()=>{
 const store=A.memoryStore(),cfg=A.options({from:base}),legacy={key:JSON.stringify({...cfg,day:20740}),id:'old-all-daily',config:cfg,to:base+100*hour,createdAt:(base+100*hour)*1000,markets:[{exchange:'BINANCE',symbol:'AKEUSDT'},{exchange:'BINANCE',symbol:'EMPTYUSDT'},{exchange:'BYBIT',symbol:'AKEUSDT'}]};await store.putRun(legacy);
 for(const m of legacy.markets)await store.save(legacy.id,m,{status:'done',cursor:base*1000,pages:20,neighbors:[row(base+99*hour)],first:base,last:base+99*hour},m.symbol==='EMPTYUSDT'?[]:[{time:base+99*hour,rate:-.6,hours:1,source:'official-history'}]);
 const scanner=A.create({store,page:async()=>{throw Error('API must not be used');},catalog:async()=>{throw Error('catalog must not be used');}}),r=await scanner.restore(config);assert.equal(r.states.length,2);assert.equal(r.states.find(s=>s.symbol==='EMPTYUSDT').matches,0);assert.equal((await store.query(r.run.id,{exchange:'BINANCE'})).rows.length,1);const all=await scanner.restore({...config,exchange:'ALL'});assert.equal(all.run.id,r.run.id);assert.equal(all.states.length,3);assert.equal((await store.query(all.run.id)).rows.length,2);assert.equal((await store.query(legacy.id)).rows.length,2);
});
test('migration keeps the best full cursor and unions newer discoveries from incomplete duplicates',async()=>{
 const store=A.memoryStore(),c=A.options(config),market={exchange:'BINANCE',symbol:'AKEUSDT'};for(const [id,status,to,pages] of [['complete','done',base+99*hour,20],['partial','partial',base+100*hour,1]]){await store.putRun({key:id,id,config:c,markets:[market],to});await store.save(id,market,{status,pages},[{time:to-hour,rate:-.6,hours:1}]);}const r=await A.create({store}).restore(config);assert.equal(r.states[0].importedFrom,'complete');assert.equal(r.states[0].status,'done');assert.equal(r.states[0].matches,2);assert.equal((await store.query(r.run.id)).rows.length,2);
});
test('ALL / venue / symbol share results while numeric criteria remain isolated',async()=>{
 const f=setup(),all=await f.make().scan({...config,exchange:'ALL'}),calls=f.calls.length,r=await f.make().restore(config),coin=await f.make().restore({...config,query:'AKE'});assert.equal(r.run.id,all.run.id);assert.equal(coin.run.id,all.run.id);assert.equal(coin.states[0].matches,100);assert.equal(f.calls.length,calls);assert.equal((await f.make().restore({...config,rate:-.7})).run,null);
});
test('expanding a symbol query discovers the full venue even within five minutes',async()=>{
 const store=A.memoryStore(),markets=[{exchange:'BINANCE',symbol:'AKEUSDT',listedAt:base},{exchange:'BINANCE',symbol:'BTCUSDT',listedAt:base}],calls=[],scanner=A.create({store,now:()=>base*1000+3600000,pause:async()=>{},page:async(ex,symbol)=>{calls.push(symbol);return [];},catalog:async()=>({rows:markets})});await scanner.scan({...config,query:'AKE'});assert.deepEqual(calls,['AKEUSDT']);const full=await scanner.scan(config);assert.equal(full.run.markets.length,2);assert.deepEqual(calls,['AKEUSDT','BTCUSDT']);
});
test('expanding an unfinished venue search to ALL loads the other venues without losing its cursor',async()=>{
 const f=setup(),abort=new AbortController();await assert.rejects(f.make().scan(config,{signal:abort.signal,onProgress:p=>{if(p.page===1)abort.abort();}}),{name:'AbortError'});const saved=(await f.make().restore(config)).states[0].cursor;let catalogs=0;const scanner=A.create({store:f.store,now:()=>f.clock,pause:async()=>{},catalog:async()=>{catalogs++;return {rows:[{exchange:'BINANCE',symbol:'AKEUSDT',listedAt:base},{exchange:'BITGET',symbol:'OTHERUSDT',listedAt:base}]};},page:async(ex,symbol,cursor)=>{if(ex==='BITGET')return [];assert.ok(cursor>=saved);return [];}}),r=await scanner.scan({...config,exchange:'ALL'});assert.equal(catalogs,1);assert.equal(r.run.markets.length,2);assert.equal(r.run.status,'done');
});
test('a pass stopped before midnight resumes exactly before updating the newer tail',async()=>{
 const f=setup(),abort=new AbortController();await assert.rejects(f.make().scan(config,{signal:abort.signal,onProgress:p=>{if(p.page===2)abort.abort();}}),{name:'AbortError'});const before=f.calls.length,saved=(await f.make().restore(config)).states[0].cursor;f.advance(86400000);const r=await f.make().scan(config);assert.equal(f.calls[before].cursor,saved);assert.equal(r.states[0].matches,100);assert.equal(r.run.status,'done');assert.ok(r.states[0].checkedTo>base+100*hour);
});
for(const exchange of ['BYBIT','BITGET','MEXC','BINGX','OKX'])test(exchange+' only checks the recent tail of a completed contract',async()=>{
 const f=setup({exchange}),c={...config,exchange};await f.make().scan(c);const before=f.calls.length;f.advance(2*hour*1000);f.add(row(base+101*hour));const r=await f.make().scan(c);assert.equal(r.states[0].matches,101);assert.equal(r.run.status,'done');assert.ok(f.calls.length-before<15);assert.equal(r.reused,1);
});
for(const exchange of ['BITGET','MEXC'])test(exchange+' resumes despite inserted newer front pages',async()=>{
 const f=setup({exchange,size:5,count:30}),c={...config,exchange},abort=new AbortController();await assert.rejects(f.make().scan(c,{signal:abort.signal,onProgress:p=>{if(p.page===1)abort.abort();}}),{name:'AbortError'});for(let i=30;i<40;i++)f.add(row(base+i*hour));f.advance(12*hour*1000);const r=await f.make().scan(c);assert.equal(r.run.status,'done');assert.equal(r.states[0].matches,40);
});
test('new listings are checked first and older contracts never restart at their listing date',async()=>{
 const f=setup();await f.make().scan(config);const before=f.calls.length;f.advance(3*hour*1000);f.market({exchange:'BINANCE',symbol:'NEWUSDT',listedAt:base+101*hour});const r=await f.make().scan(config);assert.equal(r.newMarkets,1);assert.equal(f.calls[before].symbol,'NEWUSDT');assert.ok(f.calls.slice(before).filter(c=>c.symbol==='AKEUSDT').every(c=>c.cursor>=(base+52*hour)*1000));
});
test('refreshes keep one archive and one copy of each settlement',async()=>{
 const f=setup(),a=await f.make().scan(config);for(let i=0;i<4;i++){f.advance(1000);await f.make().scan(config,{fresh:true});}assert.equal((await f.store.allRuns()).length,1);assert.equal((await f.store.query(a.run.id,{size:1000})).rows.length,100);assert.equal((await f.store.states(a.run.id))[0].matches,100);
});
test('Binance normalization retains several contracts sharing the same millisecond',()=>{
 const raw=['AKEUSDT','BTCUSDT','1000TOSHIUSDT'].map(symbol=>({symbol,fundingTime:base*1000+1,fundingRate:'-0.006'})),r=A.binanceBatch(raw,(base+hour)*1000);assert.equal(r.rows.length,3);assert.ok(r.rows.every(r=>r.timeMs===base*1000+1&&r.rate===-.6));assert.throws(()=>A.binanceBatch({}));assert.throws(()=>A.binanceBatch([{symbol:'BTCUSDT',fundingTime:'bad'}]));
});
function bulkFixture({limit=1000,markets=815}={}){
 const store=A.memoryStore(),c=A.options(config),key=A.familyKey(c),contracts=Array.from({length:markets},(_,i)=>({exchange:'BINANCE',symbol:'C'+i+'USDT',listedAt:base})),from=base+100*hour,target=from+2*hour,rows=contracts.flatMap(m=>[0,1].map(i=>({...row(from+i*hour),symbol:m.symbol,timeMs:(from+i*hour)*1000}))).sort((a,b)=>a.timeMs-b.timeMs),calls=[],individual=[];
 return {store,c,key,contracts,target,calls,individual,async init(){await store.putRun({key,id:key,version:2,config:{...c,exchange:'ALL'},markets:contracts,to:from,createdAt:from*1000,migrated:[],catalogChecked:{'BINANCE|':from*1000},catalogErrors:[]});for(const m of contracts)await store.save(key,m,{status:'done',checkedTo:from,checkedAt:from*1000,headReady:true,head:[row(from-hour)],pages:30,records:100,first:base,last:from-hour},[]);},make(overrides={}){return A.create({store,now:()=>target*1000,pause:async()=>{},catalog:async()=>({rows:contracts}),page:async(ex,symbol,cursor)=>{individual.push({symbol,cursor});return rows.filter(r=>r.symbol===symbol&&r.timeMs>=cursor);},binancePage:async(start,end)=>{calls.push({start,end});const page=rows.filter(r=>r.timeMs>=start&&r.timeMs<=end).slice(0,limit);return {rows:page,count:page.length,limit,firstMs:page[0]?.timeMs??null,lastMs:page.at(-1)?.timeMs??null};},...overrides});}};
}
test('815 scanned Binance contracts update through two shared pages instead of 815 historical passes',async()=>{
 const f=bulkFixture();await f.init();const r=await f.make().scan(config);assert.equal(r.reused,815);assert.equal(r.requests,2);assert.equal(f.calls.length,2);assert.equal(f.individual.length,0);assert.ok(r.states.every(s=>s.matches===3&&s.checkedTo===f.target));assert.equal(r.run.status,'done');
});
test('bulk pagination refetches a truncated timestamp boundary without losing coins',async()=>{
 const f=bulkFixture({limit:5,markets:4});await f.init();const r=await f.make().scan(config);assert.equal(f.calls.length,2);assert.ok(r.states.every(s=>s.matches===3));assert.equal(f.individual.length,0);
});
test('a saturated timestamp switches to lossless individual cursors',async()=>{
 const f=bulkFixture({limit:3,markets:4});await f.init();const r=await f.make().scan(config);assert.equal(r.run.status,'done');assert.ok(f.individual.length>0);assert.ok(r.states.every(s=>s.matches===3));
});
test('an interrupted bulk pass resumes its committed shared cursor after reload',async()=>{
 const f=bulkFixture({limit:5,markets:4});await f.init();const abort=new AbortController();await assert.rejects(f.make().scan(config,{signal:abort.signal,onProgress:p=>{if(p.phase==='binance-update'&&p.requests===1)abort.abort();}}),{name:'AbortError'});const saved=(await f.store.getRun(f.key)).bulk.cursor,calls=f.calls.length,r=await f.make().scan(config);assert.equal(f.calls[calls].start,saved);assert.equal(r.run.status,'done');assert.ok(r.states.every(s=>s.matches===3));
});
test('rate-limit delays persist across scanner recreation while old results remain intact',async()=>{
 const f=bulkFixture({markets:3});await f.init();const error=Object.assign(Error('HTTP 429'),{name:'RateLimitError',retryAt:(f.target+60)*1000}),r=await f.make({binancePage:async()=>{throw error;}}).scan(config);assert.equal(r.run.status,'partial');assert.equal(r.requests,1);assert.ok(r.states.every(s=>s.retryAt===error.retryAt&&s.first===base));const retry=await f.make().scan(config);assert.equal(retry.requests,0);assert.equal(f.individual.length,0);
});
test('browser locks prevent simultaneous duplicate scans in two tabs',async()=>{
 const scanner=A.create({locks:{request:async(name,opts,fn)=>fn(null)}});await assert.rejects(scanner.scan(config),/다른 탭/);
});

test('cached recent results report their actual checked cutoff when refresh is throttled',async()=>{
 const f=setup(),first=await f.make().scan(config),calls=f.calls.length;f.advance(60000);const cached=await f.make().scan(config);assert.equal(cached.requests,0);assert.equal(cached.run.to,first.run.to);assert.equal(f.calls.length,calls);
});
