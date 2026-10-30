'use strict';
const TimeframeEngine=require('../timeframes.js');
  function generateSyntheticDataset(options = {}) {
    const basePrice = options.basePrice || 100.0;
    const startTime = options.startTime || 1700000000; // 초 단위 타임스탬프
    const oneHourSec = 3600;

    // 1. 펀딩비 10시간 생성 (1시간 주기)
    const fundingRecords = [];
    for (let h = 1; h <= 12; h++) {
      const settleTime = startTime + h * oneHourSec;
      // 3~6시간 구간에서 극단 음펀비 (-0.7% ~ -1.2%)
      const rate = (h >= 3 && h <= 6) ? -0.85 : 0.01;
      fundingRecords.push({
        time: settleTime,
        rate: rate,
        fundingIntervalHours: 1
      });
    }

    // 2. 5분봉 캔들 생성 (12시간 = 144개 봉)
    const stepSec = 300; // 5분
    const totalBars = (12 * 3600) / stepSec;
    const candles5m = [];

    let currentPrice = basePrice;
    for (let i = 0; i < totalBars; i++) {
      const barTime = startTime + i * stepSec;
      const hourIndex = Math.floor(i / 12) + 1; // 1~12시간

      let open = currentPrice;
      let close = open;
      let high = open;
      let low = open;

      // 3~4시간 째에 급락 -> RSI 과매도 유도 (RSI < 30)
      if (hourIndex === 3 || hourIndex === 4) {
        close = open * 0.993; // 매 봉마다 -0.7% 하락
        low = close * 0.995;
        high = open * 1.002;
      }
      // 5~7시간 째에 급반등 -> 숏스퀴즈 (+1.5% 상승)
      else if (hourIndex >= 5 && hourIndex <= 7) {
        close = open * 1.012;
        high = close * 1.005;
        low = open * 0.998;
      }
      // 평상시
      else {
        close = open * (1 + (Math.sin(i) * 0.003));
        high = Math.max(open, close) * 1.002;
        low = Math.min(open, close) * 0.998;
      }

      currentPrice = close;
      candles5m.push({
        time: barTime,
        open: Number(open.toFixed(4)),
        high: Number(high.toFixed(4)),
        low: Number(low.toFixed(4)),
        close: Number(close.toFixed(4)),
        volume: 1000 + (i % 10) * 100
      });
    }

    // 다른 타임프레임도 TimeframeEngine.aggregate 로 합성
    const timeframeCandles = {
      '5m': candles5m
    };

    if (TimeframeEngine && typeof TimeframeEngine.aggregate === 'function') {
      try {
        timeframeCandles['15m'] = TimeframeEngine.aggregate(candles5m, '15m', '5m');
        timeframeCandles['30m'] = TimeframeEngine.aggregate(candles5m, '30m', '5m');
        timeframeCandles['1h'] = TimeframeEngine.aggregate(candles5m, '1h', '5m');
        timeframeCandles['4h'] = TimeframeEngine.aggregate(candles5m, '4h', '5m');
      } catch (e) {
        // fallback
      }
    }

    return {
      symbol: 'SYNTHETIC_USDT',
      exchange: 'SIMULATION',
      fundingRecords,
      timeframeCandles
    };
  }

module.exports={generateSyntheticDataset};
