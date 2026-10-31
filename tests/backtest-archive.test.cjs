'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const A=require('../backtest-archive.js'),T=require('../timeframes.js'),C=require('../backtest-cache.js'),D=require('../backtest-data.js'),B=require('../backtest-bars.js'),E=require('../backtest-engine.js');
// Generated prices in this file are isolated test fixtures, never market data.
const jan=Date.UTC(2024,0,1)/1000,feb=Date.UTC(2024,1,1)/1000,mar=Date.UTC(2024,2,1)/1000,now=()=>Date.UTC(2024,2,15),signal=()=>new AbortController().signal;
const row=(time,tf='3m')=>{const i=(time-jan)/T.seconds[tf],open=100+Math.sin((i-1)/7)*8,close=100+Math.sin(i/7)*8;return {time,open,high:Math.max(open,close)+.5,low:Math.min(open,close)-.5,close,volume:123.456789123456};};
function bars(from,to,tf='3m'){return Array.from({length:(to-from)/T.seconds[tf]},(_,i)=>row(from+i*T.seconds[tf],tf));}
function csv(rows,header=true){return (header?'open_time,open,high,low,close,volume,close_time\n':'')+rows.map(r=>[r.time*1000,r.open,r.high,r.low,r.close,r.volume,r.time*1000+179999].join(',')).join('\n')+'\n';}
function zip(name,body,{stored=false,badCRC=false}={}){
 const raw=Buffer.from(body),data=stored?raw:zlib.deflateRawSync(raw),file=Buffer.from(name),crc=A.crc32(raw)^(badCRC?1:0),local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(stored?0:8,8);local.writeUInt32LE(crc>>>0,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(file.length,26);
 central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(stored?0:8,10);central.writeUInt32LE(crc>>>0,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(file.length,28);
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+file.length,12);end.writeUInt32LE(local.length+file.length+data.length,16);
 return Buffer.concat([local,file,data,central,file,end]);
}
const spec=(tf='3m',from=jan,to=feb)=>A.specification('IOSTUSDT',tf,to*1000-1,from,now());
function assets(specs,{body,checksum,fail}={}){const files=new Map(specs.map(s=>{const rows=bars(s.from,s.to,s.timeframe),data=zip(s.csv,body?body(rows,s):csv(rows));return [s.url,{data,hash:crypto.createHash('sha256').update(data).digest('hex'),spec:s}];})),calls=[];return {files,calls,load:async(url,kind,sig)=>{sig.throwIfAborted();calls.push({url,kind});if(fail)throw fail;const f=files.get(url.replace(/\.CHECKSUM$/,''));if(!f)throw Object.assign(Error('HTTP 404'),{status:404});return kind==='zip'?f.data:(checksum||f.hash)+'  '+f.spec.filename;}};}
function rest(from,to,tf,calls=[]){return async(ex,symbol,frame,edge,sig)=>{sig.throwIfAborted();calls.push({ex,symbol,frame,edge});assert.equal(frame,tf);const last=Math.min(to-T.seconds[tf],T.start(edge/1000,tf));return last<from?[]:bars(Math.max(from,last-999*T.seconds[tf]),last+T.seconds[tf],tf);};}
test('portable SHA-256 and CRC-32 match independent reference vectors including block boundaries',async()=>{
 for(const n of [0,1,3,55,56,63,64,65,1000,1000000]){const bytes=crypto.randomBytes(n);assert.equal(await A.sha256(bytes,{native:false}),crypto.createHash('sha256').update(bytes).digest('hex'));}
 assert.equal(A.crc32(Buffer.from('123456789')),0xcbf43926);
});
test('archive planning selects only matching closed futures buckets worth at least 500 bars',()=>{
 for(const tf of ['1m','3m','5m','15m','30m','1h']){const s=spec(tf);assert.equal(s.from,jan);assert.equal(s.to,feb);assert.equal(s.timeframe,tf);assert.match(s.url,/\/futures\/um\/monthly\/klines\/IOSTUSDT\//);assert.equal(A.allowedUrl(s.url,'IOSTUSDT',tf),true);assert.equal(A.allowedUrl(s.url+'.CHECKSUM','IOSTUSDT',tf),true);}
 for(const tf of ['2h','4h','1d','1w','1M'])assert.equal(spec(tf),null);
 assert.equal(A.specification('IOSTUSDT','3m',(feb-60)*1000,feb-200*180,now()),null);
 const daily=A.specification('IOSTUSDT','1m',Date.UTC(2024,2,10,23,59),mar,now());assert.equal(daily.kind,'daily');assert.equal(daily.date,'2024-03-10');
 assert.equal(A.specification('IOSTUSDT','1m',now(),mar,now()),null);
 for(const bad of [spec().url.replace('data.binance.vision','evil.example'),spec().url+'?extra=1',spec().url.replace('/IOSTUSDT/','/BTCUSDT/'),spec().url.replace('IOSTUSDT-3m','BTCUSDT-3m')])assert.equal(A.allowedUrl(bad,'IOSTUSDT','3m'),false);
});
test('deflated and stored ZIPs preserve every double-precision OHLCV value',async()=>{
 const s=spec(),rows=bars(jan,feb);
 for(const stored of [false,true])assert.deepEqual(A.parseCsv(await A.unpack(zip(s.csv,csv(rows),{stored}),s),s),rows);
});
test('wrong contract, corrupt ZIP, CRC, gaps and timestamp units are rejected before any archive bars are returned',async()=>{
 const s=spec(),rows=bars(jan,feb);
 await assert.rejects(A.unpack(zip('BTCUSDT-3m-2024-01.csv',csv(rows)),s),/계약/);
 await assert.rejects(A.unpack(zip(s.csv,csv(rows),{badCRC:true}),s),/CRC/);
 await assert.rejects(A.unpack(Buffer.from('invalid'),s),/크기/);
 for(const changed of [rows.slice(1),rows.filter((_,i)=>i!==200),rows.map(r=>({...r,time:r.time*1000})),rows.map((r,i)=>i===2?{...r,high:1}:r)])assert.throws(()=>A.parseCsv(Buffer.from(csv(changed)),s));
});
test('download validates SHA-256; a failed archive falls back to the same symbol and timeframe API',async()=>{
 const s=spec(),f=assets([s],{checksum:'0'.repeat(64)}),calls=[],fallback=rest(jan,feb,'3m',calls),a=A.create({store:C.memory(),now,loadAsset:f.load,candlePage:fallback,lower:()=>jan});
 const rows=await a.candlePage('BINANCE','IOSTUSDT','3m',feb*1000-1,signal());assert.equal(rows.length,1000);assert.equal(rows.archiveMeta,undefined);assert.equal(calls[0].symbol,'IOSTUSDT');assert.equal(a.info().fallbacks,1);assert.match(a.info().reasons[0],/SHA-256/);
});
test('missing or incomplete files fall back to REST for the full bucket without fabricating missing candles',async()=>{
 for(const f of [assets([]),assets([spec()],{body:rows=>csv(rows.slice(100))})]){
  const calls=[],a=A.create({store:C.memory(),now,loadAsset:f.load,candlePage:rest(jan,feb,'3m',calls),lower:()=>jan});let edge=feb*1000-1,count=0;
  for(;;){const rows=await a.candlePage('BINANCE','IOSTUSDT','3m',edge,signal());if(!rows.length)break;count+=rows.length;edge=rows[0].time*1000-1;}
  assert.equal(count,14880);assert.equal(a.info().files,0);assert.equal(a.info().fallbacks,1);assert.ok(calls.every(c=>c.symbol==='IOSTUSDT'&&c.frame==='3m'));
 }
});
test('network and quota failures disable repeated archive attempts while preserving API rate-limit failures',async()=>{
 const f=assets([spec()],{fail:Object.assign(Error('offline'),{name:'TypeError'})}),limit=Object.assign(Error('rate limit'),{name:'RateLimitError',retryAt:123}),a=A.create({store:C.memory(),now,loadAsset:f.load,candlePage:async()=>{throw limit;},lower:()=>0});
 await assert.rejects(a.candlePage('BINANCE','IOSTUSDT','3m',feb*1000-1,signal()),e=>e===limit);await assert.rejects(a.candlePage('BINANCE','IOSTUSDT','3m',jan*1000-1,signal()),e=>e===limit);assert.equal(f.calls.length,2);
});
test('compressed archive cache is bounded, reused across workers, and revalidates changed official checksums',async()=>{
 let clock=now();const s=spec(),f=assets([s]),store=C.memory({limit:2*1048576}),make=()=>A.create({store,now:()=>clock,loadAsset:f.load,candlePage:async()=>{throw Error('unexpected REST');},lower:()=>jan});
 const first=await make().candlePage('BINANCE','IOSTUSDT','3m',feb*1000-1,signal());assert.equal(f.calls.length,2);assert.ok((await store.info()).bytes<1048576);
 const second=make(),again=await second.candlePage('BINANCE','IOSTUSDT','3m',feb*1000-1,signal());assert.deepEqual(again,first);assert.equal(f.calls.length,2);assert.equal(second.info().cachedFiles,1);
 clock+=86400001;await make().candlePage('BINANCE','IOSTUSDT','3m',feb*1000-1,signal());assert.equal(f.calls.length,3);assert.equal(f.calls.at(-1).kind,'checksum');
 const updated=zip(s.csv,csv(bars(jan,feb).map(r=>({...r,volume:r.volume+1}))));f.files.get(s.url).data=updated;f.files.get(s.url).hash=crypto.createHash('sha256').update(updated).digest('hex');clock+=86400001;
 const changed=await make().candlePage('BINANCE','IOSTUSDT','3m',feb*1000-1,signal());assert.equal(changed[0].volume,first[0].volume+1);assert.equal(f.calls.filter(c=>c.kind==='zip').length,2);assert.ok((await store.info()).bytes<=2*1048576);
});
test('aborting an archive fetch propagates cancellation without requesting REST or reporting partial success',async()=>{
 const stop=new AbortController();let restCalls=0;const a=A.create({store:C.memory(),now,lower:()=>jan,loadAsset:async()=>{stop.abort();throw stop.signal.reason;},candlePage:async()=>{restCalls++;return [];}});
 await assert.rejects(a.candlePage('BINANCE','IOSTUSDT','3m',feb*1000-1,stop.signal),{name:'AbortError'});assert.equal(restCalls,0);
});
test('archive-to-REST boundaries retain all warmup, all requested candles, funding, and identical TP/SL trades',async()=>{
 const start=jan+80*180,end=mar+3*86400,archive=assets([spec(),spec('3m',feb,mar)]),all=bars(jan,end),calls=[],funding=Array.from({length:Math.ceil((end-jan)/3600)},(_,i)=>({time:jan+i*3600,rate:-.6,fundingIntervalHours:1,markPrice:100})),fundingPage=async(ex,s,cursor)=>funding.filter(r=>r.time*1000>=cursor).slice(0,1000),options={exchange:'BINANCE',intervals:['3m'],startTime:start,endTime:end,packed:true},baseRest=rest(jan,end,'3m',calls),adapter=A.create({candlePage:baseRest,store:C.memory(),now,loadAsset:archive.load,lower:()=>jan});
 const fast=await D.create({candlePage:adapter.candlePage,fundingPage}).loadBacktestDataset('IOSTUSDT',options),slow=await D.create({candlePage:rest(jan,end,'3m'),fundingPage}).loadBacktestDataset('IOSTUSDT',options),got=fast.timeframeCandles['3m'];
 assert.equal(got.length,all.length);assert.equal(fast.coverage['3m'].count,all.length-80);assert.equal(fast.coverage['3m'].warmup,80);assert.equal(fast.gapsCount,0);for(let i=0;i<got.length;i++)assert.deepEqual(B.get(got,i),all[i]);assert.deepEqual(fast.coverage,slow.coverage);assert.deepEqual(fast.fundingRecords,slow.fundingRecords);assert.equal(adapter.info().files,2);assert.ok(calls.length<=3);assert.match(fast.source,/binance-public-archive/);
 const config={timeframe:'3m',startTime:start,endTime:end,rsiPeriod:6,rsiOversold:45,entryTrigger:'rsi_oversold',splitTrigger:'step_pct',splitCount:3,splitStepPct:.5,takeProfitPct:2,stopLossPct:3,feePct:.05,slippagePct:.03,fundingIntervalHours:1,fundingWindowSeconds:7200,minFundingRate:-.5,initialCapital:10000,allocationPerTradePct:50,maxHoldBars:30};
 const a=E.runBacktest(got,fast.fundingRecords,config),b=E.runBacktest(slow.timeframeCandles['3m'],slow.fundingRecords,config);assert.ok(a.trades.length>50);assert.deepEqual(a,b);
});
test('recent daily 1m files accelerate only complete days; current day and other venues stay on REST',async()=>{
 const day=mar+5*86400,s=A.specification('IOSTUSDT','1m',(day+86400)*1000-1,day,now()),f=assets([s]),calls=[],a=A.create({store:C.memory(),now,loadAsset:f.load,candlePage:async(...args)=>{calls.push(args);return [];},lower:()=>day});
 const rows=await a.candlePage('BINANCE','IOSTUSDT','1m',(day+86400)*1000-1,signal());assert.equal(rows.length,1440);assert.equal(rows.archiveMeta.kind,'daily');
 await a.candlePage('BYBIT','IOSTUSDT','1m',(day+86400)*1000-1,signal());await a.candlePage('BINANCE','IOSTUSDT','1m',now(),signal());assert.equal(calls.length,2);
});
test('HTTP file reader bounds response sizes and preserves status for safe fallback',async()=>{
 await assert.rejects(A.fetchAsset(spec().url,'zip',signal(),async()=>new Response(null,{status:429})),e=>e.status===429);
 await assert.rejects(A.fetchAsset(spec().url,'zip',signal(),async()=>new Response('x',{headers:{'content-length':String(A.maxZip+1)}})),/크기/);
 const result=await A.fetchAsset(spec().url,'zip',signal(),async()=>new Response(new Uint8Array([1,2,3])));assert.deepEqual([...new Uint8Array(result)],[1,2,3]);
});
