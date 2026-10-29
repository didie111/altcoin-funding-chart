(function(root,factory){'use strict';const api=factory(typeof module==='object'&&module.exports?require('./backtest-engine.js'):root.BacktestEngine,typeof module==='object'&&module.exports?require('./timeframes.js'):TimeframeEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.FundingSignals=api;})(typeof globalThis!=='undefined'?globalThis:this,function(E,T){
 'use strict';
 function calculate(bars,records,options={},now=Date.now()/1000){
  const config=E.normalizeConfig({timeframe:options.timeframe||'5m',fundingIntervalHours:options.hours??0,minFundingRate:options.threshold??-.5,fundingWindowSeconds:(options.windowMinutes??60)*60,fundingTransitionLookbackSeconds:(options.transitionMinutes??60)*60,rsiPeriod:options.rsiPeriod??14,rsiOversold:options.oversold??30}),rsi=E.computeRSI(bars,config.rsiPeriod,'close',config.timeframe),sessions=E.identifyFundingSessions(records,config),signals=[];
  for(let i=1;i<bars.length;i++){
   const time=T.end(bars[i].time,config.timeframe);if(time>now||!(rsi[i-1]<=config.rsiOversold&&rsi[i]>config.rsiOversold))continue;
   const session=E.fundingSessionAt(sessions,time);if(!session)continue;
   signals.push({time:bars[i].time,eventTime:time,price:bars[i].close,rate:session.rate,settleTime:session.settleTime,hours:session.intervalHours,transitionTime:session.transitionTime??null,previousRsi:rsi[i-1],rsi:rsi[i]});
  }
  return signals;
 }
 return {calculate};
});
