import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createNewsArchive,createNewsStore,newsQuery} from '../server/news-archive.mjs';
import {parseNewsPage,newsPageUrl} from '../server/delisting-news.mjs';
const clock=Date.parse('2026-10-25T00:00:00Z');
function database(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../server/news-schema.sql',import.meta.url),'utf8'));
 const db={prepare(sql){return {bind(...values){const s=sqlite.prepare(sql);return {async run(){const r=s.run(...values);return {meta:{changes:Number(r.changes)}};},async first(){return s.get(...values)||null;},async all(){return {results:s.all(...values)};}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=[];for(const statement of statements)out.push(await statement.run());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return {store:createNewsStore(db),sqlite};
}
const rows=(page=1)=>Array.from({length:20},(_,i)=>({title:'Delisting of BTCUSDT Perpetual Contract '+(page*20+i),url:'https://announcements.bybit.com/en/article/'+(page*20+i)+'/',publishTime:clock-((page-1)*20+i)*86400000}));
const body=(list,total=60)=>new Response(JSON.stringify({retCode:0,result:{list,total}}));
const request=(params='')=>new Request('https://relay.test/api/news?exchange=BYBIT'+params);
async function read(relay,params=''){const response=await relay.handle(request(params));assert.equal(response.status,200);return response.json();}
test('official historical URLs paginate; HTML publication dates do not use scheduled headline dates',()=>{
 assert.equal(new URL(newsPageUrl('BYBIT',3)).searchParams.get('page'),'3');assert.equal(new URL(newsPageUrl('BINANCE',4)).searchParams.get('pageNo'),'4');
 assert.match(newsPageUrl('BITGET',3),/12508313443290\/3$/);assert.match(newsPageUrl('MEXC',2),/\?page=2$/);assert.match(newsPageUrl('OKX',2),/\/page\/2$/);
 assert.throws(()=>newsPageUrl('FOREIGN',1));
 const mexc=parseNewsPage('MEXC','<a href="/announcements/article/btc-1">Delisting of BTCUSDT Futures [Oct 28, 2026]</a><span>Sep 23, 2026</span>',clock);
 assert.equal(mexc.items[0].publishedAt,Date.parse('2026-09-23T00:00:00Z'));assert.equal(mexc.items[0].dateOnly,true);
 const okx=parseNewsPage('OKX','<a href="/help/okx-to-delist-btc">OKX to delist BTCUSDT perpetual futures <span>Published on Apr 8, 2026</span></a><div>Showing 16-30 of 139 articles</div>',clock);
 assert.equal(okx.items[0].publishedAt,Date.parse('2026-04-08T00:00:00Z'));assert.equal(okx.hasNext,true);
});
test('real SQL archive retains older pages across instances and never fetches upstream for stored pagination',async()=>{
 const {store}=database();let calls=0;
 const fetch=async url=>{calls++;return body(rows(Number(new URL(url).searchParams.get('page'))));};
 const relay=createNewsArchive({store,now:()=>clock,fetch});
 let data=await read(relay);assert.equal(data.items.length,20);assert.equal(data.archive.total,20);assert.equal(data.sources.BYBIT.status,'ok');
 data=await read(relay,'&mode=older');assert.equal(data.archive.total,40);assert.equal(data.pagination.hasMore,true);assert.equal(data.history.BYBIT.nextPage,3);
 const before=calls,first=data.items.map(n=>n.id),cursor=data.pagination.nextCursor;
 const reloaded=createNewsArchive({store,now:()=>clock,fetch});data=await read(reloaded,'&mode=archive&cursor='+encodeURIComponent(cursor));
 assert.equal(calls,before);assert.equal(data.items.length,10);assert.ok(data.items.every(n=>!first.includes(n.id)));assert.equal(data.archive.durable,true);
 data=await read(reloaded,'&mode=older');assert.equal(data.archive.total,60);assert.equal(data.history.BYBIT.status,'complete');assert.equal(calls,3);
});
test('Korean date boundaries, combined filters and literal search operate over the full stored archive',async()=>{
 const {store}=database(),notices=Array.from({length:400},(_,i)=>({exchange:'BYBIT',title:'Delisting '+(i===399?'100%_MATCH':'COIN')+' Perpetual Contract',url:'https://announcements.bybit.com/en/article/seed-'+i,publishedAt:Date.parse('2026-09-01T15:00:00Z')+i*1000,checkedAt:clock,scope:'futures',symbols:['BTC']}));
 const relay=createNewsArchive({store,seed:notices,now:()=>clock,fetch:async()=>{throw Error('no network');}});
 let data=await read(relay,'&mode=archive&start=2026-09-02&end=2026-09-02&q=100%25_MATCH&scope=futures');assert.equal(data.items.length,1);assert.match(data.items[0].title,/MATCH/);assert.equal(data.archive.total,400);
 data=await read(relay,'&mode=archive&end=2026-09-01');assert.equal(data.items.length,0);
 data=await read(relay,'&mode=archive&scope=spot');assert.equal(data.items.length,0);
});
test('a repeated upstream page is blocked with an explicit status rather than a false complete archive',async()=>{
 const {store}=database(),relay=createNewsArchive({store,now:()=>clock,fetch:async()=>body(rows(1))});
 await read(relay);const data=await read(relay,'&mode=older');assert.equal(data.archive.total,20);assert.equal(data.history.BYBIT.status,'blocked');assert.equal(data.history.BYBIT.nextPage,2);assert.match(data.history.BYBIT.message,/같은 목록/);
});
test('HTTP rate limits retain persisted records and honor Retry-After across a new handler instance',async()=>{
 const {store}=database();let time=clock,calls=0,fail=false;
 const fetch=async()=>{calls++;return fail?new Response('',{status:429,headers:{'Retry-After':'3600'}}):body(rows(1));};
 let relay=createNewsArchive({store,now:()=>time,fetch});await read(relay);time+=900001;fail=true;
 let data=await read(relay);assert.equal(data.sources.BYBIT.status,'error');assert.equal(data.items.length,20);assert.equal(data.sources.BYBIT.checkedAt,clock);
 const before=calls;time+=120001;relay=createNewsArchive({store,now:()=>time,fetch});data=await read(relay);assert.equal(calls,before);assert.ok(data.sources.BYBIT.retryAt>time);
});
test('database leases deduplicate concurrent public latest fetches without sharing request-bound promises',async()=>{
 const {store}=database();let calls=0,release;const gate=new Promise(r=>release=r);
 const relay=createNewsArchive({store,now:()=>clock,fetch:async()=>{calls++;await gate;return body(rows(1));}});
 const a=read(relay);for(let i=0;i<20&&!calls;i++)await new Promise(r=>setImmediate(r));
 const b=read(createNewsArchive({store,now:()=>clock,fetch:async()=>{calls++;return body(rows(1));}}));await b;release();await a;assert.equal(calls,1);
});
test('writes, arbitrary URLs, malformed cursors and invalid ranges fail before network or storage work',async()=>{
 let calls=0;const relay=createNewsArchive({store:{seed(){calls++;}},fetch:async()=>{calls++;}});
 for(const query of ['&url=https://evil.test','&limit=50000','&start=2026-10-30&end=2026-10-01','&cursor=bad','&start=2026-02-30','&exchange=BYBIT'])assert.equal((await relay.handle(request(query))).status,400);
 assert.equal((await relay.handle(new Request('https://relay.test/api/news',{method:'POST'}))).status,405);
 assert.equal((await relay.handle(new Request('https://relay.test/api/news',{headers:{Origin:'https://evil.test'}}))).status,403);assert.equal(calls,0);
 assert.throws(()=>newsQuery(new URL('https://relay.test/api/news?scope=bogus')));
});
test('successful empty official JSON ends pagination; challenge HTML remains a retryable failure',async()=>{
 const {store}=database();const relay=createNewsArchive({store,now:()=>clock,fetch:async url=>new URL(url).searchParams.get('page')==='1'?body(rows(1)):body([])});
 await read(relay);let data=await read(relay,'&mode=older');assert.equal(data.history.BYBIT.status,'complete');assert.equal(data.archive.total,20);
 assert.throws(()=>parseNewsPage('MEXC','<html>Please verify you are human</html>'));
 assert.equal(parseNewsPage('MEXC','<html>No articles found</html>').rawCount,0);
});
