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
  function createClient({fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, wait = sleep, requestTimeout = 10000, relayUrl = globalThis.MARKET_RELAY_URL || null, onRetry} = {}) {
    let bingxQueue = Promise.resolve(), lastBingxStart = null;
    const cooldowns=new Map();
    function limitError(message,delay=0){const error=Error(message);error.name='RateLimitError';error.retryAt=now()+delay;return error;}
    function retryDelay(response,attempt){const raw=response.headers?.get('retry-after'),seconds=raw===null||raw===undefined||String(raw).trim()===''?NaN:Number(raw),date=Number.isFinite(seconds)?NaN:Date.parse(raw),reset=Number(response.headers?.get('X-Bapi-Limit-Reset-Timestamp')),explicit=Math.max(Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now():0,reset>now()?reset-now():0);return explicit>0?explicit:1500*2**attempt;}
    async function rateWait(host,name,response,attempt,message){
      const delay=retryDelay(response,attempt);cooldowns.set(host,Math.max(cooldowns.get(host)||0,now()+delay));globalThis.MarketShared?.broker.defer?.(host,now()+delay);
      if(attempt===3||delay>60000)throw limitError(message+' · API 요청 제한입니다. '+Math.ceil(delay/1000)+'초 이상 기다린 뒤 다시 실행해 주세요.',delay);
      const detail={exchange:name,host,delay,attempt:attempt+1};if(onRetry)onRetry(detail);else if(typeof globalThis.dispatchEvent==='function'&&typeof globalThis.CustomEvent==='function')globalThis.dispatchEvent(new CustomEvent('market-api-wait',{detail}));
    }
    async function serviceWait(host,name,attempt,message,signal){
      if(attempt===3){const error=Error(message+' · 거래소 서버 오류가 재시도 후에도 계속됩니다.');error.name='MarketServiceError';error.code=10016;throw error;}
      const delay=1500*2**attempt,detail={exchange:name,host,delay,attempt:attempt+1,kind:'service'};
      if(onRetry)onRetry(detail);else if(typeof globalThis.dispatchEvent==='function'&&typeof globalThis.CustomEvent==='function')globalThis.dispatchEvent(new CustomEvent('market-api-wait',{detail}));
      await wait(delay,signal);
    }
    async function cooldown(host,signal){
      const broker=globalThis.MarketShared?.broker;if(broker?.waitForCooldown)await broker.waitForCooldown(host,signal);
      for(;;){signal.throwIfAborted();const delay=(cooldowns.get(host)||0)-now();if(delay<=0)return;await wait(delay,signal);}
    }
    async function fetchTimed(url, signal, timeout = requestTimeout) {
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.throwIfAborted();
      signal.addEventListener('abort', abort, {once: true});
      const timer = setTimeout(() => controller.abort(new DOMException('시장 데이터 응답 제한 초과', 'TimeoutError')), timeout);
      try {
        return await fetcher(url, {signal: controller.signal, cache: 'no-store', credentials: 'omit'});
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }
    async function reserveBingx(signal, request) {
      if(globalThis.MarketShared)return globalThis.MarketShared.broker.reserveBingx(signal,request);
      const turn = bingxQueue.then(async () => {
        signal.throwIfAborted();
        await cooldown('open-api.bingx.com',signal);
        const delay = lastBingxStart === null ? 0 : lastBingxStart + 1150 - now();
        if (delay > 0) await wait(delay, signal);
        await cooldown('open-api.bingx.com',signal);
        signal.throwIfAborted();
        lastBingxStart = now();
        // Start fetch before releasing the queue; reserving a slot alone can let
        // simultaneous callers start together after the event loop is delayed.
        return {response: request()};
      });
      bingxQueue = turn.catch(() => {});
      return await turn;
    }
    async function fetchJson(base, params = {}, signal = new AbortController().signal) {
      const host=new URL(base).hostname;
      const bingx = host === 'open-api.bingx.com';
      const mexc = host === 'api.mexc.com' || host === 'contract.mexc.com';
      const viaRelay = Boolean(relayUrl) && (bingx || mexc);
      const name = bingx ? 'BingX' : mexc ? 'MEXC' : new URL(base).hostname;
      const fallback = bingx ? base.replace('https://open-api.bingx.com/', 'https://open-api.bingx.pro/') : null;
      let klineLimit=params.limit;
      for (let attempt = 0; attempt < 4; attempt++) {
        signal.throwIfAborted();
        await cooldown(host,signal);
        const request = (endpoint = base) => {
          const query = bingx ? {...params, timestamp: now()} : host==='api.bybit.com'&&new URL(base).pathname==='/v5/market/kline'?{...params,limit:klineLimit}:params;
          const routed = viaRelay ? {...query, exchange: bingx ? 'BINGX' : 'MEXC', path: new URL(base).pathname} : query;
          const url = (viaRelay ? relayUrl : endpoint) + '?' + new URLSearchParams(Object.entries(routed).filter(([, v]) => v !== undefined));
          return bingx || viaRelay ? fetchTimed(url, signal, viaRelay ? Math.max(requestTimeout, 15000) : requestTimeout) : fetcher(url, {signal, cache: 'no-store', credentials: 'omit'});
        };
        let response;
        try {
          if (bingx) {
            try {
              response = await (await reserveBingx(signal, request)).response;
            } catch (error) {
              signal.throwIfAborted();
              // Official live backup, only when the primary cannot be reached.
              // HTTP/API errors below keep their original status and never switch hosts.
              if (viaRelay || (!(error instanceof TypeError) && error.name !== 'TimeoutError')) throw error;
              response = await (await reserveBingx(signal, () => request(fallback))).response;
            }
          } else {
            response = await request();
          }
        } catch (error) {
          if (signal.aborted) throw signal.reason;
          if (attempt === 3) throw Error(name + ' 연결 실패: API 응답을 읽을 수 없습니다. CORS·지역 제한·네트워크 확인 필요');
          await wait(1000 * (attempt + 1), signal);
          continue;
        }
        if (viaRelay && !response.ok) {
          let failure;
          try {failure = await response.json();} catch {}
          if (failure?.code === 'RELAY_ERROR') throw Error(failure.message || name + ' 중계 조회 실패');
        }
        if(response.status===429){await rateWait(host,name,response,attempt,name+' HTTP 429');continue;}
        if (response.status >= 500) {
          if (attempt === 3) throw Error(name + ' HTTP ' + response.status + ': 요청 제한 또는 서버 오류');
          const retryAfter = Number(response.headers?.get('retry-after'));
          await wait(retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 1500 * 2 ** attempt, signal);
          continue;
        }
        if (!response.ok) throw Error(name + ' HTTP ' + response.status);
        let result;
        try {result = await response.json();}
        catch (error) {
          if (signal.aborted) throw signal.reason;
          throw Error(name + ' 응답 오류: JSON 데이터를 받지 못했습니다. 거래소 접근 제한 또는 API 주소 확인 필요');
        }
        const code = result.retCode ?? result.code;
        if (code !== undefined && !['0', '00000'].includes(String(code))) {
          const message = name + ' API ' + code + ': ' + (result.retMsg || result.msg || result.message || '요청 실패');
          const limited=(bingx&&String(code)==='100410')||(mexc&&String(code)==='510')||(host==='api.bybit.com'&&String(code)==='10006')||(host==='www.okx.com'&&String(code)==='50011')||(host==='api.bitget.com'&&String(code)==='429');
          if(limited){await rateWait(host,name,response,attempt,message);continue;}
          if(host==='api.bybit.com'&&String(code)==='10016'){
            if(new URL(base).pathname==='/v5/market/kline'&&Number(klineLimit)>200)klineLimit=Math.max(200,Math.floor(Number(klineLimit)/2));
            await serviceWait(host,name,attempt,message,signal);continue;
          }
          if (bingx && ['100500', '109500'].includes(String(code)) && attempt < 3) {
            await wait(1500 * 2 ** attempt, signal);
            continue;
          }
          throw Error(message);
        }
        if (result.success === false) throw Error(name + ': ' + (result.message || 'API 실패'));
        if (viaRelay) {
          const fetchedAt = Number(response.headers?.get('X-Market-Fetched-At'));
          if (Number.isFinite(fetchedAt) && fetchedAt > 0) Object.defineProperty(result, '__marketFetchedAt', {value: fetchedAt});
        }
        return result;
      }
      throw Error(name + ': API 실패');
    }
    async function json(base,params={},signal=new AbortController().signal){
      const shared=globalThis.MarketShared;
      return shared?shared.broker.request(shared.key(base,params),abort=>fetchJson(base,params,abort),signal,shared.ttl(base)):fetchJson(base,params,signal);
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

if (typeof globalThis !== 'undefined') globalThis.MarketAPI = MarketAPI;
if (typeof window !== 'undefined') window.MarketAPI = MarketAPI;
if (typeof module !== 'undefined' && module.exports) module.exports = MarketAPI;
