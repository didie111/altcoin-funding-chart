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
test('BingX history uses bounded start/end windows that keep moving backward through settled records', () => {
  for (const cursor of [now, now - 90 * 86400000]) {
    const request = engine.historyRequest('BINGX', 'RSR', cursor);
    assert.equal(request.params.endTime, cursor);
    assert.equal(request.params.startTime, cursor - 90 * 86400000);
    assert.equal(request.params.limit, 1000);
    const payload = request.params.startTime > 0 && request.params.endTime - request.params.startTime <= 90 * 86400000
      ? {code: 0, data: [{symbol: 'RSR-USDT', fundingTime: cursor - 3600000, fundingRate: '-0.00593600'}]}
      : {code: 0, data: null};
    assert.equal(engine.normalizeHistory('BINGX', payload, 'RSR', now).length, 1);
  }
  assert.deepEqual(engine.normalizeHistory('BINGX', {code: 0, data: null}, 'RSR'), []);
  assert.throws(() => engine.normalizeHistory('BINGX', {data: null}, 'RSR'));
});
test('MEXC current, historical, candle and cycle requests work only through the replacement official API domain', async () => {
  const requests = [];
  const context = {
    FundingEngine: engine, TimeframeEngine: require('../timeframes.js'), duration: {'15m': 900}, candle: require('../market-api.js').candle,
    json: async (url, params) => {
      const request = new URL(url); requests.push({request, params});
      if (request.origin !== 'https://api.mexc.com') throw Error('Retired domain is unavailable');
      if (request.pathname === '/api/v1/contract/kline/KAIA_USDT') return {data: {time: [now / 1000], open: [2], high: [4], low: [1], close: [3], vol: [5]}};
      if (request.pathname === '/api/v1/contract/funding_rate/KAIA_USDT') return current('MEXC');
      if (request.pathname === '/api/v1/contract/funding_rate/history') return history('MEXC');
      throw Error('Unexpected MEXC endpoint');
    }
  };
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function baseSymbol(s)'), source.indexOf('let fundingSession = null;')), context);
  const request = engine.currentRequest('MEXC', 'KAIAUSDT');
  const quote = engine.normalizeCurrent('MEXC', await context.json(request.url, request.params), 'KAIA', now);
  assert.equal(quote.rate, -1.5);
  assert.equal(quote.hours, 4);
  assert.equal((await context.fundingPage('MEXC', 'KAIAUSDT', now, 2))[0].rate, -1.5);
  assert.deepEqual(JSON.parse(JSON.stringify((await context.candlePage('MEXC', 'KAIAUSDT', '15m', now)).map(({fetchedAt,...bar})=>bar))), [{time: now / 1000, open: 2, high: 4, low: 1, close: 3, volume: 5}]);
  assert.equal((await context.fetchOfficialCycle('MEXC', 'KAIAUSDT')).hours, 4);
  assert.equal(requests.length, 4);
  assert.equal(requests[1].params.symbol, 'KAIA_USDT');
  assert.equal(requests[1].params.page_num, 2);
  assert.equal(requests[2].params.interval, 'Min15');
});
function harness(options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const snippet = source.slice(source.indexOf('let fundingSession = null;'), source.indexOf('async function loadData(){'));
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {textContent: '', disabled: false, title: ''});
    return nodes.get(id);
  };
  const requests = [], renders = [], timers = [], updates=[], rangeUpdates=[], live = {data: [], options: {}};
  const fixture=(row)=>({open:10,high:Math.max(11,row.close??10),low:9,close:10,volume:5,...row});
  const updateSeries=name=>({update:row=>updates.push({name,row}),setData:()=>{}});
  const liveUpdate=row=>{const index=live.data.findIndex(bar=>bar.time===row.time);if(index>=0)live.data[index]=row;else live.data.push(row);};
  class Clock extends Date {static now() {return now;}}
  const context = {
    FundingEngine: engine, TimeframeEngine:require('../timeframes.js'),ChartData:require('../chart-data.js'),AbortController, AbortSignal, Date: Clock, Map,
    $: node, document: {hidden: false},
    setInterval: (callback, ms) => {const timer = {callback, ms, stopped: false}; timers.push(timer); return timer;},
    clearInterval: timer => {if (timer) timer.stopped = true;},
    date: t => new Date(t * 1000).toISOString(),
    run: 1, chartDateFocus: null, busy: options.busy ?? true, changingWindow: false, requestAnimationFrame: callback=>{timers.push({callback,frame:true});}, all: [fixture({time: settle / 1000}),fixture({time: now / 1000})],loadedMarket:{int:'1h'},latestOffset:5,WINDOW:10000,cycleValues:new Map(),cycleFast:new Uint8Array(2),mapped:new Map(),
    rates: [{time: settle / 1000, rate: .01}], unmappedFunding: [],
    duration: {'1h': 3600}, windowStart: 0, windowEnd: 2, officialCycle: null,
    candles:updateSeries('price'),volume:updateSeries('volume'),funding:updateSeries('funding'),settlementCycle:updateSeries('cycle'),liveCycleValue:()=>null,currentCyclePeriod:()=>null,cycleColor:()=>'',thresholds:()=>({warn:-.5,ext:-2}),renderCycles:()=>{},renderSignalMarkers:()=>{},
    fundingLive: {update:liveUpdate,setData: rows => {live.data = rows;}, applyOptions: value => {Object.assign(live.options, value);}},
    studyPanels: {updateFundingLegend: () => {},updateLive:rows=>updates.push({name:'rsi',rows})}, schedule: () => {},
    chart: {timeScale: () => ({getVisibleLogicalRange: () => ({from: -10, to: 10}),setVisibleLogicalRange:r=>rangeUpdates.push(r)})},
    json: async (url, params, signal) => {
      requests.push({url, params, signal});
      const ex = engine.exchanges.find(([ex]) => url === engine.currentRequest(ex, 'KAIA').url)?.[0] ?? 'MEXC';
      if (options.gate) await options.gate;
      if (options.exchangeGates?.[ex]) await options.exchangeGates[ex];
      if (options.error) throw Error('network unavailable');
      const payload = current(ex, options.rate ?? '-0.015', String(params.symbol ?? params.instId ?? 'KAIA').startsWith('BTC') ? 'BTC' : 'KAIA');
      if (options.fetchedAt) payload.__marketFetchedAt = options.fetchedAt;
      return payload;
    },
    fundingPage: async () => {if (options.historyGate) await options.historyGate; return options.history ?? [{time: settle / 1000, rate: -.2}];},
    candlePage: async () => {if (options.candleGate) await options.candleGate; return (options.candles ?? [{time: now / 1000}]).map(fixture);},
    uniqueSorted: rows => engine.merge(rows),
    rebuild: () => {}, renderWindow: (...args) => renders.push(args),
    lowerBound: (rows, time) => rows.findIndex(row => row.time >= time),
    status: () => {}, focusSignal: () => {}, loadData: () => {}, pause: async () => {}
  };
  vm.createContext(context);
  vm.runInContext(snippet + '\nthis.api={startFundingUpdates,stopFundingUpdates,refreshFundingSession,refreshFundingQuotes,renderFundingBoard,fundingLegend,getSession:()=>fundingSession};', context);
  return {context, nodes, requests, renders, timers, live, updates,rangeUpdates,api: context.api};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test('live value is shown during backfill and is kept separate from settled rates', async () => {
  const h = harness(); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush();
  assert.match(h.nodes.get('fundingSelected').textContent, /-1\.500000%/);
  assert.match(h.nodes.get('fundingSettled').textContent, /-0\.200000%/);
  assert.ok(h.context.rates.every(row => row.rate !== -1.5));
  assert.equal(h.live.data.at(-1).value, -1.5);
  assert.equal(h.live.data[0].value, undefined);
  assert.equal(h.requests.length, 6);
  assert.deepEqual(h.timers.map(row => row.ms), [10000,3000,60000]);
});
test('the funding board uses the relay fetch time rather than relabeling cached quotes as newly fetched', async () => {
  const fetchedAt = now - 10000;
  const h = harness({fetchedAt}); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush();
  const quote = h.api.getSession().entries.get('MEXC').quote;
  assert.equal(quote.fetchedAt, fetchedAt / 1000);
  assert.equal(h.api.getSession().liveRows.at(-1).observedAt, fetchedAt / 1000);
});
test('live settlement refresh merges new records and keeps the current viewport', async () => {
  const rows = [{time: settle / 1000, rate: .01}, {time: next / 1000, rate: -1.5}];
  const h = harness({busy: false, history: rows}); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush();
  assert.equal(h.context.rates.at(-1).rate, -1.5);
  assert.equal(h.renders.length,0);
  assert.equal(h.rangeUpdates.length,0); // settlement refresh must not move the price viewport
});
test('failed quote requests are unavailable rather than zero', async () => {
  const h = harness({error: true}); h.api.startFundingUpdates('MEXC', 'KAIA', '1h', 1);
  await flush();
  assert.match(h.nodes.get('fundingSelected').textContent, /조회 실패/);
  assert.doesNotMatch(h.nodes.get('fundingSelected').textContent, /0\.000000%/);
  assert.ok([...h.api.getSession().entries.values()].every(row => row.quote === null && row.error));
  assert.ok(h.live.data.every(row => row.value === undefined));
  assert.match(h.nodes.get('fundingApiError').textContent, /network unavailable/);
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
  assert.ok(h.timers.every(row => row.stopped));
  assert.equal(h.live.options.title, '이전값');
  assert.match(h.nodes.get('fundingUpdateStatus').textContent, /자동 갱신 중지/);
});

