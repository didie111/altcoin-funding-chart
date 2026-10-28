'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const D=require('../drawing-engine.js'),Manager=require('../chart-drawings.js'),R=require('../drawing-renderer.js'),F=require('../funding.js'),Rank=require('../funding-rank.js'),Overlay=require('../backtest-overlay.js'),T=require('../timeframes.js'),M=require('../dashboard-model.js');
const disk=()=>{const values=new Map();return {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};};
const line=(id,tool='vline')=>({id,tool,pane:'price',points:[{time:1793000000,price:100}],color:'#60a5fa',width:2});
test('a stale second chart cannot erase a vertical drawing when editing its earlier horizontal line',()=>{
 const storage=disk(),first=new D.Store(storage),second=new D.Store(storage);first.switchMarket('BYBIT:BTCUSDT');first.add(line('horizontal','hline'));second.switchMarket('BYBIT:BTCUSDT');
 first.add(line('vertical'));second.update('horizontal',{color:'#ef4444'});first.persist();
 const reload=new D.Store(storage);reload.switchMarket('BYBIT:BTCUSDT');assert.deepEqual(reload.state.items.map(v=>v.id),['horizontal','vertical']);assert.equal(reload.state.items[0].color,'#ef4444');
 second.undo();second.redo();first.sync();assert.equal(first.state.items[0].color,'#ef4444');assert.equal(first.state.items[1].id,'vertical');first.undo();second.sync();assert.deepEqual(second.state.items.map(v=>v.id),['horizontal']);second.update('horizontal',{width:4});first.redo();second.sync();assert.equal(second.state.items[0].width,4);assert.equal(second.state.items[1].id,'vertical');
});
test('all vertical drawing families preserve exact dates through reload, another market and independent field edits',()=>{
 const storage=disk(),a=new D.Store(storage);a.switchMarket('BITGET:BTCUSDT');for(const tool of ['vline','crossline','fibTime'])a.add({...line(tool,tool),points:tool==='fibTime'?[{time:1793000000,price:1},{time:1793000300,price:2}]:line(tool).points});
 const b=new D.Store(storage);b.switchMarket('BITGET:BTCUSDT');a.update('vline',{color:'#ef4444'});b.update('vline',{width:5});a.sync();assert.equal(a.state.items[0].color,'#ef4444');assert.equal(a.state.items[0].width,5);
 a.switchMarket('MEXC:BTCUSDT');a.add(line('different'));a.switchMarket('BITGET:BTCUSDT');assert.deepEqual(a.state.items.map(v=>v.id),['vline','crossline','fibTime']);assert.equal(a.state.items[0].points[0].time,1793000000);
});
test('time-only drawings remain projectable when a restored price scale cannot project their old anchor price',()=>{
 const m=Object.create(Manager.prototype),pane={height:300,series:{priceToCoordinate:()=>null}};m.api={data:()=>[{time:100},{time:160}],step:()=>60,windowStart:()=>0,chart:{timeScale:()=>({logicalToCoordinate:i=>100+i*10})}};
 for(const tool of ['vline','fibTime']){const p=m.project({time:160,price:0},pane,tool);assert.deepEqual(p,{x:110,y:150});const item={...line(tool,tool),points:tool==='fibTime'?[{time:100,price:0},{time:160,price:0}]:[{time:160,price:0}]};assert.ok(R.geometry(item,{width:500,height:300,project:a=>m.project(a,pane,tool)}).svg);}
 const projected=m.project({time:160,price:0},pane,'crossline');assert.equal(projected.x,110);assert.ok(projected.y<0);assert.equal(m.project({time:160,price:0},pane,'trend'),null);
});
test('vertical date tools do not acquire a misleading price label when selected',()=>{
 const pane={id:'price',top:0,bottom:300,height:300},item=line('vertical'),geometry={points:[{x:50,y:100}]},svg=R.axisOverlay([{item,pane,geometry,selected:true,formatPrice:String}],{width:500,totalWidth:600,height:330,plotBottom:300,formatTime:String}).svg;
 assert.match(svg,/data-drawing-axis="time"/);assert.doesNotMatch(svg,/data-drawing-axis="price"/);
});
function tradeUI(){
 const source=fs.readFileSync(require.resolve('../backtest-ui.js'),'utf8'),report={innerHTML:''},jumps=[],overlays=[],market={ex:'BYBIT',symbol:'PUFFERUSDT',int:'3m'},trade={id:1,entryTime:1793000010,exitTime:1793000590,entries:[],dcaSteps:1,splitTarget:3,netPnl:1};
 const ctx={M,E:require('../backtest-engine.js'),single:{meta:{market,startTime:trade.entryTime,endTime:trade.exitTime,config:{}},result:{summary:{},trades:[trade]}},tradeJumpTimeframe:null,view:'trades',page:0,comparison:null,optimized:null,$:()=>report,number:String,money:String,stamp:String,escape:String,updateResultContext(){},requestChartView(){},chartWorkspace:{setBacktest:v=>overlays.push(v)},onJump:async(m,t)=>jumps.push({market:m,time:t}),setStatus(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  function table('),source.indexOf('  function provenance('))+source.slice(source.indexOf('  function render(){'),source.indexOf("  $('btExportCsv').onclick")),ctx);return {ctx,report,jumps,overlays,market};
}
test('the actual trade table defaults to its backtest frame and retains a selected viewing frame across pages',()=>{
 const h=tradeUI();h.ctx.render();assert.match(h.report.innerHTML,/<option value="3m" selected>3분 · 테스트 주기/);for(const tf of Object.keys(M.labels))assert.match(h.report.innerHTML,new RegExp('<option value="'+tf+'"'));
 h.report.onchange({target:{id:'btTradeJumpTimeframe',value:'1M'}});h.ctx.render();assert.match(h.report.innerHTML,/<option value="1M" selected>/);assert.equal(h.ctx.single.meta.market.int,'3m');
});
test('trade entry and exit buttons pass the chosen frame and exact recorded time without changing the tested strategy',async()=>{
 const h=tradeUI(),click=point=>h.report.onclick({target:{closest:()=>({dataset:{jump:'0',point}})}});await click('entry');assert.equal(h.jumps[0].market.int,'3m');
 for(const tf of Object.keys(M.labels)){h.report.onchange({target:{id:'btTradeJumpTimeframe',value:tf}});await click('entry');await click('exit');assert.equal(h.jumps.at(-2).market.int,tf);assert.equal(h.jumps.at(-2).time,1793000010);assert.equal(h.jumps.at(-1).time,1793000590);assert.equal(h.overlays.at(-1).market,h.market);assert.equal(h.overlays.at(-1).displayMarket.int,tf);}
 assert.equal(h.market.int,'3m');h.report.onchange({target:{id:'btTradeJumpTimeframe',value:'invalid'}});assert.equal(h.ctx.tradeJumpTimeframe,'1M');
});
test('intentional inspection on another timeframe is labelled as viewing the original result',()=>{
 const source=fs.readFileSync(require.resolve('../backtest-ui.js'),'utf8'),market={ex:'BYBIT',symbol:'PUFFERUSDT',int:'3m'},viewMarket={...market,int:'1m'},ctx={view:'trades',single:{meta:{market,config:{},coverage:{},fundingCoverage:{},cell:1},inspection:{market:viewMarket,cell:2}},comparison:null,optimized:null,M,target:()=>viewMarket,follow:true,lastFailure:false,busy:false,chartWorkspace:{activeCell:()=>2},resultContext:{},modeNotice:{},dataNotice:{}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function updateResultContext()'),source.indexOf('  function updateTarget()')),ctx);ctx.updateResultContext();assert.equal(ctx.resultContext.hidden,false);assert.match(ctx.resultContext.textContent,/3분 백테스트 결과를 1분 차트에서 확인 중/);assert.doesNotMatch(ctx.resultContext.textContent,/이전 결과/);
 ctx.chartWorkspace.activeCell=()=>1;ctx.updateResultContext();assert.match(ctx.resultContext.textContent,/이전 결과/);
});
test('a chosen viewing frame maps original fills to actual calendar bars and keeps other coins isolated',()=>{
 const time=T.parseKst('2026-10-20','09:03'),result={market:{ex:'BYBIT',symbol:'PUFFERUSDT',int:'3m'},displayMarket:{ex:'BYBIT',symbol:'PUFFERUSDT',int:'1M'},signals:[{type:'BUY_INITIAL',time}],trades:[]},bar={time:T.start(time,'1M')};
 assert.equal(Overlay.matches(result,{ex:'BYBIT',symbol:'PUFFERUSDT',int:'1M'}),true);assert.equal(Overlay.matches(result,{ex:'BYBIT',symbol:'BTCUSDT',int:'1M'}),false);assert.equal(Overlay.markers(result,[bar])[0].time,bar.time);
 result.displayMarket.symbol='BTCUSDT';assert.equal(Overlay.matches(result,{ex:'BYBIT',symbol:'PUFFERUSDT',int:'3m'}),true);
});
const quotes=[{exchange:'BYBIT',symbol:'ONEUSDT',baseSymbol:'ONE',rate:-.7,intervalHours:1},{exchange:'BITGET',symbol:'TWOUSDT',baseSymbol:'TWO',rate:.1,intervalHours:1},{exchange:'BINANCE',symbol:'FOURUSDT',baseSymbol:'FOUR',rate:-.8,intervalHours:4},{exchange:'MEXC',symbol:'UNKNOWN_USDT',baseSymbol:'UNKNOWN',rate:-1,intervalHours:null}];
test('the browser loads the ranking module after the existing lexical FundingEngine script',()=>{
 const ctx={};vm.createContext(ctx);for(const name of ['funding.js','funding-rank.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+name),'utf8'),ctx);assert.equal(ctx.FundingRank.settings().mode,'rate');assert.match(ctx.FundingRank.cycleBadge(4),/#f59e0b/);
});
test('cycle-only scanning ignores the stored rate condition while combined scanning requires both',()=>{
 assert.deepEqual(Rank.filter(quotes,{mode:'cycle',hours:1,rate:-.5}).map(r=>r.symbol),['ONEUSDT','TWOUSDT']);assert.deepEqual(Rank.filter(quotes,{mode:'both',hours:1,rate:-.5}).map(r=>r.symbol),['ONEUSDT']);assert.deepEqual(Rank.filter(quotes,{mode:'rate',hours:1,rate:-.5}).map(r=>r.symbol),['UNKNOWN_USDT','FOURUSDT','ONEUSDT']);
 assert.deepEqual(Rank.filter(quotes,{mode:'both',hours:1,rate:.05,operator:'gte',exchange:'BITGET',query:'two'}).map(r=>r.symbol),['TWOUSDT']);assert.equal(Rank.filter(quotes,{mode:'cycle',hours:8}).length,0);assert.equal(Rank.filter(quotes,{mode:'rate',rate:0}).length,3);
});
test('cycle numbers use the same named colors as the main chart and unknown hours never become eight',()=>{
 for(const [hours,color]of [[1,'#ef4444'],[2,'#a78bfa'],[4,'#f59e0b'],[8,'#3b82f6']]){assert.equal(F.cycleColor(hours),color);assert.match(Rank.cycleBadge(hours,'official-current'),new RegExp(color));}
 assert.match(Rank.cycleBadge(null),/미확인/);assert.doesNotMatch(Rank.cycleBadge(null),/<strong>8/);assert.match(Rank.cycleBadge(1,'observed'),/관측/);assert.doesNotMatch(Rank.card({...quotes[0],baseSymbol:'<script>',markPrice:1},1,0,String),/<script>/);
});
function scanAPI({binanceFailure=false}={}){
 const calls=[],api={json:async(url,params={})=>{calls.push({url,params});if(url.endsWith('/premiumIndex')&&url.includes('binance'))return [{symbol:'BTCUSDT',lastFundingRate:'-.001',markPrice:'100',nextFundingTime:1793000000000},{symbol:'ONEUSDT',lastFundingRate:'-.007',markPrice:'1'}];
  if(url.endsWith('/fundingInfo')){if(binanceFailure)throw Error('unavailable');return [{symbol:'ONEUSDT',fundingIntervalHours:1}];}
  if(url.includes('bybit')&&url.endsWith('/tickers'))return {result:{list:[{symbol:'BYBUSDT',fundingRate:'-.006',markPrice:'2'},{symbol:'TICKUSDT',fundingRate:'.001',fundingIntervalHour:'2'},{symbol:'DELIVERYUSDT',fundingRate:''}]}};
  if(url.includes('instruments-info'))return {result:{list:[{symbol:params.cursor?'TICKUSDT':'BYBUSDT',fundingInterval:params.cursor?480:240}],nextPageCursor:params.cursor?'':'next'}};
  if(url.includes('bitget')&&url.endsWith('/tickers'))return {data:[{symbol:'BGUSDT',fundingRate:'-.002',markPrice:'2'}]};if(url.includes('current-fund-rate'))return {data:[{symbol:'BGUSDT',fundingRate:'-.003',fundingRateInterval:'4',nextUpdate:'1793000000000'}]};
  if(url.includes('bingx'))return {data:[{symbol:'BX-USDT',lastFundingRate:'-.004',markPrice:'2',nextFundingTime:1793000000000}]};if(url.includes('mexc'))return {data:[{symbol:'MX_USDT',fundingRate:'-.005',fairPrice:2}]};throw Error('unexpected '+url);}};return {api,calls};
}
test('bulk scanning joins official per-symbol hours, follows Bybit cursors and leaves unsupported cycles unknown',async()=>{
 const h=scanAPI(),progress=[],rows=await Rank.scan({api:h.api,onProgress:p=>progress.push(p)}),bySymbol=new Map(rows.map(r=>[r.symbol,r]));
 assert.equal(bySymbol.get('ONEUSDT').intervalHours,1);assert.equal(bySymbol.get('BTCUSDT').intervalHours,8);assert.equal(bySymbol.get('BYBUSDT').intervalHours,4);assert.equal(bySymbol.get('TICKUSDT').intervalHours,2);assert.equal(bySymbol.get('BGUSDT').intervalHours,4);assert.equal(bySymbol.get('BGUSDT').rate,-.3);assert.equal(bySymbol.get('BGUSDT').nextTime,1793000000);assert.equal(bySymbol.get('BX-USDT').intervalHours,null);assert.equal(bySymbol.get('MX_USDT').intervalHours,null);assert.equal(bySymbol.has('DELIVERYUSDT'),false);assert.equal(progress.length,5);assert.equal(h.calls.filter(c=>c.url.endsWith('instruments-info')).length,2);assert.deepEqual(rows.failures,[]);
});
test('a failed Binance interval lookup does not assign a fabricated default period',async()=>{
 const rows=await Rank.scan({api:scanAPI({binanceFailure:true}).api});assert.equal(rows.find(r=>r.symbol==='BTCUSDT').intervalHours,null);
});
test('individual lookups use actual MEXC cycles and repeated BingX settlements, preserve nulls and cache results',async()=>{
 const end=Date.UTC(2026,9,28,12),rows=[{exchange:'MEXC',symbol:'TESTMX_USDT',intervalHours:null},{exchange:'BINGX',symbol:'TESTBX-USDT',intervalHours:null,nextTime:end/1000+3600}];let calls=0;
 const api={json:async url=>{calls++;return url.includes('mexc')?{data:{symbol:'TESTMX_USDT',fundingRate:'-.001',collectCycle:2,nextSettleTime:end+3600000}}:{data:[2,1,0].map(i=>({symbol:'TESTBX-USDT',fundingTime:end-i*3600000,fundingRate:'-.001'}))};}};
 await Rank.enrich(rows,{api,now:()=>end});assert.equal(rows[0].intervalHours,2);assert.equal(rows[0].intervalSource,'official-current');assert.equal(rows[1].intervalHours,1);assert.equal(rows[1].intervalSource,'observed');const copy=rows.map(r=>({...r,intervalHours:null}));await Rank.enrich(copy,{api,now:()=>end+1000});assert.equal(calls,2);assert.equal(copy[0].intervalHours,2);
});
test('cancellation stops scanning rather than reporting a partial completed scan',async()=>{
 const abort=new AbortController();abort.abort();await assert.rejects(Rank.scan({api:scanAPI().api,signal:abort.signal}),{name:'AbortError'});await assert.rejects(Rank.enrich([{exchange:'MEXC',symbol:'CANCEL_USDT',intervalHours:null}],{api:scanAPI().api,signal:abort.signal}),{name:'AbortError'});
});
