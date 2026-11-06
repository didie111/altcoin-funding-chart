'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),History=require('../funding-history.js'),F=require('../funding.js'),T=require('../timeframes.js');
const start=Date.UTC(2026,8,1)/1000,records=Array.from({length:1000},(_,i)=>({time:start+i*3600,rate:i%4?-.01:-.5})),now=()=>1000*(start+1100*3600);
function harness(){const calls=[],found=[];const loader=History.create({now,pause:async()=>{},page:async(ex,symbol,cursor,page)=>{
 calls.push({ex,symbol,cursor,page});
 if(['BITGET','MEXC'].includes(ex))return records.slice(Math.max(0,records.length-page*200),records.length-(page-1)*200);
 if(ex==='BINANCE')return records.filter(r=>r.time*1000>=cursor).slice(0,200);
 return records.filter(r=>r.time*1000<=cursor).slice(-200);
 }});return {loader,calls,found,onPage:rows=>found.push(...rows)};}
for(const ex of ['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'])test(ex+' pages all settlements for visible daily candles, independently of loaded price pages',async()=>{
 const h=harness(),from=start+5*86400,to=start+30*86400;
 await h.loader.load(ex,'EPICUSDT',{from,to,onPage:h.onPage});assert.ok(h.calls.length>2);assert.equal(h.loader.covers(ex,'EPICUSDT',from,to),true);
 const prices=Array.from({length:25},(_,i)=>({time:from+i*86400})),mapped=F.mapToCandles(prices,F.merge(h.found),86400,-.5,-2);
 assert.equal(mapped.mapped.size,25);assert.ok([...mapped.mapped.values()].every(v=>v.events===24&&v.rate===-.5));
 const count=h.calls.length;await h.loader.load(ex,'EPICUSDT',{from:from+86400,to:to-86400});assert.equal(h.calls.length,count);
 assert.equal(h.loader.covers(ex,'TUSDT',from,to),false);assert.equal(h.loader.covers(ex==='BYBIT'?'BINANCE':'BYBIT','EPICUSDT',from,to),false);
});
test('a repeated upstream page is a failure and never becomes a complete coverage claim',async()=>{
 const loader=History.create({now,pause:async()=>{},page:async()=>records.slice(-10)});
 await assert.rejects(loader.load('BYBIT','TUSDT',{from:start,to:start+999*3600}),/반복/);assert.equal(loader.covers('BYBIT','TUSDT',start,start+999*3600),false);
});
test('changing the visible dates cancels obsolete paging without marking its unqueried dates complete',async()=>{
 const abort=new AbortController(),h=harness();await assert.rejects(h.loader.load('BYBIT','TUSDT',{from:start,to:start+999*3600,signal:abort.signal,onPage:()=>abort.abort()}),{name:'AbortError'});
 assert.equal(h.calls.length,1);assert.equal(h.loader.covers('BYBIT','TUSDT',start,start+999*3600),false);
});
test('settlement history maps to true calendar month boundaries after fetching more than one page',async()=>{
 const h=harness(),from=start,to=T.end(start,'1M');await h.loader.load('BYBIT','TUSDT',{from,to,onPage:h.onPage});
 const result=F.mapToCandles([{time:start}],F.merge(h.found),T.seconds['1M'],-.5,-2,time=>T.end(time,'1M'));
 assert.equal(result.mapped.get(start).events,30*24);assert.equal(result.mapped.get(start).rate,-.5);
});
test('the visible-range chart integration fills old daily funding even when every price candle is already loaded',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8'),nodes=new Map();let pages=0,renders=0;
 const ctx={Date,AbortSignal,AbortController,FundingEngine:F,TimeframeEngine:T,FundingHistory:{...History,create:options=>History.create({...options,now,pause:async()=>{}})},loadedMarket:{ex:'BYBIT',symbol:'EPICUSDT',int:'1d',id:1},run:1,historyState:{id:1,pending:new Set()},navigationController:new AbortController(),all:Array.from({length:25},(_,i)=>({time:start+(i+5)*86400})),rates:records.slice(-200),
  $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},fundingPage:async(ex,symbol,cursor)=>{pages++;assert.equal(symbol,'EPICUSDT');return records.filter(r=>r.time*1000<=cursor).slice(-200);},sameRates:(a,b)=>a.length===b.length&&a.every((r,i)=>r.time===b[i].time&&r.rate===b[i].rate),rebuild:()=>{},renderFundingStudies:()=>renders++,status:message=>assert.fail(message),fundingError:e=>e.message};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function requestVisibleFunding('),source.indexOf('function scheduleVisibleHistory(')),ctx);
 await ctx.requestVisibleFunding({from:0,to:24});assert.ok(pages>2);assert.ok(renders>0);
 const mapped=F.mapToCandles(ctx.all,ctx.rates,86400,-.5,-2);assert.equal(mapped.mapped.size,25);assert.equal(nodes.get('historyLoading').hidden,true);
 const previous=pages;await ctx.requestVisibleFunding({from:0,to:24});assert.equal(pages,previous);
});
test('the browser build reads FundingEngine from its real script lexical binding',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),ctx={Date,AbortController};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(require.resolve('../funding.js'),'utf8'),ctx);assert.equal(ctx.FundingEngine,undefined);
 vm.runInContext(fs.readFileSync(require.resolve('../funding-history.js'),'utf8'),ctx);
 const loader=ctx.FundingHistory.create({now,pause:async()=>{},page:async()=>[]});
 await loader.load('BYBIT','EPICUSDT',{from:start,to:start+86400});assert.equal(loader.covers('BYBIT','EPICUSDT',start,start+86400),true);
});
test('cycle neighbours outside loaded prices never become a false in-range funding minimum',()=>{
 const rows=[{time:start-3600,rate:-9},{time:start,rate:-.1},{time:start+3600,rate:-.2},{time:start+7200,rate:-8}];
 const split=History.partition(rows,start,start+7200);assert.equal(split.inside.length,2);assert.equal(split.neighbors.length,2);assert.equal(F.minimum(split.inside).rate,-.2);assert.equal(split.neighbors[0].rate,-9);
});
