'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');require(path.join(ROOT,'relay-config.js'));
const API=require(path.join(ROOT,'market-api.js')),F=require(path.join(ROOT,'funding.js')),E=require(path.join(ROOT,'backtest-engine.js')),D=require(path.join(ROOT,'backtest-data.js')),T=require(path.join(ROOT,'timeframes.js'));
const cache=path.join(__dirname,'.cache'),metaPath=path.join(__dirname,'collection.json'),planPath=path.join(__dirname,'plan.json');
fs.mkdirSync(cache,{recursive:true});
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=Buffer.from(JSON.stringify(value));fs.writeFileSync(file+'.tmp',file.endsWith('.gz')?zlib.gzipSync(bytes):JSON.stringify(value,null,2)+'\n');fs.renameSync(file+'.tmp',file);}
function read(file){if(!fs.existsSync(file))return null;const b=fs.readFileSync(file);return JSON.parse(file.endsWith('.gz')?zlib.gunzipSync(b):b);}
const symbols=fs.readFileSync(path.join(__dirname,'universe.txt'),'utf8').trim().split(/\s+/);
if(new Set(symbols).size!==symbols.length||symbols.some(s=>!/^[A-Z0-9]{1,28}USDT$/.test(s)))throw Error('Invalid or duplicate universe symbol');
let plan=read(planPath);
if(!plan){const end=Math.floor(Date.now()/60000)*60;plan={version:1,createdAt:new Date().toISOString(),engineCommit:'62758674c0d8d73de655ff03622479ee12f1d855',engineBlob:'50b466862f00d4cdeced220df76ff6fcbce74ed8',symbolCount:symbols.length,universeHash:hash(symbols),start:end-365*86400,end,trainingEnd:Date.parse('2026-09-30T00:00:00+09:00')/1000,validationStart:Date.parse('2026-10-01T00:00:00+09:00')/1000,timeframes:['5m','15m'],venues:['BITGET','MEXC','OKX','BINGX'],unavailableVenues:{BINANCE:'HTTP 451 from execution environment',BYBIT:'Non-JSON Site Unavailable response from execution environment'},holdoutRule:'sha256(symbol) first uint32 modulo 5 equals 0',heldOutSymbols:symbols.filter(s=>parseInt(hash(s).slice(0,8),16)%5===0),fundingIntervalBasis:'known',fundingHours:1,minFundingRate:-.5,fundingWindowSeconds:3600,transitionLookbackSeconds:3600,rsiPeriod:14,warmupBars:200,maxHoldSeconds:12*3600,postEventSeconds:15*3600,feePct:.05,slippagePct:.03,initialCapital:10000,plannedTradeBudget:1000,oneEntryPerFunding:true,firstEntryOnlyRestrictions:true,stopLossMode:'immediate',dataSampling:'All qualifying settlements in the requested period; all supplied symbols; real contiguous candle windows covering warmup, entry window and maximum holding period. No price data synthesized.'};write(planPath,plan);}
if(plan.universeHash!==hash(symbols))throw Error('Universe changed after research plan was frozen');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),queues=new Map(),last=new Map();let requests=0;
const paceFetch=async(url,opts)=>{const u=new URL(url),ex=u.searchParams.get('exchange'),key=ex||u.host,delay=ex==='BINGX'?1200:ex==='MEXC'?180:u.host.includes('bitget')?220:260;
 const earlier=queues.get(key)||Promise.resolve(),turn=earlier.then(async()=>{await wait(Math.max(0,(last.get(key)||0)+delay-Date.now()));last.set(key,Date.now());requests++;return {response:fetch(url,opts)};});queues.set(key,turn.catch(()=>{}));return (await turn).response;};
