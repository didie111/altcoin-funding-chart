#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const TimeframeEngine = require('./timeframes.js');
globalThis.TimeframeEngine = TimeframeEngine;
const BacktestEngine = require('./backtest-engine.js');
const BacktestData = require('./backtest-data.js');

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    symbol: 'ARKUSDT',
    timeframe: '5m',
    allTimeframes: false,
    oneEntryPerFunding: false,
    entryCooldownBars: 0,
    exchange:'BINANCE',initialCapital:10000,dcaMethod:'equal',stopLossMode:'immediate',fundingIntervalHours:1,startTime:undefined,endTime:undefined,
    splits: 5,
    splitTrigger: 'rsi_cross_up', // 기본값: RSI 과매도(<=30) 후 30 돌파마감시마다 진입
    entryTrigger: 'rsi_cross_up', // 1차 진입도 30 돌파마감시 진입
    minFunding: -0.5,
    maxFunding: null,
    rsiOversold: 30,
    rsiPeriod: 14,
    tp: 2.0,
    sl: 3.0,
    exitType: 'tp_sl',
    optimize: false,
    synthetic: false,
    output: path.join(__dirname, 'backtest_results.json'),
    csv: path.join(__dirname, 'backtest_summary.csv')
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if(arg==='--capital'&&args[i+1])options.initialCapital=Number(args[++i]);
    else if(arg==='--dca-method'&&args[i+1])options.dcaMethod=args[++i];
    else if(arg==='--stop-loss-mode'&&args[i+1])options.stopLossMode=args[++i];
    else if(arg==='--funding-hours'&&args[i+1])options.fundingIntervalHours=Number(args[++i]);
    else if(arg==='--exchange'&&args[i+1])options.exchange=args[++i].toUpperCase();
    else if(arg==='--start'&&args[i+1])options.startTime=Date.parse(args[++i]+'T00:00:00+09:00')/1000;
    else if(arg==='--end'&&args[i+1])options.endTime=Date.parse(args[++i]+'T23:59:59+09:00')/1000+1;
    else if (arg === '--symbol' && args[i + 1]) options.symbol = args[++i].toUpperCase();
    else if (arg === '--timeframe' && args[i + 1]) options.timeframe = args[++i];
    else if (arg === '--all-timeframes') options.allTimeframes = true;
    else if (arg === '--one-entry-per-funding') options.oneEntryPerFunding = true;
    else if (arg === '--entry-cooldown-bars') {
      const value=args[++i];if(value===undefined||!/^\d+$/.test(value)||Number(value)>1000000)throw Error('--entry-cooldown-bars는 0~1000000 사이 정수여야 합니다.');options.entryCooldownBars=Number(value);
    }
    else if (arg === '--splits' && args[i + 1]) options.splits = parseInt(args[++i], 10);
    else if (arg === '--split-trigger' && args[i + 1]) options.splitTrigger = args[++i];
    else if (arg === '--entry-trigger' && args[i + 1]) options.entryTrigger = args[++i];
    else if (arg === '--min-funding' && args[i + 1]) options.minFunding = parseFloat(args[++i]);
    else if (arg === '--max-funding' && args[i + 1]) options.maxFunding = parseFloat(args[++i]);
    else if (arg === '--rsi-oversold' && args[i + 1]) options.rsiOversold = parseFloat(args[++i]);
    else if (arg === '--tp' && args[i + 1]) options.tp = parseFloat(args[++i]);
    else if (arg === '--sl' && args[i + 1]) options.sl = parseFloat(args[++i]);
    else if (arg === '--exit-type' && args[i + 1]) options.exitType = args[++i];
    else if (arg === '--optimize') options.optimize = true;
    else if (arg === '--synthetic') options.synthetic = true;
    else if (arg === '--output' && args[i + 1]) options.output = path.resolve(args[++i]);
    else if (arg === '--csv' && args[i + 1]) options.csv = path.resolve(args[++i]);
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
[음펀비 + RSI 백테스팅 CLI]
조건: 펀딩 정산 주기·음펀비 기준·RSI·0~10 분할 매수(DCA)를 설정해 실행

사용법:
  node backtest-cli.js [옵션]

