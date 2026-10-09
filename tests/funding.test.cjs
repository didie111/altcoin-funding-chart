'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../funding.js');
// Synthetic regression fixtures, not a claim about KAIA's actual market rate.
const now = 1791532800000;
const settle = now - 3600000;
const next = now + 3600000;
function current(ex, rate, coin = 'KAIA') {
  if (arguments.length < 2) rate = '-0.015';
  const s = engine.contract(ex, coin);
  const row = {symbol: s, fundingRate: rate, nextFundingTime: next};
  switch (ex) {
    case 'BINANCE': return {symbol: s, lastFundingRate: rate, nextFundingTime: next, time: now};
    case 'BYBIT': return {retCode: 0, time: now, result: {list: [{...row, fundingIntervalHour: '4'}]}};
    case 'BINGX': return {code: 0, data: {...row, lastFundingRate: rate, time: now}};
    case 'BITGET': return {code: '00000', requestTime: now, data: [{symbol: s, fundingRate: rate, nextUpdate: next, fundingRateInterval: '4'}]};
    case 'MEXC': return {success: true, code: 0, data: {symbol: s, fundingRate: rate, nextSettleTime: next, collectCycle: 4, timestamp: now}};
    case 'OKX': return {code: '0', data: [{instId: s, fundingRate: rate, fundingTime: next, nextFundingTime: next + 14400000, ts: now}]};
  }
}
function history(ex, rate) {
  if (arguments.length < 2) rate = '-0.015';
  const row = {symbol: engine.contract(ex, 'KAIA'), fundingRate: rate, fundingTime: settle};
  switch (ex) {
    case 'BINANCE': return [row];
    case 'BYBIT': return {result: {list: [{...row, fundingTime: undefined, fundingRateTimestamp: String(settle)}]}};
    case 'BINGX': return {data: [row]};
    case 'BITGET': return {data: [row]};
    case 'MEXC': return {data: {resultList: [{...row, fundingTime: undefined, settleTime: settle}]}};
    case 'OKX': return {data: [{instId: engine.contract(ex, 'KAIA'), fundingTime: String(settle), fundingRate: rate, realizedRate: rate}]};
  }
}
for (const [ex] of engine.exchanges) {
  test(ex + ': -0.015 is -1.5% in current and settled data', () => {
    const quote = engine.normalizeCurrent(ex, current(ex), 'KAIAUSDT', now);
    assert.equal(quote.rate, -1.5);
    assert.equal(quote.nextTime, next / 1000);
    assert.equal(quote.timestamp, now / 1000);
    assert.deepEqual(engine.normalizeHistory(ex, history(ex), 'KAIA', now), [{time: settle / 1000, rate: -1.5}]);
    assert.equal(engine.normalizeCurrent(ex, current(ex, '-0.03'), 'KAIA', now).rate, -3);
    assert.equal(engine.normalizeCurrent(ex, current(ex, '0'), 'KAIA', now).rate, 0);
  });
  test(ex + ': missing values and other contracts are rejected', () => {
    for (const value of ['', null, undefined, 'invalid']) {
      assert.throws(() => engine.normalizeCurrent(ex, current(ex, value), 'KAIA', now));
      assert.throws(() => engine.normalizeHistory(ex, history(ex, value), 'KAIA', now));
    }
    assert.throws(() => engine.normalizeCurrent(ex, current(ex, '-0.015', 'BTC'), 'KAIA', now));
  });
}
test('OKX realized settlement rate has priority, including a real zero', () => {
  const data = history('OKX', '0');
  data.data[0].fundingRate = '0.0001';
  assert.equal(engine.normalizeHistory('OKX', data, 'KAIA', now)[0].rate, 0);
  data.data[0].realizedRate = '';
  assert.equal(engine.normalizeHistory('OKX', data, 'KAIA', now)[0].rate, .01);
});
test('history is sorted, deduplicated and excludes future unsettled records', () => {
  const rows = [
    {fundingTime: settle, fundingRate: '-0.015'},
    {fundingTime: next, fundingRate: '-0.03'},
    {fundingTime: settle - 3600000, fundingRate: '0.0001'},
    {fundingTime: settle, fundingRate: '-0.015'}
  ];
  assert.deepEqual(engine.normalizeHistory('BINANCE', rows, 'KAIA', now), [
    {time: settle / 1000 - 3600, rate: .01}, {time: settle / 1000, rate: -1.5}
  ]);
});
test('negative extremes survive 15m/1h/4h/day mapping and signal thresholds', () => {
  const t = Math.floor(settle / 1000 / 86400) * 86400;
  for (const interval of [900, 3600, 14400, 86400]) {
    const bars = Array.from({length: 2}, (_, i) => ({time: t + i * interval}));
    const rows = [{time: t + 1, rate: -.2}, {time: t + interval - 1, rate: -1.5}, {time: t + interval, rate: .01}];
    const result = engine.mapToCandles(bars, rows, interval, -.5, -2);
    assert.equal(result.mapped.get(t).rate, -1.5);
    assert.equal(result.mapped.get(t).events, 2);
    assert.equal(result.mapped.get(t + interval).rate, .01);
    assert.deepEqual(result.signals, [{time: t, eventTime: t + interval - 1, rate: -1.5, type: 'WARN'}]);
    assert.equal(result.unmapped.length, 0);
  }
});
test('candle gaps are reported and minimum is calculated over collected records', () => {
  const t = settle / 1000;
  const rows = [{time: t, rate: -.2}, {time: t + 7200, rate: -1.5}];
  const result = engine.mapToCandles([{time: t}, {time: t + 10800}], rows, 3600, -.5, -2);
  assert.deepEqual(result.unmapped, [rows[1]]);
  assert.deepEqual(engine.minimum(rows), rows[1]);
});
test('funding cursors use exchange-specific directions and published page limits', () => {
  assert.deepEqual(engine.historyRequest('BINANCE', 'KAIA', settle, 1, now).params, {symbol: 'KAIAUSDT', limit: 1000, startTime: settle, endTime: now});
  assert.equal(engine.historyRequest('BYBIT', 'KAIA', settle).params.endTime, settle);
  assert.equal(engine.historyRequest('BINGX', 'KAIA', settle).params.symbol, 'KAIA-USDT');
  assert.equal(engine.historyRequest('BITGET', 'KAIA', undefined, 3).params.pageNo, 3);
  assert.equal(engine.historyRequest('BITGET', 'KAIA').params.pageSize, 100);
  assert.equal(engine.historyRequest('MEXC', 'KAIA', undefined, 3).params.page_num, 3);
  assert.equal(engine.historyRequest('MEXC', 'KAIA').params.page_size, 1000);
  assert.equal(engine.historyRequest('OKX', 'KAIA', settle).params.after, settle);
  assert.equal(engine.historyRequest('OKX', 'KAIA').params.limit, 400);
});
function harness(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const snippet = source.slice(source.indexOf('let fundingSession = null;'), source.indexOf('async function loadData(){'));
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {textContent: '', disabled: false, title: ''});
    return nodes.get(id);
  };
  const requests = [], renders = [], timers = [];
  const context = {
    FundingEngine: engine, AbortController, AbortSignal, Date, Map,
    $: node, document: {hidden: false},
    setInterval: (callback, ms) => {const timer = {callback, ms, stopped: false}; timers.push(timer); return timer;},
    clearInterval: timer => {if (timer) timer.stopped = true;},
    date: t => new Date(t * 1000).toISOString(),
    run: 1, busy: options.busy ?? true, all: [{time: settle / 1000}],
    rates: [{time: settle / 1000, rate: .01}], unmappedFunding: [],
    duration: {'1h': 3600}, windowStart: 0, officialCycle: null,
    chart: {timeScale: () => ({getVisibleLogicalRange: () => ({from: -10, to: 10})})},
    json: async (url, params, signal) => {
      requests.push({url, params, signal});
      if (options.gate) await options.gate;
      if (options.error) throw Error('network unavailable');
      const ex = engine.exchanges.find(([ex]) => url === engine.currentRequest(ex, 'KAIA').url)?.[0] ?? 'MEXC';
      return current(ex, '-0.015', String(params.symbol ?? params.instId ?? 'KAIA').startsWith('BTC') ? 'BTC' : 'KAIA');
    },
    fundingPage: async () => options.history ?? [{time: settle / 1000, rate: -.2}],
    candlePage: async () => [{time: settle / 1000}, {time: next / 1000}],
    uniqueSorted: rows => engine.merge(rows),
    rebuild: () => {}, renderWindow: (...args) => renders.push(args),
    lowerBound: (rows, time) => rows.findIndex(row => row.time >= time),
    status: () => {}, focusSignal: () => {}, loadData: () => {}, pause: async () => {}
  };
  vm.createContext(context);
  vm.runInContext(snippet + '\nthis.api={startFundingUpdates,stopFundingUpdates,refreshFundingSession,renderFundingBoard,getSession:()=>fundingSession};', context);
  return {context, nodes, requests, renders, timers, api: context.api};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('live value is shown during backfill and is kept separate from settled rates', async () => {
  const h = harness(); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush();
  assert.match(h.nodes.get('fundingSelected').textContent, /-1\.500000%/);
  assert.match(h.nodes.get('fundingSettled').textContent, /-0\.200000%/);
  assert.equal(h.context.rates[0].rate, .01);
  assert.equal(h.renders.length, 0);
  assert.equal(h.requests.length, 6);
  assert.equal(h.timers[0].ms, 60000);
});
test('live settlement refresh merges new records and keeps the current viewport', async () => {
  const rows = [{time: settle / 1000, rate: .01}, {time: next / 1000, rate: -1.5}];
  const h = harness({busy: false, history: rows}); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush();
  assert.equal(h.context.rates.at(-1).rate, -1.5);
  assert.equal(h.renders.length, 1);
  assert.equal(h.renders[0][1], false);
  assert.equal(h.renders[0][3].from, -10);
  assert.equal(h.renders[0][3].to, 10);
});
test('failed quote requests are unavailable rather than zero', async () => {
  const h = harness({error: true}); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush();
  assert.match(h.nodes.get('fundingSelected').textContent, /조회 실패/);
  assert.doesNotMatch(h.nodes.get('fundingSelected').textContent, /0\.000000%/);
  assert.ok([...h.api.getSession().entries.values()].every(row => row.quote === null && row.error));
});
test('changing the selected coin discards outstanding responses from the old session', async () => {
  let release; const gate = new Promise(resolve => {release = resolve;});
  const h = harness({gate}); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  const old = h.api.getSession(); h.context.run = 2;
  h.api.startFundingUpdates('BINANCE', 'BTC', '1h', 2);
  release(); await flush();
  assert.ok(old.abort.signal.aborted);
  assert.equal(old.entries.size, 0);
  assert.equal(h.api.getSession().symbol, 'BTC');
  assert.match(h.nodes.get('fundingSelected').textContent, /BTCUSDT/);
});
test('stop aborts requests and disables periodic refresh', async () => {
  const h = harness(); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush(); h.api.stopFundingUpdates();
  assert.ok(h.api.getSession().abort.signal.aborted);
  assert.ok(h.timers[0].stopped);
  assert.match(h.nodes.get('fundingUpdateStatus').textContent, /자동 갱신 중지/);
});
