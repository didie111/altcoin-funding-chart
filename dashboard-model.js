(function(root,factory){
 'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DashboardModel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const exchanges=Object.freeze({BINANCE:'Binance',BYBIT:'Bybit',BINGX:'BingX',BITGET:'Bitget',MEXC:'MEXC',OKX:'OKX'});
 const hosts={BINANCE:['www.binance.com'],BYBIT:['announcements.bybit.com'],BINGX:['bingx.com','www.bingx.com'],BITGET:['www.bitget.com'],MEXC:['www.mexc.com','www.mexc.fm'],OKX:['www.okx.com']};
 const labels={'1m':'1분','3m':'3분','5m':'5분','15m':'15분','30m':'30분','1h':'1시간','2h':'2시간','4h':'4시간','1d':'일봉','1w':'주봉','1M':'월봉'};
 function notice(value){
  if(!exchanges[value?.exchange]||typeof value.title!=='string'||!value.title.trim())return null;
  let url;try{url=new URL(value.url);if(url.protocol!=='https:'||url.username||url.password||!hosts[value.exchange].includes(url.hostname))return null;}catch{return null;}
  url.hash='';
  const publishedAt=Number(value.publishedAt),checkedAt=Number(value.checkedAt);
  const symbols=[...new Set((Array.isArray(value.symbols)?value.symbols:[]).filter(s=>typeof s==='string'&&/^[A-Z0-9]{1,28}$/.test(s)))].slice(0,25);
  return {id:value.exchange+':'+url.pathname.replace(/\/$/,''),exchange:value.exchange,title:value.title.trim().slice(0,350),url:url.href,dateOnly:value.dateOnly===true,effectiveAt:Number(value.effectiveAt)>0?Number(value.effectiveAt):null,publishedAt:Number.isFinite(publishedAt)&&publishedAt>0?publishedAt:null,checkedAt:Number.isFinite(checkedAt)&&checkedAt>0?checkedAt:null,symbols,scope:['futures','spot','alpha','margin'].includes(value.scope)?value.scope:'other',change:value.change===true};
 }
 function mergeNotices(...lists){const map=new Map();for(const values of lists)for(const value of values||[]){const n=notice(value);if(n)map.set(n.id,{...map.get(n.id),...n,publishedAt:n.publishedAt||map.get(n.id)?.publishedAt||null,effectiveAt:n.change?n.effectiveAt:n.effectiveAt||map.get(n.id)?.effectiveAt||null,symbols:n.symbols.length?n.symbols:map.get(n.id)?.symbols||[]});}return [...map.values()].sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0));}
 function filterNotices(values,{exchange='ALL',scope='all',query='',start='',end=''}={}){const q=query.trim().toLocaleLowerCase();const from=start?Date.parse(start+'T00:00:00+09:00'):null,to=end?Date.parse(end+'T00:00:00+09:00')+86400000:null;return values.filter(n=>(from===null||(n.publishedAt!==null&&n.publishedAt>=from))&&(to===null||(n.publishedAt!==null&&n.publishedAt<to))&&(exchange==='ALL'||n.exchange===exchange)&&(scope==='all'||n.scope===scope)&&(!q||[n.title,n.exchange,exchanges[n.exchange],...n.symbols].join(' ').toLocaleLowerCase().includes(q)));}
 function settings(value={}){
  const day=new Date().toISOString().slice(0,10),prior=new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const date=(v,f)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v?v:f;
  const number=(v,f,min,max)=>Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max?Number(v):f;
  return {start:date(value.start,prior),end:date(value.end,day),capital:number(value.capital,10000,1,1e12),orderSize:number(value.orderSize,10,0.01,100),commission:number(value.commission,0.05,0,10),slippage:number(value.slippage,.03,0,10),height:number(value.height,280,180,900),open:value.open===true};
 }
 function validateSettings(value){const s=settings(value);if(value.start!==s.start||value.end!==s.end||s.start>s.end)throw Error('시작일과 종료일을 확인해 주세요.');for(const key of ['capital','orderSize','commission','slippage'])if(Number(value[key])!==s[key])throw Error('설정값의 허용 범위를 확인해 주세요.');return s;}
 function backtestTarget({follow=true,custom}={},active={}){
  const value=follow?active:custom||active;
  const symbol=String(value.symbol||'').trim().toUpperCase().replace(/[-_]/g,'').replace(/USDTSWAP$|USDT$/,'')+'USDT';
  if(!exchanges[value.ex]||!labels[value.int]||!/^[A-Z0-9]{1,28}USDT$/.test(symbol))throw Error('실행할 거래소·코인·타임프레임을 확인하세요.');
  return {ex:value.ex,symbol,int:value.int};
 }
 const sameTarget=(a,b)=>Boolean(a&&b&&a.ex===b.ex&&a.symbol===b.symbol&&a.int===b.int);
 function backtestPlan(market,mode,config){return {intervals:mode==='compare'?Object.keys(labels):[market.int],requireMinuteData:mode==='optimize'||config.splitTrigger==='rsi_cross_up_1m'};}
 function backtestProgress(market,mode,state){
  const prefix=exchanges[market.ex]+' '+market.symbol+' · 기준 '+labels[market.int];
  const phase=state.phase==='funding'?'정산 기록':state.timeframe==='1m'&&market.int!=='1m'?(mode==='compare'?'1분 비교·보조 데이터':'보조 1분봉 RSI·체결 검증'):labels[state.timeframe]+' 기준 캔들';
  return prefix+' / '+phase+' '+state.count.toLocaleString()+'건 · '+state.pages+'페이지';
 }
 function validateBacktestDataset(data,market,mode='single'){
  if(data.exchange!==market.ex||data.symbol!==market.symbol||(mode!=='compare'&&!data.timeframeCandles?.[market.int]?.length))throw Error('수집한 종목·거래소·기준 주기가 실행 대상과 일치하지 않습니다. 다시 실행하세요.');
 }
 return {exchanges,labels,notice,mergeNotices,filterNotices,settings,validateSettings,backtestTarget,sameTarget,backtestPlan,backtestProgress,validateBacktestDataset};
});