const client=API.createClient({fetch:paceFetch,onRetry:p=>console.log(JSON.stringify({phase:'retry',...p})),requestTimeout:20000});API.json=client.json;
const log=(phase,details)=>console.log(JSON.stringify({at:new Date().toISOString(),phase,requests,...details}));
const fundingPath=(ex,s)=>path.join(cache,'funding',ex+'_'+s+'.json.gz'),candlePath=(ex,s,tf)=>path.join(cache,'candles',ex+'_'+s+'_'+tf+'.json.gz');
function eligible(rows){return E.identifyFundingSessions(rows,{fundingIntervalBasis:'known',fundingIntervalHours:1,minFundingRate:-.5,fundingWindowSeconds:3600,fundingTransitionLookbackSeconds:3600}).filter(w=>w.endTime>plan.start&&w.startTime<plan.end);}
async function funding(ex,symbol){const file=fundingPath(ex,symbol),saved=read(file);if(saved?.complete&&saved.end===plan.end)return saved;
 const lower=plan.start-48*3600;let state=saved?.end===plan.end?saved:{exchange:ex,symbol,end:plan.end,rows:[],page:1,cursor:plan.end*1000-1,pages:0,complete:false},map=new Map(state.rows.map(r=>[r.time,r]));
 for(let n=0;n<500;n++){
  const q=F.historyRequest(ex,symbol,state.cursor,state.page),raw=await API.json(q.url,q.params,AbortSignal.timeout(90000)),rows=F.merge(F.normalizeHistory(ex,raw,symbol)),signature=rows.length?rows[0].time+':'+rows.at(-1).time+':'+rows.length:null;
  if(signature&&signature===state.signature)throw Error('Repeated funding history page');
  for(const r of rows)if(r.time>=lower&&r.time<plan.end)map.set(r.time,r);
  const next={...state,pages:state.pages+1,signature,rows:[...map.values()].sort((a,b)=>a.time-b.time),fetchedAt:new Date().toISOString()};let done=false;
  if(!rows.length){if(ex==='BINGX'&&state.cursor/1000-90*86400>lower)next.cursor=state.cursor-90*86400000;else done=true;}
  else{done=rows[0].time<=lower;const cursor=F.nextHistoryCursor(ex,rows);if(['BITGET','MEXC'].includes(ex)){if(Number.isFinite(state.edge)&&rows[0].time>=state.edge)throw Error('Funding page cursor did not advance');}else if(cursor>=state.cursor)throw Error('Funding time cursor did not advance');next.cursor=cursor;next.edge=rows[0].time;next.page=state.page+1;}
  next.complete=done;state=next;write(file,state);if(done)return state;
 }
 throw Error('Funding request safety limit reached; history remains incomplete');
}
async function pool(values,count,fn){let i=0;await Promise.all(Array.from({length:count},async()=>{for(;;){const at=i++;if(at>=values.length)return;await fn(values[at],at);}}));}
async function collectFunding(){const meta=read(metaPath)||{planHash:hash(plan),assets:{}};
 if(meta.planHash!==hash(plan))throw Error('Collection metadata belongs to another plan');
 await pool(symbols,2,async(symbol,index)=>{if(meta.assets[symbol]?.finished)return;const attempts=[];let selected=null;
  for(const ex of plan.venues){try{const data=await funding(ex,symbol),windows=eligible(data.rows);attempts.push({exchange:ex,status:'complete',records:data.rows.length,pages:data.pages,first:data.rows[0]?.time??null,last:data.rows.at(-1)?.time??null,minRate:data.rows.length?Math.min(...data.rows.map(r=>r.rate)):null,eligibleWindows:windows.length,sourceHash:hash(data.rows)});if(windows.length){selected={exchange:ex,eligibleWindows:windows.length,fundingFirst:data.rows[0].time,fundingLast:data.rows.at(-1).time};break;}}
   catch(error){attempts.push({exchange:ex,status:'error',error:error.message});}}
  meta.assets[symbol]={symbol,index,heldOut:plan.heldOutSymbols.includes(symbol),finished:true,status:selected?'selected':attempts.some(a=>a.status==='error')?'incomplete-or-unavailable':'no-qualifying-history',...selected,attempts};write(metaPath,meta);log('funding-asset',{completed:Object.keys(meta.assets).length,total:symbols.length,...meta.assets[symbol]});
 });return meta;}
