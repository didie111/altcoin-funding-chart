'use strict';

/**
 * ScannerEngine
 * 5일 내 일봉 기준 급등/급락(±40% 이상 조절 가능) 코인 선별 스캐너 모듈
 */
const ScannerEngine = (() => {
  function formatMoney(num) {
    if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return '$' + (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return '$' + (num / 1e3).toFixed(1) + 'K';
    return '$' + Number(num).toFixed(2);
  }

  function formatPrice(price) {
    if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    if (price >= 0.001) return price.toFixed(6);
    return price.toFixed(8);
  }

  /**
   * 바이낸스 USDT 선물 5일 일봉 스캔 실행
   */
  async function scanBinance({
    days = 5,
    thresholdPct = 40,
    maxCoins = 300,
    minVolume = 500000,
    concurrency = 20,
    signal = new AbortController().signal,
    onProgress = () => {},
    onMatch = () => {}
  } = {}) {
    signal.throwIfAborted();

    // 1. 24hr 티커 조회
    const tickerRes = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', { signal, cache: 'no-store' });
    if (!tickerRes.ok) throw new Error('바이낸스 24hr 시세 조회 실패: HTTP ' + tickerRes.status);
    const tickers = await tickerRes.json();

    // 2. USDT 무기한 계약 필터링 & 거래대금 내림차순 정렬
    const targetPairs = tickers
      .filter(t => t.symbol.endsWith('USDT') && Number(t.quoteVolume) >= minVolume)
      .sort((a, b) => Number(b.quoteVolume) - Number(a.quoteVolume))
      .slice(0, maxCoins);

    const total = targetPairs.length;
    let processed = 0;
    let matchedCount = 0;
    const allResults = [];

    // 3. 병렬 배치 큐
    let index = 0;
    async function worker() {
      while (index < targetPairs.length) {
        signal.throwIfAborted();
        const pair = targetPairs[index++];
        try {
          const klineRes = await fetch(
            `https://fapi.binance.com/fapi/v1/klines?symbol=${pair.symbol}&interval=1d&limit=${days + 1}`,
            { signal, cache: 'no-store' }
          );
          if (!klineRes.ok) continue;
          const klines = await klineRes.json();
          if (!Array.isArray(klines) || klines.length < 2) continue;

          // klines[0]: 5일 전 일봉
          const startBar = klines[0];
          const latestBar = klines[klines.length - 1];

          const startTime = Math.floor(startBar[0] / 1000); // 5일 전 시각 (초)
          const startPrice = Number(startBar[1]); // 5일 전 시가
          const currentPrice = Number(latestBar[4]); // 최신 종가
          const changePct = ((currentPrice - startPrice) / startPrice) * 100;

          // 최저가 / 최고가 및 시각 계산
          let minLow = Infinity, minLowTime = startTime;
          let maxHigh = -Infinity, maxHighTime = startTime;

          for (const bar of klines) {
            const bTime = Math.floor(bar[0] / 1000);
            const bLow = Number(bar[3]);
            const bHigh = Number(bar[2]);
            if (bLow < minLow) { minLow = bLow; minLowTime = bTime; }
            if (bHigh > maxHigh) { maxHigh = bHigh; maxHighTime = bTime; }
          }

          const maxGain = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;
          const quoteVolume = Number(pair.quoteVolume);

          const coinData = {
            symbol: pair.symbol,
            baseSymbol: pair.symbol.replace(/USDT$/, ''),
            days,
            startTime,
            startPrice,
            currentPrice,
            changePct,
            minLow,
            minLowTime,
            maxHigh,
            maxHighTime,
            maxGain,
            quoteVolume,
            isSurge: changePct >= 0
          };

          allResults.push(coinData);

          // 임계값 조건 확인 (|changePct| >= thresholdPct 또는 상승/하락 선택)
          if (Math.abs(changePct) >= thresholdPct) {
            matchedCount++;
            onMatch(coinData);
          }
        } catch (err) {
          if (signal.aborted) throw err;
        } finally {
          processed++;
          onProgress({ processed, total, matchedCount });
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, total) }, worker);
    await Promise.all(workers);

    return allResults;
  }

  /**
   * 전체 거래소(바이낸스, 바이비트, 비트겟, 빙엑스, MEXC 등) 실시간 펀딩비 통합 스캔
   */
  async function scanAllFundingRates({
    signal = new AbortController().signal,
    onProgress = () => {}
  } = {}) {
    signal.throwIfAborted();
    const allResults = [];
    let completedExchanges = 0;
    const totalExchanges = 5;

    // 1. Binance
    const fetchBinance = async () => {
      try {
        const res = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { signal, cache: 'no-store' });
        if (!res.ok) return;
        const list = await res.json();
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (!item.symbol || !item.symbol.endsWith('USDT')) continue;
          const rate = Number(item.lastFundingRate) * 100;
          if (!Number.isFinite(rate)) continue;
          allResults.push({
            exchange: 'BINANCE',
            symbol: item.symbol,
            baseSymbol: item.symbol.replace(/USDT$/, ''),
            rate,
            markPrice: Number(item.markPrice) || 0,
            nextTime: item.nextFundingTime ? Math.floor(Number(item.nextFundingTime) / 1000) : null,
            intervalHours: 8
          });
        }
      } catch (err) {
        if (signal.aborted) throw err;
      } finally {
        completedExchanges++;
        onProgress({ completedExchanges, totalExchanges, count: allResults.length, exchange: 'BINANCE' });
      }
    };

    // 2. Bybit
    const fetchBybit = async () => {
      try {
        const res = await fetch('https://api.bybit.com/v5/market/tickers?category=linear', { signal, cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const list = json.result?.list;
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (!item.symbol || !item.symbol.endsWith('USDT')) continue;
          const rate = Number(item.fundingRate) * 100;
          if (!Number.isFinite(rate)) continue;
          allResults.push({
            exchange: 'BYBIT',
            symbol: item.symbol,
            baseSymbol: item.symbol.replace(/USDT$/, ''),
            rate,
            markPrice: Number(item.markPrice || item.lastPrice) || 0,
            nextTime: item.nextFundingTime ? Math.floor(Number(item.nextFundingTime) / 1000) : null,
            intervalHours: item.fundingIntervalHour ? Number(item.fundingIntervalHour) : 8
          });
        }
      } catch (err) {
        if (signal.aborted) throw err;
      } finally {
        completedExchanges++;
        onProgress({ completedExchanges, totalExchanges, count: allResults.length, exchange: 'BYBIT' });
      }
    };

    // 3. Bitget
    const fetchBitget = async () => {
      try {
        const res = await fetch('https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES', { signal, cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const list = json.data;
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (!item.symbol || !item.symbol.endsWith('USDT')) continue;
          const rate = Number(item.fundingRate) * 100;
          if (!Number.isFinite(rate)) continue;
          allResults.push({
            exchange: 'BITGET',
            symbol: item.symbol,
            baseSymbol: item.symbol.replace(/USDT$/, ''),
            rate,
            markPrice: Number(item.markPrice || item.lastPr) || 0,
            nextTime: null,
            intervalHours: 8
          });
        }
      } catch (err) {
        if (signal.aborted) throw err;
      } finally {
        completedExchanges++;
        onProgress({ completedExchanges, totalExchanges, count: allResults.length, exchange: 'BITGET' });
      }
    };

    // 4. BingX
    const fetchBingx = async () => {
      try {
        const res = await fetch('https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex', { signal, cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const list = json.data;
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (!item.symbol || !item.symbol.endsWith('-USDT')) continue;
          const rate = Number(item.lastFundingRate) * 100;
          if (!Number.isFinite(rate)) continue;
          allResults.push({
            exchange: 'BINGX',
            symbol: item.symbol,
            baseSymbol: item.symbol.replace(/-USDT$/, ''),
            rate,
            markPrice: Number(item.markPrice) || 0,
            nextTime: item.nextFundingTime ? Math.floor(Number(item.nextFundingTime) / 1000) : null,
            intervalHours: item.fundingIntervalHours ? Number(item.fundingIntervalHours) : 8
          });
        }
      } catch (err) {
        if (signal.aborted) throw err;
      } finally {
        completedExchanges++;
        onProgress({ completedExchanges, totalExchanges, count: allResults.length, exchange: 'BINGX' });
      }
    };

    // 5. MEXC
    const fetchMexc = async () => {
      try {
        const res = await fetch('https://contract.mexc.com/api/v1/contract/ticker', { signal, cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        const list = json.data;
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (!item.symbol || !item.symbol.endsWith('_USDT')) continue;
          const rate = Number(item.fundingRate) * 100;
          if (!Number.isFinite(rate)) continue;
          allResults.push({
            exchange: 'MEXC',
            symbol: item.symbol,
            baseSymbol: item.symbol.replace(/_USDT$/, ''),
            rate,
            markPrice: Number(item.lastPrice || item.fairPrice) || 0,
            nextTime: null,
            intervalHours: 8
          });
        }
      } catch (err) {
        if (signal.aborted) throw err;
      } finally {
        completedExchanges++;
        onProgress({ completedExchanges, totalExchanges, count: allResults.length, exchange: 'MEXC' });
      }
    };

    await Promise.allSettled([fetchBinance(), fetchBybit(), fetchBitget(), fetchBingx(), fetchMexc()]);
    return allResults;
  }

  return {
    scanBinance,
    scanAllFundingRates,
    formatMoney,
    formatPrice
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScannerEngine;
}

