'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),T=require('../timeframes.js');
test('the actual worker keeps 3m as the signal frame even when a 1m auxiliary series is present',()=>{
 const start=Date.UTC(2026,9,20)/1000,bar=(time,close)=>({time,open:100,high:Math.max(102,close),low:Math.min(98,close),close,volume:1});
 const minute=Array.from({length:140},(_,i)=>bar(start+(i-80)*60,100+Math.sin(i))),main=Array.from({length:100},(_,i)=>bar(start+(i-80)*180,100+Math.sin(i)));
 const answers=[],ctx={onmessage:null,postMessage:value=>answers.push(value)};vm.createContext(ctx);
 ctx.importScripts=(...urls)=>{for(const url of urls)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',url.split('?')[0]),'utf8'),ctx);};
 vm.runInContext(fs.readFileSync(require.resolve('../backtest-worker.js'),'utf8'),ctx);
 const dataset={exchange:'BYBIT',symbol:'SNTUSDT',timeframeCandles:{'1m':minute,'3m':main},fundingRecords:[{time:start-3600,rate:-.5},{time:start,rate:-.5}]};
 for(const splitTrigger of ['rsi_cross_up','rsi_cross_up_1m']){
  ctx.onmessage({data:{id:answers.length,mode:'single',dataset,config:{timeframe:'3m',startTime:start,endTime:T.end(main.at(-1).time,'3m'),rsiPeriod:2,splitTrigger}}});
  const packet=answers.at(-1);assert.equal(packet.error,undefined);assert.equal(packet.result.success,true);assert.equal(packet.result.config.timeframe,'3m');assert.equal(packet.result.model.dcaTimeframe,splitTrigger==='rsi_cross_up_1m'?'1m':'3m');
 }
});
