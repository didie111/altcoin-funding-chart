'use strict';

// Public market data only; no API keys or signing secrets belong in this page.
const MarketAPI = (() => {
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const abort = () => {clearTimeout(timer); reject(signal.reason);};
      const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, ms);
      signal.addEventListener('abort', abort, {once: true});
    });
  }
  function createClient({fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, wait = sleep} = {}) {
    let bingxQueue = Promise.resolve(), lastBingxStart = null;
    async function reserveBingx(signal, request) {
      const turn = bingxQueue.then(async () => {
        signal.throwIfAborted();
        const delay = lastBingxStart === null ? 0 : lastBingxStart + 1150 - now();
        if (delay > 0) await wait(delay, signal);
        signal.throwIfAborted();
        lastBingxStart = now();
        // Start fetch before releasing the queue; reserving a slot alone can let
        // simultaneous callers start together after the event loop is delayed.
        return {response: request()};
      });
      bingxQueue = turn.catch(() => {});
      return await turn;
    }
    async function json(base, params = {}, signal = new AbortController().signal) {
      const bingx = new URL(base).hostname === 'open-api.bingx.com';
      const name = bingx ? 'BingX' : new URL(base).hostname;
      for (let attempt = 0; attempt < 4; attempt++) {
        signal.throwIfAborted();
        const request = () => {
          const query = bingx ? {...params, timestamp: now()} : params;
          const url = base + '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined));
          return fetcher(url, {signal, cache: 'no-store', credentials: 'omit'});
        };
        let response;
        try {
          response = bingx ? await (await reserveBingx(signal, request)).response : await request();
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (attempt === 3) throw Error(name + ' 연결 실패: API 응답을 읽을 수 없습니다. CORS·지역 제한·네트워크 확인 필요');
          await wait(1000 * (attempt + 1), signal);
          continue;
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 3) throw Error(name + ' HTTP ' + response.status + ': 요청 제한 또는 서버 오류');
          const retryAfter = Number(response.headers?.get('retry-after'));
          await wait(retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 1500 * 2 ** attempt, signal);
          continue;
        }
        if (!response.ok) throw Error(name + ' HTTP ' + response.status);
        const result = await response.json();
        const code = result.retCode ?? result.code;
        if (code !== undefined && !['0', '00000'].includes(String(code))) {
          const message = name + ' API ' + code + ': ' + (result.retMsg || result.msg || result.message || '요청 실패');
          if (bingx && ['100410', '100500', '109500'].includes(String(code)) && attempt < 3) {
            await wait(1500 * 2 ** attempt, signal);
            continue;
          }
          throw Error(message);
        }
        if (result.success === false) throw Error(name + ': ' + (result.message || 'API 실패'));
        return result;
      }
      throw Error(name + ': API 실패');
    }
    return {json};
  }
  function candle(row) {
    const values = Array.isArray(row) ? row.slice(0, 6) : [row.time ?? row.timestamp ?? row.openTime, row.open, row.high, row.low, row.close, row.volume];
    if (values.some(value => value === null || value === undefined || String(value).trim() === '')) return null;
    const [stamp, open, high, low, close, volume] = values.map(Number);
    if (![stamp, open, high, low, close, volume].every(Number.isFinite) || stamp <= 0 || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close)) return null;
    return {time: Math.floor(stamp >= 1e11 ? stamp / 1000 : stamp), open, high, low, close, volume};
  }
  return {createClient, candle, ...createClient()};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MarketAPI;
