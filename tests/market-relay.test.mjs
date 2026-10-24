import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketRelay} from '../server/market-relay.mjs';

const stamp = 1791885000000;
const primary = 'https://open-api.bingx.com';
const backup = 'https://open-api.bingx.pro';
const payload = {code: 0, data: {symbol: 'RSR-USDT', lastFundingRate: '-0.015', nextFundingTime: stamp + 3600000}};
const mexcPayload = {success: true, code: 0, data: {symbol: 'RSR_USDT', fundingRate: '-0.015', collectCycle: 4, nextSettleTime: stamp + 3600000}};
const reply = (body = payload, status = 200) => new Response(JSON.stringify(body), {status});
function request(exchange = 'BINGX', path = '/openApi/swap/v2/quote/premiumIndex', params = {symbol: 'RSR-USDT'}, options = {}) {
  return new Request('https://relay.test/api/market?' + new URLSearchParams({exchange, path, ...params}), options);
}

test('whole-market catalogs and tickers accept only the explicit public routes without a symbol',async()=>{
 const calls=[];let clock=stamp;const relay=createMarketRelay({now:()=>clock,wait:async ms=>{clock+=ms;},fetch:async url=>{calls.push(new URL(url));return reply({code:0,data:[]});}});
 for(const [exchange,path]of [['BINGX','/openApi/swap/v2/quote/contracts'],['BINGX','/openApi/swap/v2/quote/ticker'],['MEXC','/api/v1/contract/detail'],['MEXC','/api/v1/contract/ticker']]){
  const response=await relay.handle(request(exchange,path,{}));assert.equal(response.status,200);assert.equal(calls.at(-1).pathname,path);assert.equal(calls.at(-1).searchParams.has('symbol'),false);
 }
 assert.equal((await relay.handle(request('BINGX','/openApi/swap/v2/quote/contracts',{url:'https://untrusted.test'}))).status,400);
 assert.equal((await relay.handle(request('BINGX','/openApi/swap/v2/quote/fundingRate',{}))).status,400);
 assert.equal((await relay.handle(request('MEXC','/api/v1/private/order/list',{}))).status,400);
});

test('the funding scanner can request the official whole-market BingX premium list without a symbol',async()=>{
 const calls=[];const relay=createMarketRelay({fetch:async url=>{calls.push(new URL(url));return reply({code:0,data:[]});}});
 const response=await relay.handle(request('BINGX','/openApi/swap/v2/quote/premiumIndex',{}));assert.equal(response.status,200);assert.equal(calls[0].searchParams.has('symbol'),false);
 assert.equal((await relay.handle(request('BINGX','/openApi/swap/v2/quote/fundingRate',{}))).status,400);
});
test('new chart intervals pass the relay allowlist while invented interval names remain blocked', async () => {
  const calls=[];let clock=stamp;
  const relay=createMarketRelay({now:()=>clock,wait:async ms=>{clock+=ms;},fetch:async url=>{calls.push(new URL(url));return reply({code:0,data:[]});}});
  for(const interval of ['1m','3m','5m','15m','30m','1h','2h','4h','1d','1w','1M']){
    assert.equal((await relay.handle(request('BINGX','/openApi/swap/v3/quote/klines',{symbol:'BTC-USDT',interval,limit:'1000',endTime:String(stamp)}))).status,200);
    assert.equal(calls.at(-1).searchParams.get('interval'),interval);
  }
  for(const interval of ['Min1','Min5','Min15','Min30','Min60','Hour4','Day1','Week1','Month1']){
    assert.equal((await relay.handle(request('MEXC','/api/v1/contract/kline/BTC_USDT',{interval,start:'1000',end:'2000'}))).status,200);
    assert.equal(calls.at(-1).searchParams.get('interval'),interval);
  }
  const count=calls.length;
  for(const interval of ['Min3','Hour2','bad','1m&url=attacker'])assert.equal((await relay.handle(request('MEXC','/api/v1/contract/kline/BTC_USDT',{interval}))).status,400);
  assert.equal(calls.length,count);
});

