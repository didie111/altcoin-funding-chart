// Read-only official market endpoints. Never forward browser Origin, cookies or credentials.
const PAGE_ORIGIN = 'https://didie111.github.io';
const BINGX_PRIMARY = 'https://open-api.bingx.com';
const BINGX_BACKUP = 'https://open-api.bingx.pro';
const MEXC_PRIMARY = 'https://api.mexc.com';
const bingxPaths = new Set(['/openApi/swap/v2/quote/premiumIndex', '/openApi/swap/v2/quote/fundingRate', '/openApi/swap/v3/quote/klines']);
const intervals = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d']);
const mexcIntervals = new Set(['Min1', 'Min5', 'Min15', 'Min30', 'Min60', 'Hour4', 'Day1']);

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {clearTimeout(timer); reject(signal.reason);};
    const timer = setTimeout(() => {signal.removeEventListener('abort', abort); resolve();}, ms);
    signal.addEventListener('abort', abort, {once: true});
  });
}

function targetFor(input) {
  const exchange = input.searchParams.get('exchange');
  const path = input.searchParams.get('path');
  if (!['BINGX', 'MEXC'].includes(exchange) || !path) throw Error('지원하지 않는 거래소 또는 조회 경로입니다.');
  const bingx = exchange === 'BINGX';
  const current = bingx ? path.endsWith('/premiumIndex') : /^\/api\/v1\/contract\/funding_rate\/[A-Z0-9]{1,32}_USDT$/.test(path);
  const history = bingx ? path.endsWith('/fundingRate') : path === '/api/v1/contract/funding_rate/history';
  const candles = bingx ? path.endsWith('/klines') : /^\/api\/v1\/contract\/kline\/[A-Z0-9]{1,32}_USDT$/.test(path);
  if (bingx ? !bingxPaths.has(path) : !(current || history || candles)) throw Error('공개 시세 조회만 지원합니다.');
  const allowed = new Set(['exchange', 'path', 'timestamp']);
  const params = new URLSearchParams();
  const add = (key, validate, required = false) => {
    allowed.add(key);
    const value = input.searchParams.get(key);
    if (value === null) {if (required) throw Error(key + ' 값이 필요합니다.'); return;}
    if (!validate(value)) throw Error(key + ' 값이 올바르지 않습니다.');
    params.set(key, value);
  };
  const number = (min, max) => value => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
  if (bingx || history) add('symbol', value => (bingx ? /^[A-Z0-9]{1,32}-USDT$/ : /^[A-Z0-9]{1,32}_USDT$/).test(value), true);
  if (bingx && (history || candles)) {
    add('limit', number(1, 1000)); add('startTime', number(0, 1e15)); add('endTime', number(0, 1e15));
  }
  if (bingx && candles) add('interval', value => intervals.has(value), true);
  if (!bingx && history) {add('page_num', number(1, 1000000)); add('page_size', number(1, 1000));}
  if (!bingx && candles) {
    add('interval', value => mexcIntervals.has(value), true);
    add('start', number(0, 1e12)); add('end', number(0, 1e12));
  }
  for (const key of input.searchParams.keys()) {
    if (!allowed.has(key) || input.searchParams.getAll(key).length !== 1) throw Error('허용되지 않거나 중복된 조회 매개변수입니다.');
  }
  params.sort();
  return {exchange, path, params, current, origin: bingx ? BINGX_PRIMARY : MEXC_PRIMARY, key: exchange + path + '?' + params};
}

