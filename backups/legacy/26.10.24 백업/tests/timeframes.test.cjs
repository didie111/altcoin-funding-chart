'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const engine=require('../timeframes.js');
const api=require('../market-api.js');
const stamp=Date.UTC(2026,9,14)/1000;
const bar=(time,open=10,volume=1)=>({time,open,high:open+2,low:open-1,close:open+1,volume});

test('3-minute synthesis preserves chronological OHLC and summed volume despite reverse-order duplicate API rows',()=>{
  const bars=[bar(stamp+120,12,3),bar(stamp,10,1),bar(stamp+60,11,2),bar(stamp+60,11,2)];
  assert.deepEqual(engine.aggregate(bars,'3m','1m',stamp+1000),[{time:stamp,open:10,high:14,low:9,close:13,volume:6}]);
});
test('synthesis rejects missing minutes and partial historical buckets, but allows the live forming bucket',()=>{
  assert.deepEqual(engine.aggregate([bar(stamp),bar(stamp+120)],'3m','1m',stamp+1000),[]);
  assert.deepEqual(engine.aggregate([bar(stamp+60),bar(stamp+120)],'3m','1m',stamp+1000),[]);
  assert.deepEqual(engine.aggregate([bar(stamp),bar(stamp+60)],'3m','1m',stamp+1000),[]);
  assert.equal(engine.aggregate([bar(stamp),bar(stamp+60)],'3m','1m',stamp+90).length,1);
});
test('a dropped first page fragment is recovered as a complete older candle on the next page',()=>{
  const first=engine.aggregate([bar(stamp+60),bar(stamp+120),bar(stamp+180),bar(stamp+240),bar(stamp+300)],'3m','1m',stamp+1000);
  const nextEnd=first[0].time*1000-1;
  const second=engine.aggregate([bar(stamp),bar(stamp+60),bar(stamp+120)].filter(b=>b.time*1000<=nextEnd),'3m','1m',stamp+1000);
  assert.deepEqual([...second,...first].map(b=>b.time),[stamp,stamp+180]);
});
test('two-hour synthesis uses UTC bucket boundaries and does not carry the previous close across gaps',()=>{
  const rows=[bar(stamp,10,2),bar(stamp+3600,14,3),bar(stamp+10800,20,4)];
  assert.deepEqual(engine.aggregate(rows,'2h','1h',stamp+20000),[{time:stamp,open:10,high:16,low:9,close:15,volume:5}]);
});
test('Korean date input resolves identically in UTC environments and validates real calendar dates',()=>{
  assert.equal(engine.parseKst('2012-02-29','09:00'),Date.UTC(2012,1,29)/1000);
  assert.deepEqual(engine.kstFields(engine.parseKst('2026-10-14','00:01')),{date:'2026-10-14',time:'00:01'});
  for(const [day,time] of [['2012-02-30','09:00'],['2026-13-01','10:00'],['2026-10-14','24:00'],['2026-10-14','09:60']])assert.throws(()=>engine.parseKst(day,time));
});
test('date lookup only finds the containing candle and never silently jumps to a different date in a gap',()=>{
  const rows=[bar(stamp),bar(stamp+600)];
  assert.equal(engine.indexAt(rows,stamp+59,'1m'),0);
  assert.equal(engine.indexAt(rows,stamp+60,'1m'),-1);
  assert.equal(engine.indexAt(rows,stamp-1,'1m'),-1);
  assert.equal(engine.indexAt(rows,stamp+660,'1m'),-1);
});
test('direct date loading paginates around the requested time instead of waiting for latest-to-oldest history',async()=>{
  const calls=[], rows=Array.from({length:500},(_,i)=>bar(stamp+i*60));
  const target=stamp+200*60;
  const result=await engine.dateWindow(async end=>{calls.push(end);return rows.filter(b=>b.time*1000<=end).slice(-50).reverse();},target,'1m',180,new AbortController().signal,(stamp+500*60)*1000);
  assert.ok(calls.length>=4);
  assert.ok(result[0].time<=target-100*60);
  assert.ok(result.at(-1).time>=target+90*60);
  assert.notEqual(engine.indexAt(result,target,'1m'),-1);
  assert.ok(calls[0]<(stamp+500*60)*1000);
});
test('an unavailable 2012 date remains unavailable even if an upstream endpoint ignores the old end cursor',async()=>{
  const result=await engine.dateWindow(async()=>[bar(stamp)],Date.UTC(2012,0,1)/1000,'1m',180,new AbortController().signal,stamp*1000);
  assert.deepEqual(result,[]);
});
test('cancelling a date lookup discards an already in-flight response',async()=>{
  const controller=new AbortController();let resolve;
  const pending=engine.dateWindow(()=>new Promise(done=>resolve=done),stamp,'1m',180,controller.signal,(stamp+20000)*1000);
  controller.abort();resolve([bar(stamp)]);
  await assert.rejects(pending,{name:'AbortError'});
});

