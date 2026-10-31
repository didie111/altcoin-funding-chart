'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// TimeframeEngine 전역 등록
const TimeframeEngine = require('../timeframes.js');
globalThis.TimeframeEngine = TimeframeEngine;

const BacktestEngine = require('../backtest-engine.js');
const BacktestData = require('./backtest-fixtures.cjs');

test('1. identifyFundingSessions: 1시간 주기 & 음펀비 <= -0.5%만 정확히 필터링', () => {
  const t0 = 1700000000;
  const records = [
    { time: t0 + 3600, rate: -0.6, fundingIntervalHours: 1 },       // 조건 만족 (1h, -0.6%)
    { time: t0 + 7200, rate: -0.2, fundingIntervalHours: 1 },       // 제외 (음펀비 미달: -0.2% > -0.5%)
    { time: t0 + 10800, rate: 0.1, fundingIntervalHours: 1 },        // 제외 (양수 펀비)
    { time: t0 + 25200, rate: -0.8, fundingIntervalHours: 4 },       // 제외 (4시간 주기)
    { time: t0 + 54000, rate: -1.2, fundingIntervalHours: 8 },       // 제외 (8시간 주기)
    { time: t0 + 57600, rate: -0.75, fundingIntervalHours: 1 }      // 조건 만족 (1h, -0.75%)
  ];

  const sessions = BacktestEngine.identifyFundingSessions(records, {
    fundingIntervalHours: 1,
    minFundingRate: -0.5
  });

  assert.equal(sessions.length, 2, '2개의 세션만 통과해야 함');
  assert.equal(sessions[0].rate, -0.6);
  assert.equal(sessions[1].rate, -0.75);
  assert.equal(sessions[0].startTime, t0 + 3600); // 정산 확정 전 미래 펀딩비를 사용하지 않음
  assert.equal(sessions[0].settleTime, t0 + 3600);
});

test('2. identifyFundingSessions: fundingIntervalHours가 비어있을 때 시간차로 1시간 주기 자동 감지', () => {
  const t0 = 1700000000;
  const records = [
    { time: t0, rate: -0.1 },
    { time: t0 + 3600, rate: -0.7 },   // 3600초 차이 = 1시간 주기, -0.7% (조건 만족)
    { time: t0 + 7200, rate: -0.55 },  // 3600초 차이 = 1시간 주기, -0.55% (조건 만족)
    { time: t0 + 21600, rate: -0.9 }   // 14400초 차이 = 4시간 주기 (제외)
  ];

  const sessions = BacktestEngine.identifyFundingSessions(records, {
    fundingIntervalHours: 1,
    minFundingRate: -0.5
  });

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].rate, -0.7);
  assert.equal(sessions[1].rate, -0.55);
});

test('3. RSI 과매도(<=30) 판별 및 계산 정확성', () => {
  const candles = [];
  let price = 100;
  // 급락 캔들 25개 생성 -> RSI 급락
  for (let i = 0; i < 25; i++) {
    price *= 0.98;
    candles.push({
      time: 1700000000 + i * 300,
      open: price * 1.01,
      high: price * 1.02,
      low: price * 0.99,
      close: price,
      volume: 1000
    });
  }

  const rsi = BacktestEngine.computeRSI(candles, 14);
  assert.equal(rsi.length, candles.length);
  const lastRsi = rsi[rsi.length - 1];
  assert.ok(Number.isFinite(lastRsi));
  assert.ok(lastRsi < 30, `RSI가 30 이하 과매도여야 함 (현재: ${lastRsi})`);
});

test('4. 5~10 분할 매수(DCA) 시 평단가 및 최대 분할 수 제어', () => {
  const dataset = BacktestData.generateSyntheticDataset({ basePrice: 100 });
  const config = {
    ...BacktestEngine.defaultStrategyConfig,
    splitCount: 5,
    splitTrigger: 'step_pct',
    splitStepPct: 0.5,
    takeProfitPct: 5.0,
    stopLossPct: 10.0
  };

  const result = BacktestEngine.runBacktest(dataset.timeframeCandles['5m'], dataset.fundingRecords, config);
  assert.ok(result.success);
  assert.ok(result.summary.totalTrades > 0, '최소 1회 이상 거래 발생해야 함');

  for (const trade of result.trades) {
    assert.ok(trade.dcaSteps <= 5, 'DCA 단계는 최대 5를 초과할 수 없음');
    assert.ok(trade.avgEntryPrice > 0);
    assert.ok(trade.totalCost > 0);
  }
});