주요 옵션:
  --exchange <exchange>    거래소 (기본값 BINANCE, 6개 거래소 지원)
  --start <YYYY-MM-DD>     테스트 시작일 · KST
  --end <YYYY-MM-DD>       테스트 종료일 · KST
  --capital <USDT>        초기 자본
  --dca-method <method>   equal 또는 martingale (1,1,2,4…)
  --stop-loss-mode <mode> immediate 또는 after_all_dca
  --funding-hours <hours> 정산 주기, 0은 전체
  --one-entry-per-funding 같은 정산으로 새 매매 재진입 금지 · 분할매수 유지
  --entry-cooldown-bars <N> 첫 BUY 신호 다음 N개 테스트 주기 캔들 차단 · 0은 끔
  --symbol <coin>          대상 코인 심볼 (기본값: ARKUSDT)
  --timeframe <tf>         타임프레임 (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 1d, 1w, 1M / 기본값: 5m)
  --all-timeframes         1분봉부터 월봉까지 전체 타임프레임 일괄 비교 백테스트
  --splits <0-10>          분할 매수 횟수 (0/1은 1회, 2~10회, 기본값: 5)
  --split-trigger <mode>   분할 매수 트리거 (rsi_cross_up, rsi_cross_up_1m, step_pct, rsi_oversold, bar / 기본값: rsi_cross_up)
  --min-funding <pct>      음펀비 진입 기준 (기본값: -0.5%)
  --rsi-oversold <num>     RSI 과매도 기준선 (기본값: 30)
  --tp <pct>               목표 익절률 % (기본값: 2.0%)
  --sl <pct>               손절률 % (기본값: 3.0%, 0은 손절없음)
  --optimize               최고 승률과 최고 손익비를 찾는 파라미터 그리드 최적화 실행
  --synthetic              오프라인 합성 데이터 모드 실행
  --output <path>          결과 JSON 파일 저장 경로 (기본값: backtest_results.json)
  --csv <path>             결과 CSV 파일 저장 경로 (기본값: backtest_summary.csv)