function candleHarness(response){
  const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),calls=[];
  const context={TimeframeEngine:engine,duration:engine.seconds,baseSymbol:s=>s.replace(/[-_]/g,'').replace(/USDT$/,''),candle:api.candle,
    json:async(url,params)=>{calls.push({url,params});return typeof response==='function'?response(url,params):response;}};
  vm.createContext(context);vm.runInContext(app.slice(app.indexOf('async function candlePage('),app.indexOf('async function fundingPage(')),context);
  return {calls,page:context.candlePage};
}
test('MEXC 3m and 2h fetch supported source intervals and aggregate actual exchange OHLCV',async()=>{
  for(const [interval,native,step,count] of [['3m','Min1',60,3],['2h','Min60',3600,2]]){
    const rows=Array.from({length:count},(_,i)=>bar(stamp+i*step,10+i,i+1));
    const data=Object.fromEntries(['time','open','high','low','close'].map(k=>[k,rows.map(r=>String(r[k]))]));data.vol=rows.map(r=>r.volume);
    const h=candleHarness({code:0,success:true,data});
    const bars=await h.page('MEXC','BTCUSDT',interval,stamp*1000+20000000,new AbortController().signal);
    assert.equal(h.calls[0].params.interval,native);assert.equal(bars.length,1);assert.equal(bars[0].volume,count*(count+1)/2);
    assert.equal(h.calls[0].url,'https://api.mexc.com/api/v1/contract/kline/BTC_USDT');
  }
});
test('Bitget history 2h uses supported 1H candles; Bybit and OKX 2h use their native enums',async()=>{
  const rows=[bar(stamp),bar(stamp+3600)];
  const tuple=rows.map(r=>[r.time*1000,r.open,r.high,r.low,r.close,r.volume,r.volume]);
  for(const [exchange,response,key,value] of [['BITGET',{data:tuple},'granularity','1H'],['BYBIT',{result:{list:tuple}},'interval','120'],['OKX',{data:tuple},'bar','2H']]){
    const h=candleHarness(response);await h.page(exchange,'BTC','2h',stamp*1000+20000000,new AbortController().signal);
    assert.equal(h.calls[0].params[key],value);
  }
});

test('Bitget latest candles omit the rounded endTime cursor that excludes the forming minute',async()=>{
  const h=candleHarness({data:[[stamp*1000,10,12,9,11,4]]});
  await h.page('BITGET','BTC','1m',stamp*1000+30000,new AbortController().signal,true);
  assert.equal(h.calls[0].params.endTime,undefined);
  assert.equal(h.calls[0].url,'https://api.bitget.com/api/v2/mix/market/candles');
  await h.page('BITGET','BTC','1m',stamp*1000-1,new AbortController().signal,false);
  assert.equal(h.calls[1].params.endTime,stamp*1000);
});

