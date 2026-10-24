(function(root,factory){
 'use strict';if(typeof module==='object'&&module.exports){const tf=require('./timeframes.js');globalThis.TimeframeEngine??=tf;module.exports=factory(require('./indicators.js'),tf);}else root.BacktestEngine=factory(RsiEngine,TimeframeEngine);
})(typeof globalThis!=='undefined'?globalThis:this,function(RSI,T){
 'use strict';
 const defaultStrategyConfig=Object.freeze({timeframe:'5m',fundingIntervalHours:1,minFundingRate:-.5,maxFundingRate:null,fundingWindowSeconds:3600,rsiPeriod:14,rsiOversold:30,rsiSource:'close',entryTrigger:'rsi_cross_up',splitCount:5,splitTrigger:'rsi_cross_up',splitStepPct:1,dcaMethod:'equal',stopLossMode:'immediate',exitType:'tp_sl',takeProfitPct:2,stopLossPct:3,rsiExitLevel:50,maxHoldBars:300,feePct:.05,slippagePct:.03,includeFundingPayment:true,initialCapital:10000,allocationPerTradePct:100,positionSizing:'budget',firstEntryAmount:10});
 const reasons=Object.freeze({TAKE_PROFIT:'TP · 익절',STOP_LOSS:'SL · 손절',RSI_REBOUND:'RSI 청산',SETTLE_EXIT:'정산 후 청산',TIMEOUT:'보유 기간 종료',END_OF_TEST:'테스트 기간 종료',DATA_GAP:'데이터 공백 전 종료'});
 function normalizeConfig(input={}){
  const c={...defaultStrategyConfig,...input};
  const number=(key,min,max,integer=false)=>{const value=Number(c[key]);if(!Number.isFinite(value)||value<min||value>max||(integer&&!Number.isInteger(value)))throw Error(key+' 설정 범위를 확인하세요.');c[key]=value;};
  for(const [key,min,max,int]of [['rsiPeriod',2,200,true],['rsiOversold',1,99],['rsiExitLevel',1,99],['splitCount',0,10,true],['splitStepPct',.01,99],['takeProfitPct',0,10000],['stopLossPct',0,99.99],['feePct',0,10],['slippagePct',0,10],['initialCapital',1,1e12],['allocationPerTradePct',.01,100],['firstEntryAmount',.01,1e12],['maxHoldBars',0,1000000,true],['fundingIntervalHours',0,24],['fundingWindowSeconds',0,864000],['minFundingRate',-100,100]]){if(c[key]===null&&key==='stopLossPct')c[key]=0;number(key,min,max,int);}
  if(c.maxFundingRate!==null){number('maxFundingRate',-100,100);if(c.maxFundingRate>c.minFundingRate)throw Error('음펀비 범위의 순서를 확인하세요.');}
  if(!T.seconds[c.timeframe])throw Error('지원하지 않는 타임프레임입니다.');
  for(const [key,choices]of Object.entries({entryTrigger:['rsi_cross_up','rsi_oversold'],splitTrigger:['rsi_cross_up','rsi_oversold','step_pct','bar'],dcaMethod:['equal','martingale'],stopLossMode:['immediate','after_all_dca'],exitType:['tp_sl','rsi_rebound','settle_exit','composite'],positionSizing:['budget','first_entry'],rsiSource:['close','open','high','low','hl2','hlc3','ohlc4','hlcc4']}))if(!choices.includes(c[key]))throw Error(key+' 옵션이 올바르지 않습니다.');
  c.includeFundingPayment=c.includeFundingPayment!==false;
  for(const key of ['startTime','endTime'])if(c[key]!==undefined&&!Number.isFinite(c[key]))throw Error('기간을 확인하세요.');
  if(c.startTime!==undefined&&c.endTime!==undefined&&c.startTime>=c.endTime)throw Error('테스트 기간을 확인하세요.');
  if(c.positionSizing==='first_entry'&&getStepWeights(c.splitCount,c.dcaMethod).reduce((a,b)=>a+b,0)*c.firstEntryAmount>c.initialCapital+1e-8)throw Error('분할에 필요한 총금액이 초기 자본을 초과합니다.');
  return c;
 }
 function getStepWeights(count,method='equal'){count=Math.max(1,Math.min(10,Number(count)||1));return Array.from({length:count},(_,i)=>method==='martingale'?(i<2?1:2**(i-1)):1);}
 function normalizeFunding(records){
  const unique=new Map();for(const row of records||[]){if(!Number.isFinite(row.time)||!Number.isFinite(row.rate))throw Error('펀딩비 기록 값이 올바르지 않습니다.');unique.set(row.time,{...row});}
  const sorted=[...unique.values()].sort((a,b)=>a.time-b.time);
  for(let i=0;i<sorted.length;i++){const r=sorted[i],given=Number(r.fundingIntervalHours??r.hours),observed=i?(r.time-sorted[i-1].time)/3600:NaN;r.intervalHours=given>0?given:[1,2,4,8,12,24].find(h=>Math.abs(observed-h)<.02)??null;}
  return sorted;
 }
 function qualifies(record,c){return record&&(!c.fundingIntervalHours||record.intervalHours===c.fundingIntervalHours)&&record.rate<=c.minFundingRate&&(c.maxFundingRate===null||c.maxFundingRate===undefined||record.rate>=c.maxFundingRate);}
 function identifyFundingSessions(records,config={}){const c={...defaultStrategyConfig,...config};return normalizeFunding(records).filter(r=>qualifies(r,c)).map(r=>({settleTime:r.time,startTime:r.time,endTime:r.time+(c.fundingWindowSeconds||r.intervalHours*3600||0),rate:r.rate,intervalHours:r.intervalHours,rawRecord:r}));}
 function computeRSI(candles,period=14,source='close',timeframe){
  const result=new Float64Array(candles.length).fill(NaN);let begin=0;
  for(let i=1;i<=candles.length;i++)if(i===candles.length||(timeframe&&T.end(candles[i-1].time,timeframe)<candles[i].time)){
   const values=RSI.calculate(candles.slice(begin,i),{length:period,source,divergence:false,maType:'None',showMa:false,showBands:false}).rsi;for(let j=0;j<values.length;j++)result[begin+j]=values[j];begin=i;
  }
  return result;
 }
 function knownFunding(records,time){let lo=0,hi=records.length;while(lo<hi){const mid=(lo+hi)>>>1;if(records[mid].time<=time)lo=mid+1;else hi=mid;}return records[lo-1];}
 function runBacktest(candles,fundingRecords,options={}){
  const c=normalizeConfig(options),bars=T.sorted(candles||[]);
  if(bars.some(b=>b.open<=0||b.close<=0||b.low<=0||b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)))throw Error('OHLC 캔들 범위가 올바르지 않습니다.');
  const records=normalizeFunding(fundingRecords),rsi=computeRSI(bars,c.rsiPeriod,c.rsiSource,c.timeframe),weights=getStepWeights(c.splitCount,c.dcaMethod),weightSum=weights.reduce((a,b)=>a+b,0),splitCount=weights.length;
  const trades=[],signals=[],equityCurve=[],warnings={ambiguousBars:0,fundingPriceEstimates:0,fundingTimingAmbiguities:0,dataGaps:0,skippedInsufficientCapital:0};
  const from=c.startTime??bars[0]?.time??0,to=c.endTime??Infinity,fee=c.feePct/100,slip=c.slippagePct/100;
  let capital=c.initialCapital,pos=null,pending=null,fundingIndex=0,peak=c.initialCapital,mdd=0,lastIndex=-1;
  function equity(value,time){peak=Math.max(peak,value);if(peak>0)mdd=Math.max(mdd,(peak-value)/peak*100);equityCurve.push({time,value});}
  function settle(until,bar,inclusive=true){
   while(fundingIndex<records.length&&(inclusive?records[fundingIndex].time<=until:records[fundingIndex].time<until)){
    const f=records[fundingIndex++];if(!pos||!c.includeFundingPayment||f.time<=pos.startTime)continue;
    const supplied=Number(f.markPrice??f.referencePrice),price=supplied>0?supplied:bar.open;if(!(supplied>0))warnings.fundingPriceEstimates++;
    const income=-pos.totalQty*price*f.rate/100;pos.fundingEarned+=income;pos.fundingEvents.push({time:f.time,rate:f.rate,income,price,estimated:!(supplied>0)});
   }
  }
  function fill(bar,initial){
   if(initial){const budget=c.positionSizing==='first_entry'?c.firstEntryAmount*weightSum:capital*c.allocationPerTradePct/100;
    if(budget>capital+1e-7||budget<.01){warnings.skippedInsufficientCapital++;return;}
    pos={startTime:bar.time,totalBudget:budget,entries:[],totalQty:0,totalCost:0,purchaseCost:0,entryFees:0,avgPrice:0,fundingEarned:0,fundingEvents:[],holdBars:0};
   }
   if(!pos)return;const step=pos.entries.length+1,budget=pos.totalBudget*weights[step-1]/weightSum,price=bar.open*(1+slip),qty=budget/(price*(1+fee)),entryFee=budget-qty*price;
   pos.totalQty+=qty;pos.totalCost+=budget;pos.purchaseCost+=qty*price;pos.entryFees+=entryFee;pos.avgPrice=pos.purchaseCost/pos.totalQty;
   const tp=['tp_sl','composite'].includes(c.exitType)&&c.takeProfitPct>0?pos.avgPrice*(1+c.takeProfitPct/100):null,sl=c.stopLossPct>0&&(c.stopLossMode==='immediate'||step===splitCount)?pos.avgPrice*(1-c.stopLossPct/100):null;
   pos.entries.push({step,time:bar.time,price,qty,cost:budget,fee:entryFee,avgPrice:pos.avgPrice,takeProfit:tp,stopLoss:sl});
   signals.push({time:bar.time,type:initial?'BUY_INITIAL':'DCA_BUY',step,price,avgPrice:pos.avgPrice,takeProfit:tp,stopLoss:sl});
  }
  function close(bar,price,reason,details={}){
   const fillPrice=price*(1-slip),exitFee=pos.totalQty*fillPrice*fee,grossRevenue=pos.totalQty*fillPrice,pricePnl=grossRevenue-pos.purchaseCost,net=pricePnl-pos.entryFees-exitFee+pos.fundingEarned;
   capital+=net;const trade={id:trades.length+1,entryTime:pos.startTime,exitTime:bar.time,holdBars:pos.holdBars,dcaSteps:pos.entries.length,splitTarget:splitCount,avgEntryPrice:pos.avgPrice,exitPrice:fillPrice,triggerPrice:price,totalCost:pos.totalCost,entryFees:pos.entryFees,exitFee,grossRevenue,pricePnl,fundingEarned:pos.fundingEarned,fundingEvents:pos.fundingEvents,fundingEventsCount:pos.fundingEvents.length,netPnl:net,returnPct:net/pos.totalCost*100,isWin:net>1e-9,exitReason:reason,capitalAfter:capital,entries:pos.entries,...details};
   trades.push(trade);signals.push({time:bar.time,type:'EXIT',price:fillPrice,reason,returnPct:trade.returnPct,tradeId:trade.id});pos=null;pending=null;equity(capital,bar.time);
  }
  for(let i=0;i<bars.length;i++){
   const bar=bars[i],end=T.end(bar.time,c.timeframe);if(bar.time<from||end>to)continue;lastIndex=i;
   const gap=i>0&&T.end(bars[i-1].time,c.timeframe)<bar.time;
   if(gap){warnings.dataGaps++;if(pos)close(bars[i-1],bars[i-1].close,'DATA_GAP');pending=null;}
   settle(bar.time,bar); // Settlement at the opening instant precedes new entries.
   if(pos){const tp=['tp_sl','composite'].includes(c.exitType)&&c.takeProfitPct>0?pos.avgPrice*(1+c.takeProfitPct/100):null,sl=c.stopLossPct>0&&(c.stopLossMode==='immediate'||pos.entries.length===splitCount)?pos.avgPrice*(1-c.stopLossPct/100):null;if(sl!==null&&bar.open<=sl)close(bar,bar.open,'STOP_LOSS');else if(tp!==null&&bar.open>=tp)close(bar,bar.open,'TAKE_PROFIT');}
   if(pending?.kind==='exit'&&pos)close(bar,bar.open,pending.reason);
   else if(pending?.kind==='entry'&&!pos)fill(bar,true);
   else if(pending?.kind==='dca'&&pos&&pos.entries.length<splitCount)fill(bar,false);
   pending=null;
   if(pos){
    pos.holdBars++;
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
   if(pos){
    const r=rsi[i],prev=rsi[i-1],cross=Number.isFinite(prev)&&prev<=c.rsiOversold&&r>c.rsiOversold;
    if(['rsi_rebound','composite'].includes(c.exitType)&&Number.isFinite(r)&&r>=c.rsiExitLevel)pending={kind:'exit',reason:'RSI_REBOUND'};
    else if(c.exitType==='settle_exit'&&pos.fundingEvents.length&&bar.close>bar.open)pending={kind:'exit',reason:'SETTLE_EXIT'};
    else if(c.maxHoldBars>0&&pos.holdBars>=c.maxHoldBars)pending={kind:'exit',reason:'TIMEOUT'};
    else if(pos.entries.length<splitCount&&((c.splitTrigger==='rsi_cross_up'&&cross)||(c.splitTrigger==='rsi_oversold'&&r<=c.rsiOversold)||(c.splitTrigger==='step_pct'&&bar.low<=pos.entries.at(-1).price*(1-c.splitStepPct/100))||c.splitTrigger==='bar'))pending={kind:'dca'};
    equity(capital-pos.totalCost+pos.totalQty*bar.close*(1-slip)*(1-fee)+pos.fundingEarned,bar.time);
   }else{
    const r=rsi[i],prev=rsi[i-1],trigger=c.entryTrigger==='rsi_cross_up'?Number.isFinite(prev)&&prev<=c.rsiOversold&&r>c.rsiOversold:Number.isFinite(r)&&r<=c.rsiOversold;
    const f=knownFunding(records,end),window=f&&(c.fundingWindowSeconds||f.intervalHours*3600||0);
    if(trigger&&qualifies(f,c)&&end>=f.time&&end<f.time+window&&capital>0)pending={kind:'entry'};
   }
  }
  if(pos&&lastIndex>=0)close(bars[lastIndex],bars[lastIndex].close,'END_OF_TEST');
  const summary=compileStatistics(trades,c,mdd,identifyFundingSessions(records,c).length);
  return {success:bars.length>c.rsiPeriod,reason:bars.length>c.rsiPeriod?'':'RSI 계산을 위한 캔들 데이터가 부족합니다.',summary,config:c,trades,signals,equityCurve,warnings,model:{execution:'closed-signal-next-open',sameBar:'stop-loss-first',funding:'settled-records-only; supplied mark price or candle-open estimate',periodEnd:'close-position-at-last-closed-candle'}};
 }
 function compileStatistics(trades,c,mdd=0,eligibleSessionsCount=0){
  const wins=trades.filter(t=>t.netPnl>1e-9),losses=trades.filter(t=>t.netPnl< -1e-9),grossProfit=wins.reduce((s,t)=>s+t.netPnl,0),grossLoss=-losses.reduce((s,t)=>s+t.netPnl,0),netPnl=trades.reduce((s,t)=>s+t.netPnl,0),avg=rows=>rows.length?rows.reduce((s,t)=>s+t.returnPct,0)/rows.length:0;
  return {totalTrades:trades.length,winTrades:wins.length,lossTrades:losses.length,breakevenTrades:trades.length-wins.length-losses.length,winRatePct:trades.length?wins.length/trades.length*100:0,initialCapital:c.initialCapital,finalCapital:c.initialCapital+netPnl,netPnl,grossProfit,grossLoss,totalReturnPct:netPnl/c.initialCapital*100,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit?null:0,profitFactorInfinite:!grossLoss&&grossProfit>0,maxDrawdownPct:mdd,avgTradeReturnPct:avg(trades),avgWinReturnPct:avg(wins),avgLossReturnPct:Math.abs(avg(losses)),riskRewardRatio:losses.length?avg(wins)/Math.abs(avg(losses)):null,avgDcaSteps:trades.length?trades.reduce((s,t)=>s+t.dcaSteps,0)/trades.length:0,avgHoldBars:trades.length?trades.reduce((s,t)=>s+t.holdBars,0)/trades.length:0,totalFundingEarned:trades.reduce((s,t)=>s+t.fundingEarned,0),totalFees:trades.reduce((s,t)=>s+t.entryFees+t.exitFee,0),eligibleSessionsCount};
 }
 function runAllTimeframes(map,records,options={}){const results={},comparison=[];for(const tf of Object.keys(T.seconds)){if(!map[tf]?.length)continue;const res=runBacktest(map[tf],records,{...options,timeframe:tf});results[tf]=res;comparison.push({timeframe:tf,...res.summary,trades:res.summary.totalTrades,fundingEarned:res.summary.totalFundingEarned});}const valid=comparison.filter(r=>r.totalTrades>0),best=key=>[...valid].sort((a,b)=>(b[key]??Infinity)-(a[key]??Infinity))[0]||null;return {results,comparison,bestByWinRate:best('winRatePct'),bestByProfitFactor:best('profitFactor'),bestByTotalReturn:best('totalReturnPct')};}
 function optimizeStrategy(candles,records,grid={}){
  const combinations=[];let tested=0;
  for(const splitCount of grid.splitCounts||[0,3,5,10])for(const rsiOversold of grid.rsiOversolds||[20,25,30])for(const takeProfitPct of grid.takeProfitPcts||[1,2,3])for(const stopLossPct of grid.stopLossPcts||[2,3,5])for(const splitTrigger of grid.splitTriggers||['step_pct','rsi_cross_up']){
   const params={splitCount,rsiOversold,takeProfitPct,stopLossPct,splitTrigger};tested++;if(tested>1000)throw Error('최적화 조합은 1,000개까지 지원합니다.');
   let result;try{result=runBacktest(candles,records,{...grid.baseConfig,...params});}catch(error){if(/총금액/.test(error.message))continue;throw error;}
   if(result.summary.totalTrades<(grid.minTrades??2))continue;const score=result.summary.winRatePct*Math.min(10,result.summary.profitFactor??10)/(1+result.summary.maxDrawdownPct/10);combinations.push({params,summary:result.summary,score});
  }
  const best=key=>[...combinations].sort((a,b)=>(b.summary[key]??Infinity)-(a.summary[key]??Infinity))[0]||null;
  return {totalEvaluated:tested,eligibleEvaluated:combinations.length,bestWinRate:best('winRatePct'),bestProfitFactor:best('profitFactor'),bestTotalReturn:best('totalReturnPct'),bestBalanced:[...combinations].sort((a,b)=>b.score-a.score)[0]||null,topRankings:combinations.sort((a,b)=>b.score-a.score).slice(0,20)};
 }
 function signalLabel(signal){if(signal.type==='BUY_INITIAL')return 'BUY 1';if(signal.type==='DCA_BUY')return 'DCA '+signal.step;return reasons[signal.reason]||'청산';}
 return {defaultStrategyConfig,normalizeConfig,getStepWeights,normalizeFunding,identifyFundingSessions,computeRSI,runBacktest,runAllTimeframes,optimizeStrategy,signalLabel,reasons};
});
