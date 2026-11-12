'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),I=require('../backtest-indicators.js'),E=require('../backtest-engine.js');
test('기본 지표는 음펀비 + RSI 이고 준비된 지표만 선택됩니다',()=>{
 assert.equal(I.DEFAULT,'funding_rsi');
 assert.deepEqual(I.list.filter(i=>i.ready).map(i=>i.id),['funding_rsi','rsi']);
 assert.equal(I.list[0].id,'funding_rsi');
});
test('저장값이 없거나 준비 안 된 지표면 기본 지표로 되돌립니다',()=>{
 assert.equal(I.resolve(undefined),'funding_rsi');
 assert.equal(I.resolve('rsi'),'rsi');assert.equal(I.resolve('bollinger'),'funding_rsi');
 assert.equal(I.resolve('없는지표'),'funding_rsi');
 assert.equal(I.resolve('funding_rsi'),'funding_rsi');
});
test('지표 id는 중복되지 않고 이름과 분류가 있습니다',()=>{
 assert.equal(new Set(I.list.map(i=>i.id)).size,I.list.length);
 for(const i of I.list){assert.ok(i.name&&i.category);}
 assert.equal(I.find('macd'),null);
});
test('저장 설정에 indicator 키가 섞여도 설정 정규화가 깨지지 않습니다',()=>{
 assert.doesNotThrow(()=>E.normalizeConfig({indicator:'funding_rsi',follow:true}));
});

// ---- RSI 단독 지표: 펀딩 조건 없이 RSI 신호만으로 진입한다 ----
const T=require('../timeframes.js'),R=require('../backtest-results.js');
const base=T.parseKst('2026-02-03','10:00');
function scenario(extra={}){
 const closes=[100,95,90,85,80,85,90,95],bars=Array.from({length:120},(_,i)=>{const close=closes[i%closes.length];return {time:base+(i-40)*180,open:close,high:close,low:close,close,volume:1};});
 const config={timeframe:'3m',startTime:base,endTime:base+4*3600,rsiPeriod:2,rsiOversold:30,entryTrigger:'rsi_cross_up',fundingIntervalHours:1,minFundingRate:-.5,fundingWindowSeconds:4*3600,splitCount:1,takeProfitPct:0,stopLossPct:0,maxHoldBars:1,feePct:0,slippagePct:0,initialCapital:1000,...extra};
 // 펀딩비가 기준(-0.5%)에 못 미치는 약한 값만 있어 음펀비 조건은 한 번도 충족되지 않는다.
 const records=[{time:base,rate:-.1,hours:1},{time:base+3600,rate:-.1,hours:1},{time:base+7200,rate:-.1,hours:1}];
 return {bars,config,records};
}
test('RSI 단독 지표는 펀딩 조건이 없어도 RSI 상향 돌파에서 진입하고, 음펀비 + RSI는 그대로 진입하지 않습니다',()=>{
 const s=scenario(),funding=E.runBacktest(s.bars,s.records,s.config),rsi=E.runBacktest(s.bars,s.records,{...s.config,indicator:'rsi'});
 assert.equal(funding.trades.length,0);
 assert.ok(rsi.trades.length>0);
 assert.ok(rsi.trades.every(t=>t.entryTime<t.exitTime&&t.fundingCondition===undefined));
 assert.equal(rsi.config.indicator,'rsi');
 assert.equal(funding.config.indicator,undefined);
});
test('RSI 단독 지표의 진입 시점은 음펀비 조건이 충족된 구간 안의 RSI 신호 시점과 같은 방식이다',()=>{
 const s=scenario({},[{time:base,rate:-.6,hours:1},{time:base+3600,rate:-.7,hours:1},{time:base+7200,rate:-.2,hours:1}]);
 const funding=E.runBacktest(s.bars,[{time:base,rate:-.6,hours:1},{time:base+3600,rate:-.7,hours:1},{time:base+7200,rate:-.2,hours:1}],s.config),rsi=E.runBacktest(s.bars,s.records,{...s.config,indicator:'rsi'});
 const first=new Set(rsi.trades.map(t=>t.entryTime));
 assert.ok(funding.trades.length>0&&funding.trades.every(t=>first.has(t.entryTime)));
});
test('지표 구분은 설정 비교 키에만 반영되고 기본 지표의 기존 키는 그대로입니다',()=>{
 const a=E.normalizeConfig({timeframe:'5m'}),b=E.normalizeConfig({timeframe:'5m',indicator:'rsi'});
 assert.equal(R.sameStrategy(a,{...a},'5m'),true);
 assert.equal(R.sameStrategy(a,b,'5m'),false);
 assert.deepEqual(R.strategyDifferences(a,b,'5m'),['indicator']);
 assert.equal(Object.keys(E.defaultStrategyConfig).includes('indicator'),false);
 assert.throws(()=>E.normalizeConfig({indicator:'macd'}));
});
