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
