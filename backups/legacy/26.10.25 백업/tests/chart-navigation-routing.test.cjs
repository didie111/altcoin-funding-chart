'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),frames=require('../timeframes.js');
test('date position guides expire after five seconds and a later move cancels the earlier timer',()=>{
 let clock=1000;const timers=[],context={selectedGuideVisible:false,selectedGuideTime:null,selectedGuideKind:'signal',selectedGuideDeadline:0,selectedGuideTimer:null,selectedCountdownTimer:null,
  performance:{now:()=>clock},guideCountdown:{style:{},setAttribute(){}},schedule(){},
  setTimeout:(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.stopped=true;},
  setInterval:()=>({}),clearInterval(){}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function updateGuideCountdown()'),source.indexOf("const ctx=overlay.getContext('2d');")),context);
 context.showLocationGuide(1234,'date');assert.equal(context.selectedGuideTime,1234);assert.equal(context.selectedGuideVisible,true);assert.equal(timers[0].delay,5000);assert.equal(context.guideCountdown.textContent,'이동 위치 · 5초');
 clock+=2000;context.updateGuideCountdown();assert.equal(context.guideCountdown.textContent,'이동 위치 · 3초');
 context.showLocationGuide(5678,'date');assert.equal(timers[0].stopped,true);assert.equal(context.selectedGuideTime,5678);
 clock+=5000;timers[1].callback();assert.equal(context.selectedGuideVisible,false);assert.equal(context.selectedGuideTime,null);assert.equal(context.guideCountdown.hidden,true);
});
for(const cached of [true,false])test((cached?'cached':'newly fetched')+' date moves mark the actual candle that contains the requested timestamp',async()=>{
 const time=frames.parseKst('2026-09-24','09:30'),row={time,open:10,high:11,low:9,close:10,volume:1},guides=[],renders=[];
 const context={Date,AbortSignal,AbortController,DOMException,duration:frames.seconds,loadedMarket:{ex:'BITGET',symbol:'BTCUSDT',int:'1m',id:1},run:1,
  navigationController:new AbortController(),chart:{timeScale:()=>({getVisibleLogicalRange:()=>({from:0,to:100})})},TimeframeEngine:frames,FundingEngine:{merge:(_,rows)=>rows},
  all:cached?[row]:[],rates:[],candlePage:async()=>[row],fundingPage:async()=>[],uniqueSorted:rows=>frames.sorted(rows),rebuild(){},
  clearRuler(){},showLocationGuide:(...args)=>guides.push(args),renderWindow:(...args)=>renders.push(args),date:String,status(){},$:()=>({selectedOptions:[{text:'1분'}]})};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function jumpToChartDate('),source.indexOf('async function loadData(')),context);
 await context.jumpToChartDate(time+30,new AbortController().signal,'1m');assert.deepEqual(guides,[[time,'date']]);assert.equal(renders[0][0],0);assert.equal(context.chartDateFocus.time,time+30);
});
function scannerHarness(){
 const nodes=new Map(),routed=[];const make=()=>({children:[],style:{},classList:{add(){},remove(){}},appendChild(node){this.children.push(node);}});
 const node=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};node('symbolInput').value='BTCUSDT';node('exchangeSelect').value='BITGET';node('scannerThreshold').value='40';
 const context={$:node,document:{createElement:make,querySelectorAll:()=>[]},loadedMarket:{ex:'BITGET',symbol:'BTCUSDT',int:'1h'},
  ChartWorkspace:{selectActive:(...args)=>{routed.push(args);return true;}},ScannerEngine:{formatPrice:String,formatMoney:String},
  scannedCoins:[{baseSymbol:'NIL',symbol:'NILUSDT',changePct:50,startPrice:1,currentPrice:2,minLow:.5,maxHigh:3,maxGain:500,quoteVolume:1000000}],currentFilterDir:'all',surgeHighlight:{active:false},
  fundingRankList:[{exchange:'BINGX',baseSymbol:'NIL',symbol:'NIL-USDT',rate:-1,markPrice:1,nextTime:1234,intervalHours:1}],fundingRankExchange:'ALL',fundingRankThreshFilter:'all',fundingRankSearchQuery:'',fundingRankSort:'negative',status(){}};
 vm.createContext(context);
 const scanner=source.slice(source.indexOf('function renderScannerResults()'),source.indexOf('// [거래소별 실시간 펀딩비 순위'));
 const ranking=source.slice(source.indexOf('function renderFundingRankList()'),source.indexOf('const chartViewActions='));
 vm.runInContext(scanner+ranking,context);return {context,node,routed};
}
test('scanner card clicks route the coin and its highlight without changing the first chart fields',()=>{
 const h=scannerHarness();h.context.renderScannerResults();h.node('scannerListContainer').children[0].onclick();
 assert.equal(h.routed[0][0].symbol,'NILUSDT');assert.equal(h.routed[0][1].kind,'surge');assert.equal(h.node('symbolInput').value,'BTCUSDT');assert.equal(h.node('exchangeSelect').value,'BITGET');
});
test('funding-rank card clicks route the detected exchange as well as the coin to the selected chart',()=>{
 const h=scannerHarness();h.context.renderFundingRankList();h.node('fundingRankListContainer').children[0].onclick();
 assert.equal(h.routed[0][0].symbol,'NIL-USDT');assert.equal(h.routed[0][0].ex,'BINGX');assert.equal(h.node('symbolInput').value,'BTCUSDT');assert.equal(h.node('exchangeSelect').value,'BITGET');
});
test('funding and strategy signal clicks route their timestamp before changing any first-chart state',()=>{
 const routed=[],context={loadedMarket:{ex:'BITGET',symbol:'BTCUSDT',int:'1h'},chartDateFocus:{time:1234},
  ChartWorkspace:{selectActive:(...args)=>{routed.push(args);return true;}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function focusSignal('),source.indexOf('function renderSignalMarkers(')),context);
 const signal={time:5678,eventTime:5690,rate:-1};context.focusSignal(signal,null);
 assert.equal(routed[0][0].symbol,'BTCUSDT');assert.equal(routed[0][1].signal,signal);assert.equal(context.chartDateFocus.time,1234);
});
