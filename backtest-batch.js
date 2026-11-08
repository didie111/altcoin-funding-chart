(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestBatch=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clone=value=>structuredClone(value);
 function rangeFor(mode,config,previous,sameStrategy,markets){
  const allHistory=mode==='all'||mode==='saved'&&Boolean(previous?.allHistory);
  // An enlarged all-history list keeps each reused row's snapshot, while
  // newly added markets need the current cutoff (they may have listed later).
  const keys=new Set(previous?.items?.map(m=>m.exchange+':'+m.symbol));
  const includesNew=markets?.some(m=>!keys.has(m.exchange+':'+m.symbol));
  const useCutoff=previous&&(mode==='saved'||mode==='all'&&!includesNew&&previous.allHistory&&config.reuseCompleted!==false&&sameStrategy?.(config,previous.config,config.timeframe));
  return {allHistory,fixedRange:useCutoff?{startTime:previous.config.startTime,endTime:previous.config.endTime,cacheRangeEnd:previous.config.cacheRangeEnd??(previous.allHistory?'latest':previous.config.endTime)}:null};
 }
 function create({store,execute,now=Date.now,onUpdate=()=>{},onProgress=()=>{},lookup,validateStrategy}){
  let job=null,abort=null,active=null,starting=false,stopRequested=false;
  const sameMarket=(out,item,c)=>out?.meta?.market?.ex===item.exchange&&out.meta.market.symbol===item.symbol&&out.meta.market.int===c.timeframe;
  const sameSetup=(out,c)=>!validateStrategy||validateStrategy(c,out.meta.config,c.timeframe);
  async function persist(){job.updated=now();await store.saveJob(clone(job));onUpdate(clone(job));}
  function createJob(markets,config,{allHistory=false,fixedRange=null}={}){const map=new Map();for(const m of markets)map.set(m.exchange+':'+m.symbol,{exchange:m.exchange,symbol:m.symbol});if(!map.size)throw Error('즐겨찾기 코인을 먼저 추가하세요.');const endTime=fixedRange?Math.min(fixedRange.endTime,Math.floor(now()/1000)):allHistory?Math.floor(now()/1000):Math.min(config.endTime,Math.floor(now()/1000)),startTime=fixedRange?fixedRange.startTime:allHistory?Date.UTC(2009,0,1)/1000:config.startTime;if(!Number.isFinite(startTime)||!Number.isFinite(endTime)||startTime>=endTime)throw Error('백테스트 기간을 확인하세요.');return {id:'batch-'+now()+'-'+Math.random().toString(36).slice(2,8),version:1,created:now(),updated:now(),status:'ready',allHistory,config:{...clone(config),cacheMaxEnd:fixedRange?endTime:undefined,cacheRangeEnd:fixedRange?fixedRange.cacheRangeEnd:allHistory?'latest':config.cacheRangeEnd??config.endTime,startTime,endTime},items:[...map.values()].map(m=>({...m,status:'pending'}))};}
  async function run(){
   if(abort||!job)return;abort=new AbortController();const signal=abort.signal;job.status='running';await persist();let sinceSave=0,lastSave=now();
   try{for(const item of job.items){if(['done','error','deferred'].includes(item.status))continue;signal.throwIfAborted();item.status='running';active=item;onUpdate(clone(job));try{const output=await execute(clone(item),clone(job.config),signal,p=>{if(!signal.aborted)onProgress({item:clone(item),progress:p});});signal.throwIfAborted();if(!sameMarket(output,item,job.config))throw Error('실행 대상과 다른 코인·주기 결과를 받았습니다.');if(!sameSetup(output,job.config))throw Error('실행에 설정한 전략과 다른 결과를 받았습니다.');Object.assign(item,{...output,status:'done'});delete item.error;delete item.frameReuse;}
     catch(error){if(signal.aborted){item.status='pending';throw signal.reason;}if(error.name==='RateLimitError'){item.status='pending';job.status='paused';job.message=error.message;job.retryAt=error.retryAt||now()+60000;await persist();return;}item.status='error';item.error=error.message;
      if(error.name==='MarketServiceError'||/연결 실패:|HTTP (?:403|451|5\d\d)/.test(error.message))for(const next of job.items)if(next.status==='pending'&&next.exchange===item.exchange){next.status='deferred';next.error='거래소 연결 문제로 조회 보류 · '+error.message;}
     }
     finally{active=null;}if((job.config.researchOnly||item.meta?.research&&!item.meta.research.tailRefreshed)&&item.status==='done'&&++sinceSave<8&&now()-lastSave<800)onUpdate(clone(job));else{await persist();sinceSave=0;lastSave=now();}}
    job.status=job.items.some(i=>['error','deferred'].includes(i.status))?'partial':'done';delete job.message;delete job.retryAt;await persist();
   }catch(error){if(signal.aborted){job.status='paused';job.message='중지했습니다. 완료된 코인은 유지하고 진행 중 코인부터 이어서 계산합니다.';await persist();}else{job.status='paused';job.message=error.message;await persist();}}
   finally{abort=null;active=null;onUpdate(clone(job));}
  }
  async function prepare(markets,config,options){
   const next=createJob(markets,config,options);
   if(lookup&&config.reuseCompleted!==false){
    const results=await lookup(next.items,next.config);
    for(const [i,item] of next.items.entries()){const out=results[i];if(sameMarket(out,item,next.config)&&sameSetup(out,next.config))Object.assign(item,out,{status:'done'});else if(next.config.timeframe==='all'&&out?.frameReuse?.rows?.length&&out.frameReuse.missing?.length)item.frameReuse=out.frameReuse;}
   }
   return next;
  }
  async function start(build){
   if(abort||starting)throw Error('실행 중인 작업을 먼저 중지하세요.');
   starting=true;stopRequested=false;
   try{job=await build();if(job.items.every(i=>i.status==='done'))job.status='done';await persist();}finally{starting=false;}
   if(stopRequested){job.status='paused';await persist();return;}
   if(job.status!=='done')return run();
  }
  return {get busy(){return Boolean(abort)||starting;},snapshot:()=>job?clone(job):null,
   async restore(id){if(abort||starting)return;job=id&&store.getJob?await store.getJob(id):store.activeJob?await store.activeJob():await store.latestJob();if(job){for(const item of job.items)if(item.status==='running')item.status='pending';if(job.status==='running')job.status='paused';onUpdate(clone(job));}return job?clone(job):null;},
   prepare,start(markets,config,options){return start(()=>prepare(markets,config,options));},startPrepared(next){return start(()=>next);},
   async resume({retryErrors=false}={}){if(abort||!job)return;if(job.retryAt>now())throw Error('API 대기 시간이 남았습니다. '+Math.ceil((job.retryAt-now())/1000)+'초 후 이어서 실행하세요.');if(retryErrors)for(const item of job.items)if(['error','deferred'].includes(item.status)){item.status='pending';delete item.error;}return run();},
   pause(){stopRequested=true;if(!abort)return;abort.abort(new DOMException('일괄 테스트 중지','AbortError'));if(active)active.status='pending';},
   createJob
  };
 }
 return {create,rangeFor};
});
