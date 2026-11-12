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
// 지지 확인용 일봉(신호 주기보다 큰 주기). kind: none(낭떠러지) / zone(80 근처에 거래량 실려 머문 구간) / box(80 근처 횡보 → 105까지 펌핑)
const D1=86400;
function supportDaily(kind='zone'){
 const n=45,bars=[];
 for(let i=0;i<n;i++){
  let close,volume=100;
  if(kind==='none')close=130;
  else if(kind==='zone'){if(i>=10&&i<22){close=79.5+((i%3)-1)*.7;volume=200;}else close=92+(i%4);}
  else{if(i<22){close=78.8+((i%5)*.6);volume=130;}else if(i<32){close=82+(i-21)*2.3;}else close=100-(i-32)*.4;}
  const open=i?bars[i-1].close:close;
  bars.push({time:start4-(n-i)*D1,open,high:Math.max(open,close)*1.004,low:Math.min(open,close)*.996,close,volume});
 }
 return bars;
}
function divRun(opts={},extra={},support='zone'){
 const {bars,end}=divSeries(opts);
 return E.runBacktest(bars,[{time:start4,rate:-.1,hours:8}],{timeframe:'4h',indicator:'divergence',startTime:start4,endTime:end,rsiPeriod:5,splitCount:1,takeProfitPct:0,stopLossPct:0,maxHoldBars:0,feePct:0,slippagePct:0,initialCapital:1000,divPivot:2,divMinGap:4,supportExcludeRecent:0,...extra},{supportCandles:support?supportDaily(support):undefined});
}
test('다이버전스 지표는 4시간·일·주·월봉만 지원하고, 다른 지표에는 전용 설정 키가 생기지 않습니다',()=>{
 for(const tf of ['4h','1d','1w','1M'])assert.doesNotThrow(()=>E.normalizeConfig({indicator:'divergence',timeframe:tf}));
 for(const tf of ['1m','5m','1h','2h'])assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:tf}),/4시간/);
 const c=E.normalizeConfig({indicator:'divergence',timeframe:'4h'});
 assert.equal(c.divMode,'both');assert.equal(c.divBearishExit,true);assert.equal(c.supportBars,150);assert.equal(c.supportGradeMin,'normal');assert.equal(c.divConfirm,'off');
 const other=E.normalizeConfig({timeframe:'5m',divPivot:9,supportBars:9,supportGradeMin:'box'});
 assert.equal('divPivot' in other,false);assert.equal('supportBars' in other,false);assert.equal('supportGradeMin' in other,false);
 assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:'4h',divMinGap:30,divMaxGap:10}));
 assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:'4h',divMode:'x'}));
 assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:'4h',supportGradeMin:'x'}));
 assert.throws(()=>E.normalizeConfig({indicator:'divergence',timeframe:'4h',divConfirm:'x'}));
});
test('지지 확인용 주기는 신호보다 한 단계 큰 주기이고 필요한 봉 수가 계산됩니다',()=>{
 assert.deepEqual({...E.supportTimeframes},{'4h':'1d','1d':'1w','1w':'1M','1M':'1M'});
 assert.deepEqual(E.supportPlan({indicator:'divergence',timeframe:'4h'}),{timeframe:'1d',bars:170});
 assert.deepEqual(E.supportPlan({indicator:'divergence',timeframe:'1d',supportBars:100,supportExcludeRecent:5}),{timeframe:'1w',bars:115});
 assert.equal(E.supportPlan({timeframe:'4h'}),null);
 assert.equal(E.supportPlan({indicator:'rsi',timeframe:'4h'}),null);
 const DM=require('../dashboard-model.js');assert.ok(DM);
});
test('큰 주기 지지 데이터가 없으면 조용히 통과시키지 않고 오류를 냅니다(필터를 끄면 필요 없음)',()=>{
 assert.throws(()=>divRun({},{},null),/지지 확인용 1d/);
 assert.doesNotThrow(()=>divRun({},{supportMinBars:0},null));
});
test('일봉에서 거래량 실려 머문 지지가 있으면 일반 지지 등급으로 진입하고, 하락 다이버전스에서 청산합니다',()=>{
 const r=divRun();
 assert.equal(r.trades.length,1);
 const trade=r.trades[0],sig=trade.entries[0].signal;
 assert.equal(sig.kind,'div_regular');assert.ok(sig.rsi>sig.previousRsi);assert.ok(sig.low<sig.previousLow);
 assert.equal(sig.supportGrade,'normal');assert.ok(sig.supportStayBars>=10);assert.ok(sig.supportVolRatio>=1);assert.equal(sig.supportTimeframe,'1d');
 assert.ok(sig.supportZoneLow<sig.low&&sig.low<sig.supportZoneHigh);
 assert.equal(sig.supportBoxLow,undefined);
 assert.equal(trade.fundingCondition,undefined);
 assert.equal(trade.exitReason,'BEARISH_DIVERGENCE');
 const g=r.diagnostics.divergence;
 assert.equal(g.bullish,1);assert.equal(g.gradeNormal,1);assert.equal(g.gradeBox,0);assert.equal(g.supportTimeframe,'1d');assert.ok(g.bearish>=1);
});
test('다이버전스는 저점이 확정된 뒤(오른쪽 봉 수만큼 지난 뒤)에만 신호가 되어 미래를 보지 않습니다',()=>{
 const r=divRun(),sig=r.trades[0].entries[0].signal;
 assert.ok(sig.time>=sig.pivotTime+2*H4+H4);
 assert.ok(r.trades[0].entryTime>=sig.time);
});
test('저점이 생기기 전에 끝난 일봉만 지지로 쓰고 최근 봉은 제외할 수 있습니다',()=>{
 const {bars,end}=divSeries(),run=(extra,sup)=>E.runBacktest(bars,[{time:start4,rate:-.1,hours:8}],{timeframe:'4h',indicator:'divergence',startTime:start4,endTime:end,rsiPeriod:5,splitCount:1,takeProfitPct:0,stopLossPct:0,maxHoldBars:0,feePct:0,slippagePct:0,initialCapital:1000,divPivot:2,divMinGap:4,...extra},{supportCandles:sup});
 // 지지 구간(80 근처)이 전부 저점 이후에 생긴 일봉이면 미래 자료이므로 지지가 아니다.
 const future=supportDaily('zone').map(b=>({...b,time:b.time+60*D1}));
 const r=run({supportExcludeRecent:0},future);assert.equal(r.trades.length,0);assert.equal(r.diagnostics.divergence.cliffRejected,1);
 // 지지 구간 뒤 최근 봉을 많이 제외하면 그 구간까지 잘려 나가 지지로 보지 않는다.
 assert.equal(run({supportExcludeRecent:30},supportDaily('zone')).trades.length,0);
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
test('일봉으로 봐도 그 가격대에 쌓인 캔들이 없는 낭떠러지 저점은 진입을 막고, 필터를 끄면 진입합니다',()=>{
 const blocked=divRun({},{},'none');
 assert.equal(blocked.trades.length,0);
 assert.equal(blocked.diagnostics.divergence.supportRejected,1);assert.equal(blocked.diagnostics.divergence.cliffRejected,1);
 assert.equal(blocked.diagnostics.divergence.detected,1);
 const off=divRun({},{supportMinBars:0},'none');
 assert.equal(off.trades.length,1);assert.equal(off.trades[0].entries[0].signal.supportGrade,'none');
 // 거래량 비율을 높이거나 필요한 머문 캔들 수를 늘리면 지지 캔들이 있어도 막힌다.
 assert.equal(divRun({},{supportMinVolRatio:5}).trades.length,0);
 assert.equal(divRun({},{supportMinBars:40}).trades.length,0);
});
test('오래 횡보한 박스권에서 펌핑한 뒤 그 가격대로 돌아와 나온 다이버전스는 박스권 복귀 등급입니다',()=>{
 const r=divRun({},{},'box');
 assert.equal(r.trades.length,1);
 const sig=r.trades[0].entries[0].signal;
 assert.equal(sig.supportGrade,'box');assert.ok(sig.supportBoxBars>=20);
 assert.ok(sig.supportBoxLow<sig.supportBoxHigh&&sig.supportBoxFrom<sig.supportBoxTo&&sig.supportBoxTo<=sig.pivotTime);
 assert.equal(r.diagnostics.divergence.gradeBox,1);
 // 일반 지지만 있고 펌핑한 박스는 없으면 박스권 복귀가 아니다.
 assert.equal(divRun().trades[0].entries[0].signal.supportGrade,'normal');
 // 박스권 복귀만 허용하면 일반 지지는 막고 박스권 복귀만 진입한다.
 const only=divRun({},{supportGradeMin:'box'},'zone');
 assert.equal(only.trades.length,0);assert.equal(only.diagnostics.divergence.boxRejected,1);
 assert.equal(divRun({},{supportGradeMin:'box'},'box').trades.length,1);
 // 펌핑 기준을 박스 위로 더 높게 잡으면 박스로 인정하지 않는다.
 assert.equal(divRun({},{supportGradeMin:'box',supportBoxPumpPct:80},'box').trades.length,0);
});
test('확인 신호 옵션은 저점 확정 봉이 양봉이거나 저점 봉 고가를 넘을 때만 진입하게 한다',()=>{
 const off=divRun();assert.equal(off.trades.length,1);
 const bull=divRun({},{divConfirm:'bull_candle'}),brk=divRun({},{divConfirm:'break_pivot_high'});
 assert.equal(bull.trades.length+bull.diagnostics.divergence.confirmRejected,1);
 assert.equal(brk.trades.length+brk.diagnostics.divergence.confirmRejected,1);
});
test('하락 다이버전스 청산을 끄면 다른 청산 조건이 올 때까지 보유합니다',()=>{
 const r=divRun({},{divBearishExit:false});
 assert.equal(r.trades.length,1);assert.equal(r.trades[0].exitReason,'END_OF_TEST');
 assert.ok(r.diagnostics.divergence.bearish>=1);
});
test('다이버전스 지표는 결과 비교 키가 다르고 기본 지표의 키는 그대로입니다',()=>{
 const a=E.normalizeConfig({timeframe:'4h'}),b=E.normalizeConfig({timeframe:'4h',indicator:'divergence'}),c=E.normalizeConfig({timeframe:'4h',indicator:'divergence',supportBars:90}),d=E.normalizeConfig({timeframe:'4h',indicator:'divergence',supportGradeMin:'box'});
 assert.equal(R.sameStrategy(a,b,'4h'),false);
 assert.equal(R.sameStrategy(b,{...b},'4h'),true);
 assert.equal(R.sameStrategy(b,c,'4h'),false);
 assert.ok(R.strategyDifferences(b,c,'4h').includes('supportBars'));
 assert.ok(R.strategyDifferences(b,d,'4h').includes('supportGradeMin'));
});
test('비교 모드는 각 신호 주기에 맞는 큰 주기 지지 데이터를 쓴다',()=>{
 const {bars}=divSeries(),map={'4h':bars,'1d':supportDaily('zone')};
 const out=E.runAllTimeframes(map,[{time:start4,rate:-.1,hours:8}],{indicator:'divergence',startTime:start4,endTime:start4+bars.length*H4,rsiPeriod:5,splitCount:1,takeProfitPct:0,stopLossPct:0,feePct:0,slippagePct:0,initialCapital:1000,divPivot:2,divMinGap:4,supportExcludeRecent:0,supportMinBars:0},{});
 assert.ok(out.results['4h']);
 const withSupport=E.runAllTimeframes(map,[{time:start4,rate:-.1,hours:8}],{indicator:'divergence',startTime:start4,endTime:start4+bars.length*H4,rsiPeriod:5,splitCount:1,takeProfitPct:0,stopLossPct:0,feePct:0,slippagePct:0,initialCapital:1000,divPivot:2,divMinGap:4,supportExcludeRecent:0},{supportCandles:{'1d':supportDaily('zone')}});
 assert.equal(withSupport.results['4h'].trades.length,1);
});

test('신호 위치는 차트의 RSI Div 지표(Bull/Bear)와 같다',()=>{
 const RSI=require('../indicators.js'),{bars}=divSeries();
 const chart=RSI.calculate(bars,{length:5,source:'close',oversold:30,overbought:70,divergence:true});
 const r=divRun({},{divPivot:5,supportMinBars:0,divMinGap:5,divMaxGap:60},null);
 // 지표의 pivots 는 좌우 5캔들, 간격 5~60 으로 고정이므로 같은 값을 쓴 엔진 신호와 개수가 같아야 한다.
 const bull=chart.bullCond.reduce((a,b)=>a+b,0),bear=chart.bearCond.reduce((a,b)=>a+b,0);
 assert.equal(r.diagnostics.divergence.bullish,bull);
 assert.equal(r.diagnostics.divergence.bearish,bear);
 assert.ok(bull>=1);
});
