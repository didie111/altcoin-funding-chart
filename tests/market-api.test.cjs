'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createClient, candle} = require('../market-api.js');
const engine = require('../funding.js');
const host = 'https://open-api.bingx.com/openApi/swap/';
const stamp = 1791532800000;
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
