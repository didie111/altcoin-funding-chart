'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),E=require('../backtest-engine.js'),S=require('../funding-signals.js');
const base=Date.UTC(2026,9,20)/1000,records=[{time:base-5*3600,rate:.01,hours:4},{time:base-3600,rate:-.6,hours:4},{time:base,rate:.01,hours:1},{time:base+3600,rate:.01,hours:1}];
const bars=Array.from({length:100},(_,i)=>{const close=i<45?180-i:135+(i-44)*5;return {time:base+(i-40)*60,open:close,high:close,low:close,close,volume:1};});
test('chart funding+RSI signals use the same confirmed transition condition and closed-bar RSI as the backtest',()=>{
 const signals=S.calculate(bars,records,{timeframe:'1m',hours:1,threshold:-.5,rsiPeriod:2},base+3600),result=E.runBacktest(bars,records,{timeframe:'1m',fundingIntervalHours:1,rsiPeriod:2,splitCount:1,stopLossPct:0,takeProfitPct:0,maxHoldBars:0});
 assert.equal(signals.length,1);assert.equal(result.trades.length,1);assert.equal(signals[0].eventTime,result.trades[0].fundingCondition.signalTime);assert.equal(signals[0].settleTime,base-3600);assert.equal(signals[0].transitionTime,base);
});
test('chart signals never use an unfinished candle or future transition confirmation',()=>{
 assert.equal(S.calculate(bars,records,{timeframe:'1m',hours:1,rsiPeriod:2},base-1).length,0);assert.equal(S.calculate(bars,records.slice(0,2),{timeframe:'1m',hours:1,rsiPeriod:2},base+3600).length,0);assert.equal(S.calculate(bars,records,{timeframe:'1m',hours:1,rsiPeriod:2,transitionMinutes:0},base+3600).length,0);
});
