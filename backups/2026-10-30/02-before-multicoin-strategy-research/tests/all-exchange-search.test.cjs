'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Catalog=require('../market-catalog.js'),tick=()=>new Promise(resolve=>setImmediate(resolve));
function fakeAPI({fail=new Set(),hold}={}){
 const calls=[];
 const json=async(url,params)=>{
  const ex=url.includes('binance')?'BINANCE':url.includes('bybit')?'BYBIT':url.includes('bingx')?'BINGX':url.includes('bitget')?'BITGET':url.includes('mexc')?'MEXC':'OKX';calls.push({ex,url});
  if(hold)await hold(ex);if(fail.has(ex))throw Error(ex+' offline');
  if(url.endsWith('exchangeInfo'))return {symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL'}]};
  if(url.includes('binance'))return [];
  if(url.endsWith('instruments-info'))return {result:{list:[{symbol:'BTCUSDT',status:'Trading',contractType:'LinearPerpetual',settleCoin:'USDT'}]}};
  if(url.includes('bybit'))return {result:{list:[]}};
  if(url.endsWith('quote/contracts'))return {data:[{symbol:'BTC-USDT',status:1}]};
  if(url.endsWith('market/contracts'))return {data:[{symbol:'BTCUSDT',symbolStatus:'normal'}]};
  if(url.endsWith('contract/detail'))return {data:[{symbol:'BTC_USDT',state:0}]};
  if(url.endsWith('public/instruments'))return {data:[{instId:'BTC-USDT-SWAP',state:'live',settleCcy:'USDT'}]};
  return {data:[]};
 };
 return {json,calls,fail};
}
test('all-exchange search retains every exchange listing of the same coin and shares per-exchange caches',async()=>{
 const api=fakeAPI(),catalog=Catalog.create(api),result=await catalog.load('ALL');
 assert.deepEqual(result.rows.map(r=>r.exchange).sort(),Catalog.exchanges.map(([id])=>id).sort());assert.ok(result.rows.every(r=>r.symbol==='BTCUSDT'));
 assert.ok(result.exchangeStates.every(s=>s.status==='ok'));const requests=api.calls.length;
 await catalog.load('ALL');await catalog.load('BINANCE');assert.equal(api.calls.length,requests);
});
test('fast exchange results are searchable before a slow provider finishes and errors do not erase them',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),api=fakeAPI({fail:new Set(['BYBIT']),hold:ex=>ex==='MEXC'?gate:undefined}),updates=[],catalog=Catalog.create(api);
 const pending=catalog.load('ALL',undefined,{onUpdate:r=>updates.push(r)});await tick();
 const partial=updates.at(-1);assert.ok(partial.rows.some(r=>r.exchange==='BITGET'));assert.equal(Catalog.filter(partial.rows,'btc').length,4);
 assert.equal(partial.exchangeStates.find(s=>s.exchange==='MEXC').status,'pending');assert.equal(partial.exchangeStates.find(s=>s.exchange==='BYBIT').status,'error');
 release();const result=await pending;assert.equal(result.rows.length,5);assert.equal(result.exchangeStates.find(s=>s.exchange==='MEXC').status,'ok');
});
test('refresh failure is explicit while previous listings remain usable across all exchanges',async()=>{
 const api=fakeAPI(),catalog=Catalog.create(api);await catalog.load('ALL');api.fail.add('BITGET');
 const result=await catalog.load('ALL',undefined,{refresh:true});assert.equal(result.rows.length,6);assert.equal(result.stale,true);
 assert.equal(result.exchangeStates.find(s=>s.exchange==='BITGET').status,'stale');assert.ok(result.rows.some(r=>r.exchange==='BITGET'));
});
test('canceled aggregate requests cannot publish late updates or abort another consumer',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),api=fakeAPI({hold:()=>gate}),catalog=Catalog.create(api),abort=new AbortController(),updates=[];
 const pending=catalog.load('ALL',abort.signal,{onUpdate:r=>updates.push(r)}),other=catalog.load('BITGET');abort.abort();release();
 await assert.rejects(pending,{name:'AbortError'});assert.equal(updates.length,0);assert.equal((await other).rows[0].exchange,'BITGET');
 assert.equal(api.calls.filter(c=>c.url.endsWith('market/contracts')).length,1);
});
test('complete failure reports an error instead of fabricating a default exchange or empty success',async()=>{
 const api=fakeAPI({fail:new Set(Catalog.exchanges.map(([id])=>id))}),catalog=Catalog.create(api);await assert.rejects(catalog.load('ALL'),/모든 거래소/);
});

