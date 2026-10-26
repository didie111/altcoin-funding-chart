'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const data=require('../chart-data.js'),timeframes=require('../timeframes.js');
const stamp=Date.UTC(2026,9,14)/1000;
const bar=(time,close=10)=>({time,open:10,high:Math.max(11,close),low:9,close,volume:5});
test('a current funding cycle cannot overwrite a shorter settled interval in a daily, weekly or monthly candle',()=>{
 for(const int of ['1d','1w','1M']){
  const period={hours:8,source:'official'},observed={hours:1,observedHours:1};
  const current=data.withCurrentCycle(observed,period);assert.equal(current.hours,1,int);assert.equal(current.observedHours,1);
  assert.equal(data.withCurrentCycle(current,{hours:4,source:'official'}).hours,1);
 }
 assert.equal(data.withCurrentCycle({hours:1,current:true,observedHours:null},{hours:8,source:'official'}).hours,8,'an unsettled-only candle follows the actual current cycle');
});
const rsiContext={TimeframeEngine:timeframes,module:{exports:{}}};vm.createContext(rsiContext);
vm.runInContext(fs.readFileSync(require.resolve('../indicators.js'),'utf8'),rsiContext);
const rsi=rsiContext.module.exports;

test('panning to either edge requests actual missing minute bars and treats cached date gaps as loadable',()=>{
 const rows=Array.from({length:200},(_,i)=>bar(stamp+i*60));
 const older=data.historyRequests(rows,{from:-40,to:40},60,stamp+500*60);
 assert.equal(older[0].direction,'older');assert.equal(older[0].end,stamp*1000-1);
 const newer=data.historyRequests(rows,{from:130,to:230},60,stamp+500*60);
 assert.ok(newer.some(r=>r.direction==='newer'&&r.from===stamp+200*60));
 const islands=[...rows,...Array.from({length:200},(_,i)=>bar(stamp+(2000+i)*60))];
 for(const range of [{from:160,to:230},{from:190,to:260}])assert.ok(data.historyRequests(islands,range,60,stamp+2300*60).some(r=>r.direction==='gap'));
});
test('backfill preserves a forming candle rather than reverting its body, wick or volume',()=>{
 const live={...bar(stamp,12),high:14,low:8,volume:20,fetchedAt:2000};
 const rows=data.mergeHistory([live],[{...bar(stamp),fetchedAt:1000},bar(stamp-60)]);
 assert.deepEqual(rows.at(-1),live);assert.equal(rows[0].time,stamp-60);
});
test('out-of-order live snapshots cannot rewind the candle and its observed extremes remain intact',()=>{
 const old={...bar(stamp,12),high:14,low:8,volume:20,fetchedAt:2000};
 assert.deepEqual(data.mergeLive([old],[{...bar(stamp),fetchedAt:1000}],60,stamp+30).changed,[]);
 const result=data.mergeLive([old],[{...bar(stamp,11),volume:18,fetchedAt:3000}],60,stamp+30);
 assert.equal(result.bars[0].high,14);assert.equal(result.bars[0].low,8);assert.equal(result.bars[0].volume,20);assert.equal(result.bars[0].close,11);
});
test('returning from a paused feed retains all returned minute bars, including closed bars between snapshots',()=>{
 const rows=Array.from({length:100},(_,i)=>bar(stamp+i*60));
 const resumed=Array.from({length:90},(_,i)=>bar(stamp+(90+i)*60));
 const result=data.mergeLive(rows,resumed,60,stamp+180*60);
 assert.equal(result.bars.length,180);assert.equal(result.changed.length,80);
 assert.ok(result.bars.every((b,i)=>b.time===stamp+i*60));
});
test('all supported timeframes count down at the actual UTC candle boundary',()=>{
 for(const seconds of Object.values(timeframes.seconds)){
  const remaining=seconds-1,h=Math.floor(remaining/3600),m=Math.floor(remaining%3600/60),s=remaining%60,pad=n=>String(n).padStart(2,'0');
  assert.equal(data.countdown(stamp,seconds,stamp+1),h?`${pad(h)}:${pad(m)}:${pad(s)}`:`${pad(m)}:${pad(s)}`);
  assert.equal(data.countdown(stamp,seconds,stamp+seconds),'00:00');
 }
});
test('cycle display extends through the confirmed unsettled period without filling unavailable past records',()=>{
 const quote={fetchedAt:stamp+600,nextTime:stamp+4*3600,hours:4};
 const period=data.currentCycle(quote,null,[{time:stamp-4*3600},{time:stamp}],stamp+660);
 assert.equal(period.start,stamp);assert.equal(period.end,stamp+661);assert.equal(period.hours,4);assert.equal(period.source,'official');
 assert.equal(data.currentCycle({...quote,nextTime:stamp},null,[],stamp+660),null);
 const inferred=data.currentCycle({...quote,hours:null},null,[{time:stamp-4*3600},{time:stamp}],stamp+660);
 assert.equal(inferred.source,'observed');assert.equal(inferred.hours,4);
 assert.equal(data.currentCycle({...quote,hours:null},null,[],stamp+660),null);
});
for(const maType of rsi.maTypes)test(`RSI incremental updates match a complete calculation with ${maType}, across correction and new minute bars`,()=>{
 const bars=Array.from({length:600},(_,i)=>{const price=30+Math.sin(i*.7)*7+Math.cos(i*.15)*4;return {...bar(stamp+i*60,price),open:price-.5,high:price+2,low:price-2,volume:100+i%13};});
 const settings={maType,maLength:20,source:'hlc3',overbought:55,oversold:45};
 const cache=rsi.calculate(bars,settings);
 const next=bars.map(b=>({...b}));for(let i=596;i<600;i++)next[i].close+=2;
 next.push({...next.at(-1),time:stamp+600*60,close:next.at(-1).close-1});
 const actual=rsi.update(cache,next,596),expected=rsi.calculate(next,settings);
 for(const key of ['rsi','ma','upper','lower'])for(let i=580;i<next.length;i++){
  const a=actual[key][i],e=expected[key][i];assert.ok(Number.isNaN(a)&&Number.isNaN(e)||Math.abs(a-e)<1e-8,`${key}[${i}] ${a} vs ${e}`);
 }
 assert.deepEqual(JSON.parse(JSON.stringify(actual.signals)),JSON.parse(JSON.stringify(expected.signals)));
 assert.deepEqual([...actual.bullCond],[...expected.bullCond]);assert.deepEqual([...actual.bearCond],[...expected.bearCond]);
});
test('RSI reference lines support independent visibility, colors, values, widths and styles with persisted defaults',()=>{
 const settings=rsi.normalize({upperLevel:75,lowerLevel:25,upperColor:'#FF0000',lowerColor:'#00ff00',upperWidth:4,lowerWidth:2,upperStyle:0,showLowerLine:false});
 assert.equal(settings.showUpperLine,true);assert.equal(settings.showLowerLine,false);assert.equal(settings.upperWidth,4);assert.equal(settings.lowerWidth,2);
 assert.equal(settings.upperLevel,75);assert.equal(settings.lowerLevel,25);assert.equal(settings.upperColor,'#FF0000');
 assert.equal(rsi.normalize({length:14}).lowerLevel,30);
 assert.throws(()=>rsi.normalize({upperLevel:101}));assert.throws(()=>rsi.normalize({lowerLevel:80,upperLevel:70}));
});
test('unloaded history gaps do not become fabricated RSI moves or divergence bridges',()=>{
 const first=Array.from({length:100},(_,i)=>bar(stamp+i*60,10+i%7));
 const second=Array.from({length:60},(_,i)=>bar(stamp+(2000+i)*60,20+i%11));
 const result=rsi.calculate([...first,...second],{barSeconds:60});
 const isolated=rsi.calculate(second);
 for(let i=0;i<second.length;i++)assert.ok(Number.isNaN(result.rsi[i+100])&&Number.isNaN(isolated.rsi[i])||Math.abs(result.rsi[i+100]-isolated.rsi[i])<1e-10);
 assert.ok(result.signals.every(signal=>signal.fromIndex<100&&signal.toIndex<100||signal.fromIndex>=100&&signal.toIndex>=100));
});
