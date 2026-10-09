'use strict';

// Exchange APIs use decimal rates: -0.015 means -1.5%, without clipping.
const FundingEngine = (() => {
  const exchanges = [
    ['BINANCE', 'Binance'], ['BYBIT', 'Bybit'], ['BINGX', 'BingX'],
    ['BITGET', 'Bitget'], ['MEXC', 'MEXC'], ['OKX', 'OKX']
  ];
  function numeric(value) {
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function percent(value) {
    const n = numeric(value);
    const result = n === null ? null : n * 100;
    return result !== null && Number.isFinite(result) ? result : null;
  }
  function seconds(value) {
    const n = numeric(value);
    return n !== null && n > 0 ? Math.floor(n >= 1e11 ? n / 1000 : n) : null;
  }
  function base(symbol) {
    return String(symbol).toUpperCase().replace(/[-_]/g, '').replace(/USDT(?:SWAP)?$/, '');
  }
  function contract(ex, symbol) {
    const b = base(symbol);
    return ex === 'OKX' ? b + '-USDT-SWAP' : ex === 'BINGX' ? b + '-USDT' : ex === 'MEXC' ? b + '_USDT' : b + 'USDT';
  }
  function select(data, ex, symbol) {
    const expected = contract(ex, symbol);
    const row = Array.isArray(data) ? data.find(r => (r.symbol ?? r.instId) === expected) : data;
    if (!row || (row.symbol ?? row.instId ?? expected) !== expected) throw Error('해당 USDT 무기한 계약의 응답이 없습니다.');
    return row;
  }
  function currentRequest(ex, symbol) {
    const s = contract(ex, symbol);
    switch (ex) {
      case 'BINANCE': return {url: 'https://fapi.binance.com/fapi/v1/premiumIndex', params: {symbol: s}};
      case 'BYBIT': return {url: 'https://api.bybit.com/v5/market/tickers', params: {category: 'linear', symbol: s}};
      case 'BINGX': return {url: 'https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex', params: {symbol: s}};
      case 'BITGET': return {url: 'https://api.bitget.com/api/v2/mix/market/current-fund-rate', params: {symbol: s, productType: 'USDT-FUTURES'}};
      case 'MEXC': return {url: 'https://contract.mexc.com/api/v1/contract/funding_rate/' + s, params: {}};
      case 'OKX': return {url: 'https://www.okx.com/api/v5/public/funding-rate', params: {instId: s}};
      default: throw Error('지원하지 않는 거래소입니다.');
    }
  }
  function normalizeCurrent(ex, response, symbol, fetchedAt = Date.now()) {
    const data = ex === 'BINANCE' ? response : ex === 'BYBIT' ? response.result?.list : response.data;
    const row = select(data, ex, symbol);
    const rate = percent(ex === 'BINANCE' || ex === 'BINGX' ? row.lastFundingRate : row.fundingRate);
    if (rate === null) throw Error('현재 펀딩비가 비어 있거나 올바른 숫자가 아닙니다.');
    let nextTime = seconds(row.nextFundingTime ?? row.nextUpdate ?? row.nextSettleTime);
    // OKX fundingRate belongs to fundingTime; nextFundingTime is the following period.
    if (ex === 'OKX') nextTime = seconds(row.fundingTime);
    const timestamp = seconds(row.ts ?? row.time ?? row.timestamp ?? response.time ?? response.requestTime);
    const interval = numeric(row.fundingIntervalHour ?? row.fundingRateInterval ?? row.collectCycle);
    let hours = interval !== null && interval > 0 ? interval : null;
    if (ex === 'OKX') {
      const following = seconds(row.nextFundingTime);
      hours = following !== null && nextTime !== null && following > nextTime ? (following - nextTime) / 3600 : null;
    }
    return {exchange: ex, symbol: contract(ex, symbol), rate, nextTime, hours, timestamp, fetchedAt: Math.floor(fetchedAt / 1000)};
  }
  function historyRequest(ex, symbol, cursor, page = 1, now = Date.now()) {
    const s = contract(ex, symbol);
    switch (ex) {
      case 'BINANCE': return {url: 'https://fapi.binance.com/fapi/v1/fundingRate', params: {symbol: s, limit: 1000, startTime: cursor, endTime: now}};
      case 'BYBIT': return {url: 'https://api.bybit.com/v5/market/funding/history', params: {category: 'linear', symbol: s, limit: 200, endTime: cursor}};
      case 'BINGX': return {url: 'https://open-api.bingx.com/openApi/swap/v2/quote/fundingRate', params: {symbol: s, limit: 1000, endTime: cursor}};
      case 'BITGET': return {url: 'https://api.bitget.com/api/v2/mix/market/history-fund-rate', params: {symbol: s, productType: 'USDT-FUTURES', pageSize: 100, pageNo: page}};
      case 'MEXC': return {url: 'https://contract.mexc.com/api/v1/contract/funding_rate/history', params: {symbol: s, page_size: 1000, page_num: page}};
      case 'OKX': return {url: 'https://www.okx.com/api/v5/public/funding-rate-history', params: {instId: s, limit: 400, after: cursor}};
      default: throw Error('지원하지 않는 거래소입니다.');
    }
  }
  function merge(...groups) {
    const rows = new Map();
    for (const group of groups) for (const row of group) rows.set(row.time, row);
    return [...rows.values()].sort((a, b) => a.time - b.time);
  }
  function normalizeHistory(ex, response, symbol, now = Date.now()) {
    const rows = ex === 'BINANCE' ? response : ex === 'BYBIT' ? response.result?.list : ex === 'MEXC' ? response.data?.resultList : response.data;
    if (!Array.isArray(rows)) throw Error('펀딩비 이력 응답 형식이 올바르지 않습니다.');
    const expected = contract(ex, symbol);
    const result = [];
    for (const row of rows) {
      if ((row.symbol ?? row.instId ?? expected) !== expected) throw Error('다른 계약의 펀딩비가 반환되었습니다.');
      const time = seconds(row.fundingRateTimestamp ?? row.fundingTime ?? row.settleTime);
      const hasActual = row.realizedRate !== null && row.realizedRate !== undefined && String(row.realizedRate).trim() !== '';
      const actual = ex === 'OKX' && hasActual ? row.realizedRate : row.fundingRate;
      const rate = percent(actual);
      if (time === null || rate === null) throw Error('펀딩비 이력에 비어 있거나 잘못된 값이 있습니다.');
      if (time <= Math.floor(now / 1000)) result.push({time, rate});
    }
    return merge(result);
  }
  function mapToCandles(bars, records, interval, warn, extreme) {
    const mapped = new Map(), signals = [], unmapped = [];
    let index = 0;
    for (const record of records) {
      while (index + 1 < bars.length && bars[index + 1].time <= record.time) index++;
      const bar = bars[index];
      if (!bar || record.time < bar.time || record.time >= bar.time + interval) {unmapped.push(record); continue;}
      const old = mapped.get(bar.time);
      mapped.set(bar.time, {time: bar.time, rate: old ? Math.min(old.rate, record.rate) : record.rate, events: (old?.events ?? 0) + 1});
      const type = record.rate <= extreme ? 'EXTREME' : record.rate <= warn ? 'WARN' : null;
      if (type) signals.push({time: bar.time, eventTime: record.time, rate: record.rate, type});
    }
    return {mapped, signals, unmapped};
  }
  function minimum(records) {
    return records.reduce((lowest, row) => !lowest || row.rate < lowest.rate ? row : lowest, null);
  }
  return {exchanges, numeric, percent, seconds, base, contract, currentRequest, normalizeCurrent, historyRequest, normalizeHistory, merge, mapToCandles, minimum};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = FundingEngine;
