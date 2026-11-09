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

test('classic batch worker fills missing Binance funding for preserved candles and can calculate IOST',async()=>{
 const start=Date.UTC(2025,0,10)/1000,end=start+7200,market={exchange:'BINANCE',symbol:'IOSTUSDT'},requests=[],answers=[];
 const bars=Array.from({length:120},(_,i)=>({time:start+i*60,open:100,high:103,low:97,close:100+Math.sin(i),volume:2}));
 const events=[start,start+3600].map(time=>({symbol:market.symbol,fundingTime:time*1000,fundingRate:'-0.006',markPrice:'100'}));
 const ctx={onmessage:null,AbortController,TextEncoder,TextDecoder,Blob,structuredClone,Uint8Array,URL,atob,btoa,setTimeout,clearTimeout,postMessage(value){
  if(!value.marketRequest){answers.push(value);return;}
  const q=value.marketRequest;requests.push(q);
  const funding=q.url==='https://fapi.binance.com/fapi/v1/fundingRate';
  queueMicrotask(()=>void ctx.onmessage({data:{marketResponse:{requestId:q.requestId,...(funding?{data:events.filter(r=>r.fundingTime>=q.params.startTime)}:{error:{message:'Unexpected exchange request: '+q.url}})}}}));
 }};
 vm.createContext(ctx);ctx.importScripts=(...urls)=>{for(const url of urls)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',url.split('?')[0]),'utf8'),ctx);};
 vm.runInContext(fs.readFileSync(require.resolve('../backtest-batch-worker.js'),'utf8'),ctx);
 const archive=ctx.BacktestResearchStore.memory();ctx.BacktestResearchStore.getDefault=async()=>archive;
 await archive.put(market,'candles',bars,{checked:[[start,end]]});
 const run=async(purpose,id)=>{
  await ctx.onmessage({data:{id,purpose,market,detail:true,config:{timeframe:'1m',startTime:start,endTime:end,rsiPeriod:2,useBinanceArchive:false,precomputeTimeframes:false}}});
  return answers.find(v=>v.id===id&&(v.error||v.output));
 };
 const first=await run('backtest',1);
 assert.equal(first?.error,undefined,first?.error?.message);
 assert.equal(first.output.result.success,true);assert.equal(first.output.meta.research.gapsFilled,true);
 const stored=await archive.state(market);
 assert.equal(stored.candles.count,120);assert.equal(stored.funding.count,2);assert.equal(stored.completed.to,end);
 const replay=await run('collect-research',2);
 assert.equal(replay?.error,undefined,replay?.error?.message);
 assert.equal(replay.output.received,0);assert.equal(replay.output.fundingPages,0);
 assert.equal(requests.length,2);assert.ok(requests.every(r=>r.url.endsWith('/fundingRate')));
});