test('official current rates preserve decimal values and never forward Origin, cookies or credentials upstream', async () => {
  const calls = [];
  const relay = createMarketRelay({now: () => stamp, fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    return reply(url.startsWith(primary) ? payload : mexcPayload);
  }});
  for (const req of [request(), request('MEXC', '/api/v1/contract/funding_rate/RSR_USDT', {})]) {
    const result = await relay.handle(new Request(req, {headers: {Origin: 'https://didie111.github.io', Cookie: 'private-cookie', Authorization: 'private-token'}}));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Access-Control-Allow-Origin'), 'https://didie111.github.io');
    assert.equal(Number(result.headers.get('X-Market-Fetched-At')), stamp);
    const json = await result.json();
    assert.equal(Number(json.data.lastFundingRate ?? json.data.fundingRate) * 100, -1.5);
  }
  assert.equal(calls[0].url.origin, primary);
  assert.equal(calls[1].url.href, 'https://api.mexc.com/api/v1/contract/funding_rate/RSR_USDT');
  for (const call of calls) {
    assert.deepEqual(call.options.headers, {Accept: 'application/json'});
    assert.equal(call.options.redirect, 'manual');
  }
});
test('private endpoints, arbitrary hosts, invalid contracts and duplicate parameters are rejected before any upstream call', async () => {
  let calls = 0;
  const relay = createMarketRelay({fetch: async () => {calls++; return reply();}});
  const invalid = [request('BINGX', '/openApi/swap/v2/trade/order'), request('MEXC', 'https://attacker.test', {}), request('MEXC', '/api/v1/private/account/assets', {}), request('BINGX', undefined, {symbol: 'RSR-USDT&url=https://attacker.test'}), request('MEXC', '/api/v1/contract/funding_rate/RSR_USDT', {url: 'https://attacker.test'})];
  for (const req of invalid) assert.equal((await relay.handle(req)).status, 400);
  const duplicate = new URL(request().url); duplicate.searchParams.append('symbol', 'BTC-USDT');
  assert.equal((await relay.handle(new Request(duplicate))).status, 400);
  assert.equal(calls, 0);
});
test('only the chart origin and same-origin reads are accepted and OPTIONS does not fetch data', async () => {
  let calls = 0;
  const relay = createMarketRelay({fetch: async () => {calls++; return reply();}});
  assert.equal((await relay.handle(request('BINGX', undefined, undefined, {headers: {Origin: 'https://attacker.test'}}))).status, 403);
  assert.equal((await relay.handle(request('BINGX', undefined, undefined, {method: 'POST'}))).status, 405);
  assert.equal((await relay.handle(request('BINGX', undefined, undefined, {method: 'OPTIONS', headers: {Origin: 'https://didie111.github.io'}}))).status, 204);
  assert.equal(calls, 0);
});
test('BingX network fallback regenerates timestamps and preserves the selected contract', async () => {
  let clock = stamp; const calls = [];
  const relay = createMarketRelay({now: () => clock, wait: async ms => {clock += ms;}, fetch: async url => {
    calls.push(new URL(url));
    if (url.startsWith(primary)) throw TypeError('connection failed');
    return reply();
  }});
  const result = await relay.handle(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('X-Market-Source'), backup);
  assert.deepEqual(calls.map(url => url.origin), [primary, backup]);
  assert.equal(calls[1].searchParams.get('symbol'), 'RSR-USDT');
  assert.ok(Number(calls[1].searchParams.get('timestamp')) - Number(calls[0].searchParams.get('timestamp')) >= 1000);
});
test('HTTP denial and exchange contract errors retain their status or code and do not change hosts', async () => {
  for (const response of [() => new Response('Forbidden', {status: 403}), () => reply({code: 109425, msg: 'unsupported contract'})]) {
    const calls = [];
    const relay = createMarketRelay({fetch: async url => {calls.push(url); return response();}});
    const result = await relay.handle(request());
    const body = await result.json();
    assert.ok(result.status === 403 || body.code === 109425);
    assert.equal(calls.length, 1); assert.ok(calls[0].startsWith(primary));
  }
});
test('non-JSON MEXC responses report an error instead of a zero or fabricated funding record', async () => {
  const relay = createMarketRelay({fetch: async () => new Response('<html>Site Unavailable</html>')});
  const result = await relay.handle(request('MEXC', '/api/v1/contract/funding_rate/RSR_USDT', {}));
  assert.equal(result.status, 502);
  const body = await result.json();
  assert.match(body.message, /JSON 대신/); assert.equal(body.data, undefined);
});
test('unexpected redirects are not followed to a third-party service', async () => {
  let calls = 0;
  const relay = createMarketRelay({fetch: async () => {calls++; return new Response(null, {status: 302, headers: {Location: 'https://attacker.test'}});}});
  const result = await relay.handle(request());
  assert.equal(result.status, 502); assert.equal(calls, 1);
  assert.match((await result.json()).message, /리디렉션/);
});
test('a timed-out primary can recover through the official backup', async () => {
  let clock = stamp; const calls = [];
  const relay = createMarketRelay({requestTimeout: 5, now: () => clock, wait: async ms => {clock += ms;}, fetch: async (url, {signal}) => {
    calls.push(new URL(url).origin);
    if (url.startsWith(primary)) return await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}));
    return reply();
  }});
  const alive = setTimeout(() => {}, 50);
  try {assert.equal((await relay.handle(request())).status, 200);} finally {clearTimeout(alive);}
  assert.deepEqual(calls, [primary, backup]);
});
test('completed replies retain the real fetch time, and expired cache does not hide failures', async () => {
  let clock = stamp, calls = 0;
  const relay = createMarketRelay({now: () => clock, wait: async ms => {clock += ms;}, fetch: async () => {
    calls++; if (calls > 1) throw Error('upstream unavailable'); return reply();
  }});
  const results = [await relay.handle(request()), await relay.handle(request())];
  assert.equal(calls, 1);
  for (const result of results) assert.equal(Number(result.headers.get('X-Market-Fetched-At')), stamp);
  clock += 3001;
  const failed = await relay.handle(request());
  assert.equal(failed.status, 502); assert.equal((await failed.json()).data, undefined); assert.equal(calls, 2);
});
test('MEXC history pagination and candles retain their official paths and parameters', async () => {
  const calls = [];
  const relay = createMarketRelay({fetch: async url => {calls.push(new URL(url)); return reply({success: true, code: 0, data: []});}});
  assert.equal((await relay.handle(request('MEXC', '/api/v1/contract/funding_rate/history', {symbol: 'RSR_USDT', page_num: '2', page_size: '1000'}))).status, 200);
  assert.equal((await relay.handle(request('MEXC', '/api/v1/contract/kline/RSR_USDT', {interval: 'Min15', start: '1000', end: '2000'}))).status, 200);
  assert.equal(calls[0].searchParams.get('page_num'), '2'); assert.equal(calls[0].searchParams.get('page_size'), '1000');
  assert.equal(calls[1].searchParams.get('interval'), 'Min15'); assert.equal(calls[1].searchParams.get('start'), '1000');
});


