'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),A=require('../funding-archive.js');
const base=Date.UTC(2026,9,20)/1000,venues=['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'];
const funding=Array.from({length:12},(_,i)=>({time:base+i*3600,rate:-.6,intervalHours:1,intervalSource:'official-history'}));
function fixture({exchanges=venues,store=A.memoryStore(),pageOverride,pause=async()=>{},onCatalog}={}){
 const calls=[],catalog=async()=>{onCatalog?.();return {rows:exchanges.map(exchange=>({exchange,symbol:'TESTUSDT',listedAt:base}))};};
 const page=async(ex,symbol,cursor,number,signal)=>{signal.throwIfAborted();calls.push({ex,symbol,cursor,number});if(pageOverride)return pageOverride(ex,symbol,cursor,number,signal);if(ex==='BINANCE')return funding.filter(r=>r.time*1000>=cursor).slice(0,3);if(['BITGET','MEXC'].includes(ex))return [...funding].reverse().slice((number-1)*3,number*3);return funding.filter(r=>r.time*1000<=cursor).slice(-3);};
 return {scanner:A.create({page,catalog,store,pause,now:()=>1000*(base+12*3600)}),calls,store};
}
test('all six exchanges page their available settlement history and preserve exact rate/time/cycle values',async()=>{
 const f=fixture(),r=await f.scanner.scan({from:base,to:base+10.5*3600});assert.equal(r.run.status,'done');assert.equal(r.states.length,6);assert.ok(r.states.every(s=>s.matches===11));
 const all=await f.store.query(r.run.id,{size:100});assert.equal(all.rows.length,66);assert.ok(all.rows.every(r=>r.hours===1&&r.rate===-.6&&r.time<=base+10*3600));
 for(const ex of venues)assert.ok(f.calls.filter(c=>c.ex===ex).length>=4,ex);
});
test('page-number venues can skip newer pages to inspect an older date range without a false cursor error',async()=>{
 const f=fixture({exchanges:['BITGET','MEXC']}),r=await f.scanner.scan({from:base,to:base+4*3600});assert.equal(r.run.status,'done');assert.ok(r.states.every(s=>s.matches===5));assert.ok(f.calls.some(c=>c.number===4));
});
test('a stopped search resumes from its committed cursor and does not duplicate matches or refetch its catalog',async()=>{
 let catalogs=0;const f=fixture({exchanges:['BYBIT'],onCatalog:()=>catalogs++}),abort=new AbortController();
 await assert.rejects(f.scanner.scan({from:base},{signal:abort.signal,onProgress:p=>{if(p.page===1)abort.abort();}}),{name:'AbortError'});assert.equal(f.calls.length,1);
 const resumed=await f.scanner.scan({from:base});assert.equal(resumed.run.status,'done');assert.equal(resumed.states[0].matches,12);assert.equal(catalogs,1);assert.equal(f.calls.filter(c=>c.number===1).length,1);
 const before=f.calls.length;await f.scanner.scan({from:base});assert.equal(f.calls.length,before);
});
test('failed and rate-limited venues remain incomplete, while other venues retain successful results',async()=>{
 let failed=true;const f=fixture({exchanges:['BINANCE','BITGET'],pageOverride:(ex,s,cursor,page)=>{if(ex==='BINANCE'&&failed){const e=Error('API rate limit');e.name='RateLimitError';throw e;}return ex==='BINANCE'?funding.filter(r=>r.time*1000>=cursor):page===1?funding:[];}});
 const partial=await f.scanner.scan({from:base});assert.equal(partial.run.status,'partial');assert.equal(partial.states.find(s=>s.exchange==='BINANCE').status,'error');assert.equal(partial.states.find(s=>s.exchange==='BITGET').matches,12);
 failed=false;const resumed=await f.scanner.scan({from:base});assert.equal(resumed.run.status,'done');assert.equal(resumed.states.length,2);
});
test('repeated API pages stop with an explicit error and retain the records already collected',async()=>{
 const f=fixture({exchanges:['BYBIT'],pageOverride:()=>funding.slice(-3)}),r=await f.scanner.scan({from:base});assert.equal(r.run.status,'partial');assert.match(r.states[0].error,/같은 페이지/);assert.equal(r.states[0].matches,3);
});
test('missing 90-day BingX windows are traversed instead of hiding older available history',async()=>{
 const first=base-100*86400,old=[{time:first,rate:-.7,intervalHours:1,intervalSource:'official-history'}],calls=[];
 const scanner=A.create({catalog:async()=>({rows:[{exchange:'BINGX',symbol:'OLDUSDT',listedAt:first}]}),now:()=>base*1000,pause:async()=>{},page:async(ex,s,cursor)=>{calls.push(cursor);return cursor>first*1000+90*86400000?[]:old;}});
 const r=await scanner.scan({from:first});assert.equal(r.run.status,'done');assert.equal(r.states[0].matches,1);assert.ok(calls.length>=2);
});
test('cycle inference spans page boundaries, leaves isolated unknown intervals out, and never substitutes the current cycle',()=>{
 const rows=[0,1,2,4,8,12].map((h,i)=>({time:base+h*3600,rate:i===1?-.5:-.6}));
 const one=A.matches(rows,A.options({hours:1}));assert.ok(one.some(r=>r.time===base+3600));assert.ok(one.some(r=>r.time===base+7200));assert.ok(one.every(r=>r.hours===1));
 assert.equal(A.matches(rows,A.options({hours:2,transitionMinutes:0})).length,0);assert.ok(A.matches(rows,A.options({mode:'rate'})).some(r=>r.hours===null));
});
test('a transition candidate distinguishes confirmation time from the referenced negative settlement',()=>{
 const rows=[{time:base-5*3600,rate:.01,hours:4},{time:base-3600,rate:-.6,hours:4},{time:base,rate:.01,hours:1},{time:base+3600,rate:.01,hours:1}],records=A.matches(rows,A.options({hours:1})),entry=records.find(r=>r.source==='transition');
 assert.equal(entry.time,base);assert.equal(entry.settleTime,base-3600);assert.equal(entry.rate,-.6);assert.equal(entry.hours,1);assert.equal(A.matches(rows,A.options({hours:1,transitionMinutes:0})).length,0);
});
test('rate-only, cycle-only and combined filters honor configurable thresholds with inclusive boundaries',()=>{
 const rows=[{time:base,rate:-.5,intervalHours:4,intervalSource:'official-history'},{time:base+3600,rate:-.6,intervalHours:1,intervalSource:'official-history'},{time:base+7200,rate:-.4,intervalHours:1,intervalSource:'official-history'}];
 assert.equal(A.matches(rows,A.options({mode:'rate',rate:-.5})).length,2);assert.equal(A.matches(rows,A.options({mode:'cycle',hours:1})).length,2);assert.equal(A.matches(rows,A.options({mode:'both',hours:1,rate:-.6})).length,1);
 for(const invalid of [{rate:NaN},{hours:-1},{from:10,to:1},{exchange:'UNKNOWN'},{transitionMinutes:1441}])assert.throws(()=>A.options(invalid));
});
test('search configuration keys are isolated and a fresh search preserves the previous run',async()=>{
 const f=fixture({exchanges:['BYBIT']}),one=await f.scanner.scan({from:base}),fresh=await f.scanner.scan({from:base},{fresh:true}),strict=await f.scanner.scan({from:base,rate:-.8});assert.notEqual(one.run.id,fresh.run.id);assert.notEqual(strict.run.key,fresh.run.key);assert.equal(strict.states[0].matches,0);assert.equal((await f.store.query(one.run.id)).rows.length,12);
});
test('an exact manually entered symbol can request retained history even when it is absent from the active catalog',async()=>{
 const calls=[],scanner=A.create({catalog:async()=>({rows:[]}),page:async(ex,s)=>{calls.push({ex,s});return [];},pause:async()=>{}}),r=await scanner.scan({exchange:'BITGET',query:'OLDUSDT'});assert.equal(r.run.status,'done');assert.deepEqual(calls,[{ex:'BITGET',s:'OLDUSDT'}]);
});
