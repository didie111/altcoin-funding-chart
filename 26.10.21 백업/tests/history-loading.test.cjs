'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const data=require('../chart-data.js'),timeframes=require('../timeframes.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const stamp=Date.UTC(2026,9,14)/1000;
const bar=time=>({time,open:10,high:11,low:9,close:10,volume:1});
function harness(options={}){
 const nodes=new Map(),calls=[],commits=[],timeouts=[];
 const ctx={AbortSignal,AbortController,Date,DOMException,ChartData:data,FundingEngine:require('../funding.js'),duration:timeframes.seconds,
  busy:true,run:1,loadedMarket:{ex:'BINGX',symbol:'BTCUSDT',int:'1m',id:1},navigationController:new AbortController(),
  historyState:{id:1,buffer:options.buffer??[],pending:new Set(),exhausted:new Set()},all:[bar(stamp)],rates:[],
  $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},
  candlePage:async()=>{calls.push('candles');if(options.gate)await options.gate;return options.rows??[bar(stamp-60)];},
  fundingPage:async()=>{calls.push('funding');return [];},
  commitHistoryRows:async(rows,id)=>{if(id!==ctx.run)return false;commits.push(rows);const count=ctx.all.length;ctx.all=data.mergeHistory(ctx.all,rows);return ctx.all.length>count;},
  uniqueSorted:rows=>timeframes.sorted(rows),sameRates:(a,b)=>a.length===b.length,rebuild:()=>{},renderFundingStudies:()=>{},
  scheduleVisibleHistory:()=>{},status:()=>{},fundingError:error=>error.message,
  setTimeout:callback=>{timeouts.push(callback);},clearTimeout:()=>{}
 };
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function requestChartHistory('),source.indexOf('function scheduleVisibleHistory(')),ctx);
 return {ctx,calls,commits,nodes,timeouts,request:{end:stamp*1000-1,from:stamp-2000*60,to:stamp-60,direction:'older'}};
}
test('panning loads a missing historical edge while full history collection is still busy',async()=>{
 const h=harness();await h.ctx.requestChartHistory(h.request);
 assert.equal(h.ctx.busy,true);assert.deepEqual(h.calls,['candles','funding']);assert.equal(h.ctx.all[0].time,stamp-60);
 assert.equal(h.nodes.get('historyLoading').hidden,true);
});
test('panning uses already collected background pages immediately',async()=>{
 const h=harness({buffer:[[bar(stamp-120),bar(stamp-60)]]});await h.ctx.requestChartHistory(h.request);
 assert.deepEqual(h.calls,['funding']);assert.equal(h.ctx.all.length,3);
});
test('duplicate range events share one request and a market switch discards its response',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),h=harness({gate});
 const pending=h.ctx.requestChartHistory(h.request);await h.ctx.requestChartHistory(h.request);
 assert.deepEqual(h.calls,['candles']);h.ctx.run=2;release();await pending;
 assert.equal(h.commits.length,0);assert.equal(h.ctx.all.length,1);
});
test('an upstream endpoint ignoring the historical cursor cannot insert newer bars as past data or loop forever',async()=>{
 const h=harness({rows:[bar(stamp+60)]});await h.ctx.requestChartHistory(h.request);await h.ctx.requestChartHistory(h.request);
 assert.deepEqual(h.calls,['candles']);assert.equal(h.ctx.all.length,1);
 assert.ok(h.ctx.historyState.exhausted.has(String(h.request.end)));
});
