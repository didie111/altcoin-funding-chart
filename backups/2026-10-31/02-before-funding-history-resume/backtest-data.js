(function(root,factory){
 'use strict';if(typeof module==='object'&&module.exports){require('./relay-config.js');module.exports=factory(require('./market-api.js'),require('./timeframes.js'),require('./funding.js'),require('./backtest-bars.js'));}else root.BacktestData=factory(MarketAPI,TimeframeEngine,FundingEngine,root.BacktestBars);
})(typeof globalThis!=='undefined'?globalThis:this,function(API,T,F,B){
 'use strict';const ALL_TIMEFRAMES=Object.keys(T.seconds);
 async function candlePage(ex,symbol,tf,end,signal){
  const b=symbol.replace(/[-_]/g,'').replace(/USDT$/,''),plan=T.plan(ex,tf),limit=ex==='BITGET'?200:ex==='OKX'?300:1000;let data,rows;
  if(ex==='BINANCE'){data=await API.json('https://fapi.binance.com/fapi/v1/klines',{symbol:b+'USDT',interval:plan.native,limit,endTime:end},signal);rows=data;}
  else if(ex==='BYBIT'){data=await API.json('https://api.bybit.com/v5/market/kline',{category:'linear',symbol:b+'USDT',interval:plan.native,limit,end},signal);rows=data.result.list;}
  else if(ex==='BINGX'){data=await API.json('https://open-api.bingx.com/openApi/swap/v3/quote/klines',{symbol:b+'-USDT',interval:plan.native,limit,endTime:end},signal);rows=data.data;}
  else if(ex==='BITGET'){data=await API.json('https://api.bitget.com/api/v2/mix/market/history-candles',{symbol:b+'USDT',productType:'USDT-FUTURES',granularity:plan.native,limit,endTime:T.requestEnd(end,plan.source)},signal);rows=data.data;}
  else if(ex==='OKX'){data=await API.json('https://www.okx.com/api/v5/market/history-candles',{instId:b+'-USDT-SWAP',bar:plan.native,limit,after:end},signal);rows=data.data.map(r=>[...r.slice(0,5),r[6]]);}
  else if(ex==='MEXC'){const sec=Math.floor(end/1000);data=await API.json('https://api.mexc.com/api/v1/contract/kline/'+b+'_USDT',{interval:plan.native,start:Math.max(0,sec-T.seconds[plan.source]*1999),end:sec},signal);const d=data.data;rows=(d.time||[]).map((time,i)=>({time,open:d.open[i],high:d.high[i],low:d.low[i],close:d.close[i],volume:d.vol[i]}));}
  else throw Error('지원하지 않는 거래소입니다.');
  if(!Array.isArray(rows))throw Error('캔들 응답 형식이 올바르지 않습니다.');const parsed=rows.map(API.candle);if(parsed.some(c=>!c))throw Error('올바르지 않은 캔들이 포함되어 있습니다.');return T.aggregate(parsed,tf,plan.source);
 }
 async function fundingPage(ex,symbol,cursor,page,signal){const request=F.historyRequest(ex,symbol,cursor,page);return F.normalizeHistory(ex,await API.json(request.url,request.params,signal),symbol);}
 function create(adapter={}){
  const candles=adapter.candlePage||candlePage,funding=adapter.fundingPage||fundingPage;
  async function loadBacktestDataset(symbol,options={}){
   const ex=options.exchange||'BINANCE',end=Math.min(options.endTime??Date.now()/1000,Date.now()/1000),start=options.startTime??end-7*86400,intervals=[...new Set([...(options.intervals||['5m']),...(options.requireMinuteData?['1m']:[])])],signal=options.signal||new AbortController().signal,onProgress=options.onProgress||(()=>{}),packed=options.packed===true,maxBars=options.maxBars??(packed?B.recommendedMaxBars():500000);
   if(options.requireMinuteData){intervals.splice(intervals.indexOf('1m'),1);intervals.unshift('1m');}
   if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||start<0)throw Error('테스트 기간을 확인하세요.');symbol=String(symbol).trim().toUpperCase().replace(/[-_]/g,'').replace(/USDT$/,'')+'USDT';if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol))throw Error('코인 심볼을 확인하세요.');
   for(const tf of intervals)T.plan(ex,tf);signal.throwIfAborted();
   const timeframeCandles={},coverage={},allFunding=new Map(),fundingStart=Math.max(0,start-Math.max(48*3600,Math.min(864000,Number(options.fundingWindowSeconds)||0))),fundingEnd=Math.min(Date.now()/1000,end+(options.fundingIntervalBasis==='chart'?48*3600:0));let totalCount=0,pages=0,cursor=ex==='BINANCE'?fundingStart*1000:Math.floor(fundingEnd*1000)-1,page=1;
   for(;;){
    signal.throwIfAborted();const rows=F.merge(await funding(ex,symbol,cursor,page,signal));signal.throwIfAborted();pages++;
    for(const r of rows)if(r.time>=fundingStart&&r.time<fundingEnd)allFunding.set(r.time,r);
    onProgress({phase:'funding',pages,count:allFunding.size,exchange:ex});
    if(!rows.length){if(ex==='BINGX'&&cursor/1000-90*86400>fundingStart){cursor-=90*86400000;continue;}break;}
    if(ex==='BINANCE'){const next=F.nextHistoryCursor(ex,rows);if(next<=cursor)throw Error('펀딩비 API의 과거 페이지가 진행되지 않습니다.');if(next>=fundingEnd*1000)break;cursor=next;}
    else{if(rows[0].time<=fundingStart)break;const next=F.nextHistoryCursor(ex,rows);if(next>=cursor&&!['BITGET','MEXC'].includes(ex))throw Error('펀딩비 API의 과거 페이지가 진행되지 않습니다.');if(['BITGET','MEXC'].includes(ex)&&page>1&&rows.every(r=>r.time>=cursor/1000))throw Error('펀딩비 API가 같은 페이지를 반복했습니다.');cursor=next;page++;}
   }
   if(!allFunding.size)throw Error('선택 기간의 공식 정산 기록이 없어 진입 조건을 검증할 수 없습니다.');
   const gaps=[];let gapsCount=0;
   for(const tf of intervals){try{
    const warmupStart=Math.max(0,T.shift(T.start(start,tf),tf,-Math.max(80,(options.rsiPeriod||14)*3))),map=packed?null:new Map(),compact=packed?B.builder():null,localGaps=[];let localGapCount=0,edge=Math.floor(end*1000)-1,tfPages=0,firstInside=null,lastInside=null,insideCount=0,newer=null;
    for(;;){
     signal.throwIfAborted();const pageRows=T.sorted(await candles(ex,symbol,tf,edge,signal,false)),rows=pageRows.filter(b=>b.time*1000<=edge);signal.throwIfAborted();tfPages++;if(!rows.length&&pageRows.length)throw Error(tf+' 캔들 API의 과거 커서가 진행되지 않습니다.');
     if(!rows.length)break;
     for(let i=rows.length-1;i>=0;i--){const b=rows[i];if(b.time<warmupStart||T.end(b.time,tf)>end)continue;
      if(packed){compact.push(b);if(newer!==null&&T.end(b.time,tf)<newer){localGapCount++;if(localGaps.length<2000)localGaps.push({timeframe:tf,from:T.end(b.time,tf),to:newer});}newer=b.time;
       if(b.time>=start){firstInside=b.time;if(lastInside===null)lastInside=b.time;insideCount++;}}
      else map.set(b.time,b);
     }
     const count=packed?compact.length:map.size;
     if(count+totalCount>maxBars)throw Error((packed?'현재 환경의 메모리 보호 기준 ':'선택 기간의 데이터가 ')+maxBars.toLocaleString()+'봉을 초과합니다. 기간을 나누어 실행해 주세요. 일부만 계산하지 않고 중단했습니다.');
     onProgress({phase:'candles',timeframe:tf,pages:tfPages,count,exchange:ex});
     if(rows[0].time<=warmupStart)break;const next=rows[0].time*1000-1;if(next>=edge)throw Error(tf+' 캔들 API의 과거 페이지가 진행되지 않습니다.');edge=next;
    }
    const values=packed?compact.finish():[...map.values()].sort((a,b)=>a.time-b.time);if(!values.length)throw Error(tf+'의 해당 기간 캔들 기록을 거래소가 제공하지 않습니다.');
    if(!packed){const inside=values.filter(b=>b.time>=start);if(inside.length){firstInside=inside[0].time;lastInside=inside.at(-1).time;insideCount=inside.length;}}
    if(!insideCount)throw Error(tf+'의 선택 기간에 완성된 캔들이 없습니다.');
    timeframeCandles[tf]=values;totalCount+=values.length;gapsCount+=localGapCount;for(const gap of localGaps)if(gaps.length<2000)gaps.push(gap);coverage[tf]={first:firstInside,last:lastInside,count:insideCount,endMissing:T.end(lastInside,tf)<T.start(end,tf),warmup:values.length-insideCount,startMissing:firstInside>T.end(T.start(start,tf),tf)};
   }catch(error){signal.throwIfAborted();if(!options.allowMissing||(options.requireMinuteData&&tf==='1m')||error.name==='RateLimitError'||/초과|반복|진행되지|메모리|순서/.test(error.message))throw error;coverage[tf]={error:error.message};}}
   if(!Object.keys(timeframeCandles).length)throw Error('선택 기간의 캔들을 불러오지 못했습니다.');
   const fundingRecords=[...allFunding.values()].sort((a,b)=>a.time-b.time);if(!fundingRecords.length)throw Error('선택 기간의 공식 정산 기록이 없어 진입 조건을 검증할 수 없습니다.');
   if(!packed)for(const [tf,rows]of Object.entries(timeframeCandles))for(let i=1;i<rows.length;i++)if(T.end(rows[i-1].time,tf)<rows[i].time){gapsCount++;gaps.push({timeframe:tf,from:T.end(rows[i-1].time,tf),to:rows[i].time});}
   const available=Object.entries(coverage).filter(([,v])=>Number.isFinite(v.first)&&Number.isFinite(v.last)),priceStart=Math.max(start,Math.min(...available.map(([,v])=>v.first))),priceEnd=Math.min(end,Math.max(...available.map(([tf,v])=>T.end(v.last,tf)))),first=fundingRecords[0].time,last=fundingRecords.at(-1).time;let longGaps=0;
   for(let i=1;i<fundingRecords.length;i++)if(fundingRecords[i].time-fundingRecords[i-1].time>86400+60&&fundingRecords[i].time>priceStart&&fundingRecords[i-1].time<priceEnd)longGaps++;
   return {symbol,exchange:ex,startTime:start,endTime:end,fundingRecords,timeframeCandles,coverage,gaps,gapsCount,source:'official-exchange-api',fundingCoverage:{first,last,count:fundingRecords.length,startMissing:first>priceStart+2*86400,endMissing:last<priceEnd-2*86400,longGaps}};
  }
  return {loadBacktestDataset};
 }
 async function fetchBinanceFundingHistory(symbol,limit=1000,signal=new AbortController().signal){const request=F.historyRequest('BINANCE',symbol,Date.now()-90*86400000,1);request.params.limit=Math.min(1000,limit);return F.normalizeHistory('BINANCE',await API.json(request.url,request.params,signal),symbol);}
 async function fetchBinanceKlines(symbol,interval='5m',startTime=null,endTime=null,limit=1000,signal=new AbortController().signal){const params={symbol:String(symbol).toUpperCase().replace(/USDT$/,'')+'USDT',interval,limit:Math.min(1500,limit)};if(startTime)params.startTime=startTime>=1e11?startTime:startTime*1000;if(endTime)params.endTime=endTime>=1e11?endTime:endTime*1000;const data=await API.json('https://fapi.binance.com/fapi/v1/klines',params,signal);return T.sorted(data.map(API.candle));}
 return {ALL_TIMEFRAMES,create,...create(),candlePage,fundingPage,transferables:B.transferables,fetchBinanceFundingHistory,fetchBinanceKlines};
});
