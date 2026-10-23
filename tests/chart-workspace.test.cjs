'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Shared=require('../market-shared.js'),Catalog=require('../market-catalog.js'),Workspace=require('../chart-workspace.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('four chart subscribers share one request and cancel independently',async()=>{
 let resolve,calls=0,producerSignal;const broker=Shared.create(),first=new AbortController();
 const producer=signal=>{calls++;producerSignal=signal;return new Promise(done=>{resolve=done;});};
 const pending=[broker.request('same',producer,first.signal),...Array.from({length:3},()=>broker.request('same',producer))];
 const canceled=assert.rejects(pending[0],{name:'AbortError'});await tick();first.abort();await canceled;assert.equal(producerSignal.aborted,false);
 const value={rows:[{time:1,close:4}]};Object.defineProperty(value,'__marketFetchedAt',{value:1234});resolve(value);
 const results=await Promise.all(pending.slice(1));assert.equal(calls,1);results[0].rows[0].close=999;assert.equal(results[1].rows[0].close,4);assert.equal(results[1].__marketFetchedAt,1234);
});
test('closing all consumers aborts the request and a later chart can retry',async()=>{
 const broker=Shared.create(),abort=new AbortController();let upstream;
 const pending=broker.request('closed',signal=>{upstream=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},abort.signal);
 const canceled=assert.rejects(pending,{name:'AbortError'});await tick();abort.abort();await canceled;assert.equal(upstream.aborted,true);
 assert.deepEqual(await broker.request('closed',async()=>({ok:true})),{ok:true});
});
test('shared cache expires, failed requests are retriable, and BingX requests are paced across charts',async()=>{
 let clock=10000,calls=0;const broker=Shared.create({now:()=>clock,wait:async ms=>{clock+=ms;}}),producer=async()=>({n:++calls});
 assert.equal((await broker.request('cached',producer,undefined,100)).n,1);assert.equal((await broker.request('cached',producer,undefined,100)).n,1);clock+=101;assert.equal((await broker.request('cached',producer,undefined,100)).n,2);
 await assert.rejects(broker.request('fail',async()=>{throw Error('failed');}));assert.equal((await broker.request('fail',producer)).n,3);
 const starts=[];await Promise.all(Array.from({length:4},()=>broker.reserveBingx(new AbortController().signal,()=>{starts.push(clock);return Promise.resolve();})));assert.deepEqual(starts.map((t,i)=>i?t-starts[i-1]:0),[0,1150,1150,1150]);
});
test('catalog follows every Bybit cursor instead of truncating the coin list at 1000',async()=>{
 const calls=[],instrument=s=>({symbol:s,status:'Trading',contractType:'LinearPerpetual',settleCoin:'USDT'});
 const catalog=Catalog.create({json:async(url,params)=>{calls.push(params);if(url.endsWith('tickers'))return {result:{list:[]}};return {result:params.cursor?{list:[instrument('LASTUSDT')],nextPageCursor:''}:{list:Array.from({length:1000},(_,i)=>instrument('COIN'+i+'USDT')),nextPageCursor:'page-2'}};}});
 const result=await catalog.load('BYBIT');assert.equal(result.rows.length,1001);assert.ok(result.rows.some(x=>x.symbol==='LASTUSDT'));assert.ok(calls.some(x=>x.cursor==='page-2'));
});
test('catalog uses only active USDT perpetual contracts and preserves unavailable prices',()=>{
 assert.equal(Catalog.normalize('BINANCE',[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL'},{symbol:'OLDUSDT',status:'BREAK',contractType:'PERPETUAL'},{symbol:'ETHUSDT',status:'TRADING',contractType:'CURRENT_QUARTER'}],[]).length,1);
 const bybit=Catalog.normalize('BYBIT',[{symbol:'NILUSDT',status:'Trading',contractType:'LinearPerpetual',settleCoin:'USDT'}],[{symbol:'NILUSDT',lastPrice:'0.08',price24hPcnt:'-.05',turnover24h:'1200'}])[0];assert.equal(bybit.change,-5);assert.equal(bybit.price,.08);
 const mexc=Catalog.normalize('MEXC',[{symbol:'NIL_USDT',state:0},{symbol:'OLD_USDT',state:1}],[{symbol:'NIL_USDT',lastPrice:null,riseFallRate:null}]);assert.equal(mexc.length,1);assert.equal(mexc[0].price,null);assert.equal(mexc[0].change,null);
 assert.equal(Catalog.normalize('BINGX',[{symbol:'NIL-USDT',status:1},{symbol:'OLD-USDT',status:0}],[]).length,1);
 assert.equal(Catalog.normalize('OKX',[{instId:'BTC-USDT-SWAP',state:'live',settleCcy:'USDT'},{instId:'BTC-USD-SWAP',state:'live',settleCcy:'BTC'}],[]).length,1);
});
test('thousands of coins are searchable and sortable while visible rows stay bounded',()=>{
 const rows=Array.from({length:20000},(_,i)=>({exchange:'BITGET',base:'COIN'+i,symbol:'COIN'+i+'USDT',volume:i,change:i%80-40}));
 assert.equal(Catalog.filter(rows,'COIN19999')[0].symbol,'COIN19999USDT');assert.equal(Catalog.filter(rows,'',new Set(['BITGET:COIN5USDT']))[0].base,'COIN5');
 for(const top of [0,52000,800000]){const range=Catalog.visibleRange(rows.length,top,420);assert.ok(range.end-range.start<=18);assert.ok(range.start>=0);assert.ok(range.end<=rows.length);}
 assert.equal(Catalog.filter(rows,'',null,'volume',-1)[0].volume,19999);
});
test('a catalog network failure is marked stale without replacing its known contracts',async()=>{
 let fail=false;const catalog=Catalog.create({json:async url=>{if(fail)throw Error('offline');return url.endsWith('contracts')?{data:[{symbol:'BTCUSDT',symbolStatus:'normal'}]}:{data:[]};}});
 const first=await catalog.load('BITGET');fail=true;const cached=await catalog.load('BITGET',undefined,{refresh:true});assert.equal(cached.stale,true);assert.equal(cached.rows[0].symbol,first.rows[0].symbol);
});
test('layout preferences validate all four independent markets and embedded URLs never recurse',()=>{
 const saved=Workspace.preferences({layout:4,markets:[{ex:'BINGX',symbol:'NILUSDT',int:'1m'},{ex:'BITGET',symbol:'BTCUSDT',int:'1h'}]});assert.equal(saved.layout,4);assert.equal(saved.markets[0].int,'1m');assert.equal(saved.markets[1].symbol,'BTCUSDT');
 const url=new URL(Workspace.embedUrl('https://example.test/index.html?old=1#fragment',saved.markets[1],1));assert.equal(url.searchParams.get('chart-embed'),'1');assert.equal(url.searchParams.get('symbol'),'BTCUSDT');assert.equal(url.searchParams.has('old'),false);
 assert.equal(Workspace.market({ex:'INVALID',symbol:'<script>',int:'unknown'}).symbol,'BTCUSDT');assert.equal(Workspace.preferences({layout:500,markets:[]}).layout,1);
});

// Exercise the real controller without mounting chart engines or issuing network requests.
function workspaceHarness({embedded=false,saved={}}={}){
 const ids=new Map(),messages=[],events={},docEvents={},storage=new Map([['funding-chart-layout-v1',JSON.stringify(saved)]]);
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.attrs={};this.dataset={};this.classes=new Set();this.classList={add:name=>this.classes.add(name),toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name);},contains:name=>this.classes.has(name)};if(tag==='iframe')this.contentWindow={postMessage:data=>messages.push({frame:this,data})};}
  set id(value){this._id=value;ids.set(value,this);}get id(){return this._id;}
  set className(value){this.classes=new Set(value.split(' '));}
  append(...nodes){for(const node of nodes){node.remove();node.parent=this;this.children.push(node);}}
  prepend(node){node.remove();node.parent=this;this.children.unshift(node);}
  before(node){this.parent?.append(node);}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}}
  setAttribute(name,value){this.attrs[name]=String(value);}addEventListener(){}
 }
 const doc={body:new Element('body'),documentElement:new Element('html'),createElement:tag=>new Element(tag),getElementById:id=>ids.get(id),addEventListener:(name,fn)=>docEvents[name]=fn,querySelector:()=>null};
 for(const id of ['exchangeSelect','symbolInput','intervalSelect','chartWorkspace','chartTopbar','chartBody','drawingHistoryControls','chartSymbolLabel','host']){const element=new Element('div');element.id=id;doc.body.append(element);}
 ids.get('exchangeSelect').value='BITGET';ids.get('symbolInput').value='SAHARAUSDT';ids.get('intervalSelect').value='1h';
 const parent={postMessage:data=>messages.push({data})},win={document:doc,location:new URL('https://example.test/'+(embedded?'?chart-embed=1&cell=2':'')),parent:embedded?parent:null,localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},addEventListener:(name,fn)=>events[name]=fn,SymbolPicker:{bind:()=>({open(){}})},MarketCatalog:{create:()=>({})}};
 if(!embedded)win.parent=win;
 const calls={schedule:0,dispose:0,split:0,fullscreen:[],market:[]},controller=Workspace.create(win);
 controller.bind({workspace:ids.get('chartWorkspace'),host:ids.get('host'),symbolButton:ids.get('chartSymbolLabel'),getMarket:()=>({ex:'BITGET',symbol:'SAHARAUSDT',int:'1h'}),selectMarket:m=>calls.market.push(m),onSplit:()=>calls.split++,dispose:()=>calls.dispose++,schedule:()=>calls.schedule++,fullscreen:options=>calls.fullscreen.push(options),syncFullscreen(){},jumpDate(){}});
 return {ids,doc,messages,calls,controller,parent,win,storage,frames:()=>ids.get('chartGrid')?.children.filter(x=>x.tagName==='iframe')||[],message:(source,data,origin=win.location.origin)=>events.message({source,origin,data:{channel:'funding-chart-workspace-v1',...data}}),key:event=>docEvents.keydown({target:{closest:()=>null},preventDefault(){this.defaultPrevented=true;},...event})};
}
test('each of the four charts maximizes in place and restores the same chart frames',t=>{
 const h=workspaceHarness();t.after(()=>h.controller.setLayout(1));h.controller.setLayout(4);const frames=h.frames(),grid=h.ids.get('chartGrid');
 assert.equal(frames.length,3);assert.equal(h.ids.get('chartCellMaximize').hidden,false);
 h.ids.get('chartCellMaximize').onclick();assert.equal(grid.classList.contains('cell-maximized'),true);assert.equal(grid.children[0].classList.contains('maximized'),true);
 assert.equal(h.controller.restoreMaximized(),true);
 for(const frame of frames){
  h.message(frame.contentWindow,{type:'maximize'});assert.equal(frame.classList.contains('maximized'),true);assert.equal(grid.children.filter(x=>x.classList.contains('maximized')).length,1);
  assert.equal(h.frames().every((f,i)=>f===frames[i]),true);assert.equal(h.calls.market.length,0);assert.equal(h.calls.dispose,0);
  h.message(frame.contentWindow,{type:'restore'});assert.equal(grid.classList.contains('cell-maximized'),false);
 }
 h.controller.requestFullscreen();assert.equal(grid.children[0].classList.contains('maximized'),true);h.controller.requestFullscreen();assert.equal(grid.classList.contains('cell-maximized'),false);
 h.controller.setLayout(1);assert.equal(h.frames().length,0);assert.equal(h.ids.get('chartCellMaximize').hidden,true);assert.equal(h.controller.requestFullscreen(),false);
});
test('Alt+Enter follows the selected chart while browser fullscreen remains separate',t=>{
 const h=workspaceHarness();t.after(()=>h.controller.setLayout(1));h.controller.setLayout(4);const frame=h.frames()[2];
 h.message(frame.contentWindow,{type:'active'});h.key({key:'Enter',altKey:true});assert.equal(frame.classList.contains('maximized'),true);
 h.ids.get('chartWorkspaceFullscreen').onclick();assert.deepEqual(h.calls.fullscreen,[{workspace:true}]);assert.equal(frame.classList.contains('maximized'),true);
 h.controller.syncWorkspaceFullscreen(true);assert.equal(h.ids.get('chartWorkspaceFullscreen').attrs['aria-pressed'],'true');
 assert.ok(h.messages.some(x=>x.data.type==='layout-state'&&x.data.maximized===3&&x.data.fullscreen));
 h.key({key:'Enter',altKey:true});assert.equal(frame.classList.contains('maximized'),false);
 h.key({key:'Enter',altKey:true,target:{closest:()=>({})}});assert.equal(frame.classList.contains('maximized'),false);
 h.message(frame.contentWindow,{type:'maximize'},'https://untrusted.test');assert.equal(frame.classList.contains('maximized'),false);
 h.message({postMessage(){}},{type:'maximize'});assert.equal(frame.classList.contains('maximized'),false);
});
test('embedded chart requests use the parent and reflect maximize and restore labels',()=>{
 const h=workspaceHarness({embedded:true});assert.ok(h.messages.some(x=>x.data.type==='ready'));
 h.controller.requestFullscreen();assert.equal(h.messages.at(-1).data.type,'maximize');assert.equal(h.calls.fullscreen.length,0);
 h.message(h.parent,{type:'layout-state',maximized:2,fullscreen:true});assert.equal(h.controller.fullscreenState().active,true);assert.match(h.ids.get('chartCellMaximize').attrs['aria-label'],/4분할/);
 assert.equal(h.controller.restoreMaximized(),true);assert.equal(h.messages.at(-1).data.type,'restore');
 h.ids.get('chartWorkspaceFullscreen').onclick();assert.equal(h.messages.at(-1).data.type,'workspace-fullscreen');
 h.message(h.parent,{type:'layout-state',maximized:-1,fullscreen:true});assert.equal(h.controller.exitWorkspaceFullscreen(),true);assert.equal(h.messages.at(-1).data.type,'exit-workspace-fullscreen');
 h.message(h.parent,{type:'layout-state',maximized:-1,fullscreen:false});assert.equal(h.controller.fullscreenState().active,false);assert.equal(h.controller.restoreMaximized(),false);
 assert.equal(h.controller.exitWorkspaceFullscreen(),false);
});
