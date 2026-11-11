'use strict';
const partLimit=256*1048576;
let directory,partBytes=partLimit,activePart=null,total=0;
const parts=[];
async function closePart(){
 if(!activePart)return;
 const p=activePart;activePart=null;
 if(p.sync){try{p.writer.flush();}finally{p.writer.close();}}
 else await p.writer.close();
 parts.push(p.file);
}
async function openPart(){
 const file=await directory.getFileHandle(String(parts.length)+'.part',{create:true});
 let writer,sync=false;
 if(typeof file.createSyncAccessHandle==='function'){
  try{writer=await file.createSyncAccessHandle();sync=true;}
  catch(error){if(typeof file.createWritable!=='function')throw error;}
 }
 if(!writer)writer=await file.createWritable();
 activePart={file,writer,sync,bytes:0};
}
async function append(bytes){
 for(let offset=0;offset<bytes.length;){
  if(!activePart)await openPart();
  const p=activePart,take=Math.min(partBytes-p.bytes,bytes.length-offset),chunk=bytes.subarray(offset,offset+take);
  if(p.sync){
   for(let written=0;written<chunk.length;){
    const n=p.writer.write(chunk.subarray(written),{at:p.bytes+written});
    if(!Number.isSafeInteger(n)||n<=0||n>chunk.length-written)throw Error('백업 임시 파일의 쓰기가 중단되었습니다.');
    written+=n;
   }
  }else await p.writer.write(chunk);
  p.bytes+=take;total+=take;offset+=take;
  if(p.bytes===partBytes)await closePart();
 }
}
async function appendValue(value){
 if(value instanceof Blob){
  const reader=value.stream().getReader();
  try{for(;;){const {done,value:bytes}=await reader.read();if(done)break;await append(bytes);}}finally{reader.releaseLock();}
 }else if(value instanceof Uint8Array)await append(value);
 else throw Error('백업에 쓸 자료 형식이 올바르지 않습니다.');
}
onmessage=async({data:{id,op,name,value,limit}})=>{
 try{
  let output;
  if(op==='open'){
   if(directory||!/^tmp-research-export-v2-\d+-[a-z0-9]+$/.test(name))throw Error('백업 임시 저장 경로가 올바르지 않습니다.');
   const root=await navigator.storage.getDirectory();
   // Clear only stale scratch files from this app; an active download can still be reading recent ones.
   if(typeof root.entries==='function')for await(const [key,handle] of root.entries()){
    const match=handle.kind==='directory'?/^tmp-research-export-v2-(\d+)-[a-z0-9]+$/.exec(key):/^tmp-research-export-(\d+)-[a-z0-9]+\.dat$/.exec(key),created=Number(match?.[1]);
    if(created>0&&Date.now()-created>86400000)try{await root.removeEntry(key,{recursive:handle.kind==='directory'});}catch{}
   }
   directory=await root.getDirectoryHandle(name,{create:true});
   if(Number.isSafeInteger(limit)&&limit>0)partBytes=Math.min(limit,partLimit);
  }else if(op==='write'&&directory)await appendValue(value);
  else if(op==='close'&&directory){
   await closePart();const files=await Promise.all(parts.map(p=>p.getFile()));
   if(!files.length||files.reduce((n,f)=>n+f.size,0)!==total)throw Error('백업 임시 파일의 길이가 일치하지 않습니다.');
   output={files};
  }else throw Error('백업 쓰기 순서를 확인하세요.');
  postMessage({id,output});
 }catch(error){postMessage({id,error:{name:error.name,message:error.message}});}
};
