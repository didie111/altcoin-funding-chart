'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {bindDateNavigation,dateNavigationRequest}=require('../date-navigation.js'),frames=require('../timeframes.js');
const target=frames.parseKst('2026-09-24','09:30');
test('a date request keeps the selected minute timeframe and Korean date together',()=>{
 for(const interval of Object.keys(frames.seconds))assert.deepEqual(dateNavigationRequest('2026-09-24','09:30',interval,target+60),{time:target,interval});
 assert.throws(()=>dateNavigationRequest('2026-09-24','09:30','1m',target-1),/현재 시각/);
 assert.throws(()=>dateNavigationRequest('2026-09-24','09:30','invalid',target+1),/타임프레임/);
 assert.throws(()=>dateNavigationRequest('2026-09-31','09:30','1m',target+864000),/날짜/);
});
function dialogHarness(jump){
 const nodes=new Map();
 function element(){return {value:'',textContent:'',disabled:false,open:false,children:[],listeners:{},setAttribute(){},focus(){},append(node){this.children.push(node);},replaceChildren(...nodes){this.children=nodes;},addEventListener(type,callback){this.listeners[type]=callback;},showModal(){this.open=true;},close(){this.open=false;this.listeners.close?.();}};}
 const node=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 node('intervalSelect').options=Object.keys(frames.seconds).map(value=>({value,cloneNode(){return {...this};}}));node('intervalSelect').value='1h';
 const document={getElementById:node,createElement:element,addEventListener(){},querySelector:()=>null};
 const previous=global.document;global.document=document;
 const api=bindDateNavigation({currentTime:()=>target,currentTimeframe:()=>node('intervalSelect').value,jump});
 return {api,node,restore:()=>{global.document=previous;}};
}
test('the calendar opens at the chart timeframe and submits its own selected timeframe',async()=>{
 const calls=[],h=dialogHarness(async(...args)=>calls.push(args));
 try{
  h.api.open();assert.equal(h.node('dateNavigationInterval').value,'1h');
  assert.deepEqual(h.node('dateNavigationInterval').children.map(o=>o.value),Object.keys(frames.seconds));
  h.node('dateNavigationInterval').value='1m';
  await h.node('dateNavigationForm').onsubmit({preventDefault(){}});
  assert.equal(calls[0][0],target);assert.equal(calls[0][2],'1m');assert.equal(h.node('dateNavigationDialog').open,false);
 }finally{h.restore();}
});
test('closing a pending date request aborts it and stale completion leaves a newly opened panel alone',async()=>{
 let resolve,signal;const h=dialogHarness((_,abort)=>{signal=abort;return new Promise(done=>resolve=done);});
 try{
  h.api.open();const pending=h.node('dateNavigationForm').onsubmit({preventDefault(){}});
  h.api.cancel();assert.equal(signal.aborted,true);h.api.open();resolve();await pending;
  assert.equal(h.node('dateNavigationDialog').open,true);assert.equal(h.node('dateNavigationSubmit').disabled,false);
 }finally{h.restore();}
});
test('unavailable date records keep the panel open with a usable error',async()=>{
 const h=dialogHarness(async()=>{throw Error('해당 날짜의 1분봉 기록을 거래소가 제공하지 않습니다.');});
 try{h.api.open();await h.node('dateNavigationForm').onsubmit({preventDefault(){}});assert.equal(h.node('dateNavigationDialog').open,true);assert.match(h.node('dateNavigationMessage').textContent,/1분봉/);assert.equal(h.node('dateNavigationSubmit').disabled,false);}finally{h.restore();}
});
const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
test('switching timeframe from the date panel carries the exact timestamp into the new market load',async()=>{
 const calls=[],signal=new AbortController().signal,context={duration:frames.seconds,loadedMarket:{int:'1h'},loadData:async options=>calls.push(options)};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('async function jumpToChartDate('),app.indexOf('async function loadData(')),context);
 await context.jumpToChartDate(target,signal,'1m');assert.equal(calls.length,1);assert.equal(calls[0].dateTarget,target);assert.equal(calls[0].timeframe,'1m');assert.equal(calls[0].signal,signal);
});
test('a timeframe change focuses the requested candles before starting background history and keeps the date request alive',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',selectedOptions:[{text:'1분봉'}]});return nodes.get(id);};
 node('symbolInput').value='BTCUSDT';node('exchangeSelect').value='BITGET';node('intervalSelect').value='1h';
 let focused,collecting=false,cancelled=false;const oldController=new AbortController(),dateSignal=new AbortController().signal;
 const context={AbortController,AbortSignal,DOMException,Map,Set,Uint8Array,Number,globalThis:{},$:node,duration:frames.seconds,thresholds:()=>{},
  chartDateFocus:null,clearLocationGuide(){},dateNavigation:{cancel:()=>{cancelled=true;}},navigationController:new AbortController(),controller:oldController,run:1,
  FundingEngine:{contract:(_,s)=>s},chartSymbolLabel:{},paneScaleSeries:[],clearRuler(){},mapped:new Map(),
  candles:{setData(){}},studyPanels:{clearData(){}},cycleMarkers:null,volume:null,funding:null,settlementCycle:null,markers:{setMarkers(){}},
  cycleValues:new Map(),cycleCaption:{},cycleBadge:{},renderList(){},status(){},startFundingUpdates(){},
  jumpToChartDate:async(time,signal,interval)=>{assert.equal(interval,'1m');assert.equal(signal.aborted,false);focused=time;},
  collectMarketHistory:()=>{assert.equal(focused,target);collecting=true;return new Promise(()=>{});}};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('async function loadData('),app.indexOf('async function collectMarketHistory(')),context);
 await context.loadData({dateTarget:target,timeframe:'1m',signal:dateSignal});
 assert.equal(node('intervalSelect').value,'1m');assert.equal(context.loadedMarket.int,'1m');assert.equal(context.loadedMarket.symbol,'BTCUSDT');
 assert.equal(focused,target);assert.equal(collecting,true);assert.equal(cancelled,false);assert.equal(oldController.signal.aborted,true);assert.equal(dateSignal.aborted,false);
});
test('an old history response cannot replace candles after the user changes timeframe again',async()=>{
 let resolve;const untouched=[{time:target,close:20}],context={Date,run:1,historyState:{},all:untouched,uniqueSorted:rows=>rows,
  candlePage:()=>new Promise(done=>resolve=done)};
 vm.createContext(context);vm.runInContext(app.slice(app.indexOf('async function collectMarketHistory('),app.indexOf("$('searchBtn').onclick")),context);
 const pending=context.collectMarketHistory({ex:'BITGET',symbol:'BTCUSDT',int:'1m',id:1,signal:new AbortController().signal});
 context.run=2;resolve([{time:target,close:1}]);await pending;assert.equal(context.all,untouched);
});