export function createMarketRelay({fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, wait = pause, requestTimeout = 7000} = {}) {
  const cache = new Map(), pending = new Map();
  let bingxQueue = Promise.resolve(), lastBingxStart = null;
  async function request(target, origin, signal) {
    const start = async () => {
      signal.throwIfAborted();
      const params = new URLSearchParams(target.params);
      if (target.exchange === 'BINGX') params.set('timestamp', String(now()));
      const timeout = AbortSignal.timeout(requestTimeout);
      const combined = AbortSignal.any([signal, timeout]);
      try {
        const response = await fetcher(origin + target.path + (params.size ? '?' + params : ''), {
          signal: combined, headers: {Accept: 'application/json'}, redirect: 'manual', cache: 'no-store'
        });
        if (response.status >= 300 && response.status < 400) throw Error(target.exchange + ' API가 다른 주소로 리디렉션했습니다: HTTP ' + response.status);
        const body = await response.text();
        if (body.length > 2 * 1024 * 1024) throw Error('거래소 응답이 허용 크기를 초과했습니다.');
        let data;
        try {data = JSON.parse(body);} catch {
          if (!response.ok) {
            data = {code: 'UPSTREAM_HTTP_ERROR', message: target.exchange + ' HTTP ' + response.status};
            return {body: JSON.stringify(data), status: response.status, source: origin, fetchedAt: now(), retryAfter: response.headers.get('retry-after'), data};
          }
          throw Error(target.exchange + '가 JSON 대신 접근 제한 또는 비정상 응답을 반환했습니다.');
        }
        if (!data || typeof data !== 'object') throw Error('거래소 응답 형식이 올바르지 않습니다.');
        return {body, status: response.status, source: origin, fetchedAt: now(), retryAfter: response.headers.get('retry-after'), data};
      } catch (error) {
        signal.throwIfAborted();
        if (timeout.aborted) throw timeout.reason;
        throw error;
      }
    };
    if (target.exchange !== 'BINGX') return await start();
    const turn = bingxQueue.then(async () => {
      signal.throwIfAborted();
      const delay = lastBingxStart === null ? 0 : lastBingxStart + 1150 - now();
      if (delay > 0) await wait(delay, signal);
      signal.throwIfAborted(); lastBingxStart = now();
      return {response: start()};
    });
    bingxQueue = turn.catch(() => {});
    return await (await turn).response;
  }

  async function load(target) {
    const saved = cache.get(target.key);
    if (saved?.expires > now()) return saved.reply;
    if (pending.has(target.key)) return await pending.get(target.key);
    // One visitor leaving the page must not cancel a shared request for others.
    const signal = new AbortController().signal;
    const job = (async () => {
      let reply;
      try {reply = await request(target, target.origin, signal);} catch (error) {
        signal.throwIfAborted();
        if (target.exchange !== 'BINGX' || (!(error instanceof TypeError) && error.name !== 'TimeoutError')) throw error;
        reply = await request(target, BINGX_BACKUP, signal);
      }
      const code = reply.data.code;
      if (reply.status === 200 && reply.data.success !== false && (code === undefined || ['0', '00000'].includes(String(code)))) {
        cache.delete(target.key);
        cache.set(target.key, {reply, expires: now() + (target.current ? 3000 : 10000)});
        while (cache.size > 32) cache.delete(cache.keys().next().value);
      }
      return reply;
    })();
    pending.set(target.key, job);
    try {return await job;} finally {pending.delete(target.key);}
  }

  async function handle(request) {
    const input = new URL(request.url), origin = request.headers.get('origin');
    const headers = {
      'Access-Control-Allow-Origin': PAGE_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Market-Fetched-At, X-Market-Source',
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin'
    };
    const errorResponse = (message, status) => new Response(JSON.stringify({code: 'RELAY_ERROR', message}), {status, headers});
    if (origin && origin !== PAGE_ORIGIN && origin !== input.origin) return errorResponse('허용되지 않은 요청 출처입니다.', 403);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (request.method !== 'GET') return errorResponse('조회 요청만 지원합니다.', 405);
    let target;
    try {target = targetFor(input);} catch (error) {return errorResponse(error.message, 400);}
    try {
      request.signal.throwIfAborted();
      const reply = await load(target);
      headers['X-Market-Fetched-At'] = String(reply.fetchedAt);
      headers['X-Market-Source'] = reply.source;
      if (reply.retryAfter) headers['Retry-After'] = reply.retryAfter;
      return new Response(reply.body, {status: reply.status, headers});
    } catch (error) {
      return errorResponse(target.exchange + ' 공식 API 조회 실패: ' + (error.name === 'TimeoutError' ? '응답 시간 초과' : error.message), 502);
    }
  }
  return {handle};
}

export const marketRelay = createMarketRelay();
