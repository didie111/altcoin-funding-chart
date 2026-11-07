(function(root,factory){
 'use strict';
 const api=factory(root,typeof module==='object'&&module.exports?require('./timeframes.js'):root.TimeframeEngine);
 if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestResearchStore=api;
})(globalThis,function(root,T){
 'use strict';
 const name='funding-chart-research-v1',week=T.seconds['1w'],maxBlockBytes=2*1048576,columns=['time','open','high','low','close','volume'];
 const exchanges=new Set(['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX']),kinds=['candles','funding'],encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),littleEndian=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
 const timestamp=t=>Number.isSafeInteger(t)&&t>=0&&t<1e11;
 const bucket=t=>T.start(t,'1w');
 function market(value){
  const exchange=value?.exchange??value?.ex,symbol=value?.symbol;
  if(!exchanges.has(exchange)||typeof symbol!=='string'||!/^[A-Z0-9]{1,28}USDT$/.test(symbol))throw Error('원본을 보관할 거래소·코인을 확인하세요.');
  return {id:exchange+':'+symbol,exchange,symbol};
 }
 function ranges(values=[]){
  if(!Array.isArray(values)||values.length>200000)throw Error('원본 자료 확인 범위가 올바르지 않습니다.');
  const ordered=values.map(r=>{if(!Array.isArray(r)||r.length!==2||!timestamp(r[0])||!timestamp(r[1])||r[0]>=r[1])throw Error('원본 자료 확인 범위가 올바르지 않습니다.');return r.slice();}).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),out=[];
  for(const r of ordered){const last=out.at(-1);if(last&&r[0]<=last[1])last[1]=Math.max(last[1],r[1]);else out.push(r);}
  return out;
 }
 function missing(covered,from,to){
  const gaps=[];let at=from;
  for(const [a,b] of covered||[]){if(a>=to)break;if(b<=at)continue;if(a>at)gaps.push([at,Math.min(a,to)]);at=Math.max(at,b);if(at>=to)break;}
  if(at<to)gaps.push([at,to]);return gaps;
 }
 function blank(m){return {...m,candles:{count:0,first:null,last:null,ranges:[]},funding:{count:0,first:null,last:null,ranges:[]},bytes:0,revision:0,signature:'0',completed:null};}
 function versionHash(value){let h=14695981039346656037n;for(const c of value||'')h=BigInt.asUintN(64,(h^BigInt(c.charCodeAt(0)))*1099511628211n);return value?h:0n;}
 function updatedState(m,state,next,old){
  const s=state||blank(m),kind=next.kind,previous=s[kind];
  const signature=(BigInt('0x'+(s.signature||'0'))^versionHash(old?.revision)^versionHash(next.revision)).toString(16);
  return {...s,[kind]:{...previous,count:previous.count+next.count-(old?.count||0),first:Math.min(previous.first??Infinity,next.first),last:Math.max(previous.last??-Infinity,next.last)},bytes:s.bytes+next.bytes-(old?.bytes||0),revision:s.revision+1,signature};
 }
 function mergeState(m,state,update){
  const s=state||blank(m),out={...s,revision:s.revision+1};
  for(const k of kinds)if(update[k]?.ranges?.length)out[k]={...s[k],ranges:ranges([...s[k].ranges,...update[k].ranges])};
  const c=update.completed,old=s.completed;
  if(c&&(!old||c.to>old.to||c.to===old.to&&c.from<=old.from))out.completed=c;
  return out;
 }
 function validCandle(r){
  return r&&timestamp(r.time)&&r.time%60===0&&Number.isFinite(r.open)&&Number.isFinite(r.high)&&Number.isFinite(r.low)&&Number.isFinite(r.close)&&Number.isFinite(r.volume)&&r.low>0&&r.low<=Math.min(r.open,r.close)&&r.high>=Math.max(r.open,r.close)&&r.volume>=0;
 }
 function fundingRow(r){
  if(!r||!timestamp(r.time)||!Number.isFinite(r.rate))throw Error('정산 원본의 시각 또는 펀딩률이 올바르지 않습니다.');
  const row={time:r.time,rate:r.rate};
  if(Number.isSafeInteger(r.timeMs)&&Math.floor(r.timeMs/1000)===r.time)row.timeMs=r.timeMs;
  for(const field of ['markPrice','referencePrice'])if(Number.isFinite(r[field])&&r[field]>0)row[field]=r[field];
  const hours=r.fundingIntervalHours??r.hours??r.intervalHours;
  if(Number.isFinite(hours)&&hours>0&&hours<=24){row.intervalHours=hours;if(typeof r.intervalSource==='string'&&r.intervalSource.length<=40)row.intervalSource=r.intervalSource;}
  return row;
 }
 function rowAt(values,i,target={}){const p=i*6;for(let j=0;j<6;j++)target[columns[j]]=values[p+j];return target;}
 function normalizeRows(kind,rows){
  const map=new Map();
  for(const r of rows||[]){if(kind==='candles'&&!validCandle(r))throw Error('1분봉 원본의 가격·거래량·시간이 올바르지 않습니다.');map.set(r.time,kind==='candles'?r:fundingRow(r));}
  return [...map.values()].sort((a,b)=>a.time-b.time);
 }
 function asLittleEndian(rows){
  const a=new Float64Array(rows.length*6);
  for(let i=0;i<rows.length;i++)for(let j=0;j<6;j++)a[i*6+j]=rows[i][columns[j]];
  if(littleEndian)return new Uint8Array(a.buffer);
  const b=new Uint8Array(a.byteLength),view=new DataView(b.buffer);for(let i=0;i<a.length;i++)view.setFloat64(i*8,a[i],true);return b;
 }
 function fromLittleEndian(bytes){
  if(littleEndian&&bytes.byteOffset%8===0)return new Float64Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/8);
  const a=new Float64Array(bytes.byteLength/8),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let i=0;i<a.length;i++)a[i]=view.getFloat64(i*8,true);return a;
 }
 async function transform(bytes,stream,limit,exact=false){
  const reader=new Blob([bytes]).stream().pipeThrough(stream).getReader(),parts=[],fixed=exact?new Uint8Array(limit):null;let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;const offset=size;size+=value.byteLength;if(size>limit)throw Error('원본 자료 블록이 허용 크기를 넘었습니다.');if(fixed)fixed.set(value,offset);else parts.push(value);}}
  finally{try{await reader.cancel();}catch{}}
  if(fixed)return fixed.subarray(0,size);
  const out=new Uint8Array(size);let offset=0;for(const part of parts){out.set(part,offset);offset+=part.byteLength;}return out;
 }
 async function encode(m,kind,start,rows){
  const raw=kind==='candles'?asLittleEndian(rows):encoder.encode(JSON.stringify(rows));
  if(!raw.byteLength||raw.byteLength>maxBlockBytes)throw Error('원본 자료 블록의 크기를 확인하세요.');
  let bytes=raw,encoding='raw';
  if(typeof root.CompressionStream==='function'&&typeof root.DecompressionStream==='function'){
   const compressed=await transform(raw,new root.CompressionStream('gzip'),maxBlockBytes+1024);
   if(compressed.length<raw.length){bytes=compressed;encoding='gzip';}
  }
  const head={key:[m.id,kind,start],kind,exchange:m.exchange,symbol:m.symbol,week:start,first:rows[0].time,last:rows.at(-1).time,count:rows.length,encoding,rawBytes:raw.byteLength,bytes:bytes.byteLength,revision:Date.now()+'-'+Math.random().toString(36).slice(2)};
  return {head,bytes};
 }
 function validateHead(h){
  const m=market(h),validKey=Array.isArray(h.key)&&h.key.length===3&&h.key[0]===m.id&&h.key[1]===h.kind&&h.key[2]===h.week;
  if(!validKey||!kinds.includes(h.kind)||!timestamp(h.week)||bucket(h.week)!==h.week||!timestamp(h.first)||!timestamp(h.last)||h.first<h.week||h.last>=h.week+week||h.first>h.last||!Number.isSafeInteger(h.count)||h.count<1||h.count>(h.kind==='candles'?week/60:week)||!Number.isSafeInteger(h.bytes)||h.bytes<1||h.bytes>maxBlockBytes||!Number.isSafeInteger(h.rawBytes)||h.rawBytes<1||h.rawBytes>maxBlockBytes||!['raw','gzip'].includes(h.encoding)||typeof h.revision!=='string'||!/^\d{1,17}-[a-z0-9]{1,24}$/.test(h.revision)||h.kind==='candles'&&h.rawBytes!==h.count*48)throw Error('백업 원본 자료 블록 정보가 올바르지 않습니다.');
  return m;
 }
 async function decode(head,bytes,{validate=false}={}){
  if(validate)validateHead(head);
  if(!(bytes instanceof Uint8Array)||bytes.byteLength!==head.bytes)throw Error('원본 자료 블록이 잘렸습니다.');
  const raw=head.encoding==='gzip'?await transform(bytes,new root.DecompressionStream('gzip'),head.rawBytes,true):bytes;
  if(raw.byteLength!==head.rawBytes)throw Error('원본 자료 압축 길이가 일치하지 않습니다.');
  const values=head.kind==='candles'?fromLittleEndian(raw):JSON.parse(decoder.decode(raw));
  if((head.kind==='candles'?values.length/6:values.length)!==head.count)throw Error('원본 자료 개수가 일치하지 않습니다.');
  if(validate){const scratch={};let prev=-Infinity;
   for(let i=0;i<head.count;i++){const r=head.kind==='candles'?rowAt(values,i,scratch):values[i];if(head.kind==='funding')fundingRow(r);else if(!validCandle(r))throw Error('백업에 올바르지 않은 1분봉이 있습니다.');if(r.time<=prev||r.time<head.week||r.time>=head.week+week||i===0&&r.time!==head.first||i===head.count-1&&r.time!==head.last)throw Error('백업 원본의 종목·범위·순서를 확인하세요.');prev=r.time;}
  }
  return values;
 }
 function valuesAsRows(head,values){return head.kind==='candles'?Array.from({length:head.count},(_,i)=>rowAt(values,i)):values;}
 function validatedState(value){
  const m=market(value),completed=value.completed;
  if(completed&&(!timestamp(completed.from)||!timestamp(completed.to)||completed.from>=completed.to||!timestamp(completed.fundingFrom)||completed.fundingFrom>=completed.to||completed.to%60))throw Error('백업 원본의 완료 범위를 확인하세요.');
  const clean={...m,candles:{ranges:ranges(value.candles?.ranges)},funding:{ranges:ranges(value.funding?.ranges)},completed:completed?{from:completed.from,to:completed.to,fundingFrom:completed.fundingFrom}:null};
  if(completed&&(missing(clean.candles.ranges,completed.from,completed.to).length||missing(clean.funding.ranges,completed.fundingFrom,completed.to).length))throw Error('백업 원본의 완료 범위와 확인 범위가 일치하지 않습니다.');
  return clean;
 }
 function wrap(backend){
  async function insertBlock(m,kind,start,rows,{preferStored=false,encoded}={}){
   const key=[m.id,kind,start];let staged=encoded;
   for(let attempt=0;attempt<10;attempt++){
    const old=await backend.read(key);
    if(old){
     if(encoded?.head.revision===old.head.revision&&encoded.bytes.length===old.bytes.length&&encoded.bytes.every((v,i)=>v===old.bytes[i]))return false;
     const previous=valuesAsRows(old.head,await decode(old.head,old.bytes)),merged=new Map(previous.map(r=>[r.time,r]));let changed=false;
     for(const r of rows){const existing=merged.get(r.time);if(existing&&(preferStored||(kind==='candles'?columns.every(k=>existing[k]===r[k]):JSON.stringify(existing)===JSON.stringify(r))))continue;merged.set(r.time,r);changed=true;}
     if(!changed)return false;
     staged=await encode(m,kind,start,[...merged.values()].sort((a,b)=>a.time-b.time));
    }else staged=encoded||await encode(m,kind,start,rows);
    if(await backend.commit(m,old?.head.revision,staged))return true;
   }
   throw Error('다른 탭에서 같은 원본을 저장 중입니다. 잠시 후 이어서 실행하세요.');
  }
  return {
   async put(item,kind,rows,{checked=[],preferStored=false}={}){
    const m=market(item);if(!kinds.includes(kind))throw Error('지원하지 않는 원본 자료입니다.');
    const groups=new Map();for(const r of normalizeRows(kind,rows)){const start=bucket(r.time);if(!groups.has(start))groups.set(start,[]);groups.get(start).push(r);}
    for(const [start,group] of groups)await insertBlock(m,kind,start,group,{preferStored});
    if(checked.length)await backend.mark(m,{[kind]:{ranges:ranges(checked)}});
   },
   state:item=>backend.state(market(item).id),states:backend.states,snapshot:backend.snapshot,readBlock:backend.read,
   async *series(item,kind,from,to,{signal,batchSize=12}={}){
    if(from>=to)return;const m=market(item),heads=await backend.heads(m.id,kind,bucket(from),bucket(to-1));
    for(let i=0;i<heads.length;i+=batchSize){
     signal?.throwIfAborted();
     const records=await backend.readMany(heads.slice(i,i+batchSize).map(h=>h.key));
     const rows=await Promise.all(records.map(async record=>{if(!record)throw Error('보관한 원본 블록을 읽을 수 없습니다.');return {head:record.head,values:await decode(record.head,record.bytes)};}));
     for(const row of rows){signal?.throwIfAborted();yield row;}
    }
   },
   async complete(item,completed){const m=market(item),s=await backend.state(m.id);if(!s?.candles.count||!s?.funding.count||missing(s.candles.ranges,completed.from,completed.to).length||missing(s.funding.ranges,completed.fundingFrom,completed.to).length)return false;await backend.mark(m,{completed});return true;},
   async importBlock(head,bytes){
    const m=validateHead(head),values=await decode(head,bytes,{validate:true}),rows=valuesAsRows(head,values);
    return insertBlock(m,head.kind,head.week,rows,{preferStored:true,encoded:{head,bytes}});
   },
   async importStates(values){
    // Merge evidence only after every promised block of the file was validated.
    const states=values.map(validatedState);for(const state of states)await backend.mark(market(state),state);
   }
  };
 }
 function memory(){
  const rows=new Map(),states=new Map(),key=k=>JSON.stringify(k),copy=v=>structuredClone(v);
  return wrap({
   read:async k=>copy(rows.get(key(k))||null),readMany:async ks=>copy(ks.map(k=>rows.get(key(k))||null)),state:async k=>copy(states.get(k)||null),states:async()=>copy([...states.values()]),
   snapshot:async()=>({keys:copy([...rows.values()].map(r=>r.head.key)),states:copy([...states.values()])}),
   heads:async(id,kind,first,last)=>copy([...rows.values()].map(r=>r.head).filter(h=>h.key[0]===id&&h.kind===kind&&h.week>=first&&h.week<=last).sort((a,b)=>a.week-b.week)),
   async commit(m,rev,next){const k=key(next.head.key),old=rows.get(k);if(old?.head.revision!==rev)return false;rows.set(k,copy(next));states.set(m.id,updatedState(m,states.get(m.id),next.head,old?.head));return true;},
   async mark(m,update){states.set(m.id,mergeState(m,states.get(m.id),update));}
  });
 }
 const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const completeTx=tx=>{const p=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('원본 자료를 브라우저에 저장하지 못했습니다.'));});p.catch(()=>{});return p;};
 async function open({indexedDB=root.indexedDB,dbName=name}={}){
  if(!indexedDB)throw Error('이 환경에서는 브라우저 원본 보관소를 열 수 없습니다.');
  const opening=indexedDB.open(dbName,1);opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('heads',{keyPath:'key'});db.createObjectStore('data');db.createObjectStore('markets',{keyPath:'id'});};
  const db=await request(opening);db.onversionchange=()=>db.close();
  function get(store,k){return request(db.transaction(store,'readonly').objectStore(store).get(k)).then(v=>v||null);}
  function readMany(keys){const tx=db.transaction(['heads','data'],'readonly'),heads=tx.objectStore('heads'),data=tx.objectStore('data');return Promise.all(keys.map(async key=>{const [head,bytes]=await Promise.all([request(heads.get(key)),request(data.get(key))]);return head&&bytes?{head,bytes}:null;}));}
  return wrap({
   readMany,async read(k){return (await readMany([k]))[0];},
   state:k=>get('markets',k),states:()=>request(db.transaction('markets','readonly').objectStore('markets').getAll()),
   async snapshot(){const tx=db.transaction(['heads','markets'],'readonly'),[keys,states]=await Promise.all([request(tx.objectStore('heads').getAllKeys()),request(tx.objectStore('markets').getAll())]);return {keys,states};},
   heads:(id,k,first,last)=>request(db.transaction('heads','readonly').objectStore('heads').getAll(root.IDBKeyRange.bound([id,k,first],[id,k,last]))),
   async commit(m,revision,{head,bytes}){
    const tx=db.transaction(['heads','data','markets'],'readwrite'),done=completeTx(tx),h=tx.objectStore('heads'),ms=tx.objectStore('markets'),[old,state]=await Promise.all([request(h.get(head.key)),request(ms.get(m.id))]);
    if(old?.revision!==revision){await done;return false;}
    h.put(head);tx.objectStore('data').put(bytes,head.key);ms.put(updatedState(m,state,head,old));await done;return true;
   },
   async mark(m,update){const tx=db.transaction('markets','readwrite'),done=completeTx(tx),ms=tx.objectStore('markets'),state=await request(ms.get(m.id));ms.put(mergeState(m,state,update));await done;}
  });
 }
 let shared;
 return {name,week,bucket,market,ranges,missing,validCandle,fundingRow,rowAt,validateHead,validatedState,maxBlockBytes,memory,open,getDefault:()=>shared??=open()};
});