test('selected live panel updates immediately while another exchange and history are pending', async () => {
  let release; const gate = new Promise(resolve => {release = resolve;});
  const h = harness({rate: '-0.02', exchangeGates: {BINGX: gate}, historyGate: gate});
  h.api.startFundingUpdates('BINANCE', 'KAIA', '1h', 1);
  await flush();
  assert.equal(h.live.data.at(-1).value, -2);
  assert.match(h.api.fundingLegend(), /현재 -2\.000000% · 미정산/);
  assert.ok(h.api.getSession().pending);
  assert.equal(h.api.getSession().entries.has('BINGX'), false);
  release(); await flush();
});
test('ten-second quote refresh changes the live panel without overwriting settlement rates', async () => {
  const options = {rate: '-0.015'};
  const h = harness(options); h.api.startFundingUpdates('BINANCE', 'KAIA', '1h', 1);
  await flush(); options.rate = '-0.02';
  h.timers.find(timer => timer.ms === 10000).callback(); await flush();
  assert.equal(h.live.data.at(-1).value, -2);
  assert.equal(h.api.getSession().liveRows.length, 1);
  assert.ok(h.context.rates.every(row => row.rate !== -2));
});
test('failed refresh retains the observed rate with an explicit stale label', async () => {
  const options = {};
  const h = harness(options); h.api.startFundingUpdates('BINGX', 'KAIA', '1h', 1);
  await flush(); options.error = true;
  await h.api.refreshFundingQuotes(h.api.getSession());
  assert.equal(h.live.data.at(-1).value, -1.5);
  assert.equal(h.live.options.title, '이전값');
  assert.match(h.api.fundingLegend(), /이전값/);
  assert.match(h.nodes.get('fundingApiError').textContent, /network unavailable/);
});
test('observed current rates leave unseen historical candles blank across settlement', () => {
  const interval = 3600, t = now / 1000;
  let records = engine.observeCurrent([], {fetchedAt: t + 10, rate: -1.5}, interval);
  records = engine.observeCurrent(records, {fetchedAt: t + 20, rate: -2}, interval);
  records = engine.observeCurrent(records, {fetchedAt: t + interval + 10, rate: .01}, interval);
  assert.deepEqual(engine.liveSeriesData([{time: t - interval}, {time: t}, {time: t + interval}], records), [
    {time: t - interval}, {time: t, value: -2}, {time: t + interval, value: .01}
  ]);
});

