(function(root,factory){'use strict';const api=factory(typeof module==='object'&&module.exports?require('./funding.js'):FundingEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.FundingHistory=api;})(typeof globalThis!=='undefined'?globalThis:this,function(F){
 'use strict';
 // Price pages and funding pages cover different durations. Page settlements
 // independently for the visible dates, including neighbours for cycle inference.
 function create({page,now=Date.now,pause=(ms,signal)=>new Promise((resolve,reject)=>{const timer=setTimeout(done,ms);function done(){signal.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);reject(signal.reason);}signal.addEventListener('abort',abort,{once:true});})}){
  let covered=[];
  function covers(ex,symbol,from,to){return covered.some(r=>r.ex===ex&&r.symbol===symbol&&r.from<=from&&r.to>=to&&r.until>now());}
  async function load(ex,symbol,{from,to,signal=new AbortController().signal,onPage=()=>{}}){
   if(!(Number.isFinite(from)&&Number.isFinite(to)&&from<to))throw Error('정산 이력의 조회 구간이 올바르지 않습니다.');
   signal.throwIfAborted();if(covers(ex,symbol,from,to))return {cached:true,pages:0};
   const lower=Math.max(0,from-86400),upper=Math.min(now()/1000,to+86400),seen=new Set();let cursor=ex==='BINANCE'?Math.floor(lower*1000):Math.floor(upper*1000),number=1,pages=0;
   for(;;){
    signal.throwIfAborted();const rows=F.merge(await page(ex,symbol,cursor,number,signal));signal.throwIfAborted();pages++;
    if(rows.length){const signature=rows[0].time+':'+rows.at(-1).time+':'+rows.length;if(seen.has(signature))throw Error('정산 이력 API가 같은 페이지를 반복했습니다.');seen.add(signature);await onPage(rows,pages);signal.throwIfAborted();}
    if(!rows.length){if(ex==='BINGX'&&cursor/1000-90*86400>lower){cursor-=90*86400000;}else break;}
    else if(ex==='BINANCE'){const next=rows.at(-1).time*1000+1;if(next<=cursor)throw Error('정산 이력 API의 과거 커서가 진행되지 않습니다.');if(rows.at(-1).time>=upper)break;cursor=next;}
    else{if(rows[0].time<=lower)break;const next=rows[0].time*1000-1;if(next>=cursor&&!['BITGET','MEXC'].includes(ex))throw Error('정산 이력 API의 과거 커서가 진행되지 않습니다.');cursor=next;number++;}
    await pause(ex==='BINGX'?1150:200,signal);
   }
   signal.throwIfAborted();covered=covered.filter(r=>r.until>now());covered.push({ex,symbol,from,to,until:to>=now()/1000-86400?now()+60000:Infinity});covered=covered.slice(-24);
   return {cached:false,pages};
  }
  return {load,covers};
 }
 function partition(records,from,to){
  const inside=[],neighbors=[];let before=null,after=null;
  for(const row of F.merge(records)){if(row.time<from)before=row;else if(row.time>=to){after??=row;}else inside.push(row);}
  if(before)neighbors.push(before);if(after)neighbors.push(after);return {inside,neighbors};
 }
 return {create,partition};
});
