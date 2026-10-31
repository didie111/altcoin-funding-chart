(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BacktestBatch=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const clone=value=>structuredClone(value);
 function create({store,execute,now=Date.now,onUpdate=()=>{},onProgress=()=>{}}){
  let job=null,abort=null,active=null,starting=false,stopRequested=false;
  async function persist(){job.updated=now();await store.saveJob(clone(job));onUpdate(clone(job));}
  function createJob(markets,config,{allHistory=false}={}){const map=new Map();for(const m of markets)map.set(m.exchange+':'+m.symbol,{exchange:m.exchange,symbol:m.symbol});if(!map.size)throw Error('즐겨찾기 코인을 먼저 추가하세요.');const endTime=allHistory?Math.floor(now()/1000):Math.min(config.endTime,Math.floor(now()/1000)),startTime=allHistory?Date.UTC(2009,0,1)/1000:config.startTime;if(!Number.isFinite(startTime)||!Number.isFinite(endTime)||startTime>=endTime)throw Error('백테스트 기간을 확인하세요.');return {id:'batch-'+now()+'-'+Math.random().toString(36).slice(2,8),version:1,created:now(),updated:now(),status:'ready',allHistory,config:{...clone(config),startTime,endTime},items:[...map.values()].map(m=>({...m,status:'pending'}))};}
  async function run(){
   if(abort||!job)return;abort=new AbortController();const signal=abort.signal;job.status='running';await persist();
   try{for(const item of job.items){if(['done','error','deferred'].includes(item.status))continue;signal.throwIfAborted();item.status='running';active=item;onUpdate(clone(job));try{const output=await execute(clone(item),clone(job.config),signal,p=>{if(!signal.aborted)onProgress({item:clone(item),progress:p});});signal.throwIfAborted();if(output.meta?.market?.symbol!==item.symbol||output.meta?.market?.ex!==item.exchange||output.meta?.market?.int!==job.config.timeframe)throw Error('실행 대상과 다른 코인·주기 결과를 받았습니다.');Object.assign(item,{...output,status:'done'});delete item.error;}
     catch(error){if(signal.aborted){item.status='pending';throw signal.reason;}if(error.name==='RateLimitError'){item.status='pending';job.status='paused';job.message=error.message;job.retryAt=error.retryAt||now()+60000;await persist();return;}item.status='error';item.error=error.message;
      if(error.name==='MarketServiceError'||/연결 실패:|HTTP (?:403|451|5\d\d)/.test(error.message))for(const next of job.items)if(next.status==='pending'&&next.exchange===item.exchange){next.status='deferred';next.error='거래소 연결 문제로 조회 보류 · '+error.message;}
     }
     finally{active=null;}await persist();}
    job.status=job.items.some(i=>['error','deferred'].includes(i.status))?'partial':'done';delete job.message;delete job.retryAt;await persist();
   }catch(error){if(signal.aborted){job.status='paused';job.message='중지했습니다. 완료된 코인은 유지하고 진행 중 코인부터 이어서 계산합니다.';await persist();}else{job.status='paused';job.message=error.message;await persist();}}
   finally{abort=null;active=null;onUpdate(clone(job));}
  }
  return {get busy(){return Boolean(abort)||starting;},snapshot:()=>job?clone(job):null,
   async restore(){if(abort)return;job=await store.latestJob();if(job){for(const item of job.items)if(item.status==='running')item.status='pending';if(job.status==='running')job.status='paused';onUpdate(clone(job));}return job?clone(job):null;},
   async start(markets,config,options){if(abort||starting)throw Error('실행 중인 작업을 먼저 중지하세요.');starting=true;stopRequested=false;try{job=createJob(markets,config,options);await persist();}finally{starting=false;}if(stopRequested){job.status='paused';await persist();return;}return run();},
   async resume({retryErrors=false}={}){if(abort||!job)return;if(job.retryAt>now())throw Error('API 대기 시간이 남았습니다. '+Math.ceil((job.retryAt-now())/1000)+'초 후 이어서 실행하세요.');if(retryErrors)for(const item of job.items)if(['error','deferred'].includes(item.status)){item.status='pending';delete item.error;}return run();},
   pause(){stopRequested=true;if(!abort)return;abort.abort(new DOMException('일괄 테스트 중지','AbortError'));if(active)active.status='pending';},
   createJob
  };
 }
 return {create};
});