`);
}

function formatTable(rows, headers) {
  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)));
  const pad = (text, width, align = 'right') => {
    const s = String(text ?? '');
    return align === 'left' ? s.padEnd(width) : s.padStart(width);
  };

  const headerLine = headers.map((h, i) => pad(h, colWidths[i], i === 0 ? 'left' : 'right')).join(' | ');
  const separator = colWidths.map(w => '-'.repeat(w)).join('-|-');
  const bodyLines = rows.map(r => r.map((c, i) => pad(c, colWidths[i], i === 0 ? 'left' : 'right')).join(' | '));

  return [headerLine, separator, ...bodyLines].join('\n');
}

async function main() {
  const options = parseArgs();

  console.log('='.repeat(72));
  console.log('[백테스팅] 음펀비 + RSI 분할 매수 전략');
  console.log('='.repeat(72));
  console.log(`- 대상 코인: ${options.symbol}`);
  console.log(`- 펀딩비 조건: ${options.fundingIntervalHours ? options.fundingIntervalHours + "시간" : "모든"} 주기 정산 & 펀딩비 <= ${options.minFunding}%`);
  console.log(`- 분할 매수: ${options.splits}분할 (방식: ${options.splitTrigger})`);
  console.log(`- RSI 과매도 기준: <= ${options.rsiOversold} (14주기)`);
  console.log(`- 목표 익절: +${options.tp}%, 손절: ${options.sl > 0 ? '-' + options.sl + '%' : '없음'}`);
  console.log(`- 실행 모드: ${options.optimize ? '파라미터 최적화(Grid Search)' : (options.allTimeframes ? '전체 타임프레임 일괄 비교' : options.timeframe + ' 단일 백테스트')}`);
  console.log('-'.repeat(72));

  // 1. 데이터 로드
  let dataset;
  if (options.synthetic) {
    console.log('📦 합성 시나리오 데이터셋을 생성합니다...');
    dataset = require('./tests/backtest-fixtures.cjs').generateSyntheticDataset();
  } else {
    console.log(`📡 거래소 API로부터 [${options.symbol}] 펀딩비 및 캔들 데이터를 수집하는 중...`);
    try {
      dataset = await BacktestData.loadBacktestDataset(options.symbol, {
        packed:true,exchange:options.exchange,startTime:options.startTime,endTime:options.endTime,allowMissing:options.allTimeframes,requireMinuteData:options.optimize||options.splitTrigger==='rsi_cross_up_1m',
        intervals: options.allTimeframes ? BacktestData.ALL_TIMEFRAMES : [options.timeframe]
      });
      console.log(`✓ 펀딩비 레코드 수집: ${dataset.fundingRecords.length}개`);
      console.log(`✓ 실제 수집 주기: ${Object.keys(dataset.timeframeCandles).join(', ')}`);
    } catch (err) {
      console.error(`거래소 API 수집 실패: ${err.message}. 실제 데이터가 없어 실행을 중단합니다.`);process.exitCode=1;return;
    }
  }

  const strategyConfig = {
    initialCapital:options.initialCapital,dcaMethod:options.dcaMethod,stopLossMode:options.stopLossMode,timeframe:options.timeframe,startTime:dataset.startTime,endTime:dataset.endTime,fundingIntervalHours:options.fundingIntervalHours,
    minFundingRate: options.minFunding,
    oneEntryPerFunding: options.oneEntryPerFunding,
    entryCooldownBars: options.entryCooldownBars,
    maxFundingRate: options.maxFunding,
    splitCount: options.splits,
    splitTrigger: options.splitTrigger,
    entryTrigger: options.entryTrigger,
    rsiPeriod: options.rsiPeriod,
    rsiOversold: options.rsiOversold,
    takeProfitPct: options.tp,
    stopLossPct: options.sl,
    exitType: options.exitType
  };

  const outputPayload = {
    timestamp: new Date().toISOString(),
    symbol: dataset.symbol||options.symbol,
    dataMode:options.synthetic?'synthetic-test-fixture':'official-exchange-api',
    options,
    strategyConfig
  };

  // 2. 모드별 실행
  if (options.optimize) {
    console.log('\n🔍 최고의 승률과 최고의 손익비를 찾기 위해 파라미터 최적화를 진행합니다...');
    const candles = dataset.timeframeCandles[options.timeframe] || Object.values(dataset.timeframeCandles)[0];
    if (!candles || candles.length === 0) {
      console.error('❌ 유효한 캔들 데이터가 없습니다.');
      process.exit(1);
    }

    const optResult = BacktestEngine.optimizeStrategy(candles, dataset.fundingRecords, {
      baseConfig: strategyConfig,minuteCandles:dataset.timeframeCandles['1m'],
      splitCounts: [5, 7, 10],
      rsiOversolds: [20, 25, 30],
      takeProfitPcts: [1.0, 1.5, 2.0, 3.0, 5.0],
      stopLossPcts: [2.0, 3.0, 5.0, 0],
      splitTriggers: ['step_pct', 'rsi_cross_up', 'rsi_cross_up_1m', 'rsi_oversold'],
      minTrades: 1
    });

    outputPayload.optimization = optResult;

    console.log(`\n총 ${optResult.totalEvaluated}개 파라미터 조합 검증 완료!\n`);

    if (optResult.bestWinRate) {
      const b = optResult.bestWinRate;
      console.log('🏆 [최고 승률 (Best Win Rate) 조합]');
      console.log(`   - 분할 수: ${b.params.splitCount}분할 | RSI 과매도: ${b.params.rsiOversold} | TP: +${b.params.takeProfitPct}% | SL: ${b.params.stopLossPct ? '-' + b.params.stopLossPct + '%' : '없음'}`);
      console.log(`   - 승률: ${b.summary.winRatePct}% (${b.summary.winTrades}승 / ${b.summary.lossTrades}패, 총 ${b.summary.totalTrades}회 거래)`);
      console.log(`   - 손익비(Profit Factor): ${b.summary.profitFactor} | 총수익률: ${b.summary.totalReturnPct}% | MDD: ${b.summary.maxDrawdownPct}%\n`);
    }

    if (optResult.bestProfitFactor) {
      const b = optResult.bestProfitFactor;
      console.log('💎 [최고 손익비 (Best Profit Factor) 조합]');
      console.log(`   - 분할 수: ${b.params.splitCount}분할 | RSI 과매도: ${b.params.rsiOversold} | TP: +${b.params.takeProfitPct}% | SL: ${b.params.stopLossPct ? '-' + b.params.stopLossPct + '%' : '없음'}`);
      console.log(`   - 손익비(Profit Factor): ${b.summary.profitFactor} | 승률: ${b.summary.winRatePct}% | 총수익률: ${b.summary.totalReturnPct}% | MDD: ${b.summary.maxDrawdownPct}%\n`);
    }

    if (optResult.bestBalanced) {
      const b = optResult.bestBalanced;
      console.log('⚖️ [최적 밸런스 점수 (Best Balanced) 조합]');
      console.log(`   - 분할 수: ${b.params.splitCount}분할 | RSI 과매도: ${b.params.rsiOversold} | TP: +${b.params.takeProfitPct}% | SL: ${b.params.stopLossPct ? '-' + b.params.stopLossPct + '%' : '없음'}`);
      console.log(`   - 종합점수: ${b.score}점 | 승률: ${b.summary.winRatePct}% | 손익비: ${b.summary.profitFactor} | 총수익률: ${b.summary.totalReturnPct}%\n`);
    }

    // Top 5 랭킹 테이블
    console.log('📊 [최적화 파라미터 Top 5 랭킹]');
    const headers = ['순위', '분할수', 'RSI선', 'TP(%)', 'SL(%)', '승률(%)', '손익비', '총수익(%)', 'MDD(%)', '거래수'];
    const rows = optResult.topRankings.slice(0, 5).map((r, i) => [
      `#${i + 1}`,
      `${r.params.splitCount}분할`,
      `<=${r.params.rsiOversold}`,
      `+${r.params.takeProfitPct}%`,
      r.params.stopLossPct ? `-${r.params.stopLossPct}%` : 'None',
      `${r.summary.winRatePct}%`,
      r.summary.profitFactor,
      `${r.summary.totalReturnPct}%`,
      `${r.summary.maxDrawdownPct}%`,
      r.summary.totalTrades
    ]);
    console.log(formatTable(rows, headers));

  } else if (options.allTimeframes) {
    console.log('\n📊 [전체 타임프레임(1분봉~월봉) 일괄 백테스트 실행]');
    const multiResult = BacktestEngine.runAllTimeframes(dataset.timeframeCandles, dataset.fundingRecords, strategyConfig,{equityMaxPoints:5000});
    outputPayload.allTimeframes = multiResult;

    const headers = ['타임프레임', '거래수', '승률(%)', '손익비', '총수익률(%)', 'MDD(%)', '평균보유봉', '펀딩수취($)'];
    const rows = multiResult.comparison.map(c => [
      c.timeframe,
      c.trades,
      `${c.winRatePct}%`,
      c.profitFactor,
      `${c.totalReturnPct}%`,
      `${c.maxDrawdownPct}%`,
      `${c.avgHoldBars || 0}봉`,
      `$${(c.fundingEarned || 0).toFixed ? (c.fundingEarned || 0).toFixed(2) : c.fundingEarned || 0}`
    ]);

    console.log('\n' + formatTable(rows, headers));

    if (multiResult.bestByWinRate) {
      console.log(`\n🏆 최고 승률 타임프레임: [${multiResult.bestByWinRate.timeframe}] - 승률 ${multiResult.bestByWinRate.winRatePct}%, 손익비 ${multiResult.bestByWinRate.profitFactor}`);
    }
    if (multiResult.bestByProfitFactor) {
      console.log(`💎 최고 손익비 타임프레임: [${multiResult.bestByProfitFactor.timeframe}] - 손익비 ${multiResult.bestByProfitFactor.profitFactor}, 승률 ${multiResult.bestByProfitFactor.winRatePct}%`);
    }

  } else {
    // 단일 타임프레임 백테스트
    console.log(`\n📈 [${options.timeframe} 타임프레임 백테스트 결과]`);
    const candles = dataset.timeframeCandles[options.timeframe] || Object.values(dataset.timeframeCandles)[0];
    if (!candles || candles.length === 0) {
      console.error(`❌ [${options.timeframe}] 유효한 캔들 데이터가 없습니다.`);
      process.exit(1);
    }

    const result = BacktestEngine.runBacktest(candles, dataset.fundingRecords, strategyConfig,{minuteCandles:dataset.timeframeCandles['1m'],equityMaxPoints:5000});
    outputPayload.single = result;
    const s = result.summary;

    console.log(`- 총 거래 횟수: ${s.totalTrades}회 (${s.winTrades}승 / ${s.lossTrades}패)`);
    console.log(`- 승률 (Win Rate): ${s.winRatePct}%`);
    console.log(`- 손익비 (Profit Factor): ${s.profitFactor}`);
    console.log(`- 리스크-보상비 (RRR): ${s.riskRewardRatio}`);
    console.log(`- 총 누적 수익률: ${s.totalReturnPct}% (순수익: $${s.netPnl})`);
    console.log(`- 최대 낙폭 (MDD): ${s.maxDrawdownPct}%`);
    console.log(`- 평균 분할 진입 수: ${s.avgDcaSteps} / ${options.splits}회`);
    console.log(`- 수취한 펀딩비 총액: $${s.totalFundingEarned}`);
    console.log(`- 평균 포지션 보유 기간: ${s.avgHoldBars}봉`);

    if (result.trades.length > 0) {
      console.log('\n📋 [최근 거래 내역 상세]');
      const tHeaders = ['ID', '진입일시', '청산일시', '분할수', '평단가', '청산가', '펀딩수익($)', '수익률(%)', '청산사유'];
      const tRows = result.trades.slice(-5).map(t => [
        `#${t.id}`,
        new Date(t.entryTime * 1000).toISOString().slice(5, 16).replace('T', ' '),
        new Date(t.exitTime * 1000).toISOString().slice(5, 16).replace('T', ' '),
        `${t.dcaSteps}/${t.splitTarget}`,
        t.avgEntryPrice.toFixed(4),
        t.exitPrice.toFixed(4),
        `$${t.fundingEarned.toFixed(2)}`,
        `${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(2)}%`,
        t.exitReason
      ]);
      console.log(formatTable(tRows, tHeaders));
    }
  }

  // 3. 파일로 저장 (AI/머신러닝 및 사용자가 읽을 수 있도록 구조화)
  fs.writeFileSync(options.output, JSON.stringify(outputPayload, null, 2), 'utf8');
  console.log(`\n💾 결과 JSON 파일 저장 완료: ${options.output}`);

  // CSV 요약 파일 작성
  if (outputPayload.allTimeframes?.comparison) {
    const csvContent = [
      'Timeframe,Trades,WinRatePct,ProfitFactor,TotalReturnPct,MaxDrawdownPct,AvgHoldBars,FundingEarned',
      ...outputPayload.allTimeframes.comparison.map(c =>
        `${c.timeframe},${c.trades},${c.winRatePct},${c.profitFactor},${c.totalReturnPct},${c.maxDrawdownPct},${c.avgHoldBars},${c.fundingEarned}`
      )
    ].join('\n');
    fs.writeFileSync(options.csv, csvContent, 'utf8');
    console.log(`💾 CSV 요약 파일 저장 완료: ${options.csv}`);
  } else if (outputPayload.optimization?.topRankings) {
    const csvContent = [
      'Rank,SplitCount,RsiOversold,TakeProfitPct,StopLossPct,WinRatePct,ProfitFactor,TotalReturnPct,MaxDrawdownPct,TotalTrades,Score',
      ...outputPayload.optimization.topRankings.map((r, i) =>
        `${i + 1},${r.params.splitCount},${r.params.rsiOversold},${r.params.takeProfitPct},${r.params.stopLossPct},${r.summary.winRatePct},${r.summary.profitFactor},${r.summary.totalReturnPct},${r.summary.maxDrawdownPct},${r.summary.totalTrades},${r.score}`
      )
    ].join('\n');
    fs.writeFileSync(options.csv, csvContent, 'utf8');
    console.log(`💾 CSV 요약 파일 저장 완료: ${options.csv}`);
  }

  console.log('='.repeat(72));
}

main().catch(err => {
  console.error('\n❌ 백테스팅 실행 중 오류 발생:', err);
  process.exit(1);
});
