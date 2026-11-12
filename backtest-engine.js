(function(root,factory){
 'use strict';if(typeof module==='object'&&module.exports){const tf=require('./timeframes.js');globalThis.TimeframeEngine??=tf;module.exports=factory(require('./indicators.js'),tf,require('./funding.js'),require('./backtest-bars.js'));}else root.BacktestEngine=factory(RsiEngine,TimeframeEngine,FundingEngine,root.BacktestBars);
})(typeof globalThis!=='undefined'?globalThis:this,function(RSI,T,F,B){
 'use strict';
 const defaultStrategyConfig=Object.freeze({timeframe:'5m',fundingIntervalHours:1,fundingIntervalBasis:'known',minFundingRate:-.5,maxFundingRate:null,fundingWindowSeconds:3600,fundingTransitionLookbackSeconds:3600,oneEntryPerFunding:false,entryCooldownBars:0,requireFreshFundingAfterCooldown:true,rsiPeriod:14,rsiOversold:30,rsiSource:'close',entryTrigger:'rsi_cross_up',splitCount:5,splitTrigger:'rsi_cross_up',splitStepPct:1,dcaMethod:'equal',stopLossMode:'immediate',exitType:'tp_sl',takeProfitPct:2,stopLossPct:3,rsiExitLevel:50,maxHoldBars:300,feePct:.05,slippagePct:.03,includeFundingPayment:true,initialCapital:10000,allocationPerTradePct:100,positionSizing:'budget',firstEntryAmount:10});
 const reasons=Object.freeze({TAKE_PROFIT:'TP · 익절',STOP_LOSS:'SL · 손절',RSI_REBOUND:'RSI 청산',SETTLE_EXIT:'정산 후 청산',TIMEOUT:'보유 기간 종료',END_OF_TEST:'테스트 기간 종료',DATA_GAP:'데이터 공백 전 종료',BEARISH_DIVERGENCE:'하락 다이버전스 청산'});

 // ===== 다이버전스 지표 (지표 선택: divergence) =====
 // 4시간·일·주·월봉 전용. 상승 다이버전스(진입 신호) + 하락 다이버전스(롱 청산 신호).
 // 상승 다이버전스는 "바닥 지지" 필터를 통과해야만 신호가 된다(지지 없는 낭떠러지 구간은 제외).
 const divergenceDefaults=Object.freeze({divPivot:3,divMinGap:5,divMaxGap:60,divMode:'both',divMinRsiDiff:1,divWickRatio:.3,divBearishExit:true,supportLookback:80,supportTolerancePct:1.5,supportMinTouches:2,supportMinVolMult:1.2,supportMinVolTouches:1});
 const divergenceTimeframes=Object.freeze(['4h','1d','1w','1M']);
 function computeDivergence(bars,rsi,c,from,to){
  const n=bars.length,o=new Float64Array(n),h=new Float64Array(n),l=new Float64Array(n),k=new Float64Array(n),v=new Float64Array(n),scratch={};
  for(let i=0;i<n;i++){const b=B.get(bars,i,scratch);o[i]=b.open;h[i]=b.high;l[i]=b.low;k[i]=b.close;v[i]=b.volume;}
  const cum=new Float64Array(n+1);for(let i=0;i<n;i++)cum[i+1]=cum[i]+v[i];
  const L=c.divPivot,tol=c.supportTolerancePct/100;
  const bull=new Array(n),bear=new Array(n),lows=[],highs=[];
  const stats={bullish:0,wick:0,regular:0,supportRejected:0,cliffRejected:0,bearish:0};
  const inRange=q=>{const t=B.time(bars,q);return t>=from&&T.end(t,c.timeframe)<=to;};
  const avgVolume=j=>{const a=Math.max(0,j-20),count=j-a;return count>=5?(cum[j]-cum[a])/count:NaN;};
  // 지지 판정: 저점 주변 가격대(±허용 %)를 이전 구간에서 몇 번 받쳤는지(연속된 캔들은 1회) + 그중 거래량이 받쳐준 횟수.
  function support(p,low){
   const zLow=low*(1-tol),zHigh=low*(1+tol),start=Math.max(0,p-c.supportLookback);
   let clusters=0,volClusters=0,lastTouch=-Infinity,clusterVol=false;
   for(let j=start;j<p;j++){
    if(l[j]<zLow||l[j]>zHigh)continue;
    if(j-lastTouch>2){if(clusters>0&&clusterVol)volClusters++;clusters++;clusterVol=false;}
    const avg=avgVolume(j);if(Number.isFinite(avg)&&avg>0&&v[j]>=avg*c.supportMinVolMult)clusterVol=true;
    lastTouch=j;
   }
   if(clusters>0&&clusterVol)volClusters++;
   const off=c.supportMinTouches===0&&c.supportMinVolTouches===0;
   return {zLow,zHigh,touches:clusters,volTouches:volClusters,ok:off||(clusters>=c.supportMinTouches&&volClusters>=c.supportMinVolTouches)};
  }
  for(let p=L;p<n-L;p++){
   if(!Number.isFinite(rsi[p]))continue;
   let isLow=true,isHigh=true;
   for(let j=1;j<=L&&(isLow||isHigh);j++){
    if(!(l[p]<=l[p-j]&&l[p]<l[p+j]))isLow=false;
    if(!(h[p]>=h[p-j]&&h[p]>h[p+j]))isHigh=false;
   }
   const q=p+L,range=h[p]-l[p];
   if(isLow){
    for(let a=lows.length-1;a>=0;a--){
     const p1=lows[a],gap=p-p1;if(gap>c.divMaxGap)break;
     let lowest=Infinity;for(let j=p1+1;j<p;j++)if(l[j]<lowest)lowest=l[j];
     if(lowest<l[p])break; // 두 저점 사이에 더 낮은 저점이 있으면 더 오래된 저점과 비교하지 않는다
     if(gap<c.divMinGap||!Number.isFinite(rsi[p1])||!(l[p]<l[p1])||!(rsi[p]>rsi[p1]+c.divMinRsiDiff))continue;
     const bodyLow2=Math.min(o[p],k[p]),bodyLow1=Math.min(o[p1],k[p1]),wickRatio=range>0?(bodyLow2-l[p])/range:0;
     const wick=bodyLow2>=bodyLow1&&wickRatio>=c.divWickRatio;
     if(!wick&&c.divMode==='wick')continue;
     const sup=support(p,l[p]);
     if(!sup.ok){if(inRange(q)){if(sup.touches===0)stats.cliffRejected++;stats.supportRejected++;}break;}
     const found={kind:wick?'div_wick':'div_regular',p,p1,rsi2:rsi[p],rsi1:rsi[p1],low2:l[p],low1:l[p1],wickRatio,touches:sup.touches,volTouches:sup.volTouches,zLow:sup.zLow,zHigh:sup.zHigh};
     if(!bull[q]||(wick&&bull[q].kind!=='div_wick')){if(inRange(q)&&!bull[q]){stats.bullish++;stats[wick?'wick':'regular']++;}bull[q]=found;}
     break;
    }
    lows.push(p);
   }
   if(isHigh){
    for(let a=highs.length-1;a>=0;a--){
     const p1=highs[a],gap=p-p1;if(gap>c.divMaxGap)break;
     let highest=-Infinity;for(let j=p1+1;j<p;j++)if(h[j]>highest)highest=h[j];
     if(highest>h[p])break;
     if(gap<c.divMinGap||!Number.isFinite(rsi[p1])||!(h[p]>h[p1])||!(rsi[p]<rsi[p1]-c.divMinRsiDiff))continue;
     const bodyHigh2=Math.max(o[p],k[p]),bodyHigh1=Math.max(o[p1],k[p1]),wickRatio=range>0?(h[p]-bodyHigh2)/range:0;
     const wick=bodyHigh2<=bodyHigh1&&wickRatio>=c.divWickRatio;
     if(!wick&&c.divMode==='wick')continue;
     if(!bear[q]){if(inRange(q))stats.bearish++;bear[q]={kind:wick?'div_wick':'div_regular',p,p1,rsi2:rsi[p],rsi1:rsi[p1],high2:h[p],high1:h[p1],wickRatio};}
     break;
    }
    highs.push(p);
   }
  }
  return {bull,bear,stats};
 }
 function normalizeConfig(input={}){
  const c={...defaultStrategyConfig,...input};
  const number=(key,min,max,integer=false)=>{const value=Number(c[key]);if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw Error(key+' 설정 범위를 확인하세요.');c[key]=value;};
  for(const [key,min,max,int]of [['rsiPeriod',2,200,true],['rsiOversold',1,99],['rsiExitLevel',1,99],['splitCount',0,10,true],['splitStepPct',.01,99],['takeProfitPct',0,10000],['stopLossPct',0,99.99],['feePct',0,10],['slippagePct',0,10],['initialCapital',1,1e12],['allocationPerTradePct',.01,100],['firstEntryAmount',.01,1e12],['maxHoldBars',0,1000000,true],['entryCooldownBars',0,1000000,true],['fundingIntervalHours',0,24],['fundingWindowSeconds',0,864000],['fundingTransitionLookbackSeconds',0,86400],['minFundingRate',-100,100]]){if(c[key]===null&&key==='stopLossPct')c[key]=0;number(key,min,max,int);}
  if(c.maxFundingRate!==null){number('maxFundingRate',-100,100);if(c.maxFundingRate>c.minFundingRate)throw Error('음펀비 범위의 순서를 확인하세요.');}
  if(!T.seconds[c.timeframe])throw Error('지원하지 않는 타임프레임입니다.');
  for(const [key,choices]of Object.entries({fundingIntervalBasis:['known','chart'],entryTrigger:['rsi_cross_up','rsi_oversold'],splitTrigger:['rsi_cross_up','rsi_cross_up_1m','rsi_oversold','step_pct','bar'],dcaMethod:['equal','martingale','cumulative'],stopLossMode:['immediate','after_all_dca'],exitType:['tp_sl','rsi_rebound','settle_exit','composite'],positionSizing:['budget','first_entry'],rsiSource:['close','open','high','low','hl2','hlc3','ohlc4','hlcc4']}))if(!choices.includes(c[key]))throw Error(key+' 옵션이 올바르지 않습니다.');
  c.includeFundingPayment=c.includeFundingPayment!==false;
  // 지표: 'funding_rsi'(음펀비 + RSI, 기본) 또는 'rsi'(RSI 단독). 지표는 합치지 않고 하나만 쓴다.
  if(c.indicator!==undefined&&!['funding_rsi','rsi','divergence'].includes(c.indicator))throw Error('indicator 옵션이 올바르지 않습니다.');
  // 기본 지표는 키를 만들지 않아 이전 결과·백업의 설정 객체와 그대로 같다.
  if(c.indicator==='rsi'||c.indicator==='divergence'){}else delete c.indicator;
  if(c.indicator==='divergence'){
   // 다이버전스 전용 설정은 이 지표를 고를 때만 키가 생긴다.
   for(const [key,value]of Object.entries(divergenceDefaults))if(c[key]===undefined)c[key]=value;
   if(!divergenceTimeframes.includes(c.timeframe))throw Error('다이버전스 지표는 4시간·일·주·월봉만 지원합니다.');
   for(const [key,min,max,int]of [['divPivot',1,20,true],['divMinGap',2,500,true],['divMaxGap',3,1000,true],['divMinRsiDiff',0,50],['divWickRatio',0,1],['supportLookback',5,2000,true],['supportTolerancePct',.1,20],['supportMinTouches',0,50,true],['supportMinVolMult',0,50],['supportMinVolTouches',0,50,true]])number(key,min,max,int);
   if(c.divMinGap>c.divMaxGap)throw Error('다이버전스 두 저점 간격의 최소·최대 순서를 확인하세요.');
   if(!['both','wick'].includes(c.divMode))throw Error('divMode 옵션이 올바르지 않습니다.');
   c.divBearishExit=c.divBearishExit!==false;
  }else for(const key of Object.keys(divergenceDefaults))delete c[key];
  c.oneEntryPerFunding=c.oneEntryPerFunding===true;c.requireFreshFundingAfterCooldown=c.requireFreshFundingAfterCooldown===true;
  for(const key of ['startTime','endTime'])if(c[key]!==undefined&&!Number.isFinite(c[key]))throw Error('기간을 확인하세요.');
  if(c.startTime!==undefined&&c.endTime!==undefined&&c.startTime>=c.endTime)throw Error('테스트 기간을 확인하세요.');
  if(c.dcaMethod==='cumulative')c.dcaMultipliers=roundMultipliers(c.splitCount,c.dcaMultipliers);
  else delete c.dcaMultipliers;
  if(c.positionSizing==='first_entry'&&getStepWeights(c.splitCount,c.dcaMethod,c.dcaMultipliers).reduce((a,b)=>a+b,0)*c.firstEntryAmount>c.initialCapital+1e-8)throw Error(c.dcaMethod==='cumulative'?getAllocationPlan(c).message:'분할에 필요한 총금액이 초기 자본을 초과합니다.');
  return c;
 }
 function roundMultipliers(count,values=[]){
  if(!Array.isArray(values)||values.length>9)throw Error('2~10회차 배수 목록을 확인하세요.');
  return Array.from({length:Math.max(0,count-1)},(_,i)=>{
   const value=values[i]===undefined?1:values[i];
   if(!Number.isInteger(value)||value<1||value>10)throw Error((i+2)+'회차 배수는 1~10 사이 정수로 지정하세요.');
   return value;
  });
 }
 function getStepWeights(count,method='equal',multipliers){
  count=Math.max(1,Math.min(10,Number(count)||1));
  if(method==='cumulative'){let weight=1;return [1,...roundMultipliers(count,multipliers).map(value=>weight*=value)];}
  return Array.from({length:count},(_,i)=>method==='martingale'?(i<2?1:2**(i-1)):1);
 }
 const positionBudget=(c,capital,sum)=>c.positionSizing==='first_entry'?c.firstEntryAmount*sum:capital*c.allocationPerTradePct/100;
 function entryBudget(c,budget,weights,sum,index,used){
  if(c.dcaMethod==='cumulative'){
   if(c.positionSizing==='first_entry')return c.firstEntryAmount*weights[index];
   if(index===weights.length-1)return budget-used;
  }
  return budget*weights[index]/sum;
 }
 function getAllocationPlan(c){
  const weights=getStepWeights(c.splitCount,c.dcaMethod,c.dcaMultipliers),sum=weights.reduce((a,b)=>a+b,0),budget=positionBudget(c,c.initialCapital,sum);
  let used=0,excessStep=0;
  const exceeds=c.positionSizing==='first_entry'&&budget>c.initialCapital+1e-8;
  const amounts=weights.map((_,i)=>{
   const amount=entryBudget(c,budget,weights,sum,i,used);used+=amount;
   if(exceeds&&!excessStep&&used>c.initialCapital+1e-8)excessStep=i+1;
   return amount;
  });
  if(exceeds&&!excessStep)excessStep=amounts.length;
  const format=value=>value.toLocaleString('en-US',{maximumFractionDigits:8});
  return {amounts,budget,excessStep,message:excessStep?excessStep+'회차에서 초기 자본을 초과합니다. 총 '+format(budget)+' USDT 필요 · 초기 자본 '+format(c.initialCapital)+' USDT. 첫 진입금액이나 배수를 줄이세요.':''};
 }
 function normalizeFunding(records){
  const unique=new Map();for(const row of records||[]){if(!Number.isFinite(row.time)||!Number.isFinite(row.rate))throw Error('펀딩비 기록 값이 올바르지 않습니다.');unique.set(row.time,{...row});}
  const sorted=[...unique.values()].sort((a,b)=>a.time-b.time);
  for(let i=0;i<sorted.length;i++){const r=sorted[i],given=Number(r.fundingIntervalHours??r.hours??r.intervalHours),observed=i?(r.time-sorted[i-1].time)/3600:NaN;r.intervalHours=given>0?given:[1,2,4,6,8,12,24].find(h=>Math.abs(observed-h)<.02)??null;r.intervalSource=given>0?(r.intervalSource||'record'):r.intervalHours?'observed':'unknown';}
  return sorted;
 }
 function rateQualifies(record,c){return record&&record.rate<=c.minFundingRate&&(c.maxFundingRate===null||c.maxFundingRate===undefined||record.rate>=c.maxFundingRate);}
 function intervalObservations(rows,basis){
  if(basis!=='chart')return rows.map(r=>({time:r.time,hours:r.intervalHours,source:r.intervalSource}));
  const timeline=F.observedCycles(rows).map(p=>({time:p.start,hours:p.hours,source:p.hours?'retrospective':'unknown'}));
  if(rows.length)timeline.push({time:rows.at(-1).time,hours:null,source:'unknown'});return timeline;
 }
 function identifyFundingSessions(records,config={}){
  const c={...defaultStrategyConfig,...config},rows=normalizeFunding(records),events=new Set(rows.map(r=>r.time)),windows=new Map(),sessions=[],active=[];
  const timeline=intervalObservations(rows,c.fundingIntervalBasis),extensions=new Map();
  for(const r of rows)if(rateQualifies(r,c)){const end=r.time+(c.fundingWindowSeconds||r.intervalHours*3600||0);if(end>r.time){windows.set(r.time,{end,record:r});events.add(end);}}
  // A previous negative settlement may arm a newly confirmed funding cycle.
  // Confirmation is never moved backwards to a time before the new settlement.
  if(c.fundingIntervalBasis==='known'&&c.fundingTransitionLookbackSeconds>0){
   let cursor=0,negative=null,previous=null;
   for(const observation of timeline){
    while(cursor<rows.length&&rows[cursor].time<=observation.time){const record=rows[cursor++];if(rateQualifies(record,c))negative=record;}
    if(previous?.hours>0&&observation.hours>0&&previous.hours!==observation.hours&&(!c.fundingIntervalHours||observation.hours===c.fundingIntervalHours)&&negative&&negative.time<observation.time&&observation.time-negative.time<=c.fundingTransitionLookbackSeconds&&windows.get(negative.time)?.end<=observation.time){
     const end=observation.time+(c.fundingWindowSeconds||observation.hours*3600),window={end,record:negative,transitionTime:observation.time};
     const values=extensions.get(observation.time)||[];values.push(window);extensions.set(observation.time,values);events.add(observation.time);events.add(end);
    }
    previous=observation;
   }
  }
  // Only a record already settled at the signal close can establish the interval.
  // A later low-magnitude settlement does not cancel an earlier unexpired signal.
  const times=[...events].sort((a,b)=>a-b);let index=0,intervalIndex=0,current=null;
  for(let i=0;i+1<times.length;i++){
   const time=times[i];while(index<rows.length&&rows[index].time<=time){const r=rows[index++],w=windows.get(r.time);if(w){while(active.length&&active.at(-1).end<=w.end)active.pop();active.push(w);}}
   while(intervalIndex<timeline.length&&timeline[intervalIndex].time<=time)current=timeline[intervalIndex++];
   for(const w of extensions.get(time)||[]){while(active.length&&active.at(-1).end<=w.end)active.pop();active.push(w);}
   while(active.length&&active.at(-1).end<=time)active.pop();
   const w=active.at(-1);if(!w||(c.fundingIntervalHours&&current?.hours!==c.fundingIntervalHours))continue;
   const last=sessions.at(-1),end=Math.min(w.end,times[i+1]);
   if(last&&last.rawRecord.time===w.record.time&&last.intervalHours===(current?.hours??null)&&last.endTime===time)last.endTime=end;
   else sessions.push({settleTime:w.record.time,startTime:time,endTime:end,validUntil:w.end,rate:w.record.rate,intervalHours:current?.hours??null,intervalSource:current?.source??'unknown',rawRecord:w.record,...(w.transitionTime?{transitionTime:w.transitionTime}:{})});
  }
  return sessions;
 }
 function fundingSessionAt(sessions,time){let lo=0,hi=sessions.length;while(lo<hi){const mid=(lo+hi)>>>1;if(sessions[mid].startTime<=time)lo=mid+1;else hi=mid;}const s=sessions[lo-1];return s&&time<s.endTime?s:null;}
 function computeRSI(candles,period=14,source='close',timeframe){
  if(!Number.isSafeInteger(period)||period<1||!['close','open','high','low','hl2','hlc3','ohlc4','hlcc4'].includes(source))throw Error('RSI 설정을 확인하세요.');
  // The same Wilder RMA as the chart indicator, without allocating nine full
  // arrays of intermediate values for millions of historical candles.
  const result=new Float64Array(candles.length).fill(NaN),scratch={};let lastTime=null,lastSource=null,count=0,gainSum=0,lossSum=0,up=NaN,down=NaN;
  for(let i=0;i<candles.length;i++){
   const bar=B.get(candles,i,scratch),value=source==='hl2'?(bar.high+bar.low)/2:source==='hlc3'?(bar.high+bar.low+bar.close)/3:source==='ohlc4'?(bar.open+bar.high+bar.low+bar.close)/4:source==='hlcc4'?(bar.high+bar.low+bar.close*2)/4:bar[source];
   if(lastTime!==null&&timeframe&&T.end(lastTime,timeframe)<bar.time){lastSource=null;count=0;gainSum=0;lossSum=0;up=NaN;down=NaN;}
   if(lastSource!==null){const change=value-lastSource,gain=Math.max(change,0),loss=-Math.min(change,0);
    if(count<period){gainSum+=gain;lossSum+=loss;if(++count===period){up=gainSum/period;down=lossSum/period;}}
    else{up=gain/period+(1-1/period)*up;down=loss/period+(1-1/period)*down;}
    if(Number.isFinite(up)&&Number.isFinite(down))result[i]=down===0?100:up===0?0:100-100/(1+up/down);
   }
   lastTime=bar.time;lastSource=value;
  }return result;
 }
 function knownFunding(records,time){let lo=0,hi=records.length;while(lo<hi){const mid=(lo+hi)>>>1;if(records[mid].time<=time)lo=mid+1;else hi=mid;}return records[lo-1];}
 function prepareExecution(candles,c,context){
  const mtf=c.splitTrigger==='rsi_cross_up_1m'&&c.timeframe!=='1m',key=[c.timeframe,c.rsiPeriod,c.rsiSource,mtf,c.startTime,c.endTime].join('|'),saved=context.prepared?.get(key);if(saved)return saved;
  const check=input=>{const rows=B.isPacked(input)?input:T.sorted(input||[]),scratch={};let previous=-Infinity;
   for(let i=0;i<rows.length;i++){const b=B.get(rows,i,scratch);if(!b||!Number.isFinite(b.time)||!Number.isFinite(b.open)||!Number.isFinite(b.high)||!Number.isFinite(b.low)||!Number.isFinite(b.close)||!Number.isFinite(b.volume)||b.time<=previous||b.open<=0||b.close<=0||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close))throw Error('OHLC 캔들 범위가 올바르지 않습니다.');previous=b.time;}return rows;};
  const signalBars=check(candles),rsi=computeRSI(signalBars,c.rsiPeriod,c.rsiSource,c.timeframe);
  let bars=signalBars,minuteRsi=rsi,rangeStart=c.startTime??B.time(signalBars,0)??0,rangeEnd=c.endTime??Infinity;
  if(mtf){
   if(!context.minuteCandles?.length)throw Error('1분봉 RSI 분할에는 동일 거래소·종목의 실제 1분봉 데이터가 필요합니다.');
   const cache=context.minutePrepared;if(cache?.input===context.minuteCandles&&cache.period===c.rsiPeriod&&cache.source===c.rsiSource){bars=cache.bars;minuteRsi=cache.rsi;}
   else{bars=check(context.minuteCandles);minuteRsi=computeRSI(bars,c.rsiPeriod,c.rsiSource,'1m');context.minutePrepared={input:context.minuteCandles,period:c.rsiPeriod,source:c.rsiSource,bars,rsi:minuteRsi};}
   let first=-1,lastMain=-1,previous=null;for(let i=0;i<signalBars.length;i++){const time=B.time(signalBars,i);if(time<rangeStart||T.end(time,c.timeframe)>rangeEnd)continue;
    if(previous!==null&&T.end(previous,c.timeframe)!==time)throw Error('기준 주기 데이터에 공백이 있어 1분봉 분할을 정확히 검증할 수 없습니다.');if(first<0)first=i;lastMain=i;previous=time;
   }
   if(first<0)throw Error('선택 기간에 완성된 기준 주기 캔들이 없습니다.');rangeStart=B.time(signalBars,first);rangeEnd=T.end(B.time(signalBars,lastMain),c.timeframe);
   let lo=0,hi=bars.length;while(lo<hi){const mid=(lo+hi)>>>1;if(B.time(bars,mid)<rangeStart)lo=mid+1;else hi=mid;}const minuteStart=lo;let last=minuteStart;
   if(minuteStart>=bars.length||B.time(bars,minuteStart)!==rangeStart||minuteStart<c.rsiPeriod)throw Error('1분봉 기록 또는 RSI 준비 구간이 부족합니다. 기간을 줄이거나 제공 범위를 확인하세요.');
   for(let j=1;j<=c.rsiPeriod;j++)if(B.time(bars,minuteStart-j)!==rangeStart-j*60)throw Error('1분봉 RSI 준비 구간에 공백이 있습니다. 일부만 계산하지 않고 중단했습니다.');
   while(last+1<bars.length&&B.time(bars,last+1)<rangeEnd){if(B.time(bars,last+1)!==B.time(bars,last)+60)throw Error('1분봉 기록에 공백이 있어 분할 신호를 정확히 검증할 수 없습니다.');last++;}
   if(B.time(bars,last)+60!==rangeEnd)throw Error('테스트 종료까지의 1분봉 기록이 부족합니다. 일부만 계산하지 않고 중단했습니다.');
  }
  const data={bars,signalBars,rsi,minuteRsi,mtf,rangeStart,rangeEnd,executionTimeframe:mtf?'1m':c.timeframe};context.prepared?.set(key,data);return data;
 }
 function runBacktest(candles,fundingRecords,options={},context={}){
  const c=normalizeConfig(options),data=prepareExecution(candles,c,context),{bars,signalBars,rsi,minuteRsi,mtf,executionTimeframe}=data;
  const records=normalizeFunding(fundingRecords),weights=getStepWeights(c.splitCount,c.dcaMethod,c.dcaMultipliers),weightSum=weights.reduce((a,b)=>a+b,0),splitCount=weights.length;
  const noFunding=c.indicator==='rsi'||c.indicator==='divergence',divergence=c.indicator==='divergence'?computeDivergence(signalBars,rsi,c,data.rangeStart,data.rangeEnd):null;
  const divDetails=d=>({rsi:d.rsi2,previousRsi:d.rsi1,low:d.low2,previousLow:d.low1,wickRatio:d.wickRatio,pivotTime:B.time(signalBars,d.p),previousPivotTime:B.time(signalBars,d.p1),supportTouches:d.touches,supportVolumeTouches:d.volTouches,supportZoneLow:d.zLow,supportZoneHigh:d.zHigh});
  const trades=[],signals=[],equityCurve=[],warnings={ambiguousBars:0,fundingPriceEstimates:0,fundingTimingAmbiguities:0,dataGaps:0,skippedInsufficientCapital:0};
  const from=data.rangeStart,to=data.rangeEnd,fee=c.feePct/100,slip=c.slippagePct/100;
  const fundingSessions=identifyFundingSessions(records,c),rateSessions=c.fundingIntervalHours?identifyFundingSessions(records,{...c,fundingIntervalHours:0}):fundingSessions;
  const intervals=intervalObservations(records,c.fundingIntervalBasis);
  const negativeRecords=records.filter(r=>rateQualifies(r,c)),eligible=fundingSessions.filter(s=>s.endTime>from&&s.startTime<to);
  const diagnostics={fundingRecords:records.filter(r=>r.time>=from&&r.time<to).length,rateQualifiedRecords:new Set([...negativeRecords.filter(r=>r.time<to&&r.time+(c.fundingWindowSeconds||r.intervalHours*3600||0)>from).map(r=>r.time),...rateSessions.filter(s=>s.transitionTime&&s.endTime>from&&s.startTime<to).map(s=>s.settleTime)]).size,eligibleFundingWindows:eligible.length,rsiSignals:0,entrySignals:0,rejected:{funding_window:0,funding_cycle:0,funding_reuse:0,entry_cooldown:0,funding_before_cooldown:0,position:0,capital:0},samples:[]};
  if(divergence)diagnostics.divergence={...divergence.stats};
  let capital=c.initialCapital,pos=null,pending=null,fundingIndex=0,peak=c.initialCapital,mdd=0,lastIndex=-1,equityCount=0,equityStride=1,equityLastTime=null,equityLastValue=null,equitySampled=false;
  // Keep the last actually filled initial entry across exits and data gaps.
  // Older overlapping windows must not rearm entry when a newer window expires.
  let lastUsedFundingTime=-Infinity,lastEntrySignalIndex=-Infinity,lastCooldownClose=-Infinity;
  const equityLimit=Number.isSafeInteger(context.equityMaxPoints)?Math.max(2,context.equityMaxPoints):Infinity;
  function compactEquity(){let j=0;for(let i=0;i<equityCurve.length;i+=2)equityCurve[j++]=equityCurve[i];equityCurve.length=j;equityStride*=2;equitySampled=true;}
  function equity(value,time){peak=Math.max(peak,value);if(peak>0)mdd=Math.max(mdd,(peak-value)/peak*100);if(!context.summaryOnly){equityLastTime=time;equityLastValue=value;if(equityCount++%equityStride===0){equityCurve.push({time,value});if(equityCurve.length>equityLimit)compactEquity();}}}
  function settle(until,bar,inclusive=true){
   while(fundingIndex<records.length&&(inclusive?records[fundingIndex].time<=until:records[fundingIndex].time<until)){
    const f=records[fundingIndex++];if(!pos||!c.includeFundingPayment||f.time<=pos.startTime)continue;
    const supplied=Number(f.markPrice??f.referencePrice),price=supplied>0?supplied:bar.open;if(!(supplied>0))warnings.fundingPriceEstimates++;
    const income=-pos.totalQty*price*f.rate/100;pos.fundingEarned+=income;pos.fundingEvents.push({time:f.time,rate:f.rate,income,price,estimated:!(supplied>0)});
   }
  }
  function entrySignal(kind,bar,time,timeframe,details){
   if(context.summaryOnly)return;
   const signal={kind,barTime:bar.time,time,timeframe,close:bar.close,...details};
   if(details&&'previousRsi' in details&&!Number.isFinite(details.previousRsi))signal.previousRsi=null;
   return signal;
  }
  function fill(bar,initial,fundingCondition,signalIndex,signal){
   if(initial){const budget=positionBudget(c,capital,weightSum);
    if(budget>capital+1e-7||budget<.01){warnings.skippedInsufficientCapital++;return;}
    pos={startTime:bar.time,totalBudget:budget,entries:[],totalQty:0,totalCost:0,purchaseCost:0,entryFees:0,avgPrice:0,fundingEarned:0,fundingEvents:[],holdBars:0,fundingCondition};
   }
   if(!pos)return;const step=pos.entries.length+1,budget=entryBudget(c,pos.totalBudget,weights,weightSum,step-1,pos.totalCost),price=bar.open*(1+slip),qty=budget/(price*(1+fee)),entryFee=budget-qty*price;
   pos.totalQty+=qty;pos.totalCost+=budget;pos.purchaseCost+=qty*price;pos.entryFees+=entryFee;pos.avgPrice=pos.purchaseCost/pos.totalQty;
   const tp=['tp_sl','composite'].includes(c.exitType)&&c.takeProfitPct>0?pos.avgPrice*(1+c.takeProfitPct/100):null,sl=c.stopLossPct>0&&(c.stopLossMode==='immediate'||step===splitCount)?pos.avgPrice*(1-c.stopLossPct/100):null;
   pos.entries.push({step,time:bar.time,price,qty,cost:budget,fee:entryFee,avgPrice:pos.avgPrice,takeProfit:tp,stopLoss:sl,...(signal?{signal}:{})});
   if(initial){if(c.oneEntryPerFunding&&fundingCondition)lastUsedFundingTime=fundingCondition.settleTime;lastEntrySignalIndex=signalIndex;if(fundingCondition)lastCooldownClose=fundingCondition.signalTime;}
   if(!context.summaryOnly)signals.push({time:bar.time,type:initial?'BUY_INITIAL':'DCA_BUY',step,price,avgPrice:pos.avgPrice,takeProfit:tp,stopLoss:sl,...(initial?{fundingCondition}: {})});
  }
  function close(bar,price,reason,details={}){
   const fillPrice=price*(1-slip),exitFee=pos.totalQty*fillPrice*fee,grossRevenue=pos.totalQty*fillPrice,pricePnl=grossRevenue-pos.purchaseCost,net=pricePnl-pos.entryFees-exitFee+pos.fundingEarned;
   capital+=net;const trade={id:trades.length+1,entryTime:pos.startTime,exitTime:bar.time,holdBars:pos.holdBars,dcaSteps:pos.entries.length,splitTarget:splitCount,avgEntryPrice:pos.avgPrice,exitPrice:fillPrice,triggerPrice:price,totalCost:pos.totalCost,entryFees:pos.entryFees,exitFee,grossRevenue,pricePnl,fundingEarned:pos.fundingEarned,fundingEvents:pos.fundingEvents,fundingEventsCount:pos.fundingEvents.length,netPnl:net,returnPct:net/pos.totalCost*100,isWin:net>1e-9,exitReason:reason,capitalAfter:capital,entries:pos.entries,fundingCondition:pos.fundingCondition,...details};
   trades.push(trade);if(!context.summaryOnly)signals.push({time:bar.time,type:'EXIT',price:fillPrice,reason,returnPct:trade.returnPct,tradeId:trade.id});pos=null;pending=null;equity(capital,bar.time);
  }
  let mainCursor=0;const currentBar={},previousBar={},currentSignal={};
  for(let i=0;i<bars.length;i++){
   if(context.onProgress&&i%250000===0)context.onProgress({phase:'compute',timeframe:c.timeframe,executionTimeframe,count:i,total:bars.length});
   const bar=B.get(bars,i,currentBar),end=T.end(bar.time,executionTimeframe);if(bar.time<from||end>to)continue;lastIndex=i;
   if(mtf)while(mainCursor<signalBars.length&&T.end(B.time(signalBars,mainCursor),c.timeframe)<end)mainCursor++;
   const checkpoint=mtf?(mainCursor<signalBars.length&&T.end(B.time(signalBars,mainCursor),c.timeframe)===end?mainCursor:-1):i,signalBar=mtf?B.get(signalBars,checkpoint,currentSignal):bar;
   const gap=i>0&&T.end(B.time(bars,i-1),executionTimeframe)<bar.time;
   if(gap){warnings.dataGaps++;if(pos){const prev=B.get(bars,i-1,previousBar);close(prev,prev.close,'DATA_GAP');}pending=null;}
   settle(bar.time,bar); // Settlement at the opening instant precedes new entries.
   if(pos){const tp=['tp_sl','composite'].includes(c.exitType)&&c.takeProfitPct>0?pos.avgPrice*(1+c.takeProfitPct/100):null,sl=c.stopLossPct>0&&(c.stopLossMode==='immediate'||pos.entries.length===splitCount)?pos.avgPrice*(1-c.stopLossPct/100):null;if(sl!==null&&bar.open<=sl)close(bar,bar.open,'STOP_LOSS');else if(tp!==null&&bar.open>=tp)close(bar,bar.open,'TAKE_PROFIT');}
   if(pending?.kind==='exit'&&pos)close(bar,bar.open,pending.reason);
   else if(pending?.kind==='entry'&&!pos)fill(bar,true,pending.fundingCondition,pending.signalIndex,pending.signal);
   else if(pending?.kind==='dca'&&pos&&pos.entries.length<splitCount)fill(bar,false,null,null,pending.signal);
   pending=null;
   if(pos){
    const bucket=T.start(bar.time,c.timeframe);if(!mtf||pos.holdBucket!==bucket){pos.holdBars++;pos.holdBucket=bucket;}
    const tpEnabled=['tp_sl','composite'].includes(c.exitType)&&c.takeProfitPct>0,tp=tpEnabled?pos.avgPrice*(1+c.takeProfitPct/100):null,sl=c.stopLossPct>0&&(c.stopLossMode==='immediate'||pos.entries.length===splitCount)?pos.avgPrice*(1-c.stopLossPct/100):null;
    const hitStop=sl!==null&&bar.low<=sl,hitTarget=tp!==null&&bar.high>=tp;
    if(hitStop||hitTarget){
     if(hitStop&&hitTarget)warnings.ambiguousBars++;
     const reason=hitStop?'STOP_LOSS':'TAKE_PROFIT',level=hitStop?sl:tp;
     const price=hitStop&&bar.open<level?bar.open:!hitStop&&bar.open>level?bar.open:level;
     if(records[fundingIndex]&&records[fundingIndex].time>bar.time&&records[fundingIndex].time<end)warnings.fundingTimingAmbiguities++;
     close(bar,price,reason,{ambiguousBar:hitStop&&hitTarget});
    }
   }
   settle(end,bar,false); // Only positions that survived the bar can receive intrabar settlements.
   if(c.entryCooldownBars>0&&checkpoint>lastEntrySignalIndex&&checkpoint-lastEntrySignalIndex<=c.entryCooldownBars)lastCooldownClose=end;
   const entryRsi=rsi[checkpoint],entryPrev=rsi[checkpoint-1],entryDiv=divergence&&signalBar?divergence.bull[checkpoint]:null,entryTrigger=divergence?Boolean(entryDiv):signalBar&&(c.entryTrigger==='rsi_cross_up'?Number.isFinite(entryPrev)&&entryPrev<=c.rsiOversold&&entryRsi>c.rsiOversold:Number.isFinite(entryRsi)&&entryRsi<=c.rsiOversold);
   let entrySession=null;
   if(entryTrigger){
    diagnostics.rsiSignals++;const rateWindow=fundingSessionAt(rateSessions,end),matched=fundingSessionAt(fundingSessions,end),interval=knownFunding(intervals,end),negative=rateWindow?.rawRecord??knownFunding(negativeRecords,end);
    // Count test-timeframe candles, even when DCA executes on 1m candles.
    // Suppressed signals do not extend the wait or consume a new settlement.
    const rsiOnly=noFunding,reason=rsiOnly?(pos?'position':capital<=0?'capital':'match'):pos?'position':!rateWindow?'funding_window':!matched?'funding_cycle':c.entryCooldownBars>0&&checkpoint-lastEntrySignalIndex<=c.entryCooldownBars?'entry_cooldown':c.entryCooldownBars>0&&c.requireFreshFundingAfterCooldown&&matched.settleTime<lastCooldownClose?'funding_before_cooldown':c.oneEntryPerFunding&&matched.settleTime<=lastUsedFundingTime?'funding_reuse':capital<=0?'capital':'match';
    if(reason==='match'){entrySession=rsiOnly?{settleTime:end,rate:null,intervalHours:null}:matched;diagnostics.entrySignals++;}else diagnostics.rejected[reason]++;
    if(!context.summaryOnly){diagnostics.samples.push({time:end,rsi:entryRsi,previousRsi:Number.isFinite(entryPrev)?entryPrev:null,reason,intervalHours:interval?.hours??null,intervalSource:interval?.source??'unknown',fundingTime:negative?.time??null,fundingRate:negative?.rate??null,validUntil:matched?.transitionTime?matched.validUntil:negative?negative.time+(c.fundingWindowSeconds||negative.intervalHours*3600||0):null,...(matched?.transitionTime?{transitionTime:matched.transitionTime}:{})});if(diagnostics.samples.length>30)diagnostics.samples.shift();}
   }
   if(pos){
    const r=rsi[checkpoint],prev=rsi[checkpoint-1],cross=Number.isFinite(prev)&&prev<=c.rsiOversold&&r>c.rsiOversold,minuteCross=Number.isFinite(minuteRsi[i-1])&&minuteRsi[i-1]<=c.rsiOversold&&minuteRsi[i]>c.rsiOversold,kind=c.splitTrigger;
    if(signalBar&&divergence&&c.divBearishExit&&divergence.bear[checkpoint])pending={kind:'exit',reason:'BEARISH_DIVERGENCE',signal:entrySignal(divergence.bear[checkpoint].kind,signalBar,end,c.timeframe,{rsi:divergence.bear[checkpoint].rsi2,previousRsi:divergence.bear[checkpoint].rsi1})};
    else if(signalBar&&['rsi_rebound','composite'].includes(c.exitType)&&Number.isFinite(r)&&r>=c.rsiExitLevel)pending={kind:'exit',reason:'RSI_REBOUND'};
    else if(signalBar&&c.exitType==='settle_exit'&&pos.fundingEvents.length&&signalBar.close>signalBar.open)pending={kind:'exit',reason:'SETTLE_EXIT'};
    else if(signalBar&&c.maxHoldBars>0&&pos.holdBars>=c.maxHoldBars)pending={kind:'exit',reason:'TIMEOUT'};
    else if(pos.entries.length<splitCount){
     const level=kind==='step_pct'?pos.entries.at(-1).price*(1-c.splitStepPct/100):null;
     if(kind==='step_pct'&&bar.low<=level)pending={kind:'dca',signal:entrySignal(kind,bar,end,executionTimeframe,{referencePrice:level,low:bar.low})};
     else if(kind==='bar')pending={kind:'dca',signal:entrySignal(kind,bar,end,executionTimeframe)};
     else if((kind==='rsi_cross_up_1m'&&minuteCross)||(kind==='rsi_cross_up'&&cross)||(kind==='rsi_oversold'&&r<=c.rsiOversold)){
      const minute=kind==='rsi_cross_up_1m';
      pending={kind:'dca',signal:entrySignal(kind,minute?bar:signalBar,end,minute?'1m':c.timeframe,{threshold:c.rsiOversold,rsi:minute?minuteRsi[i]:r,previousRsi:(minute?minuteRsi[i-1]:prev)??null})};
     }
    }
    equity(capital-pos.totalCost+pos.totalQty*bar.close*(1-slip)*(1-fee)+pos.fundingEarned,bar.time);
   }else{
    if(entrySession)pending={kind:'entry',signalIndex:checkpoint,signal:entryDiv?entrySignal(entryDiv.kind,signalBar,end,c.timeframe,divDetails(entryDiv)):entrySignal(c.entryTrigger,signalBar,end,c.timeframe,{threshold:c.rsiOversold,rsi:entryRsi,previousRsi:entryPrev??null}),fundingCondition:noFunding?undefined:{signalTime:end,settleTime:entrySession.settleTime,rate:entrySession.rate,intervalHours:entrySession.intervalHours,intervalSource:entrySession.intervalSource,validUntil:entrySession.validUntil,...(entrySession.transitionTime?{transitionTime:entrySession.transitionTime}:{})}};
   }
  }
  if(pos&&lastIndex>=0){const last=B.get(bars,lastIndex,previousBar);close(last,last.close,'END_OF_TEST');}
  if(equityLastTime!==null&&Number.isFinite(equityLimit)){const point={time:equityLastTime,value:equityLastValue},last=equityCurve.at(-1);if(last?.time===point.time)equityCurve[equityCurve.length-1]=point;else{if(equityCurve.length>=equityLimit)compactEquity();equityCurve.push(point);}}
  const summary=compileStatistics(trades,c,mdd,new Set(eligible.map(s=>s.settleTime)).size);
  return {success:signalBars.length>c.rsiPeriod,reason:signalBars.length>c.rsiPeriod?'':'RSI 계산을 위한 캔들 데이터가 부족합니다.',summary,config:c,trades:context.summaryOnly?[]:trades,signals,equityCurve,warnings,diagnostics,model:{execution:'closed-signal-next-open',executionTimeframe,dcaTimeframe:c.splitTrigger==='rsi_cross_up_1m'?'1m':c.timeframe,sameBar:'stop-loss-first',funding:'settled-records-only; supplied mark price or candle-open estimate',fundingCondition:'unexpired-negative-settlement',fundingReentry:c.oneEntryPerFunding?'newer-qualified-settlement-only':'reuse-unexpired-settlement',entryCooldown:{bars:c.entryCooldownBars,timeframe:c.timeframe,anchor:'filled-initial-entry-signal',count:'skip-next-n-signal-bars',requireFreshFunding:c.requireFreshFundingAfterCooldown,dca:'unchanged'},fundingIntervalBasis:c.fundingIntervalBasis,futureIntervalObservations:c.fundingIntervalBasis==='chart',periodEnd:'close-position-at-last-closed-candle',...(equitySampled?{equityCurveSampled:true,equityPointLimit:equityLimit}:{})}};
 }
 function compileStatistics(trades,c,mdd=0,eligibleSessionsCount=0){
  const wins=trades.filter(t=>t.netPnl>1e-9),losses=trades.filter(t=>t.netPnl< -1e-9),grossProfit=wins.reduce((s,t)=>s+t.netPnl,0),grossLoss=-losses.reduce((s,t)=>s+t.netPnl,0),netPnl=trades.reduce((s,t)=>s+t.netPnl,0),avg=rows=>rows.length?rows.reduce((s,t)=>s+t.returnPct,0)/rows.length:0;
  return {totalTrades:trades.length,winTrades:wins.length,lossTrades:losses.length,breakevenTrades:trades.length-wins.length-losses.length,winRatePct:trades.length?wins.length/trades.length*100:0,initialCapital:c.initialCapital,finalCapital:c.initialCapital+netPnl,netPnl,grossProfit,grossLoss,totalReturnPct:netPnl/c.initialCapital*100,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit?null:0,profitFactorInfinite:!grossLoss&&grossProfit>0,maxDrawdownPct:mdd,avgTradeReturnPct:avg(trades),avgWinReturnPct:avg(wins),avgLossReturnPct:Math.abs(avg(losses)),riskRewardRatio:losses.length?avg(wins)/Math.abs(avg(losses)):null,avgDcaSteps:trades.length?trades.reduce((s,t)=>s+t.dcaSteps,0)/trades.length:0,avgHoldBars:trades.length?trades.reduce((s,t)=>s+t.holdBars,0)/trades.length:0,totalFundingEarned:trades.reduce((s,t)=>s+t.fundingEarned,0),totalFees:trades.reduce((s,t)=>s+t.entryFees+t.exitFee,0),eligibleSessionsCount};
 }
 function runAllTimeframes(map,records,options={},controls={}){const results={},comparison=[],context={minuteCandles:map['1m'],prepared:new Map(),summaryOnly:controls.summaryOnly===true,equityMaxPoints:controls.equityMaxPoints,onProgress:controls.onProgress},frames=Object.keys(T.seconds).filter(tf=>map[tf]?.length&&(options.indicator!=='divergence'||divergenceTimeframes.includes(tf)));for(const [index,tf]of frames.entries()){controls.onProgress?.({phase:'compare',timeframe:tf,count:index+1,total:frames.length});const res=runBacktest(map[tf],records,{...options,timeframe:tf},context);results[tf]=res;comparison.push({timeframe:tf,...res.summary,trades:res.summary.totalTrades,fundingEarned:res.summary.totalFundingEarned});}const valid=comparison.filter(r=>r.totalTrades>0),best=key=>[...valid].sort((a,b)=>(b[key]??Infinity)-(a[key]??Infinity))[0]||null;return {results,comparison,bestByWinRate:best('winRatePct'),bestByProfitFactor:best('profitFactor'),bestByTotalReturn:best('totalReturnPct')};}
 function optimizeStrategy(candles,records,grid={}){
  const combinations=[],context={minuteCandles:grid.minuteCandles,prepared:new Map(),summaryOnly:true},splits=grid.baseConfig?.dcaMethod==='cumulative'?[grid.baseConfig.splitCount??defaultStrategyConfig.splitCount]:grid.splitCounts||[0,3,5,10],oversolds=grid.rsiOversolds||[20,25,30],targets=grid.takeProfitPcts||[1,2,3],stops=grid.stopLossPcts||[2,3,5],triggers=grid.splitTriggers||(grid.minuteCandles?.length?['step_pct','rsi_cross_up','rsi_cross_up_1m']:['step_pct','rsi_cross_up']),total=splits.length*oversolds.length*targets.length*stops.length*triggers.length;let tested=0;
  for(const splitCount of splits)for(const rsiOversold of oversolds)for(const takeProfitPct of targets)for(const stopLossPct of stops)for(const splitTrigger of triggers){
   const params={splitCount,rsiOversold,takeProfitPct,stopLossPct,splitTrigger};tested++;if(tested>1000)throw Error('최적화 조합은 1,000개까지 지원합니다.');
   grid.onProgress?.({phase:'optimize',timeframe:grid.baseConfig?.timeframe,count:tested,total});
   let result;try{result=runBacktest(candles,records,{...grid.baseConfig,...params},context);}catch(error){if(/총금액/.test(error.message))continue;throw error;}
   if(result.summary.totalTrades<(grid.minTrades??2))continue;const score=result.summary.winRatePct*Math.min(10,result.summary.profitFactor??10)/(1+result.summary.maxDrawdownPct/10);combinations.push({params,summary:result.summary,score});
  }
  const best=key=>[...combinations].sort((a,b)=>(b.summary[key]??Infinity)-(a.summary[key]??Infinity))[0]||null;
  return {totalEvaluated:tested,eligibleEvaluated:combinations.length,bestWinRate:best('winRatePct'),bestProfitFactor:best('profitFactor'),bestTotalReturn:best('totalReturnPct'),bestBalanced:[...combinations].sort((a,b)=>b.score-a.score)[0]||null,topRankings:combinations.sort((a,b)=>b.score-a.score).slice(0,20)};
 }
 function signalLabel(signal){if(signal.type==='BUY_INITIAL')return 'BUY 1';if(signal.type==='DCA_BUY')return 'DCA '+signal.step;return reasons[signal.reason]||'청산';}
 return {defaultStrategyConfig,divergenceDefaults,divergenceTimeframes,normalizeConfig,getStepWeights,getAllocationPlan,normalizeFunding,identifyFundingSessions,fundingSessionAt,computeRSI,runBacktest,runAllTimeframes,optimizeStrategy,signalLabel,reasons};
});
