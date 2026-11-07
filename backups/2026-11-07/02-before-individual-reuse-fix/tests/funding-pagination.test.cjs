'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const F=require('../funding.js'),H=require('../funding-history.js'),D=require('../backtest-data.js'),T=require('../timeframes.js');
const start=Date.UTC(2026,8,1)/1000,source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const bar=time=>({time,open:100,high:101,low:99,close:100,volume:1});
// Deliberate millisecond offsets reproduce the inclusive API boundary; these
// regression fixtures are never served as market data by the application.
function fixture(symbol,times,{offset=17,size=3,now=(times.at(-1)+86400)*1000}={}){
 const raw=times.map((time,i)=>({symbol,fundingTime:time*1000+offset,fundingRate:String((i+1)/10000)})),calls=[];
 const page=async(ex,s,cursor)=>{assert.equal(ex,'BINANCE');assert.equal(s,symbol);calls.push(cursor);return F.normalizeHistory(ex,raw.filter(r=>r.fundingTime>=cursor).slice(0,size),s,now);};
 return {raw,calls,page,now,expected:F.normalizeHistory('BINANCE',raw,symbol,now)};
}
for(const [symbol,offset]of [['BIRBUSDT',1],['QUSDT',17],['BTCUSDT',999]])test(symbol+' finishes inclusive settlement pagination with a '+offset+'ms timestamp offset',async()=>{
 const f=fixture(symbol,Array.from({length:14},(_,i)=>start+i*3600),{offset}),found=[],loader=H.create({now:()=>f.now,pause:async()=>{},page:f.page}),to=f.now/1000;
 await loader.load('BINANCE',symbol,{from:start,to,onPage:rows=>found.push(...rows)});
 assert.deepEqual(F.merge(found),f.expected);assert.equal(loader.covers('BINANCE',symbol,start,to),true);
 assert.equal(f.calls.length,6);assert.ok(f.calls.every((cursor,i)=>!i||cursor>f.raw[Math.min(i*3,f.raw.length)-1].fundingTime));
 await loader.load('BINANCE',symbol,{from:start,to});assert.equal(f.calls.length,6);
});
for(const interval of Object.keys(T.seconds))test('visible '+interval+' funding reaches its end without a false cursor error',async()=>{
 const from=T.start(start,interval),to=T.end(from,interval),times=[];for(let time=from-3600;time<to;time+=3600)times.push(time);
 const f=fixture('BIRBUSDT',times,{size:200,now:(to+3600)*1000}),found=[],loader=H.create({now:()=>f.now,pause:async()=>{},page:f.page});
 await loader.load('BINANCE','BIRBUSDT',{from,to,onPage:rows=>found.push(...rows)});
 const split=H.partition(found,from,to);assert.equal(split.inside.length,times.filter(t=>t>=from).length);assert.equal(loader.covers('BINANCE','BIRBUSDT',from,to),true);
 assert.ok(f.calls.length<=Math.ceil(times.length/200)+1);
});
test('backtesting keeps all real settlement pages through the fractional-millisecond final record',async()=>{
 const f=fixture('QUSDT',[-1,0,1,2].map(i=>start+i*3600),{size:2}),prices=Array.from({length:440},(_,i)=>bar(start-80*60+i*60));
 const api=D.create({fundingPage:f.page,candlePage:async(ex,s,tf,end)=>prices.filter(r=>r.time*1000<=end)});
 const result=await api.loadBacktestDataset('QUSDT',{exchange:'BINANCE',intervals:['1m'],startTime:start,endTime:start+6*3600});
 assert.deepEqual(result.fundingRecords,f.expected);assert.equal(f.calls.length,3);assert.equal(result.coverage['1m'].count,360);
});
test('an endpoint that really ignores the cursor still fails instead of claiming complete funding coverage',async()=>{
 const row={time:start,rate:.01,timeMs:start*1000+17},loader=H.create({now:()=>(start+86400)*1000,pause:async()=>{},page:async()=>[row]});
 await assert.rejects(loader.load('BINANCE','BIRBUSDT',{from:start,to:start+3600}),/반복|진행되지/);
 assert.equal(loader.covers('BINANCE','BIRBUSDT',start,start+3600),false);
 const api=D.create({fundingPage:async()=>[row],candlePage:async()=>[bar(start)]});
 await assert.rejects(api.loadBacktestDataset('BIRBUSDT',{exchange:'BINANCE',intervals:['1m'],startTime:start,endTime:start+3600}),/반복|진행되지/);
});
test('full chart collection uses the same exclusive next-page boundary instead of stopping on a repeated final row',async()=>{
 const f=fixture('BIRBUSDT',[0,1,2,3].map(i=>start+i*3600),{size:2}),nodes=new Map();let candleCalls=0;
 const ctx={AbortController,Date:{now:()=>f.now},FundingEngine:F,TimeframeEngine:T,ChartData:{mergeHistory:(...groups)=>F.merge(...groups)},duration:T.seconds,
  run:1,all:[],rates:[],busy:true,historyState:{},fundingSession:null,chartDateFocus:null,changingWindow:false,unmappedFunding:[],globalThis:{},
  uniqueSorted:rows=>F.merge(rows),fundingPage:f.page,candlePage:async()=>++candleCalls===1?[bar(start),bar(start+86400)]:[],pause:async()=>{},
  chart:{timeScale:()=>({getVisibleLogicalRange:()=>null})},captureChartView:()=>null,restoreChartView(){},rebuild(){},renderWindow(){},settleChartView:async()=>true,
  status(){},date:String,fetchOfficialCycle:async()=>null,fetchAllCycles:async()=>[],renderFundingBoard(){},calculateStrategySignals(){},
  $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function collectMarketHistory('),source.indexOf("$('searchBtn').onclick")),ctx);
 await ctx.collectMarketHistory({ex:'BINANCE',symbol:'BIRBUSDT',int:'1d',id:1,signal:new AbortController().signal});
 assert.deepEqual(Array.from(ctx.rates),f.expected);assert.equal(f.calls.length,3);assert.doesNotMatch(nodes.get('coverage').textContent,/반복|진행 불가/);
});
test('visible chart integration fills funding and clears its loading state without showing the reported error',async()=>{
 const f=fixture('BIRBUSDT',[0,1,2,3].map(i=>start+i*3600),{size:2}),nodes=new Map(),errors=[];
 const ctx={Date,AbortSignal,AbortController,FundingEngine:F,TimeframeEngine:T,FundingHistory:{...H,create:options=>H.create({...options,now:()=>f.now,pause:async()=>{}})},
  loadedMarket:{ex:'BINANCE',symbol:'BIRBUSDT',int:'1d',id:1},run:1,historyState:{id:1,pending:new Set()},navigationController:new AbortController(),all:[bar(start)],rates:[],
  $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},fundingPage:f.page,sameRates:(a,b)=>JSON.stringify(a)===JSON.stringify(b),rebuild(){},renderFundingStudies(){},status:message=>errors.push(message),fundingError:error=>error.message};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('async function requestVisibleFunding('),source.indexOf('function scheduleVisibleHistory(')),ctx);
 await ctx.requestVisibleFunding({from:0,to:0});assert.equal(errors.length,0);assert.deepEqual(Array.from(ctx.rates),f.expected);
 assert.equal(nodes.get('historyLoading').hidden,true);assert.equal(ctx.historyState.fundingPending,false);
});