test('canceling a visitor never leaves a shared pending request that blocks the next visitor',async()=>{
  let calls=0;
  const relay=createMarketRelay({requestTimeout:30,fetch:async()=>{calls++;return calls===1?new Promise(()=>{}):reply(mexcPayload);}});
  const controller=new AbortController();
  const first=relay.handle(request('MEXC','/api/v1/contract/funding_rate/RSR_USDT',{}, {signal:controller.signal}));
  await new Promise(resolve=>setImmediate(resolve));controller.abort();
  const alive=setTimeout(()=>{},100);
  try{
    assert.equal((await first).status,502);
    const second=await relay.handle(request('MEXC','/api/v1/contract/funding_rate/RSR_USDT',{}));
    assert.equal(second.status,200);assert.equal(calls,2);
  }finally{clearTimeout(alive);}
});
test('a fetch ignoring AbortSignal still reaches the relay deadline and cannot poison later requests',async()=>{
  let calls=0;const relay=createMarketRelay({requestTimeout:5,fetch:async()=>++calls===1?new Promise(()=>{}):reply(mexcPayload)});
  const alive=setTimeout(()=>{},100);
  try{
    assert.equal((await relay.handle(request('MEXC','/api/v1/contract/funding_rate/RSR_USDT',{}))).status,502);
    assert.equal((await relay.handle(request('MEXC','/api/v1/contract/funding_rate/RSR_USDT',{}))).status,200);
  }finally{clearTimeout(alive);}
});
test('canceling one BingX queue wait cannot hold another request behind an unresolved promise',async()=>{
  let clock=stamp,waiting=0;const relay=createMarketRelay({now:()=>clock,requestTimeout:30,wait:async ms=>{if(++waiting===1)return new Promise(()=>{});clock+=ms;},fetch:async()=>reply()});
  await relay.handle(request());
  const controller=new AbortController();
  const first=relay.handle(request('BINGX',undefined,{symbol:'BTC-USDT'},{signal:controller.signal}));
  await new Promise(resolve=>setImmediate(resolve));controller.abort();
  const alive=setTimeout(()=>{},100);
  try{
    assert.equal((await first).status,502);
    assert.equal((await relay.handle(request('BINGX',undefined,{symbol:'ETH-USDT'}))).status,200);
  }finally{clearTimeout(alive);}
});
test('local development origins are reflected exactly while lookalike hosts remain blocked',async()=>{
  const relay=createMarketRelay({fetch:async()=>reply(mexcPayload)});
  for(const origin of ['http://localhost:3000','http://127.0.0.1:8000','http://[::1]:5173']){
    const result=await relay.handle(request('MEXC','/api/v1/contract/funding_rate/RSR_USDT',{}, {headers:{Origin:origin}}));
    assert.equal(result.status,200);assert.equal(result.headers.get('Access-Control-Allow-Origin'),origin);
  }
  for(const origin of ['http://localhost.attacker.test','http://127.0.0.1.attacker.test','https://attacker.test'])assert.equal((await relay.handle(request('MEXC','/api/v1/contract/funding_rate/RSR_USDT',{}, {headers:{Origin:origin}}))).status,403);
});