test('current candles keep updating while historical backfill is still in progress', async () => {
  const h = harness({busy: true, rate: '-0.02', candles: [{time: now / 1000, close: 12}]});
  h.api.startFundingUpdates('BITGET', 'KAIA', '1h', 1); await flush();
  assert.equal(h.context.busy, true);
  assert.equal(h.context.all.at(-1).close, 12);
  assert.equal(h.api.getSession().recentCandles.at(-1).close, 12);
  assert.equal(h.live.data.at(-1).value, -2);
  assert.ok(h.renders.every(render => render[1] === false));
});

test('a live refresh waits for a pending date navigation frame instead of preserving obsolete logical indices',async()=>{
  const h=harness();h.api.startFundingUpdates('BITGET','KAIA','1h',1);await flush();
  const count=h.renders.length;h.context.changingWindow=true;
  h.context.refreshFundingChart(h.api.getSession(),[{time:now/1000,close:99}]);
  assert.equal(h.renders.length,count);
  assert.notEqual(h.context.all.at(-1).close,99);
  const frame=h.timers.find(t=>t.frame);assert.ok(frame);
  h.context.changingWindow=false;frame.callback();
  assert.equal(h.renders.length,count);assert.equal(h.context.all.at(-1).close,99);
  assert.ok(h.updates.some(row=>row.name==='price'&&row.row.close===99));
});

