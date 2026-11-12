'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),I=require('../backtest-indicators.js'),E=require('../backtest-engine.js');
test('기본 지표는 음펀비 + RSI 이고 준비된 지표만 선택됩니다',()=>{
 assert.equal(I.DEFAULT,'funding_rsi');
 assert.deepEqual(I.list.filter(i=>i.ready).map(i=>i.id),['funding_rsi','rsi','divergence']);
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

// ---- 다이버전스 지표: 상승(진입)·하락(청산), 꼬리/일반, 지지 필터 ----
const H4=14400,start4=T.parseKst('2026-02-03','00:00');
function divSeries({base79=true,wick=false,bearTail=true}={}){
 const c=Array(8).fill(90);
 if(base79)c.push(90,86,82,80,81,83,85,88,90,92,94,95); // 80 근처를 거래량 실어 받쳐 준 과거 구간
 c.push(96,98,100,100,99,97,95,92,89,86,83,81,80,82,85,88,90,89,88,87,86,85,84,83,82,81);
 const wickIndex=c.length;
 c.push(wick?80.6:79.2);
 if(bearTail)c.push(81,84,88,92,96,100,97,94,92,93,94,95,96,97,98,99,100,101,102,101,99,97,95,93);
 else c.push(80.5,82,83,84,85,86,87,88,89);
 let prev=c[0];
 const bars=c.map((close,i)=>{const open=prev;prev=close;const row={time:start4+i*H4,open,high:Math.max(open,close)*1.002,low:Math.min(open,close)*.998,close,volume:close<=82&&i<20?300:100};if(wick&&i===wickIndex)row.low=78.9;return row;});
 return {bars,end:start4+c.length*H4};
}
function divRun(opts={},extra={}){
 const {bars,end}=divSeries(opts);
 return E.runBacktest(bars,[{time:start4,rate:-.1,hours:8}],{timeframe:'4h',indicator:'divergence',startTime:start4,endTime:end,rsiPeriod:5,splitCount:1,takeProfitPct:0,stopLossPct:0,maxHoldBars:0,feePct:0,slippagePct:0,initialCapital:1000,divPivot:2,divMinGap:4,...extra});
}
test('다이버전스 지표는 4시간·일·주·월봉만 지원하고, 다른 지표에는 전용 설정 키가 생기지 않습니다',()=>{
 for(const tf of ['4h','1d','1w','1M'])assert.doesNotThrow(()=>E.normalizeConfig({indicator:'divergence',timeframe:tf}));
 for(const tf of ['1m','5m','1h','2h'])assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:tf}),/4시간/);
 const c=E.normalizeConfig({indicator:'divergence',timeframe:'4h'});
 assert.equal(c.divMode,'both');assert.equal(c.divBearishExit,true);assert.equal(c.supportMinTouches,2);
 const other=E.normalizeConfig({timeframe:'5m',divPivot:9,supportLookback:9});
 assert.equal('divPivot' in other,false);assert.equal('supportLookback' in other,false);
 assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:'4h',divMinGap:30,divMaxGap:10}));
 assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:'4h',divMode:'x'}));
});
test('받쳐 준 지지가 있으면 일반 상승 다이버전스에서 진입하고, 하락 다이버전스에서 청산합니다',()=>{
 const r=divRun();
 assert.equal(r.trades.length,1);
 const trade=r.trades[0],sig=trade.entries[0].signal;
 assert.equal(sig.kind,'div_regular');assert.ok(sig.rsi>sig.previousRsi);assert.ok(sig.low<sig.previousLow);
 assert.ok(sig.supportTouches>=2&&sig.supportVolumeTouches>=1);
 assert.equal(trade.fundingCondition,undefined);
 assert.equal(trade.exitReason,'BEARISH_DIVERGENCE');
 assert.equal(r.diagnostics.divergence.bullish,1);assert.ok(r.diagnostics.divergence.bearish>=1);
});
test('다이버전스는 저점이 확정된 뒤(오른쪽 봉 수만큼 지난 뒤)에만 신호가 되어 미래를 보지 않습니다',()=>{
 const r=divRun(),sig=r.trades[0].entries[0].signal;
 assert.ok(sig.time>=sig.pivotTime+2*H4+H4);
 assert.ok(r.trades[0].entryTime>=sig.time);
});
test('몸통이 새 저점을 못 만들고 아래꼬리만 이전 저점을 깨면 꼬리 다이버전스입니다',()=>{
 const r=divRun({wick:true});
 assert.equal(r.trades[0].entries[0].signal.kind,'div_wick');
 assert.ok(r.trades[0].entries[0].signal.wickRatio>=.3);
 assert.equal(r.diagnostics.divergence.wick,1);
 // 꼬리만 허용하면 일반 다이버전스는 건너뜁니다.
 assert.equal(divRun({},{divMode:'wick'}).trades.length,0);
 assert.equal(divRun({wick:true},{divMode:'wick'}).trades.length,1);
});
test('지지가 없는 낭떠러지 저점은 진입을 막고, 필터를 끄면 진입합니다',()=>{
 const blocked=divRun({base79:false});
 assert.equal(blocked.trades.length,0);
 assert.equal(blocked.diagnostics.divergence.supportRejected,1);
 const off=divRun({base79:false},{supportMinTouches:0,supportMinVolTouches:0});
 assert.equal(off.trades.length,1);
 // 거래량 조건을 높이면 지지 캔들이 있어도 막힙니다.
 assert.equal(divRun({},{supportMinVolMult:20}).trades.length,0);
});
test('하락 다이버전스 청산을 끄면 다른 청산 조건이 올 때까지 보유합니다',()=>{
 const r=divRun({},{divBearishExit:false});
 assert.equal(r.trades.length,1);assert.equal(r.trades[0].exitReason,'END_OF_TEST');
 assert.ok(r.diagnostics.divergence.bearish>=1);
});
test('다이버전스 지표는 결과 비교 키가 다르고 기본 지표의 키는 그대로입니다',()=>{
 const a=E.normalizeConfig({timeframe:'4h'}),b=E.normalizeConfig({timeframe:'4h',indicator:'divergence'}),c=E.normalizeConfig({timeframe:'4h',indicator:'divergence',supportMinTouches:3});
 assert.equal(R.sameStrategy(a,b,'4h'),false);
 assert.equal(R.sameStrategy(b,{...b},'4h'),true);
 assert.equal(R.sameStrategy(b,c,'4h'),false);
 assert.ok(R.strategyDifferences(b,c,'4h').includes('supportMinTouches'));
});

test('신호 위치는 차트의 RSI Div 지표(Bull/Bear)와 같다',()=>{
 const RSI=require('../indicators.js'),{bars,end}=divSeries(),times=bars;
 const chart=RSI.calculate(bars,{length:5,source:'close',oversold:30,overbought:70,divergence:true});
 const r=divRun({},{divPivot:5,supportMinTouches:0,supportMinVolTouches:0,divMinGap:5,divMaxGap:60});
 // 지표의 pivots 는 좌우 5캔들, 간격 5~60 으로 고정이므로 같은 값을 쓴 엔진 신호와 개수가 같아야 한다.
 const bull=chart.bullCond.reduce((a,b)=>a+b,0),bear=chart.bearCond.reduce((a,b)=>a+b,0);
 assert.equal(r.diagnostics.divergence.bullish,bull);
 assert.equal(r.diagnostics.divergence.bearish,bear);
 assert.ok(bull>=1);
});
