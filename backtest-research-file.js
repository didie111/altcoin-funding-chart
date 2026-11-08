(function(root,factory){
 'use strict';
 const c=typeof module==='object'&&module.exports,api=factory(root,c?require('./backtest-research-store.js'):root.BacktestResearchStore,c?require('./backtest-archive.js'):root.BacktestArchive,c?require('./backtest-backup.js'):root.BacktestBackup);
 if(c)module.exports=api;else root.BacktestResearchFile=api;
})(globalThis,function(root,S,A,Backup){
 'use strict';
 const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true}),magic=enc.encode('FUNDING-RESEARCH-1\n'),endMagic=enc.encode('FUNDING-RESEARCH-END\n'),metaLimit=16*1048576,legacyLimit=160*1048576,downloadLimit=128*1048576,descriptorLimit=4096;
 const u32=n=>{const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n,true);return a;},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]),json=value=>enc.encode(JSON.stringify(value));
 const aborted=()=>new AbortController().signal;
 function join(a,b){const out=new Uint8Array(a.length+b.length);out.set(a);out.set(b,a.length);return out;}
 async function isResearch(file){return file.size>=magic.length&&equal(new Uint8Array(await file.slice(0,magic.length).arrayBuffer()),magic);}
 async function write(store,legacy,sink,{signal=aborted(),onProgress=()=>{},snapshot}={}){
  signal.throwIfAborted();const {keys,states}=snapshot??await store.snapshot();
  if(!keys.length)throw Error('보관된 원본이 없습니다. 먼저 원본 수집·이어서를 실행하세요.');
  const manifest=json({version:1,blocks:keys.length,markets:states.map(s=>S.validatedState(s))}),meta=await Backup.blob({...legacy,pages:[]});
  if(manifest.length>metaLimit||meta.size>legacyLimit)throw Error('백업 설정·결과 자료의 크기 한도를 초과했습니다.');
  let bytes=0;async function part(value){signal.throwIfAborted();await sink.write(value);bytes+=value.size??value.byteLength;}
  await part(magic);await part(u32(manifest.length));await part(enc.encode(await A.sha256(manifest)));await part(manifest);await part(u32(meta.size));await part(enc.encode(await A.sha256(await meta.arrayBuffer())));await part(meta);
  let blocks=0;for(const key of keys){
   signal.throwIfAborted();const record=await store.readBlock(key);if(!record)throw Error('백업 도중 원본 블록을 읽을 수 없습니다.');
   const {head,bytes:body}=record,SHA=await A.sha256(join(json(head),body)),descriptor=json({head,SHA});
   if(descriptor.length>descriptorLimit)throw Error('원본 블록 설명이 너무 큽니다.');
   await part(u32(descriptor.length));await part(descriptor);await part(body);
   blocks++;if(blocks===keys.length||blocks%16===0)onProgress({phase:'archive-export',blocks,total:keys.length,bytes});
  }
  await part(u32(blocks));await part(endMagic);return {blocks,markets:states.filter(s=>s.candles.count||s.funding.count).length,bytes};
 }
 async function restore(file,store,{signal=aborted(),onProgress=()=>{},beforeImport}={}){
  if(!await isResearch(file))throw Error('지원하지 않는 원본 백업 파일입니다.');
  const limit=file.size-endMagic.length-4;
  if(limit<magic.length+4+64+4||!equal(new Uint8Array(await file.slice(file.size-endMagic.length).arrayBuffer()),endMagic))throw Error('원본 백업이 끝까지 저장되지 않았습니다. 기존 기록은 유지됩니다.');
  const footer=new DataView(await file.slice(limit,limit+4).arrayBuffer()).getUint32(0,true);let offset=magic.length;
  async function bytes(n,max){signal.throwIfAborted();if(!Number.isSafeInteger(n)||n<0||n>max||offset+n>limit)throw Error('원본 백업 파일 길이가 일치하지 않습니다.');const v=new Uint8Array(await file.slice(offset,offset+n).arrayBuffer());offset+=n;return v;}
  const length=async()=>new DataView((await bytes(4,4)).buffer).getUint32(0,true),parse=b=>JSON.parse(dec.decode(b));
  const manifestLen=await length(),hash=dec.decode(await bytes(64,64)),rawManifest=await bytes(manifestLen,metaLimit);
  if(await A.sha256(rawManifest)!==hash)throw Error('백업 원본 범위의 무결성 검증에 실패했습니다.');
  const info=parse(rawManifest);
  if(info.version!==1||!Array.isArray(info.markets)||info.markets.length>10000||info.blocks!==footer||!Number.isSafeInteger(info.blocks)||info.blocks<1||info.blocks>5000000)throw Error('백업 원본의 버전 또는 자료 개수를 확인하세요.');
  const states=info.markets.map(S.validatedState),markets=new Map(states.map(state=>[state.id,state]));
  if(markets.size!==states.length)throw Error('백업에 중복 거래소·코인이 있습니다.');
  const legacyLength=await length(),legacyHash=dec.decode(await bytes(64,64)),legacyData=await bytes(legacyLength,legacyLimit);
  if(await A.sha256(legacyData)!==legacyHash)throw Error('백업의 설정·결과 무결성 검증에 실패했습니다.');
  const legacy=parse(legacyData);
  if(legacy?.app!=='funding-chart-batch-v1'||legacy.version!==1||!Array.isArray(legacy.pages)||legacy.pages.length||!Array.isArray(legacy.jobs))throw Error('원본 백업의 설정·결과를 확인하세요.');
  if(beforeImport){await beforeImport(legacy);signal.throwIfAborted();}
  const seen=new Set(),counts=new Map();
  for(let i=0;i<info.blocks;i++){
   const {head,SHA}=parse(await bytes(await length(),descriptorLimit)),m=S.validateHead(head),key=JSON.stringify(head.key);
   if(seen.has(key)||!markets.has(m.id))throw Error('백업의 원본 블록 목록이 일치하지 않습니다.');seen.add(key);
   const body=await bytes(head.bytes,S.maxBlockBytes);
   if(await A.sha256(join(json(head),body))!==SHA)throw Error('백업 원본 블록의 무결성 검증에 실패했습니다. ('+m.symbol+')');
   await store.importBlock(head,body);const row=counts.get(m.id)||{candles:0,funding:0};row[head.kind]+=head.count;counts.set(m.id,row);
   if(i+1===info.blocks||(i+1)%16===0)onProgress({phase:'archive-import',blocks:i+1,total:info.blocks,bytes:offset});
  }
  if(offset!==limit)throw Error('백업 파일 끝 위치가 일치하지 않습니다.');
  for(const s of states)if(s.completed&&(!counts.get(s.id)?.candles||!counts.get(s.id)?.funding))throw Error('완료 범위에 필요한 1분봉 또는 펀딩 원본이 빠져 있습니다.');
  await store.importStates(states);return {legacy,blocks:info.blocks,markets:counts.size,bytes:file.size};
 }
 function filename(now=Date.now()){return Backup.filename(now).replace('funding-chart-backup-','funding-chart-research-');}
 function download(environment,doc,file,name,cleanup=()=>{}){
  const url=environment.URL.createObjectURL(file),link=doc.createElement('a');link.href=url;link.download=name;doc.body.append(link);
  try{link.click();}finally{link.remove();environment.setTimeout(()=>{environment.URL.revokeObjectURL(url);void cleanup();},600000);}
 }
 async function save(store,readLegacy,{environment=root,document=environment.document,onProgress=()=>{},signal=aborted(),optional=false,name=optional?Backup.filename():filename()}={}){
  let selection;
  if(typeof environment.showSaveFilePicker==='function'){
   try{selection=Promise.resolve(environment.showSaveFilePicker({suggestedName:name,types:[{description:'백테스트 원본 포함 백업',accept:{'application/octet-stream':['.dat']}}]})).then(handle=>({handle}),error=>({error}));}
   catch(error){selection=Promise.resolve({error});}
  }
  const chosen=selection?await selection:null;if(chosen?.error?.name==='AbortError')throw chosen.error;
  signal.throwIfAborted();const source=await store,snapshot=await source?.snapshot(),includeRaw=Boolean(snapshot?.keys.length);
  if(!includeRaw&&!optional)throw Error('보관된 원본이 없습니다. 먼저 원본 수집·이어서를 실행하세요.');
  const legacy=await readLegacy(includeRaw);let sink,dir,temp,handle=chosen?.handle,parts=null;
  try{
   if(!handle&&includeRaw&&environment.navigator?.storage?.getDirectory){
    try{
     dir=await environment.navigator.storage.getDirectory();
     if(typeof dir.entries==='function')for await(const [key,entry] of dir.entries()){if(key.startsWith('tmp-research-export-')&&entry.kind==='file'){try{const old=await entry.getFile();if(Date.now()-old.lastModified>86400000)await dir.removeEntry(key);}catch{}}}
     temp='tmp-research-export-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.dat';
     const target=await dir.getFileHandle(temp,{create:true});if(typeof target.createWritable==='function')handle=target;
    }catch(error){if(error.name==='QuotaExceededError')throw error;dir=null;temp=null;}
   }
   if(handle)sink=await handle.createWritable();
   else{let size=0;parts=[];sink={write(p){size+=p.size??p.byteLength;if(size>(includeRaw?downloadLimit:legacyLimit))throw Error('이 브라우저는 큰 원본 파일을 바로 저장할 수 없습니다. Chrome·Edge 등 파일 저장 창을 지원하는 브라우저에서 원본 포함 백업을 실행하세요.');parts.push(p);},close(){},abort(){parts.length=0;}};}
   let raw;
   if(includeRaw)raw=await write(source,legacy,sink,{signal,onProgress,snapshot});
   else{const file=await Backup.blob(legacy);await sink.write(file);raw={blocks:0,markets:0,bytes:file.size};}
   await sink.close();
   const result={...raw,includesRaw:includeRaw,favorites:legacy.favorites?.length||0,jobs:legacy.jobs.length,completedResults:legacy.completedResults?.entries?.length||0};
   if(chosen?.handle)return {...result,method:'file'};
   const file=parts?new Blob(parts,{type:'application/octet-stream'}):await handle.getFile(),cleanup=async()=>{if(dir&&temp)try{await dir.removeEntry(temp);}catch{}};
   download(environment,document,file,name,cleanup);return {...result,method:'download'};
  }catch(error){try{await sink?.abort?.();}catch{}if(dir&&temp)try{await dir.removeEntry(temp);}catch{}throw error;}
 }
 return {isResearch,write,restore,filename,save};
});