function mergeRanges(ranges){const sorted=ranges.sort((a,b)=>a[0]-b[0]),out=[];for(const r of sorted){const p=out.at(-1);if(p&&r[0]<=p[1])p[1]=Math.max(p[1],r[1]);else out.push(r.slice());}return out;}
async function collectCandles({only=null}={}){const meta=read(metaPath);if(!meta)throw Error('Collect funding first');const assets=Object.values(meta.assets).filter(a=>a.status==='selected'&&(!only||only.includes(a.symbol)));
 await pool(assets,2,async(asset,index)=>{const ex=asset.exchange,symbol=asset.symbol,records=read(fundingPath(ex,symbol)).rows;
  for(const tf of plan.timeframes){const file=candlePath(ex,symbol,tf),saved=read(file);if(saved?.finished&&saved.planHash===hash(plan))continue;
   const windows=eligible(records),step=T.seconds[tf],ranges=mergeRanges(windows.map(w=>[Math.max(plan.start-step*plan.warmupBars,T.start(w.startTime,tf)-step*plan.warmupBars),Math.min(plan.end,T.end(w.endTime+plan.maxHoldSeconds+3600,tf))]).filter(r=>r[1]>r[0]));
   let state=saved?.planHash===hash(plan)?saved:{symbol,exchange:ex,timeframe:tf,planHash:hash(plan),ranges,completed:[],rows:[],complete:false,failedRanges:[],source:'official-exchange-api'},map=new Map(state.rows.map(b=>[b.time,b]));
   const adapter=D.create({fundingPage:async(_ex,_s,_cursor,page)=>page===1?records:[]});
   for(let i=0;i<ranges.length;i++){if(state.completed.includes(i))continue;const [from,to]=ranges[i];try{
    const data=await adapter.loadBacktestDataset(symbol,{exchange:ex,startTime:from,endTime:to,intervals:[tf],packed:false,maxBars:2000000,rsiPeriod:plan.rsiPeriod,fundingWindowSeconds:plan.fundingWindowSeconds,signal:AbortSignal.timeout(180000),onProgress:p=>{if(p.phase==='candles'&&p.pages%40===0)log('candle-page',{symbol,exchange:ex,tf,range:i+1,ranges:ranges.length,...p});}});
    for(const b of data.timeframeCandles[tf])map.set(b.time,b);state.rows=[...map.values()].sort((a,b)=>a.time-b.time);state.completed.push(i);write(file,state);log('candle-window',{symbol,exchange:ex,tf,range:i+1,ranges:ranges.length,bars:state.rows.length});
   }catch(error){state.failedRanges??=[];state.failedRanges.push({index:i,from,to,error:error.message});write(file,state);log('candle-error',{symbol,ex,tf,range:i+1,error:error.message});}}
   state.finished=true;state.complete=!state.failedRanges?.length;state.sourceHash=hash(state.rows);state.first=state.rows[0]?.time??null;state.last=state.rows.at(-1)?.time??null;write(file,state);
  }log('candle-asset',{completed:index+1,total:assets.length,symbol,exchange:ex});
 });return meta;}
async function followCandles(){const attempted=new Set();for(;;){const m=read(metaPath),ready=Object.values(m?.assets||{}).filter(a=>a.status==='selected'&&!attempted.has(a.symbol));if(ready.length){await collectCandles({only:ready.map(a=>a.symbol)});ready.forEach(a=>attempted.add(a.symbol));}else if(Object.keys(m?.assets||{}).length===symbols.length)break;else await wait(1000);}}
module.exports={ROOT,cache,plan,hash,write,read,log,symbols,fundingPath,candlePath,metaPath,collectFunding,collectCandles,eligible,E,F,T,pool};
if(require.main===module)(async()=>{const phase=process.argv[2]||'funding';log('start',{phase,plan});if(phase==='funding')await collectFunding();else if(phase==='candles')await collectCandles();else if(phase==='candles-follow')await followCandles();else throw Error('Unknown phase');log('finished',{phase});})().catch(e=>{console.error(e.stack);process.exitCode=1;});