function harness(load){
 const ids=new Map(),frames=[],storage=new Map(),selections=[];
 class Element{
  constructor(tag,cls=''){this.tagName=tag;this.className=cls;this.children=[];this.style={};this.attrs={};this.events={};this.value='';this.hidden=false;this.scrollTop=0;this.clientHeight=300;this._text='';this.classList={toggle:(key,on)=>{const classes=new Set(this.className.split(' '));on?classes.add(key):classes.delete(key);this.className=[...classes].join(' ');}};}
  set id(value){this._id=value;ids.set(value,this);}get id(){return this._id;}
  set textContent(value){this._text=String(value);this.children=[];}get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  append(...nodes){this.children.push(...nodes.flatMap(n=>n.tagName==='fragment'?n.children:[n]));}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this.attrs[key]=String(value);}addEventListener(name,handler){this.events[name]=handler;}
  focus(){}showModal(){this.open=true;}close(){this.open=false;this.events.close?.();}click(){this.onclick?.();}
  getBoundingClientRect(){return {left:0,right:650,top:0,bottom:500};}
 }
 const doc={hidden:false,createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment')},host=new Element('section');
 const context={document:doc,MarketCatalog:Catalog,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},requestAnimationFrame:fn=>{frames.push(fn);return frames.length;},AbortController,ResizeObserver:class{observe(){}},setInterval:()=>1,clearInterval(){},Intl};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../symbol-picker.js'),'utf8'),context);
 const picker=context.SymbolPicker.bind({host,catalog:{load},onSelect:(value,target)=>selections.push({value:JSON.parse(JSON.stringify(value)),target})});
 const walk=n=>[n,...n.children.flatMap(walk)],find=(cls,text)=>walk(host).find(n=>n.className.split(' ').includes(cls)&&(text===undefined||n.textContent===text));
 return {picker,ids,selections,find,storage,flush(){while(frames.length)frames.shift()();},input(value){const n=ids.get('symbolPickerSearch');n.value=value;n.events.input();},key(key){ids.get('symbolPickerSearch').events.keydown({key,preventDefault(){}});}};
}
const row=(exchange,base='BTC',volume=10)=>({exchange,base,symbol:base+'USDT',price:2,change:1,volume}),result=rows=>({rows,fetchedAt:1000,stale:false});
test('the picker defaults to all exchanges regardless of the chart and routes the clicked exchange to its target cell',async()=>{
 const calls=[],h=harness(async(ex)=>{calls.push(ex);return result([row('BINANCE'),row('BITGET')]);});h.picker.open({ex:'BYBIT',symbol:'ETHUSDT'},3);await tick();h.flush();
 const select=h.ids.get('symbolPickerExchange');assert.equal(select.value,'ALL');assert.equal(select.children.length,7);assert.equal(calls[0],'ALL');
 const buttons=h.find('symbol-picker-rows').children.map(r=>r.children[1]);assert.ok(buttons[1].textContent.includes('Bitget'));assert.match(buttons[1].attrs['aria-label'],/Bitget/);buttons[1].click();
 assert.deepEqual(h.selections,[{value:{ex:'BITGET',symbol:'BTCUSDT'},target:3}]);
});
test('individual exchange filtering and manual symbols remain available, with no ambiguous all-exchange fallback',async()=>{
 const h=harness(async ex=>result([row(ex==='ALL'?'BITGET':ex)]));h.picker.open({ex:'BYBIT',symbol:'BTCUSDT'});await tick();h.input('UNKNOWN');h.flush();
 const manual=h.find('symbol-picker-footer').children[1];assert.equal(manual.hidden,true);manual.click();h.key('Enter');assert.equal(h.selections.length,0);
 const exchange=h.ids.get('symbolPickerExchange');exchange.value='BINANCE';exchange.onchange();await tick();h.flush();assert.equal(manual.hidden,false);manual.click();
 assert.equal(h.selections[0].value.ex,'BINANCE');assert.equal(h.selections[0].value.symbol,'UNKNOWNUSDT');
 h.picker.open({ex:'BITGET',symbol:'ETHUSDT'});await tick();assert.equal(exchange.value,'BINANCE');
});
test('late results respect current search, keyboard selection, scope changes and dialog closure',async()=>{
 let update,finish;const h=harness((ex,signal,options)=>ex==='ALL'?new Promise(resolve=>{update=options.onUpdate;finish=resolve;}):Promise.resolve(result([row('BYBIT','ETH')])));
 h.picker.open({ex:'BYBIT',symbol:'BTCUSDT'});update(result([row('BITGET','BTC',20),row('BYBIT','BTC',10),row('BITGET','ETH',40)]));h.input('btc');h.key('ArrowDown');
 update(result([row('BINANCE','BTC',100),row('BITGET','BTC',20),row('BYBIT','BTC',10),row('BITGET','ETH',40)]));h.flush();h.key('Enter');assert.equal(h.selections[0].value.ex,'BITGET');
 update(result([row('MEXC','FAKE')]));finish(result([row('MEXC','FAKE')]));await tick();assert.equal(h.ids.get('symbolPickerDialog').open,false);
 h.picker.open({ex:'BITGET',symbol:'BTCUSDT'});const oldUpdate=update,oldFinish=finish;const exchange=h.ids.get('symbolPickerExchange');exchange.value='BYBIT';exchange.onchange();await tick();
 oldUpdate(result([row('BINANCE','BTC')]));oldFinish(result([row('BINANCE','BTC')]));await tick();h.flush();assert.ok(h.find('symbol-picker-rows').textContent.includes('ETH'));assert.ok(!h.find('symbol-picker-rows').textContent.includes('Binance'));
});
test('the actual picker renders a bounded set of rows for a combined 20,000-listing catalog',async()=>{
 const rows=Array.from({length:20000},(_,i)=>row(Catalog.exchanges[i%6][0],'COIN'+i,i)),h=harness(async()=>result(rows));h.picker.open({ex:'BINANCE',symbol:'BTCUSDT'});await tick();h.flush();
 assert.ok(h.find('symbol-picker-rows').children.length<=14);h.input('COIN19999');h.flush();assert.equal(h.find('symbol-picker-rows').children.length,1);assert.match(h.find('symbol-picker-rows').textContent,/COIN19999/);
});