test('live candle refresh retains the selected date while leaving manual price scales intact',async()=>{
  const h=harness();h.api.startFundingUpdates('BITGET','KAIA','1h',1);await flush();
  h.context.chartDateFocus={id:1,time:settle/1000,span:180};
  h.context.refreshFundingChart(h.api.getSession(),[{time:now/1000+3600,close:100}]);
  assert.equal(h.renders.length,0);assert.equal(h.rangeUpdates.length,0);
  assert.equal(h.context.chartDateFocus.time,settle/1000);
  assert.ok(h.updates.some(row=>row.name==='price'&&row.row.time===now/1000+3600));
});

test('a new minute updates price, volume, funding time points, cycle and RSI together without replacing price data',async()=>{
 const h=harness();h.api.startFundingUpdates('MEXC','KAIA','1h',1);await flush();h.updates.length=0;
 h.context.duration['1m']=60;h.context.loadedMarket.int='1m';h.api.getSession().interval='1m';
 const time=now/1000+60;
 h.context.refreshFundingChart(h.api.getSession(),[{time,open:10,high:12,low:9,close:11,volume:25}]);
 assert.deepEqual(h.updates.map(item=>item.name),['price','volume','funding','cycle','rsi']);
 assert.ok(h.updates.slice(0,4).every(item=>item.row.time===time));
 assert.equal(h.updates[4].rows[0].time,time);assert.equal(h.renders.length,0);
 assert.equal(h.context.windowEnd,h.context.all.length);
});

test('switching a market disposes all three timers including the fast candle timer',async()=>{
 const h=harness();h.api.startFundingUpdates('MEXC','KAIA','1h',1);await flush();const previous=h.timers.slice();
 h.context.run=2;h.api.startFundingUpdates('MEXC','BTC','1h',2);await flush();
 assert.equal(previous.length,3);assert.ok(previous.every(timer=>timer.stopped));
});

test('a live candle outside a historical render window does not redraw that window or move its date',async()=>{
 const h=harness();h.api.startFundingUpdates('MEXC','KAIA','1h',1);await flush();
 h.context.windowEnd=1;h.context.chartDateFocus={id:1,time:settle/1000,span:180};
 h.context.refreshFundingChart(h.api.getSession(),[{time:now/1000+3600,open:10,high:12,low:9,close:11,volume:25}]);
 assert.equal(h.renders.length,0);assert.equal(h.rangeUpdates.length,0);assert.equal(h.context.windowEnd,1);
 assert.equal(h.context.chartDateFocus.time,settle/1000);assert.equal(h.context.all.at(-1).close,11);
});
