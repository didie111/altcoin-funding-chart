(function(root,factory){'use strict';const api=factory(typeof module==='object'&&module.exports?require('./timeframes.js'):TimeframeEngine);if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestArchive=api;})(typeof globalThis!=='undefined'?globalThis:this,function(T){
 'use strict';
 const maxZip=16*1048576,maxRaw=24*1048576,host='https://data.binance.vision',decoder=new TextDecoder('utf-8',{fatal:true});
 const K=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
 const bytes=value=>value instanceof Uint8Array?value:new Uint8Array(value);
 const hex=value=>[...value].map(n=>n.toString(16).padStart(2,'0')).join('');
 async function sha256(value,{native=true}={}){
  const data=bytes(value);if(native&&globalThis.crypto?.subtle)return hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',data)));
  // Portable SHA-256 for local HTTP previews; HTTPS uses native Web Crypto.
  const buffer=new Uint8Array(Math.ceil((data.length+9)/64)*64),v=new DataView(buffer.buffer),w=new Uint32Array(64),h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),r=(x,n)=>(x>>>n)|(x<<(32-n));buffer.set(data);buffer[data.length]=128;v.setUint32(buffer.length-8,Math.floor(data.length/536870912));v.setUint32(buffer.length-4,data.length*8>>>0);
  for(let p=0;p<buffer.length;p+=64){for(let i=0;i<16;i++)w[i]=v.getUint32(p+i*4);for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=w[i-16]+(r(a,7)^r(a,18)^(a>>>3))+w[i-7]+(r(b,17)^r(b,19)^(b>>>10));}let [a,b,c,d,e,f,g,z]=h;for(let i=0;i<64;i++){const t1=(z+(r(e,6)^r(e,11)^r(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((r(a,2)^r(a,13)^r(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,z].forEach((n,i)=>h[i]=(h[i]+n)>>>0);}
  return [...h].map(n=>n.toString(16).padStart(8,'0')).join('');
 }
 const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
 function crc32(data){let crc=0xffffffff;for(const b of bytes(data))crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
 function specification(symbol,tf,edge,lower,now=Date.now()){
  if(!/^[A-Z0-9]{1,28}USDT$/.test(symbol)||!T.seconds[tf]||T.seconds[tf]>3600||!Number.isFinite(edge)||!Number.isFinite(lower))return null;
  const time=Math.min(edge/1000,now/1000),month=T.start(time,'1M'),currentMonth=T.start(now/1000,'1M');let from=month,to=T.end(month,'1M'),kind='monthly';
  if(to>currentMonth){if(tf!=='1m')return null;from=T.start(time,'1d');to=T.end(from,'1d');if(to>T.start(now/1000,'1d'))return null;kind='daily';}
  const count=T.closedRange(Math.max(from,lower),Math.min(to,T.end(T.start(time,tf),tf)),tf).count;if(count<500)return null;
  const date=new Date(from*1000).toISOString().slice(0,kind==='monthly'?7:10),filename=symbol+'-'+tf+'-'+date+'.zip',url=host+'/data/futures/um/'+kind+'/klines/'+symbol+'/'+tf+'/'+filename;
  return {symbol,timeframe:tf,from,to,kind,date,filename,url,csv:filename.replace(/\.zip$/,'.csv')};
 }
 function allowedUrl(value,symbol,tf){try{const u=new URL(value),parts=u.pathname.split('/'),file=parts.at(-1),pattern=new RegExp('^'+symbol+'-'+tf+'-\\d{4}-\\d{2}'+(parts[4]==='daily'?'-\\d{2}':'')+'\\.zip(?:\\.CHECKSUM)?$');return u.origin===host&&!u.search&&!u.hash&&!u.username&&!u.password&&parts.length===9&&parts.slice(1,4).join('/')==='data/futures/um'&&['monthly','daily'].includes(parts[4])&&parts[5]==='klines'&&parts[6]===symbol&&parts[7]===tf&&pattern.test(file);}catch{return false;}}
 async function fetchAsset(url,kind,signal=new AbortController().signal,fetcher=globalThis.fetch){
  const limit=kind==='zip'?maxZip:4096,controller=new AbortController(),abort=()=>controller.abort(signal.reason),timer=setTimeout(()=>controller.abort(new DOMException('공식 과거 파일 응답 제한','TimeoutError')),15000);signal.throwIfAborted();signal.addEventListener('abort',abort,{once:true});let reader;
  try{const response=await fetcher(url,{signal:controller.signal,credentials:'omit',cache:'no-store'});if(!response.ok)throw Object.assign(Error('공식 과거 파일 HTTP '+response.status),{status:response.status,name:'ArchiveHTTPError'});if(Number(response.headers?.get('content-length'))>limit)throw Error('공식 과거 파일 크기 제한을 초과했습니다.');reader=response.body?.getReader();if(!reader)throw Error('공식 과거 파일 본문을 읽을 수 없습니다.');const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('공식 과거 파일 크기 제한을 초과했습니다.');chunks.push(value);}const result=new Uint8Array(size);let offset=0;for(const part of chunks){result.set(part,offset);offset+=part.length;}return kind==='zip'?result.buffer:decoder.decode(result);
  }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);if(reader)try{await reader.cancel();}catch{}}
 }
 async function inflateRaw(data,expected,signal){
  const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(),out=new Uint8Array(expected);let offset=0;try{for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;if(offset+value.length>expected)throw Error('ZIP 압축 해제 크기가 일치하지 않습니다.');out.set(value,offset);offset+=value.length;}if(offset!==expected)throw Error('ZIP 압축 해제 크기가 일치하지 않습니다.');return out;}finally{try{await reader.cancel();}catch{}}
 }
 async function unpack(value,spec,{signal=new AbortController().signal,inflate=inflateRaw}={}){
  const data=bytes(value);if(data.length<22||data.length>maxZip)throw Error('공식 ZIP 파일 크기가 올바르지 않습니다.');const v=new DataView(data.buffer,data.byteOffset,data.byteLength);let eocd=-1;for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===data.length){eocd=i;break;}
  if(eocd<0||v.getUint16(eocd+4,true)||v.getUint16(eocd+6,true)||v.getUint16(eocd+8,true)!==1||v.getUint16(eocd+10,true)!==1)throw Error('단일 CSV ZIP 형식이 아닙니다.');const cd=v.getUint32(eocd+16,true),cdSize=v.getUint32(eocd+12,true);if(cd+46>eocd||cd+cdSize!==eocd||v.getUint32(cd,true)!==0x02014b50)throw Error('ZIP 중앙 목록이 올바르지 않습니다.');
  const flags=v.getUint16(cd+8,true),method=v.getUint16(cd+10,true),crc=v.getUint32(cd+16,true),compressed=v.getUint32(cd+20,true),raw=v.getUint32(cd+24,true),nameLength=v.getUint16(cd+28,true),extra=v.getUint16(cd+30,true),comment=v.getUint16(cd+32,true),local=v.getUint32(cd+42,true);
  if(flags&1||![0,8].includes(method)||!raw||raw>maxRaw||compressed>maxZip||v.getUint16(cd+34,true)||cd+46+nameLength+extra+comment!==eocd||decoder.decode(data.subarray(cd+46,cd+46+nameLength))!==spec.csv||local+30>cd||v.getUint32(local,true)!==0x04034b50||v.getUint16(local+8,true)!==method||v.getUint16(local+6,true)&1)throw Error('ZIP 계약·주기·압축 정보가 일치하지 않습니다.');
  const localName=v.getUint16(local+26,true),offset=local+30+localName+v.getUint16(local+28,true);if(offset+compressed>cd||decoder.decode(data.subarray(local+30,local+30+localName))!==spec.csv)throw Error('ZIP CSV 위치가 올바르지 않습니다.');signal.throwIfAborted();const body=method===0?data.slice(offset,offset+compressed):await inflate(data.subarray(offset,offset+compressed),raw,signal);if(body.length!==raw||crc32(body)!==crc)throw Error('ZIP CRC 검증에 실패했습니다.');return body;
 }
 function parseCsv(body,spec,signal=new AbortController().signal){
  const rows=[],lines=decoder.decode(body).replace(/^\uFEFF/,'').split('\n');let previous=null;for(let i=0;i<lines.length;i++){if(i%2048===0)signal.throwIfAborted();const line=lines[i].trim();if(!line)continue;const parts=line.split(',');if(!rows.length&&/^open[_ ]?time$/i.test(parts[0]))continue;if(parts.length<6||parts.slice(0,6).some(s=>!s.trim()||!Number.isFinite(Number(s))))throw Error('공식 CSV 캔들 값이 올바르지 않습니다.');const ms=Number(parts[0]),time=ms/1000,[open,high,low,close,volume]=parts.slice(1,6).map(Number);if(!Number.isSafeInteger(ms)||ms<1e11||ms>=1e14||!Number.isInteger(time)||time<spec.from||time>=spec.to||T.start(time,spec.timeframe)!==time||previous!==null&&T.end(previous,spec.timeframe)!==time||Math.min(open,high,low,close)<=0||volume<0||high<Math.max(open,close,low)||low>Math.min(open,close,high))throw Error('공식 CSV 범위·봉 간격·가격 검증에 실패했습니다.');rows.push({time,open,high,low,close,volume});previous=time;}
  const expected=T.closedRange(spec.from,spec.to,spec.timeframe);if(rows.length!==expected.count||rows[0]?.time!==expected.first||rows.at(-1)?.time!==expected.last)throw Error('공식 CSV에 비어 있는 캔들 구간이 있어 API로 확인합니다.');return rows;
 }
 function create({candlePage,store,loadAsset=fetchAsset,lower=()=>0,now=Date.now,onProgress=()=>{},onCache=()=>{}}){
  const failed=new Set(),stats={files:0,cachedFiles:0,downloadBytes:0,restPages:0,fallbacks:0,reasons:[]};let disabled=false,lastDecoded=null;
  try{new DecompressionStream('deflate-raw');}catch{disabled=true;}
  async function read(spec,signal){
   if(lastDecoded?.url===spec.url)return {rows:lastDecoded.rows,cached:true};const key=JSON.stringify(['binance-official-zip-v1',spec.url]);let saved=await store.get(key,now()),cached=Boolean(saved),zip,checksum;
   if(saved?.zip&&/^[a-f0-9]{64}$/.test(saved.checksum)){zip=bytes(saved.zip);checksum=saved.checksum;if(now()-saved.checkedAt>=86400000){const text=await loadAsset(spec.url+'.CHECKSUM','checksum',signal),m=text.trim().match(/^([a-f0-9]{64})\s+(.+)$/i);if(!m||m[2]!==spec.filename)throw Error('공식 체크섬 계약이 일치하지 않습니다.');if(m[1].toLowerCase()!==checksum){zip=null;cached=false;}else saved.checkedAt=now();}}
   else zip=null;
   if(!zip){const [buffer,text]=await Promise.all([loadAsset(spec.url,'zip',signal),loadAsset(spec.url+'.CHECKSUM','checksum',signal)]),m=text.trim().match(/^([a-f0-9]{64})\s+(.+)$/i);if(!m||m[2]!==spec.filename)throw Error('공식 체크섬 계약이 일치하지 않습니다.');checksum=m[1].toLowerCase();zip=bytes(buffer);stats.downloadBytes+=zip.byteLength;}
   signal.throwIfAborted();if(await sha256(zip)!==checksum)throw Error('공식 파일 SHA-256 검증에 실패했습니다.');const rows=parseCsv(await unpack(zip,spec,{signal}),spec,signal);await store.put(key,{zip,checksum,checkedAt:now()},{expires:now()+30*86400000,bytes:zip.byteLength+key.length*2+256});if(cached){stats.cachedFiles++;onCache();}lastDecoded={url:spec.url,rows};return {rows,cached};
  }
  return {info:()=>({...stats,reasons:stats.reasons.slice()}),async candlePage(ex,symbol,tf,edge,signal){
   const spec=!disabled&&ex==='BINANCE'?specification(symbol,tf,edge,lower(tf),now()):null;
   if(spec&&!failed.has(spec.url)){try{onProgress({phase:'archive',timeframe:tf,kind:spec.kind,from:spec.from,to:spec.to});const result=await read(spec,signal),rows=result.rows.filter(r=>r.time*1000<=edge);if(rows.length){stats.files++;Object.defineProperty(rows,'archiveMeta',{value:{kind:spec.kind,cached:result.cached,url:spec.url}});return rows;}}
    catch(error){signal.throwIfAborted();failed.add(spec.url);stats.fallbacks++;if(stats.reasons.length<5)stats.reasons.push(error.message);if(error.name==='TypeError'||error.name==='TimeoutError'||error.name==='ArchiveUnavailableError'||[403,429].includes(error.status)||error.status>=500)disabled=true;onProgress({phase:'archive-fallback',timeframe:tf,message:error.message});}}
   stats.restPages++;return candlePage(ex,symbol,tf,edge,signal);
  }};
 }
 return {maxZip,maxRaw,sha256,crc32,specification,allowedUrl,fetchAsset,unpack,parseCsv,create};
});
