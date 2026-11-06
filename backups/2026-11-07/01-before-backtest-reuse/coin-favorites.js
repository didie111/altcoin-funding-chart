(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.CoinFavorites=api;let storage;try{storage=root.localStorage;}catch{}api.store=api.create({storage});root.addEventListener('storage',event=>{if(event.key===api.storageKey)api.store.reload();});}})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const storageKey='funding-chart-symbol-favorites-v1',venues=['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'];
 const symbol=value=>{const s=String(value||'').trim().toUpperCase().replace(/[-_/]/g,'').replace(/USDTSWAP$/,'USDT'),contract=s.endsWith('USDT')?s:s+'USDT';return /^[A-Z0-9]{1,28}USDT$/.test(contract)?contract:null;};
 const marketKey=value=>{const ex=String(value?.exchange||value?.ex||'').toUpperCase(),s=symbol(value?.symbol);return venues.includes(ex)&&s?ex+':'+s:null;};
 const parseKey=value=>{if(typeof value!=='string')return null;const [exchange,s,...extra]=value.split(':');return !extra.length&&venues.includes(exchange)&&s?.endsWith('USDT')&&symbol(s)===s?{exchange,symbol:s}:null;};
 function parse(text){const values=String(text||'').toUpperCase().split(/[\s,;|]+/).filter(Boolean),symbols=[],invalid=[],seen=new Set();let duplicates=0;for(const value of values){const normalized=symbol(value);if(!normalized){invalid.push(value);continue;}if(seen.has(normalized)){duplicates++;continue;}seen.add(normalized);symbols.push(normalized);}return {symbols,invalid,duplicates};}
 function resolve(text,rows,{exchange='ALL',preferredExchange='BINANCE',allExchanges=false}={}){
  const parsed=parse(text),keys=[],missing=[],wanted=new Map();for(const row of rows||[]){const key=marketKey(row);if(!key||(exchange!=='ALL'&&row.exchange!==exchange))continue;const list=wanted.get(row.symbol)||[];list.push(row);wanted.set(row.symbol,list);}
  for(const s of parsed.symbols){const list=(wanted.get(s)||[]).sort((a,b)=>Number(b.exchange===preferredExchange)-Number(a.exchange===preferredExchange)||venues.indexOf(a.exchange)-venues.indexOf(b.exchange));if(!list.length){missing.push(s);continue;}for(const row of allExchanges?list:list.slice(0,1))keys.push(marketKey(row));}
  return {...parsed,keys:[...new Set(keys)],missing};
 }
 function create({storage}={}){
  let values=new Set(),undo=null,persistent=Boolean(storage);const listeners=new Set();
  function read(){try{const list=JSON.parse(storage?.getItem(storageKey)||'[]');return new Set(Array.isArray(list)?list.filter(parseKey):[]);}catch{persistent=false;return new Set();}}
  values=read();
  const emit=()=>{for(const fn of listeners)fn(snapshot());};
  function persist(){try{if(storage)storage.setItem(storageKey,JSON.stringify([...values]));else persistent=false;}catch{persistent=false;}emit();}
  function snapshot(){return {keys:[...values],markets:[...values].map(parseKey),size:values.size,canUndo:Boolean(undo),persistent};}
  function change(keys,on){const clean=[...new Set(keys)].filter(parseKey),before=new Set(values);for(const key of clean)on?values.add(key):values.delete(key);if(before.size===values.size&&[...before].every(k=>values.has(k)))return false;undo=before;persist();return true;}
  return {snapshot,has:key=>values.has(key),change,clear(){return change([...values],false);},undo(){if(!undo)return false;values=undo;undo=null;persist();return true;},reload(){values=read();undo=null;emit();},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);}};
 }
 return {storageKey,venues,symbol,marketKey,parseKey,parse,resolve,create};
});