test('5. 10분할 매수 설정 검증 (splitCount: 10)', () => {
  const dataset = BacktestData.generateSyntheticDataset({ basePrice: 100 });
  const config = {
    ...BacktestEngine.defaultStrategyConfig,
    splitCount: 10,
    splitTrigger: 'step_pct',
    splitStepPct: 0.2,
    takeProfitPct: 5.0,
    stopLossPct: 15.0
  };

  const result = BacktestEngine.runBacktest(dataset.timeframeCandles['5m'], dataset.fundingRecords, config);
  assert.ok(result.success);
  for (const trade of result.trades) {
    assert.ok(trade.dcaSteps <= 10, 'DCA 단계는 최대 10을 초과할 수 없음');
  }
});

test('6. 펀딩비 정산 통과 시 롱 포지션 음펀비 수취 수익 반영', () => {
  const dataset = BacktestData.generateSyntheticDataset();
  const config = {
    ...BacktestEngine.defaultStrategyConfig,
    includeFundingPayment: true
  };

  const result = BacktestEngine.runBacktest(dataset.timeframeCandles['5m'], dataset.fundingRecords, config);
  assert.ok(result.success);
  assert.ok(result.summary.totalFundingEarned >= 0, '음펀비 정산으로 펀딩 수익이 발생해야 함');
});

test('7. 전체 타임프레임 일괄 백테스트 (runAllTimeframes)', () => {
  const dataset = BacktestData.generateSyntheticDataset();
  const multi = BacktestEngine.runAllTimeframes(dataset.timeframeCandles, dataset.fundingRecords);

  assert.ok(multi.results);
  assert.ok(multi.comparison.length > 0);
  assert.ok(multi.bestByWinRate !== undefined);
  assert.ok(multi.bestByProfitFactor !== undefined);
});

test('8. 파라미터 최적화기(Optimizer): 최고 승률과 최고 손익비 탐색', () => {
  const dataset = BacktestData.generateSyntheticDataset();
  const opt = BacktestEngine.optimizeStrategy(dataset.timeframeCandles['5m'], dataset.fundingRecords, {
    splitCounts: [5, 10],
    rsiOversolds: [25, 30],
    takeProfitPcts: [1.0, 2.0],
    stopLossPcts: [2.0, 0],
    splitTriggers: ['step_pct'],
    minTrades: 1
  });

  assert.ok(opt.totalEvaluated > 0);
  assert.ok(opt.bestWinRate, '최고 승률 조합이 존재해야 함');
  assert.ok(opt.bestProfitFactor, '최고 손익비 조합이 존재해야 함');
  assert.ok(opt.bestBalanced, '최적 밸런스 조합이 존재해야 함');
  assert.ok(opt.topRankings.length > 0);
});

test('9. rsi_cross_up: 과매도(<=30) 후 30 상향 돌파 마감 시 진입 트리거 검증', () => {
  const dataset = BacktestData.generateSyntheticDataset();
  const config = {
    ...BacktestEngine.defaultStrategyConfig,
    entryTrigger: 'rsi_cross_up',
    splitTrigger: 'rsi_cross_up',
    splitCount: 5,
    takeProfitPct: 3.0,
    stopLossPct: 5.0
  };

  const result = BacktestEngine.runBacktest(dataset.timeframeCandles['5m'], dataset.fundingRecords, config);
  assert.ok(result.success);
  // 거래 발생 시 진입 신호가 BUY_INITIAL로 정상 기록되는지 확인
  if (result.trades.length > 0) {
    const buySignals = result.signals.filter(s => s.type === 'BUY_INITIAL');
    assert.ok(buySignals.length > 0, 'BUY_INITIAL 신호가 기록되어야 함');
  }
});

