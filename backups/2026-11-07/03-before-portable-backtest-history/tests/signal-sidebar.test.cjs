'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),Sidebar=require('../signal-sidebar.js');
const market={ex:'BITGET',symbol:'BTCUSDT',int:'1m'};
test('signal snapshots keep settings per chart, filter by symbol and send only bounded visible list records',()=>{
 const strategy=Array.from({length:10000},(_,i)=>({symbol:'BTCUSDT',time:i,type:'RSI_BUY',category:i%2?'rsi':'funding_rsi',price:i+1}));
 const funding=Array.from({length:2000},(_,i)=>({time:i,rate:-1,type:'WARN'}));
 const a=Sidebar.snapshot({market,settings:{rsi:false,fundingRsi:true},filter:'rsi',strategy:[...strategy,{symbol:'ETHUSDT',time:10001,category:'rsi'}],funding,page:1});
 assert.equal(a.settings.rsi,false);assert.equal(a.strategyTotal,10000);assert.equal(a.strategyFiltered,5000);assert.equal(a.strategy.length,80);assert.equal(a.strategy[0].time,9999);assert.equal(a.funding.length,100);assert.equal(a.funding[0].time,1899);assert.equal(a.funding.at(-1).time,1800);assert.ok(JSON.stringify(a).length<40000);
 const b=Sidebar.snapshot({market:{...market,symbol:'ETHUSDT'},settings:{rsi:true,fundingRsi:false}});assert.equal(b.settings.rsi,true);assert.equal(a.settings.rsi,false);assert.equal(b.settings.fundingRsi,false);
});
test('local commands update only their chart model and focus existing signals without reloading a coin',()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),events=[];
 const context={SignalSidebar:Sidebar,signalSettings:Sidebar.settings(),signalFundingPage:0,run:4,busy:false,currentStrategyFilter:'all',loadedMarket:market,all:[{time:10}],windowStart:0,windowEnd:1,strategySignals:[{time:10,eventTime:11,type:'RSI_BUY',symbol:'BTCUSDT'}],signals:[],signalSidebar:{publish(){events.push('publish');}},calculateStrategySignals(){events.push('calculate');},renderSignalMarkers(){events.push('markers');},schedule(){events.push('schedule');},focusSignal(s,el,local){events.push({s,local});},$:()=>{throw Error('settings must not read the shared sidebar DOM');}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function localSignalSnapshot()'),source.indexOf('// [사이드바 탭 전환 관리]')),context);
 context.applySignalCommand({kind:'settings',patch:{rsi:false,fundingRsi:true,fundingThreshold:-1}});assert.equal(context.signalSettings.rsi,false);assert.equal(context.signalSettings.fundingThreshold,-1);assert.ok(events.includes('markers'));
 context.applySignalCommand({kind:'filter',filter:'rsi'});assert.equal(context.currentStrategyFilter,'rsi');
 context.applySignalCommand({kind:'focus',source:'strategy',time:10,eventTime:11,type:'RSI_BUY'});assert.equal(events.find(e=>e.local)?.local,true);
 const count=events.filter(e=>e.local).length;context.applySignalCommand({kind:'focus',source:'strategy',time:999,eventTime:11,type:'RSI_BUY'});assert.equal(events.filter(e=>e.local).length,count);
 assert.equal(context.localSignalSnapshot().market.symbol,'BTCUSDT');
});
