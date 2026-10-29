(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MarketCatalog=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const exchanges=[['BINANCE','Binance'],['BYBIT','Bybit'],['BINGX','BingX'],['BITGET','Bitget'],['MEXC','MEXC'],['OKX','OKX']];
 const numeric=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
 const base=s=>String(s||'').toUpperCase().replace(/[-_]/g,'').replace(/USDTSWAP$|USDT$/,'');
 function normalize(exchange,contracts,tickers){
  const quotes=new Map((tickers||[]).map(t=>[base(t.symbol||t.instId),t])),rows=new Map();
  for(const c of contracts||[]){
   const native=c.symbol||c.instId||'',coin=base(native);if(!coin||!/^[A-Z0-9]{1,40}$/.test(coin)||!/USDT(?:-SWAP)?$/.test(native))continue;
   if(exchange==='BINANCE'&&(c.status!=='TRADING'||c.contractType!=='PERPETUAL'))continue;
   if(exchange==='BYBIT'&&(c.status!=='Trading'||c.contractType!=='LinearPerpetual'||c.settleCoin!=='USDT'))continue;
   if(exchange==='BITGET'&&c.symbolStatus&&!['normal','listed'].includes(c.symbolStatus))continue;
   if(exchange==='BINGX'&&c.status!==undefined&&Number(c.status)!==1)continue;
   if(exchange==='MEXC'&&c.state!==undefined&&Number(c.state)!==0)continue;
   if(exchange==='OKX'&&(c.state!=='live'||c.settleCcy!=='USDT'))continue;
   const t=quotes.get(coin)||{},price=numeric(t.lastPrice??t.lastPr??t.last),rawVolume=numeric(t.quoteVolume??t.turnover24h??t.usdtVolume??t.amount24??t.volCcy24h);
   const volume=exchange==='OKX'?(rawVolume!==null&&price!==null?rawVolume*price:null):rawVolume;
   let change=numeric(t.priceChangePercent);
   if(exchange==='BYBIT')change=numeric(t.price24hPcnt);if(exchange==='BITGET')change=numeric(t.change24h);if(exchange==='MEXC')change=numeric(t.riseFallRate);
   if(['BYBIT','BITGET','MEXC'].includes(exchange)&&change!==null)change*=100;
   if(exchange==='OKX'){const open=numeric(t.open24h);change=price!==null&&open>0?(price-open)/open*100:null;}
   const listed=numeric(exchange==='BINANCE'?c.onboardDate:exchange==='BYBIT'?c.launchTime:exchange==='OKX'?c.listTime:null),listedAt=listed>1e11?Math.floor(listed/1000):listed;
   rows.set(coin,{...(listedAt>0&&listedAt<Date.now()/1000?{listedAt}:{}),exchange,symbol:coin+'USDT',base:coin,native,price:price>0?price:null,change,volume:volume!==null?volume:null,volumeApprox:exchange==='OKX'});
  }
  return [...rows.values()].sort((a,b)=>(b.volume??-1)-(a.volume??-1)||a.base.localeCompare(b.base));
 }
 function create({json=(...args)=>MarketAPI.json(...args),now=Date.now}={}){
  const cache=new Map(),pending=new Map();
  async function load(exchange,signal=new AbortController().signal,{refresh=false,onUpdate}={}){
   if(exchange==='ALL')return loadAll(signal,{refresh,onUpdate});
   if(!exchanges.some(([id])=>id===exchange))throw Error('지원하지 않는 거래소입니다.');
   signal.throwIfAborted();const saved=cache.get(exchange);if(!refresh&&saved&&now()-saved.fetchedAt<30000)return {...saved,stale:false};
   // A caller's cancellation does not abort another chart's shared catalog request.
   let task=pending.get(exchange);
   if(!task){task=fetchCatalog(exchange).then(rows=>{if(!rows.length)throw Error('거래 가능한 USDT 무기한 종목을 받지 못했습니다.');const result={rows,fetchedAt:now(),stale:false};cache.set(exchange,result);return result;}).finally(()=>pending.delete(exchange));pending.set(exchange,task);}
   try{const result=await task;signal.throwIfAborted();return result;}catch(error){signal.throwIfAborted();if(saved)return {...saved,stale:true,error:error.message};throw error;}
  }
  async function loadAll(signal,{refresh,onUpdate}){
   signal.throwIfAborted();
   const results=new Map(),states=new Map(exchanges.map(([exchange])=>[exchange,{exchange,status:'pending'}]));
   const snapshot=()=>{const values=[...results.values()];return {rows:values.flatMap(value=>value.rows),fetchedAt:values.length?Math.min(...values.map(value=>value.fetchedAt)):null,stale:values.some(value=>value.stale),exchangeStates:exchanges.map(([exchange])=>({...states.get(exchange)}))};};
   await Promise.all(exchanges.map(async([exchange])=>{
    try{const result=await load(exchange,signal,{refresh});results.set(exchange,result);states.set(exchange,{exchange,status:result.stale?'stale':'ok',...(result.error?{error:result.error}:{})});}
    catch(error){if(signal.aborted)return;states.set(exchange,{exchange,status:'error',error:error.message});}
    if(!signal.aborted)onUpdate?.(snapshot());
   }));
   signal.throwIfAborted();const result=snapshot();if(!result.rows.length)throw Error('모든 거래소의 종목 목록을 조회하지 못했습니다. 새로고침하거나 거래소를 선택해 다시 시도하세요.');return result;
  }
  async function fetchCatalog(ex){
   const signal=AbortSignal.timeout(20000),get=(url,params={})=>json(url,params,signal);
   let contracts,tickers;
   if(ex==='BINANCE'){
    const [c,t]=await Promise.all([get('https://fapi.binance.com/fapi/v1/exchangeInfo'),get('https://fapi.binance.com/fapi/v1/ticker/24hr').catch(()=>[])]);contracts=c.symbols;tickers=t;
   }else if(ex==='BYBIT'){
    contracts=[];let cursor;const seen=new Set();
    do{const c=await get('https://api.bybit.com/v5/market/instruments-info',{category:'linear',limit:1000,cursor});contracts.push(...(c.result?.list||[]));cursor=c.result?.nextPageCursor;if(cursor&&seen.has(cursor))throw Error('종목 목록 페이지가 반복됩니다.');if(cursor)seen.add(cursor);}while(cursor);
    tickers=(await get('https://api.bybit.com/v5/market/tickers',{category:'linear'}).catch(()=>null))?.result?.list;
   }else if(ex==='BINGX'){
    contracts=(await get('https://open-api.bingx.com/openApi/swap/v2/quote/contracts')).data;
    tickers=(await get('https://open-api.bingx.com/openApi/swap/v2/quote/ticker').catch(()=>null))?.data;
   }else if(ex==='BITGET'){
    const [c,t]=await Promise.all([get('https://api.bitget.com/api/v2/mix/market/contracts',{productType:'USDT-FUTURES'}),get('https://api.bitget.com/api/v2/mix/market/tickers',{productType:'USDT-FUTURES'}).catch(()=>null)]);contracts=c.data;tickers=t?.data;
   }else if(ex==='MEXC'){
    const [c,t]=await Promise.all([get('https://api.mexc.com/api/v1/contract/detail'),get('https://api.mexc.com/api/v1/contract/ticker').catch(()=>null)]);contracts=c.data;tickers=t?.data;
   }else{
    const [c,t]=await Promise.all([get('https://www.okx.com/api/v5/public/instruments',{instType:'SWAP'}),get('https://www.okx.com/api/v5/market/tickers',{instType:'SWAP'}).catch(()=>null)]);contracts=c.data;tickers=t?.data;
   }
   if(!Array.isArray(contracts))throw Error('종목 목록 응답 형식이 올바르지 않습니다.');
   return normalize(ex,contracts,Array.isArray(tickers)?tickers:tickers?[tickers]:[]);
  }
  return {load};
 }
 function filter(rows,query='',favorites=null,sort='volume',direction=-1){
  const q=String(query).toUpperCase().replace(/[^A-Z0-9]/g,'');
  const list=rows.filter(r=>(!q||r.symbol.includes(q)||r.base.includes(q))&&(!favorites||favorites.has(r.exchange+':'+r.symbol)));
  return list.sort((a,b)=>sort==='symbol'?direction*a.base.localeCompare(b.base):((a[sort]??(direction===1?Infinity:-Infinity))-(b[sort]??(direction===1?Infinity:-Infinity)))*direction||a.base.localeCompare(b.base));
 }
 function visibleRange(count,scrollTop,height,rowHeight=52,overscan=4){const start=Math.max(0,Math.floor(scrollTop/rowHeight)-overscan);return {start:Math.min(start,count),end:Math.min(count,Math.ceil((scrollTop+height)/rowHeight)+overscan)};}
 function suggest(rows,query,limit=12){
  const q=String(query).toUpperCase().replace(/[^A-Z0-9]/g,'');if(!q)return [];
  return filter(rows,q).sort((a,b)=>Number(b.base.startsWith(q))-Number(a.base.startsWith(q))||(b.volume??-1)-(a.volume??-1)||a.base.localeCompare(b.base)).slice(0,Math.max(0,Math.min(20,limit)));
 }
 return {exchanges,create,normalize,filter,visibleRange,numeric,base,suggest};
});
