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

test('the actual worker passes the larger-timeframe support candles to the divergence engine',()=>{
 const H4=14400,D1=86400,start=Date.UTC(2026,1,3)/1000,ctx={onmessage:null,postMessage:value=>answers.push(value)},answers=[];
 const bar=(time,close,step)=>({time,open:close,high:close*1.003,low:close*.997,close,volume:100});
 const fourH=Array.from({length:120},(_,i)=>bar(start+(i-30)*H4,100+Math.sin(i/4)*5)),daily=Array.from({length:60},(_,i)=>bar(start-(60-i)*D1,100+Math.sin(i/6)*4));
 vm.createContext(ctx);ctx.importScripts=(...urls)=>{for(const url of urls)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',url.split('?')[0]),'utf8'),ctx);};
 vm.runInContext(fs.readFileSync(require.resolve('../backtest-worker.js'),'utf8'),ctx);
 const config={timeframe:'4h',indicator:'divergence',startTime:start,endTime:T.end(fourH.at(-1).time,'4h'),rsiPeriod:5,supportExcludeRecent:0};
 const dataset={exchange:'BINANCE',symbol:'SNTUSDT',timeframeCandles:{'4h':fourH},fundingRecords:[{time:start-3600,rate:-.5}]};
 ctx.onmessage({data:{id:1,mode:'single',dataset,config}});
 assert.match(answers.at(-1).error,/지지 확인용 1d/);
 ctx.onmessage({data:{id:2,mode:'single',dataset:{...dataset,supportCandles:{'1d':daily}},config}});
 const packet=answers.at(-1);assert.equal(packet.error,undefined);assert.equal(packet.result.success,true);assert.equal(packet.result.diagnostics.divergence.supportTimeframe,'1d');
});

test('classic batch worker loads the larger-timeframe candles separately for divergence support',async()=>{
 const H4=14400,D1=86400,start=Date.UTC(2026,1,3)/1000,end=start+100*H4,market={exchange:'BINANCE',symbol:'SNTUSDT'},requests=[],answers=[];
 const mk=(time,close)=>[time*1000,String(close),String(close*1.003),String(close*.997),String(close),'100',time*1000+1,'0',1,'0','0','0'];
 const fourH=Array.from({length:260},(_,i)=>mk(start+(i-120)*H4,100+Math.sin(i/4)*5)),daily=Array.from({length:260},(_,i)=>mk(Math.floor(start/D1)*D1-(200-i)*D1,100+Math.sin(i/6)*4));
 const events=[start-3*D1,start,start+D1].map(time=>({symbol:market.symbol,fundingTime:time*1000,fundingRate:'-0.006',markPrice:'100'}));
 const ctx={onmessage:null,AbortController,TextEncoder,TextDecoder,Blob,structuredClone,Uint8Array,URL,atob,btoa,setTimeout,clearTimeout,postMessage(value){
  if(!value.marketRequest){answers.push(value);return;}
  const q=value.marketRequest;requests.push(q);
  const rows=q.url.endsWith('/klines')?(q.params.interval==='1d'?daily:fourH).filter(r=>r[0]<=q.params.endTime).slice(-q.params.limit):null;
  queueMicrotask(()=>void ctx.onmessage({data:{marketResponse:{requestId:q.requestId,...(q.url.endsWith('/fundingRate')?{data:events.filter(r=>r.fundingTime>=q.params.startTime)}:rows?{data:rows}:{error:{message:'Unexpected exchange request: '+q.url}})}}}));
 }};
 vm.createContext(ctx);ctx.importScripts=(...urls)=>{for(const url of urls)vm.runInContext(fs.readFileSync(path.join(__dirname,'..',url.split('?')[0]),'utf8'),ctx);};
 vm.runInContext(fs.readFileSync(require.resolve('../backtest-batch-worker.js'),'utf8'),ctx);
 const archive=ctx.BacktestResearchStore.memory();ctx.BacktestResearchStore.getDefault=async()=>archive;
 await ctx.onmessage({data:{id:1,purpose:'backtest',market,detail:true,config:{timeframe:'4h',indicator:'divergence',startTime:start,endTime:end,rsiPeriod:5,useBinanceArchive:false,precomputeTimeframes:false,reuseCompleted:false}}});
 const packet=answers.find(v=>v.id===1&&(v.error||v.output));
 assert.equal(packet?.error,undefined,packet?.error?.message);
 assert.equal(packet.output.result.success,true);
 assert.equal(packet.output.result.diagnostics.divergence.supportTimeframe,'1d');
 assert.ok(requests.some(r=>r.url.endsWith('/klines')&&r.params.interval==='1d'),'지지 확인용 일봉을 따로 요청해야 합니다');
});