function navigationHarness(){
  const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const renders=[],context={all:Array.from({length:100},(_,i)=>bar(stamp+i*60)),windowStart:0,windowEnd:100,latestOffset:5,chartDateFocus:null,run:1,
    chart:{timeScale:()=>({getVisibleLogicalRange:()=>({from:10,to:30})})},renderWindow:(...args)=>renders.push(args),lowerBound:(a,t)=>a.findIndex(b=>b.time>=t)};
  vm.createContext(context);vm.runInContext(app.slice(app.indexOf('function captureChartView()'),app.indexOf('async function jumpToChartDate(')),context);
  return {context,renders};
}
test('finishing background history keeps a date-centered view after older bars change its logical index',()=>{
  const h=navigationHarness(),view=h.context.captureChartView();
  assert.equal(view.time,stamp+20*60);
  h.context.all=[...Array.from({length:200},(_,i)=>bar(stamp-(200-i)*60)),...h.context.all];
  h.context.restoreChartView(view);
  assert.equal(h.renders[0][0],220);assert.equal(h.renders[0][2],20);
});

test('history completion waits for deferred chart range changes before capturing its date again',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),h=navigationHarness();
  let applyRange,frame;
  const context=h.context;
  context.id=context.run=1;context.signal=new AbortController().signal;
  context.chunks=[Array.from({length:200},(_,i)=>bar(stamp-(200-i)*60))];
  context.fundingSession=null;context.busy=true;context.uniqueSorted=engine.sorted;context.ChartData=require('../chart-data.js');context.rebuild=()=>{};
  context.requestAnimationFrame=callback=>{frame=callback;};
  context.renderWindow=(index,focus,span)=>{
    // Lightweight Charts defers setVisibleLogicalRange until its drawing frame.
    context.windowStart=index-50;
    context.chart={timeScale:()=>({getVisibleLogicalRange:()=>({from:170,to:190})})};
    applyRange=()=>{context.chart={timeScale:()=>({getVisibleLogicalRange:()=>({from:40,to:60})})};};
  };
  const begin=app.indexOf('if(id!==run)return;const collectedView=captureChartView();');
  const end=app.indexOf(' if(!signal.aborted)',begin);
  vm.runInContext('this.finish=async()=>{'+app.slice(begin,end)+';this.nextView=captureChartView();};',context);
  const pending=context.finish();
  assert.equal(context.nextView,undefined);
  applyRange();frame();await pending;
  assert.equal(context.nextView.time,stamp+20*60);
});

test('a chosen date remains the anchor across delayed SDK indices and both history completion renders',()=>{
  const h=navigationHarness();h.context.chartDateFocus={id:1,time:stamp+20*60,span:180};
  h.context.chart={timeScale:()=>({getVisibleLogicalRange:()=>({from:1000,to:1180})})};
  h.context.all=[...Array.from({length:200},(_,i)=>bar(stamp-(200-i)*60)),...h.context.all];
  for(let pass=0;pass<2;pass++){
    const view=h.context.captureChartView();assert.equal(view.time,stamp+20*60);h.context.restoreChartView(view);
  }
  assert.deepEqual(h.renders.map(row=>row[0]),[220,220]);
});
test('after manual navigation, view capture uses the timestamp actually drawn at screen center',()=>{
  const h=navigationHarness();h.context.chart={timeScale:()=>({width:()=>1000,coordinateToTime:x=>{assert.equal(x,500);return stamp+55*60;},getVisibleLogicalRange:()=>({from:10,to:30})})};
  assert.equal(h.context.captureChartView().time,stamp+55*60);
});

test('Bitget rounded exclusive history cursors do not skip a minute between consecutive pages',async()=>{
  const source=Array.from({length:500},(_,i)=>bar(stamp-i*60));
  const h=candleHarness((url,params)=>({data:source.filter(row=>row.time*1000<Math.floor(params.endTime/60000)*60000).slice(0,200).map(row=>[row.time*1000,row.open,row.high,row.low,row.close,row.volume])}));
  const first=await h.page('BITGET','BTC','1m',stamp*1000+30000,new AbortController().signal);
  const next=await h.page('BITGET','BTC','1m',first[0].time*1000-1,new AbortController().signal);
  const merged=engine.sorted([...next,...first]);
  assert.equal(merged.length,400);assert.ok(merged.slice(1).every((row,i)=>row.time-merged[i].time===60));
});
