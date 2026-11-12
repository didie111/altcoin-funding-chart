(function(root,factory){
 'use strict';
 const c=typeof module==='object'&&module.exports,api=factory(root,c?require('./backtest-research-store.js'):root.BacktestResearchStore,c?require('./backtest-archive.js'):root.BacktestArchive,c?require('./backtest-backup.js'):root.BacktestBackup);
 if(c)module.exports=api;else root.BacktestResearchFile=api;
})(globalThis,function(root,S,A,Backup){
 'use strict';
 const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true}),magic=enc.encode('FUNDING-RESEARCH-1\n'),endMagic=enc.encode('FUNDING-RESEARCH-END\n'),metaLimit=16*1048576,legacyLimit=160*1048576,downloadLimit=128*1048576,descriptorLimit=4096;
 const u32=n=>{const a=new Uint8Array(4);new DataView(a.buffer).setUint32(0,n,true);return a;},equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]),json=value=>enc.encode(JSON.stringify(value)),scriptURL=root.document?.currentScript?.src;
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
   const block=new Uint8Array(4+descriptor.length+body.length);
   block.set(u32(descriptor.length));block.set(descriptor,4);block.set(body,4+descriptor.length);
   await part(block);
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
 function download(environment,doc,file,name,cleanup){
  const url=environment.URL.createObjectURL(file);let link;
  try{link=doc.createElement('a');link.href=url;link.download=name;doc.body.append(link);link.click();}
  catch(error){environment.URL.revokeObjectURL(url);throw error;}
  finally{link?.remove();}
  // The download may still be reading the disk-backed parts after link.click().
  environment.setTimeout(()=>{environment.URL.revokeObjectURL(url);void cleanup?.();},cleanup?3600000:600000);
 }
 class OutputError extends Error{constructor(cause){super(cause.message,{cause});}}
 async function output(action){try{return await action();}catch(error){throw new OutputError(error);}}
 async function writeTo(open,produce,signal){
  let sink;
  try{
   signal.throwIfAborted();sink=await output(open);
   const raw=await produce({write:value=>output(()=>sink.write(value))});
   signal.throwIfAborted();const file=await output(()=>sink.close());return {raw,file};
  }catch(error){try{await sink?.abort?.();}catch{}signal.throwIfAborted();throw error;}
 }
 async function stagingSink(environment,doc,signal){
  const name='tmp-research-export-v2-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  const worker=new environment.Worker(new URL('backtest-export-worker.js?v=20261109-funding-backup-fix-1',scriptURL||doc.baseURI).href);
  let pending,id=0,stopped=false;
  const cleanup=async()=>{try{const dir=await environment.navigator.storage.getDirectory();await dir.removeEntry(name,{recursive:true});}catch{}};
  function stop(error){
   if(stopped)return;stopped=true;worker.terminate();signal.removeEventListener('abort',cancel);
   if(pending){const reply=pending;pending=null;reply.reject(error);}
  }
  function cancel(){stop(signal.reason);}
  worker.onerror=event=>{event.preventDefault?.();stop(event.error||Error(event.message||'백업 임시 저장을 시작하지 못했습니다.'));};
  worker.onmessageerror=()=>stop(Error('백업 임시 파일을 읽을 수 없습니다.'));
  worker.onmessage=({data})=>{
   if(pending?.id!==data.id)return;
   const reply=pending;pending=null;
   if(data.error)reply.reject(Object.assign(Error(data.error.message),{name:data.error.name}));else reply.resolve(data.output);
  };
  function send(op,params={}){
   return new Promise((resolve,reject)=>{
    signal.throwIfAborted();if(stopped)throw Error('백업 임시 저장이 중단되었습니다.');
    pending={id:++id,resolve,reject};
    try{worker.postMessage({id,op,...params});}catch(error){pending=null;throw error;}
   });
  }
  signal.addEventListener('abort',cancel,{once:true});
  async function abort(){stop();await cleanup();}
  try{await send('open',{name});}
  catch(error){await abort();throw error;}
  return {write:value=>send('write',{value}),async close(){const {files}=await send('close');stop();return new Blob(files,{type:'application/octet-stream'});},abort,cleanup};
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
  const legacy=await readLegacy(includeRaw);
  const produce=async sink=>{
   if(includeRaw)return write(source,legacy,sink,{signal,onProgress,snapshot});
   signal.throwIfAborted();const file=await Backup.blob(legacy);await sink.write(file);return {blocks:0,markets:0,bytes:file.size};
  };
  const result=(raw,method)=>({...raw,includesRaw:includeRaw,favorites:legacy.favorites?.length||0,jobs:legacy.jobs.length,completedResults:legacy.completedResults?.entries?.length||0,method});
  let storageError=chosen?.error;
  const failed=error=>{signal.throwIfAborted();if(!(error instanceof OutputError))throw error;storageError=error.cause;};
  if(chosen?.handle){
   try{const {raw}=await writeTo(()=>chosen.handle.createWritable(),produce,signal);return result(raw,'file');}
   catch(error){failed(error);}
  }
  if(includeRaw&&environment.Worker&&environment.navigator?.storage?.getDirectory&&document){
   let stage;
   try{
    onProgress({phase:'archive-staging'});
    const {raw,file}=await writeTo(async()=>stage=await stagingSink(environment,document,signal),produce,signal);
    try{signal.throwIfAborted();await output(()=>download(environment,document,file,name,stage.cleanup));}
    catch(error){await stage.cleanup();throw error;}
    return result(raw,'download');
   }catch(error){failed(error);}
  }
  if(!includeRaw||snapshot.states.reduce((n,s)=>n+s.bytes,0)<=downloadLimit){
   const parts=[],limit=includeRaw?downloadLimit:legacyLimit;let size=0;
   try{
    const {raw,file}=await writeTo(()=>({
     write(p){size+=p.size??p.byteLength;if(size>limit)throw Error('백업 파일이 브라우저의 직접 다운로드 한도를 넘었습니다.');parts.push(p);},
     close:()=>new Blob(parts,{type:'application/octet-stream'}),abort:()=>{parts.length=0;}
    }),produce,signal);
    await output(()=>download(environment,document,file,name));return result(raw,'download');
   }catch(error){failed(error);}
  }
  if(storageError?.name==='QuotaExceededError')throw Error('백업 파일을 만들 공간이 부족합니다. 디스크 여유 공간을 확보한 뒤 다시 저장하세요. 이미 보관한 원본은 유지됩니다.',{cause:storageError});
  throw Error('백업 파일을 저장할 수 없습니다. 다운로드 폴더에 파일을 쓸 수 있는지와 디스크 여유 공간을 확인한 뒤 다시 시도하세요. 이미 보관한 원본은 유지됩니다.',{cause:storageError});
 }
 return {isResearch,write,restore,filename,save};
});
