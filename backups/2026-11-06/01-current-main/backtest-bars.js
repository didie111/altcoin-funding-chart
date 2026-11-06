(function(root,factory){
 'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestBars=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Fixed-size blocks are filled newest first as exchange pages arrive. The
 // worker reads them oldest first without copying millions of candle objects.
 const kind='packed-ohlcv-v1',blockSize=8192,stride=6;
 function builder(){
  const blocks=[];let length=0,previous=Infinity,finished=false;
  function push(row){
   if(finished)throw Error('이미 완료한 캔들 수집입니다.');
   if(!row||!Number.isFinite(row.time)||!Number.isFinite(row.open)||!Number.isFinite(row.high)||!Number.isFinite(row.low)||!Number.isFinite(row.close)||!Number.isFinite(row.volume)||row.time>=previous)throw Error('캔들 순서 또는 값이 올바르지 않습니다.');
   const block=Math.floor(length/blockSize),offset=(length%blockSize)*stride;
   if(!blocks[block]){try{blocks.push(new Float64Array(blockSize*stride));}catch(error){throw Error('백테스트에 사용할 메모리가 부족합니다. 기간이나 주기 비교 범위를 줄여 주세요.');}}
   const out=blocks[block];out[offset]=row.time;out[offset+1]=row.open;out[offset+2]=row.high;out[offset+3]=row.low;out[offset+4]=row.close;out[offset+5]=row.volume;
   previous=row.time;length++;
  }
  return {push,get length(){return length;},finish(){finished=true;return {kind,blockSize,length,blocks};}};
 }
 function isPacked(rows){return Boolean(rows&&rows.kind===kind&&Number.isSafeInteger(rows.length)&&rows.length>=0&&rows.blockSize===blockSize&&Array.isArray(rows.blocks));}
 function time(rows,index){
  if(!isPacked(rows))return rows[index]?.time;if(!Number.isInteger(index)||index<0||index>=rows.length)return undefined;
  const reverse=rows.length-1-index,block=rows.blocks[Math.floor(reverse/blockSize)];return block?.[(reverse%blockSize)*stride];
 }
 function get(rows,index,out){
  if(!isPacked(rows))return rows[index];if(!Number.isInteger(index)||index<0||index>=rows.length)return undefined;
  const reverse=rows.length-1-index,block=rows.blocks[Math.floor(reverse/blockSize)],offset=(reverse%blockSize)*stride,r=out||{};if(!block||block.length<offset+stride)return undefined;
  r.time=block[offset];r.open=block[offset+1];r.high=block[offset+2];r.low=block[offset+3];r.close=block[offset+4];r.volume=block[offset+5];return r;
 }
 function transferables(dataset){
  const buffers=[],seen=new Set();for(const rows of Object.values(dataset?.timeframeCandles||{}))if(isPacked(rows))for(const block of rows.blocks){const buffer=block?.buffer;if(buffer&&!seen.has(buffer)){seen.add(buffer);buffers.push(buffer);}}
  return buffers;
 }
 function recommendedMaxBars(deviceMemory){
  // Keep approximately 256–768 MiB for compact OHLCV, with headroom for RSI,
  // results and the chart. Browsers which do not expose RAM use the 768 MiB cap.
  const memory=Number(deviceMemory),mib=Number.isFinite(memory)&&memory>0?Math.max(256,Math.min(768,memory*128)):768;
  return Math.min(16000000,Math.floor(mib*1048576/(stride*8)));
 }
 return {builder,isPacked,time,get,transferables,recommendedMaxBars};
});
