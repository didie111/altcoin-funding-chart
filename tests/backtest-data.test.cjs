'use strict';const {test}=require('node:test'),assert=require('node:assert/strict'),Data=require('../backtest-data.js');
const start=Date.UTC(2026,9,20)/1000,bar=time=>({time,open:100,high:101,low:99,close:100,volume:1}),funding=[{time:start-3600,rate:-.5}];
test('range collection pages beyond 1500 real rows, keeps warmup separate, and preserves the requested exchange',async()=>{
 const history=Array.from({length:2100},(_,i)=>bar(start-100*60+i*60)),calls=[];
 const api=Data.create({fundingPage:async(ex,s,cursor,page)=>page===1?funding:[],candlePage:async(ex,symbol,tf,end)=>{calls.push({ex,symbol,tf,end});return history.filter(b=>b.time*1000<=end).slice(-500);}});
 const d=await api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1m'],startTime:start,endTime:start+2000*60});
 assert.equal(d.coverage['1m'].count,2000);assert.ok(d.timeframeCandles['1m'].length>2000);assert.ok(calls.length>3);assert.ok(calls.every(c=>c.ex==='BITGET'&&c.symbol==='BTCUSDT'));assert.equal(d.source,'official-exchange-api');
});
test('API errors and missing funding never become a synthetic success',async()=>{
 const offline=Data.create({fundingPage:async()=>{throw Error('offline');}});await assert.rejects(offline.loadBacktestDataset('BTCUSDT',{startTime:start,endTime:start+120}),/offline/);
 const missing=Data.create({fundingPage:async()=>[],candlePage:async()=>[bar(start)]});await assert.rejects(missing.loadBacktestDataset('BTCUSDT',{intervals:['1m'],startTime:start,endTime:start+60}),/정산 기록/);
 assert.equal(Data.generateSyntheticDataset,undefined);
});
test('ignored historical cursors fail explicitly rather than looping or truncating a test',async()=>{
 const api=Data.create({fundingPage:async(ex,s,cursor,page)=>page===1?funding:[],candlePage:async()=>[bar(start+60)]});await assert.rejects(api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1m'],startTime:start,endTime:start+600}),/진행되지|캔들/);
});
test('memory guard rejects an oversized range rather than reporting partial results as complete',async()=>{
 const api=Data.create({fundingPage:async(ex,s,cursor,page)=>page===1?funding:[],candlePage:async()=>[bar(start),bar(start+60)]});await assert.rejects(api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1m'],startTime:start,endTime:start+120,maxBars:1}),/일부만 계산하지 않고 중단/);
});
test('fixed-minute execution loads one shared 1m series before the requested chart frames without duplicates',async()=>{
 const calls=[],api=Data.create({fundingPage:async(ex,s,cursor,page)=>page===1?funding:[],candlePage:async(ex,s,tf)=>{calls.push(tf);return Array.from({length:82},(_,i)=>bar(start-80*(tf==='1m'?60:3600)+i*(tf==='1m'?60:3600)));}});
 const d=await api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1h','1m','1h'],requireMinuteData:true,startTime:start,endTime:start+7200});
 assert.deepEqual(calls,['1m','1h']);assert.deepEqual(Object.keys(d.timeframeCandles),['1m','1h']);
});
test('missing required 1m data and exhausted rate limits abort comparison instead of skipping them',async()=>{
 for(const failure of [Error('1분봉 제공 불가'),Object.assign(Error('API 요청 제한'),{name:'RateLimitError'})]){
  const api=Data.create({fundingPage:async(ex,s,cursor,page)=>page===1?funding:[],candlePage:async()=>{throw failure;}});
  await assert.rejects(api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1h'],requireMinuteData:true,allowMissing:true,startTime:start,endTime:start+7200}),error=>error===failure);
 }
 const limited=Object.assign(Error('API 요청 제한'),{name:'RateLimitError'}),api=Data.create({fundingPage:async(ex,s,cursor,page)=>page===1?funding:[],candlePage:async()=>{throw limited;}});
 await assert.rejects(api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1h'],allowMissing:true,startTime:start,endTime:start+7200}),error=>error===limited);
});
test('only explicit retrospective interval comparison collects settlements beyond the test end',async()=>{
 const end=start+3600,rows=[...funding,{time:end+3600,rate:.01},{time:end+7200,rate:.01}],edges=[];
 const api=Data.create({fundingPage:async(ex,s,cursor,page)=>{edges.push(cursor/1000);return page===1?rows:[];},candlePage:async(ex,s,tf,end)=>start*1000<=end?[bar(start)]:[]});
 const known=await api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1m'],startTime:start,endTime:end});
 assert.ok(known.fundingRecords.every(r=>r.time<end));assert.ok(edges[0]<end);
 edges.length=0;const chart=await api.loadBacktestDataset('BTCUSDT',{exchange:'BITGET',intervals:['1m'],startTime:start,endTime:end,fundingIntervalBasis:'chart'});
 assert.ok(chart.fundingRecords.some(r=>r.time>end));assert.ok(edges[0]>end);assert.ok(chart.timeframeCandles['1m'].every(b=>b.time+60<=end));
});
test('a configured long funding window loads its full pre-test lookback instead of stopping at 48 hours',async()=>{
 const old={time:start-6*86400,rate:-1},cursors=[];
 const api=Data.create({fundingPage:async(ex,s,cursor)=>{cursors.push(cursor/1000);return cursor<=start*1000?[old,{time:start,rate:.01}]:[];},candlePage:async(ex,s,tf,end)=>start*1000<=end?[bar(start)]:[]});
 const d=await api.loadBacktestDataset('BTCUSDT',{exchange:'BINANCE',intervals:['1m'],startTime:start,endTime:start+60,fundingWindowSeconds:7*86400});
 assert.equal(cursors[0],start-7*86400);assert.ok(d.fundingRecords.some(r=>r.time===old.time));
});

test('지지 확인용 큰 주기 캔들은 펀딩·1분봉 없이 시작 전 지정한 봉 수만큼 거슬러 불러온다',async()=>{
 const day=86400,t0=Math.floor(start/day)*day,history=Array.from({length:400},(_,i)=>bar(t0-390*day+i*day)),calls=[];
 const api=Data.create({fundingPage:async()=>{throw Error('펀딩을 불러오면 안 됩니다');},candlePage:async(ex,symbol,tf,end)=>{calls.push({ex,symbol,tf});return history.filter(b=>b.time*1000<=end).slice(-200);}});
 const rows=await api.loadContextCandles('BTCUSDT',{exchange:'BINANCE',timeframe:'1d',startTime:start,endTime:start+3*day,bars:150,packed:false});
 assert.ok(calls.length>=1&&calls.every(c=>c.tf==='1d'&&c.symbol==='BTCUSDT'));
 assert.ok(rows.length>=150,'시작 전 150봉 이상을 불러와야 합니다');
 assert.ok(rows[0].time<=t0-150*day);assert.ok(rows.every((b,i)=>i===0||b.time>rows[i-1].time));
 assert.ok(rows.every(b=>b.time+day<=start+3*day),'아직 끝나지 않은 캔들은 쓰면 안 됩니다');
 const packed=await api.loadContextCandles('BTCUSDT',{exchange:'BINANCE',timeframe:'1d',startTime:start,endTime:start+3*day,bars:30});
 assert.ok(packed.kind&&packed.length>=30);
 await assert.rejects(api.loadContextCandles('BTCUSDT',{exchange:'BINANCE',timeframe:'7x',startTime:start,endTime:start+day,bars:10}),/주기·기간/);
});
