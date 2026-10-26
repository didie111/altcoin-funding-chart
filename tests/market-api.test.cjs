'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createClient, candle} = require('../market-api.js');
const engine = require('../funding.js');
const host = 'https://open-api.bingx.com/openApi/swap/';
const stamp = 1791532800000;
const relayUrl = 'https://relay.test/api/market';
function response(body, status = 200) {return {ok: status === 200, status, headers: {get: () => null}, json: async () => body};}

test('overlapping BingX current/history/candle requests have fresh timestamps and start at least 1s apart', async () => {
  let clock = stamp; const calls = [];
  const client = createClient({now: () => clock, wait: async ms => {clock += ms;}, fetch: async (url, options) => {
    calls.push({url: new URL(url), time: clock, options}); return response({code: 0, data: []});
  }});
  await Promise.all(['v2/quote/premiumIndex', 'v2/quote/fundingRate', 'v3/quote/klines'].map(path => client.json(host + path, {symbol: 'KAIA-USDT'})));
  assert.equal(calls.length, 3);
  for (let i = 0; i < calls.length; i++) {
    assert.equal(Number(calls[i].url.searchParams.get('timestamp')), calls[i].time);
    assert.equal(calls[i].url.searchParams.get('symbol'), 'KAIA-USDT');
    assert.equal(calls[i].options.cache, 'no-store');
    if (i) assert.ok(calls[i].time - calls[i - 1].time >= 1000);
  }
});
test('BingX rate-limit code inside HTTP 200 is retried and its decimal funding rate stays exact', async () => {
  let clock = stamp; const calls = [];
  const client = createClient({now: () => clock, wait: async ms => {clock += ms;}, fetch: async url => {
    calls.push(new URL(url));
    return response(calls.length === 1 ? {code: 100410, msg: 'too many requests'} : {code: 0, data: {symbol: 'KAIA-USDT', lastFundingRate: '-0.02', time: stamp}});
  }});
  const payload = await client.json(host + 'v2/quote/premiumIndex', {symbol: 'KAIA-USDT'});
  assert.equal(engine.normalizeCurrent('BINGX', payload, 'KAIA', stamp).rate, -2);
  assert.equal(calls.length, 2);
  assert.ok(+calls[1].searchParams.get('timestamp') > +calls[0].searchParams.get('timestamp'));
});
test('persistent BingX rate-limit and unsupported-contract errors retain their codes', async () => {
  for (const code of [100410, 109425, 100413]) {
    let calls = 0, clock = stamp;
    const client = createClient({now: () => clock, wait: async ms => {clock += ms;}, fetch: async () => {calls++; return response({code, msg: 'exchange message'});}});
    await assert.rejects(client.json(host + 'v2/quote/premiumIndex'), new RegExp('BingX API ' + code + ': exchange message'));
    assert.equal(calls, code === 100410 ? 4 : 1);
  }
});
test('BingX HTTP 429 honors retry delay and keeps retry count bounded', async () => {
  let clock = stamp, calls = 0;
  const waits = [];
  const client = createClient({now: () => clock, wait: async ms => {waits.push(ms); clock += ms;}, fetch: async () => {
    calls++;
    return {ok: false, status: 429, headers: {get: () => '2'}};
  }});
  await assert.rejects(client.json(host + 'v2/quote/premiumIndex'), /HTTP 429/);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [2000, 2000, 2000]);
});
test('BingX transport failures do not become a numeric zero or a fabricated CORS diagnosis', async () => {
  let clock = stamp; const calls = [];
  const client = createClient({now: () => clock, wait: async ms => {clock += ms;}, fetch: async url => {calls.push(new URL(url)); throw TypeError('Failed to fetch');}});
  await assert.rejects(client.json(host + 'v2/quote/premiumIndex'), /BingX 연결 실패: API 응답을 읽을 수 없습니다/);
  assert.equal(calls.length, 8);
  assert.deepEqual(calls.map(url => url.hostname), Array.from({length: 4}, () => ['open-api.bingx.com', 'open-api.bingx.pro']).flat());
});
test('BingX official fallback preserves contract, endpoint, parameters and fresh rate-limited timestamps', async () => {
  let clock = stamp; const calls = [];
  const client = createClient({now: () => clock, wait: async ms => {clock += ms;}, fetch: async url => {
    const parsed = new URL(url); calls.push({url: parsed, time: clock});
    if (parsed.hostname === 'open-api.bingx.com') throw TypeError('Failed to fetch');
    return response({code: 0, data: {symbol: 'RSR-USDT', lastFundingRate: '-0.02', time: clock}});
  }});
  for (const path of ['v2/quote/premiumIndex', 'v2/quote/fundingRate', 'v3/quote/klines']) {
    const payload = await client.json(host + path, {symbol: 'RSR-USDT', endTime: stamp, interval: '15m'});
    assert.equal(engine.normalizeCurrent('BINGX', payload, 'RSR', clock).rate, -2);
    const [primary, backup] = calls.slice(-2);
    assert.equal(primary.url.hostname, 'open-api.bingx.com');
    assert.equal(backup.url.hostname, 'open-api.bingx.pro');
    assert.equal(primary.url.pathname, backup.url.pathname);
    for (const key of ['symbol', 'endTime', 'interval']) assert.equal(primary.url.searchParams.get(key), backup.url.searchParams.get(key));
  }
  for (let i = 0; i < calls.length; i++) {
    assert.equal(Number(calls[i].url.searchParams.get('timestamp')), calls[i].time);
    if (i) assert.ok(calls[i].time - calls[i - 1].time >= 1000);
  }
});
test('readable BingX HTTP, business and non-JSON failures do not switch to the backup host', async () => {
  const cases = [
    {reply: () => response({}, 403), error: /HTTP 403/},
    {reply: () => response({code: 109425, msg: 'unsupported contract'}), error: /API 109425: unsupported contract/},
    {reply: () => ({...response({}), json: async () => {throw SyntaxError('HTML response');}}), error: /JSON 데이터를 받지 못했습니다/}
  ];
  for (const item of cases) {
    const calls = [];
    const client = createClient({fetch: async url => {calls.push(url); return item.reply();}});
    await assert.rejects(client.json(host + 'v2/quote/premiumIndex'), item.error);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]).hostname, 'open-api.bingx.com');
  }
});
test('a hung BingX primary request times out and then uses the official backup', async () => {
  let clock = stamp; const calls = [];
  const client = createClient({requestTimeout: 5, now: () => clock, wait: async ms => {clock += ms;}, fetch: async (url, {signal}) => {
    const hostname = new URL(url).hostname; calls.push(hostname);
    if (hostname === 'open-api.bingx.com') return await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {once: true});
    });
    return response({code: 0, data: {symbol: 'RSR-USDT', lastFundingRate: '-0.02', time: clock}});
  }});
  const payload = await client.json(host + 'v2/quote/premiumIndex', {symbol: 'RSR-USDT'});
  assert.equal(engine.normalizeCurrent('BINGX', payload, 'RSR', clock).rate, -2);
  assert.deepEqual(calls, ['open-api.bingx.com', 'open-api.bingx.pro']);
});
test('stopping a failed BingX request cancels fallback and leaves later requests usable', async () => {
  let clock = stamp; const calls = [], controller = new AbortController();
  const client = createClient({now: () => clock, wait: async ms => {clock += ms;}, fetch: async url => {
    calls.push(new URL(url).hostname);
    if (calls.length === 1) {controller.abort(); throw TypeError('Failed to fetch');}
    return response({code: 0, data: []});
  }});
  await assert.rejects(client.json(host + 'v2/quote/premiumIndex', {}, controller.signal), {name: 'AbortError'});
  await client.json(host + 'v3/quote/klines');
  assert.deepEqual(calls, ['open-api.bingx.com', 'open-api.bingx.com']);
});
test('aborted queued BingX requests never reach fetch or poison following requests', async () => {
  let clock = stamp; const calls = [];
  const client = createClient({now: () => clock, wait: async ms => {clock += ms;}, fetch: async url => {calls.push(url); return response({code: 0});}});
  const controller = new AbortController();
  const first = client.json(host + 'v2/quote/premiumIndex');
  const cancelled = client.json(host + 'v2/quote/fundingRate', {}, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, {name: 'AbortError'}); await first;
  await client.json(host + 'v3/quote/klines');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => !url.includes('fundingRate')));
});
test('other exchanges run independently while BingX waits for its rate limit', async () => {
  let clock = stamp; const calls = [];
  let release;
  const gate = new Promise(resolve => {release = resolve;});
  const client = createClient({now: () => clock, wait: async ms => {await gate; clock += ms;}, fetch: async url => {calls.push(url); return response({code: 0});}});
  await client.json(host + 'v2/quote/premiumIndex');
  const bingx = client.json(host + 'v2/quote/fundingRate');
  await client.json('https://fapi.binance.com/fapi/v1/premiumIndex');
  assert.equal(calls.length, 2);
  assert.match(calls[1], /fapi.binance.com/);
  release(); await bingx;
});
test('BingX candle array and object timestamps normalize without turning missing OHLC into zero', () => {
  const expected = {time: stamp / 1000, open: 2, high: 4, low: 1, close: 3, volume: 5};
  assert.deepEqual(candle([stamp, '2', '4', '1', '3', '5']), expected);
  assert.deepEqual(candle({timestamp: stamp, open: '2', high: '4', low: '1', close: '3', volume: '5'}), expected);
  assert.deepEqual(candle({time: stamp / 1000, open: 2, high: 4, low: 1, close: 3, volume: 5}), expected);
  for (const bad of [[stamp, null, 4, 1, 3, 5], [stamp, 2, 1, 4, 3, 5], [stamp, 2, 4, 1, 3, -1]]) assert.equal(candle(bad), null);
});
test('BingX and MEXC use the configured relay with the original contract and real fetch time', async () => {
  const calls = [];
  const fetchedAt = stamp - 7000;
  const client = createClient({relayUrl, now: () => stamp, fetch: async (url, options) => {
    const parsed = new URL(url); calls.push({parsed, options});
    const bingx = parsed.searchParams.get('exchange') === 'BINGX';
    return {...response({code: 0, data: bingx ? {symbol: 'RSR-USDT', lastFundingRate: '-0.015', fundingIntervalHours: 8} : {symbol: 'RSR_USDT', fundingRate: '-0.015', collectCycle: 4}}), headers: {get: name => name === 'X-Market-Fetched-At' ? String(fetchedAt) : null}};
  }});
  for (const ex of ['BINGX', 'MEXC']) {
    const req = engine.currentRequest(ex, 'RSR');
    const result = await client.json(req.url, req.params);
    const quote = engine.normalizeCurrent(ex, result, 'RSR', result.__marketFetchedAt);
    assert.equal(quote.rate, -1.5); assert.equal(quote.fetchedAt, fetchedAt / 1000);
    assert.equal(quote.hours, ex === 'BINGX' ? 8 : 4);
  }
  assert.ok(calls.every(call => call.parsed.origin === 'https://relay.test' && call.options.credentials === 'omit'));
  assert.equal(calls[0].parsed.searchParams.get('symbol'), 'RSR-USDT');
  assert.equal(calls[1].parsed.searchParams.get('path'), '/api/v1/contract/funding_rate/RSR_USDT');
});
test('other exchange requests stay independent of the BingX/MEXC relay', async () => {
  const calls = [];
  const client = createClient({relayUrl, fetch: async url => {calls.push(url); return response({code: 0, data: []});}});
  for (const ex of ['BINANCE', 'BYBIT', 'BITGET', 'OKX']) {
    const req = engine.currentRequest(ex, 'RSR'); await client.json(req.url, req.params);
    assert.ok(calls.at(-1).startsWith(req.url));
  }
  assert.ok(calls.every(url => new URL(url).origin !== 'https://relay.test'));
});
test('relay failures are reported without silently returning to the blocked browser API path', async () => {
  let clock = stamp; const calls = [];
  const client = createClient({relayUrl, now: () => clock, wait: async ms => {clock += ms;}, fetch: async url => {calls.push(url); throw TypeError('Failed to fetch');}});
  await assert.rejects(client.json(host + 'v2/quote/premiumIndex'), /BingX 연결 실패/);
  assert.equal(calls.length, 4); assert.ok(calls.every(url => new URL(url).origin === 'https://relay.test'));
});
test('relay response errors retain the upstream explanation', async () => {
  let calls = 0;
  const client = createClient({relayUrl, fetch: async () => {calls++; return response({code: 'RELAY_ERROR', message: 'MEXC 공식 API가 JSON 대신 접근 제한 응답을 반환했습니다.'}, 502);}});
  const req = engine.currentRequest('MEXC', 'RSR');
  await assert.rejects(client.json(req.url, req.params), /MEXC 공식 API가 JSON 대신/);
  assert.equal(calls, 1);
});
test('Bybit, Bitget, OKX and MEXC rate-limit codes inside HTTP 200 retry without losing API data',async()=>{
 for(const [base,code]of [['https://api.bybit.com/v5/market/kline',10006],['https://api.bitget.com/api/v2/mix/market/history-candles','429'],['https://www.okx.com/api/v5/market/history-candles','50011'],['https://api.mexc.com/api/v1/contract/kline/BTC_USDT',510]]){
  let clock=stamp,calls=0;const waits=[],events=[],client=createClient({now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},onRetry:event=>events.push(event),fetch:async()=>++calls===1?response(base.includes('bybit')?{retCode:code,retMsg:'Too many visits'}:{code,message:'rate limited'}):response({code:0,data:[1,2]})});
  assert.deepEqual((await client.json(base)).data,[1,2]);assert.equal(calls,2);assert.deepEqual(waits,[1500]);assert.equal(events.length,1);
 }
});
test('exhausted rate limits remain typed failures rather than successful empty history',async()=>{
 let clock=stamp,calls=0;const client=createClient({now:()=>clock,wait:async ms=>{clock+=ms;},fetch:async()=>{calls++;return response({code:'50011',msg:'Rate limit reached'});}});
 await assert.rejects(client.json('https://www.okx.com/api/v5/market/history-candles'),error=>error.name==='RateLimitError'&&/50011.*요청 제한/.test(error.message)&&error.retryAt>clock);assert.equal(calls,4);
});
test('Retry-After HTTP dates are honored and a long requested wait is not capped then retried too early',async()=>{
 for(const seconds of [12,120]){
  let clock=stamp,calls=0;const waits=[],client=createClient({now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},fetch:async()=>{calls++;return calls===1?{...response({},429),headers:{get:name=>name.toLowerCase()==='retry-after'?new Date(stamp+seconds*1000).toUTCString():null}}:response({code:0});}});
  if(seconds===12){await client.json('https://api.bitget.com/api/v2/mix/market/history-candles');assert.deepEqual(waits,[12000]);assert.equal(calls,2);}
  else{await assert.rejects(client.json('https://api.bitget.com/api/v2/mix/market/history-candles'),error=>error.name==='RateLimitError'&&error.retryAt===stamp+120000);assert.equal(calls,1);assert.deepEqual(waits,[]);}
 }
});
test('Bybit reset timestamps determine the next allowed retry',async()=>{
 let clock=stamp,calls=0;const waits=[],client=createClient({now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},fetch:async()=>++calls===1?{...response({retCode:10006,retMsg:'Too many visits'}),headers:{get:name=>name==='X-Bapi-Limit-Reset-Timestamp'?String(stamp+7500):null}}:response({retCode:0,result:{list:[]}})});
 await client.json('https://api.bybit.com/v5/market/kline');assert.deepEqual(waits,[7500]);assert.equal(calls,2);
});
test('rate-limit cooldown is shared across chart clients but another exchange remains available',async()=>{
 const Shared=require('../market-shared.js');let clock=stamp;const waits=[],calls=[];
 const broker=Shared.create({now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;}}),previous=globalThis.MarketShared;globalThis.MarketShared={...Shared,broker};
 try{
  const first=createClient({now:()=>clock,fetch:async()=>({...response({},429),headers:{get:name=>name.toLowerCase()==='retry-after'?'120':null}})});
  await assert.rejects(first.json('https://api.bitget.com/limited'),{name:'RateLimitError'});
  const other=createClient({now:()=>clock,fetch:async url=>{calls.push({url,time:clock});return response({code:0});}});
  await other.json('https://www.okx.com/independent');assert.equal(calls[0].time,stamp);
  await other.json('https://api.bitget.com/another-page');assert.equal(calls[1].time,stamp+120000);assert.deepEqual(waits,[120000]);
 }finally{if(previous===undefined)delete globalThis.MarketShared;else globalThis.MarketShared=previous;}
});
test('canceling during API cooldown stops the retry and preserves the original abort reason',async()=>{
 const controller=new AbortController();let calls=0;const client=createClient({fetch:async()=>{calls++;return response({},429);},wait:async(ms,signal)=>{controller.abort();signal.throwIfAborted();}});
 await assert.rejects(client.json('https://api.bitget.com/api/v2/mix/market/history-candles',{},controller.signal),{name:'AbortError'});assert.equal(calls,1);
});
test('a BingX cooldown announced while another request is queued delays it without a burst on resume',async()=>{
 const Shared=require('../market-shared.js');let clock=stamp,release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;}),starts=[];
 const broker=Shared.create({now:()=>clock,wait:async ms=>{if(ms===1150&&starts.length===1){entered();await gate;}clock+=ms;}}),signal=new AbortController().signal,task=()=>{starts.push(clock);return Promise.resolve({});};
 await broker.reserveBingx(signal,task);const queued=broker.reserveBingx(signal,task);await waiting;broker.defer('open-api.bingx.com',stamp+10000);release();await queued;await broker.reserveBingx(signal,task);
 assert.deepEqual(starts,[stamp,stamp+10000,stamp+11150]);
});
test('Bybit 10016 retries the same coin, timeframe and cursor with smaller real-data pages',async()=>{
 let clock=stamp;const calls=[],waits=[],events=[],client=createClient({now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},onRetry:event=>events.push(event),fetch:async url=>{calls.push(new URL(url));return calls.length<3?response({retCode:10016,retMsg:'svc error: Get kline failed'}):response({retCode:0,result:{list:[[stamp,'2','4','1','3','5']]}});}});
 const params={category:'linear',symbol:'SNTUSDT',interval:'3',end:stamp,limit:1000},data=await client.json('https://api.bybit.com/v5/market/kline',params);
 assert.equal(data.result.list.length,1);assert.deepEqual(waits,[1500,3000]);assert.deepEqual(calls.map(u=>u.searchParams.get('limit')),['1000','500','250']);
 for(const url of calls)for(const field of ['symbol','interval','end','category'])assert.equal(url.searchParams.get(field),String(params[field]));
 assert.equal(params.limit,1000);assert.ok(events.every(e=>e.kind==='service'));
});
test('persistent Bybit server errors stay explicit and canceling a retry never returns prior or empty data',async()=>{
 let calls=0;const client=createClient({wait:async()=>{},fetch:async()=>{calls++;return response({retCode:10016,retMsg:'Get kline failed'});}});
 await assert.rejects(client.json('https://api.bybit.com/v5/market/kline'),e=>e.name==='MarketServiceError'&&e.code===10016&&/재시도/.test(e.message));assert.equal(calls,4);
 const abort=new AbortController(),stopped=createClient({fetch:async()=>response({retCode:10016,retMsg:'Get kline failed'}),wait:async(ms,signal)=>{abort.abort();signal.throwIfAborted();}});
 await assert.rejects(stopped.json('https://api.bybit.com/v5/market/kline',{},abort.signal),{name:'AbortError'});
});
