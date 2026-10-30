'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const T=require('../timeframes.js'),D=require('../chart-data.js'),F=require('../funding.js');
const ts=s=>Date.parse(s)/1000,bar=(day,values={})=>({time:ts(day),open:10,high:15,low:8,close:12,volume:100,...values});
test('weekly bars start on Monday UTC, including Sunday and a year boundary',()=>{
 assert.equal(T.start(ts('2026-10-25T23:59:59Z'),'1w'),ts('2026-10-19T00:00:00Z'));
 assert.equal(T.start(ts('2026-01-01T12:00:00Z'),'1w'),ts('2025-12-29T00:00:00Z'));
});
test('monthly closes follow leap years and 31-day months',()=>{
 assert.equal(T.end(ts('2024-02-01'),'1M'),ts('2024-03-01'));
 assert.equal(T.end(ts('2026-01-01'),'1M'),ts('2026-02-01'));
 assert.equal(T.shift(ts('2026-01-31'),'1M',1),ts('2026-02-01'));
 assert.equal(T.shift(ts('2026-01-01'),'1M',-2),ts('2025-11-01'));
});
test('a date at month end focuses the real containing monthly bar, without crossing missing months',()=>{
 const bars=[bar('2024-02-01'),bar('2024-04-01')];
 assert.equal(T.indexAt(bars,ts('2024-02-29T23:59:59Z'),'1M'),0);
 assert.equal(T.indexAt(bars,ts('2024-03-01T00:00:00Z'),'1M'),-1);
 assert.equal(T.indexAt([bar('2026-01-01')],ts('2026-01-31T23:59:59Z'),'1M'),0);
});
test('weekly and monthly API cursors round to calendar boundaries, not Unix-epoch week offsets',()=>{
 assert.equal(T.requestEnd(Date.parse('2026-10-18T23:59:59Z'),'1w'),Date.parse('2026-10-19'));
 assert.equal(T.requestEnd(Date.parse('2026-10-19'),'1w'),Date.parse('2026-10-19'));
 assert.equal(T.requestEnd(Date.parse('2024-02-29T23:59:59Z'),'1M'),Date.parse('2024-03-01'));
});
test('all six exchanges use official native weekly and monthly bars',()=>{
 const expected={BINANCE:['1w','1M'],BYBIT:['W','M'],BINGX:['1w','1M'],BITGET:['1Wutc','1Mutc'],MEXC:['Week1','Month1'],OKX:['1Wutc','1Mutc']};
 for(const [ex,periods]of Object.entries(expected))for(const [i,interval]of ['1w','1M'].entries()){assert.equal(T.plan(ex,interval).native,periods[i]);assert.equal(T.plan(ex,interval).factor,1);}
});
test('a forming 31-day month retains its open and extremes during live updates',()=>{
 const previous=bar('2026-10-01',{high:20,low:5}),row=bar('2026-10-01',{open:12,high:16,low:7,close:14,volume:90});
 const result=D.mergeLive([previous],[row],T.seconds['1M'],ts('2026-10-31T23:59:00Z'),t=>T.end(t,'1M'));
 assert.deepEqual(result.bars[0],{...row,open:10,high:20,low:5,volume:100});
 assert.equal(D.countdown(previous.time,T.seconds['1M'],ts('2026-10-31T23:59:00Z'),T.end(previous.time,'1M')),'01:00');
});
test('month-end funding records and current observations align with the real monthly candle',()=>{
 const time=ts('2026-01-01'),record={time:ts('2026-01-31T16:00:00Z'),rate:-.5};
 const result=F.mapToCandles([bar('2026-01-01')],[record],T.seconds['1M'],-.4,-2,t=>T.end(t,'1M'));
 assert.equal(result.unmapped.length,0);assert.equal(result.mapped.get(time).rate,-.5);
 const observations=F.observeCurrent([],{fetchedAt:record.time,rate:.01},T.seconds['1M'],t=>T.start(t,'1M'));
 assert.equal(observations[0].time,time);
});
test('monthly history requests identify March between February and April without synthesizing bars',()=>{
 const bars=[bar('2024-02-01'),bar('2024-04-01')],calendar={start:t=>T.start(t,'1M'),end:t=>T.end(t,'1M'),shift:(t,n)=>T.shift(t,'1M',n)};
 const gaps=D.historyRequests(bars,{from:0,to:1},T.seconds['1M'],ts('2024-04-15'),calendar).filter(r=>r.direction==='gap');
 assert.equal(gaps.length,1);assert.equal(gaps[0].from,ts('2024-03-01'));assert.equal(gaps[0].to,ts('2024-03-01'));
});
test('calendar date navigation requests actual pages around a leap day',async()=>{
 const controller=new AbortController(),target=ts('2024-02-29T12:00:00Z');
 const bars=await T.dateWindow(async()=>[bar('2024-01-01'),bar('2024-02-01'),bar('2024-03-01')],target,'1M',1,controller.signal,Date.parse('2024-04-01'));
 assert.equal(T.indexAt(bars,target,'1M'),1);
});
