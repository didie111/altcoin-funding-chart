import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseNews,symbolsIn,createDelistingNews} from '../server/delisting-news.mjs';
const notice={title:'Delisting of BTCUSDT Perpetual Contract',url:'https://announcements.bybit.com/en/article/btc/',publishTime:1000};
const response=()=>new Response(JSON.stringify({retCode:0,result:{list:[notice]}}));
test('delisting parser distinguishes publication metadata from headline execution dates',()=>{
 const body='<a href="/announcements/article/btc-123">Delisting of BTCUSDT Perpetual Futures Pair [Oct 28, 2026]</a><time datetime="2026-10-21T08:00:00Z">Oct 21</time>';
 const [value]=parseNews('MEXC',body,5000);assert.equal(value.publishedAt,Date.parse('2026-10-21T08:00:00Z'));assert.equal(value.checkedAt,5000);assert.deepEqual(value.symbols,['BTC']);assert.equal(value.scope,'futures');
});
test('unknown page-local times stay date-only, and empty/challenge pages fail explicitly',()=>{
 const [value]=parseNews('BITGET','<a href="/support/articles/123">Notice of Delisting 3 Spot Trading Pairs on October 30, 2026</a><div>2026-10-23 10:00</div>');
 assert.equal(value.publishedAt,Date.parse('2026-10-23T00:00:00Z'));assert.equal(value.dateOnly,true);
 assert.throws(()=>parseNews('BITGET','<h1>Site unavailable</h1>'));
});
test('non-USDT products never become links to unrelated USDT perpetual markets',()=>{
 assert.deepEqual(symbolsIn('Delisting of BTCUSDC Perpetual Contract'),[]);assert.deepEqual(symbolsIn('Delisting of GRAM, BCH and SHIB USDC-M Perpetual Futures'),[]);assert.deepEqual(symbolsIn('Delisting of PTBUSDT and MITOUSDT Perpetual Contracts'),['PTB','MITO']);
});
test('parsers preserve postponements and reject unrelated API or external links',()=>{
 const body=JSON.stringify({retCode:0,result:{list:[{...notice,title:'Postponement of delisting of BTCUSDT Perpetual Contract'},{...notice,url:'https://evil.test/article/123'},{...notice,title:'Delisting deprecated API endpoints'}]}});
 const result=parseNews('BYBIT',body);assert.equal(result.length,1);assert.equal(result[0].change,true);
});
test('news relay caches serialized successes and retains them with a stale status after failure',async()=>{
 let clock=10000,calls=0,fail=false;
 const relay=createDelistingNews({now:()=>clock,fetch:async url=>{calls++;if(fail||!url.includes('api.bybit.com'))throw Error('offline');return response();}});
 let data=await (await relay.handle(new Request('https://relay.test/api/news'))).json();assert.equal(data.sources.BYBIT.status,'ok');assert.equal(data.items.length,1);
 const previous=calls;await relay.handle(new Request('https://relay.test/api/news'));assert.equal(calls,previous);
 clock+=900001;fail=true;data=await (await relay.handle(new Request('https://relay.test/api/news'))).json();assert.equal(data.sources.BYBIT.status,'error');assert.equal(data.items.length,1);assert.equal(data.sources.BYBIT.checkedAt,10000);
});
test('relay rejects writes, foreign origins and arbitrary upstream parameters before fetching',async()=>{
 let calls=0;const relay=createDelistingNews({fetch:async()=>{calls++;return response();}});
 assert.equal((await relay.handle(new Request('https://relay.test/api/news',{method:'POST'}))).status,405);
 assert.equal((await relay.handle(new Request('https://relay.test/api/news',{headers:{Origin:'https://foreign.test'}}))).status,403);
 assert.equal((await relay.handle(new Request('https://relay.test/api/news?url=https://evil.test'))).status,400);assert.equal(calls,0);
});
