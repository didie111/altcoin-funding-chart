(function(root){
 'use strict';
 function bind({host,report,getConfig,isBusy,onBusy,onOpen,onResult,onSettings}){
  const doc=host.ownerDocument,F=root.CoinFavorites,M=root.DashboardModel,storePromise=root.BacktestCache.open(),resultsPromise=root.BacktestResults?.getDefault(),node=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const panel=node('section',undefined,'bt-batch');panel.setAttribute('aria-label','즐겨찾기 일괄 백테스트');
  panel.innerHTML='<header class="bt-batch-heading"><div><span>WATCHLIST RESEARCH</span><h3>즐겨찾기 일괄 백테스트</h3></div><button type="button" id="btBatchManage">★ 즐겨찾기 편집</button></header><div class="bt-batch-setup"><label>테스트 주기<select id="btBatchFrame"><option value="">백테스팅 설정 주기</option><option value="all">1분봉 ~ 월봉 전체 주기 · 실제 1분봉 집계</option>'+Object.entries(M.labels).map(([v,t])=>'<option value="'+v+'">'+t+'</option>').join('')+'</select></label><label>기간<select id="btBatchPeriod"><option value="settings">현재 설정 기간</option><option value="all">전체 과거 ~ 현재 · 직접 선택</option></select></label><label class="bt-batch-speed" id="btBatchResearchChoice" hidden><input id="btBatchResearchOnly" type="checkbox">보관 원본만 사용 · 거래소 재조회 없음</label><label class="bt-batch-speed"><input id="btBatchPrepare" type="checkbox">1분봉을 새로 계산할 때 다른 주기도 준비</label><small>조건이 같은 저장 결과는 완료로 먼저 표시합니다. 결과가 없거나 조건이 달라진 코인·주기만 계산합니다.</small><label class="bt-batch-speed"><input id="btBatchArchive" type="checkbox" checked>공식 과거 파일로 빠르게 읽기 · Binance</label><button type="button" id="btBatchSettings">기간·전략 설정</button><button type="button" class="bt-primary" id="btBatchStart" title="이 브라우저의 현재 백테스팅 전략으로 실행합니다.">현재 설정으로 실행</button><button type="button" id="btBatchResume" hidden>이어서 실행</button><button type="button" id="btBatchPause" hidden>일시 중지</button></div><div class="bt-batch-range" id="btBatchRange" role="status"></div><p class="bt-batch-plan" id="btBatchPlan"></p><details class="bt-batch-estimates"><summary>1분봉 ~ 월봉 수집량 미리보기</summary><p>기존 API 기준 코인 1개당 예상 상한 · 공식 파일 사용 시 요청 감소 · RSI 예열 포함 · 실제 상장일·제공 범위·누락에 따라 줄어들 수 있습니다. 정산 이력 조회는 별도이며, 페이지 수는 API 응답 길이에 따라 달라집니다.</p><div id="btBatchEstimates"></div></details><p class="bt-batch-range-warning" id="btBatchRangeWarning" role="status" hidden></p><p class="bt-footnote">각 코인에 초기 자본을 각각 적용합니다. 공유 자본 포트폴리오 수익률이 아닙니다. 실행 중 차트·즐겨찾기를 바꿔도 이번 목록과 조건은 유지됩니다.</p><div class="bt-batch-progress"><progress id="btBatchProgress" max="1" value="0" aria-label="즐겨찾기 백테스트 진행률"></progress><p id="btBatchStatus" role="status">즐겨찾기의 코인들을 같은 설정으로 차례로 검토합니다.</p></div><div class="bt-batch-resultbar"><strong id="btBatchCount">결과 대기</strong><div class="bt-batch-sync-actions"><button type="button" id="btBatchExport" title="즐겨찾기, 저장 결과와 보관 중인 1분봉·펀딩 원본을 한 파일에 백업합니다.">💾 데이터 백업</button><button type="button" id="btBatchImport" title="백업의 즐겨찾기 목록으로 교체하고 저장한 결과와 자료를 복원합니다.">📂 데이터 복원</button><input type="file" id="btBatchImportFile" accept=".json,.dat" style="display:none"></div><label>저장한 실행<select id="btBatchSavedJob" aria-label="저장한 일괄 백테스트 실행"><option value="">보관 기록 없음</option></select></label><button type="button" id="btBatchUseSaved" title="선택한 저장 실행의 전략과 기간을 사용합니다. 테스트 주기를 직접 고르면 그 주기로 실행합니다." hidden>저장 설정으로 일괄 실행</button><label>정렬<select id="btBatchSort"><option value="original">실행 순서</option><option value="netPnl">순손익 높은 순</option><option value="winRatePct">승률 높은 순</option><option value="profitFactor">수익계수 높은 순</option><option value="symbol">코인명</option></select></label><button type="button" id="btBatchCsv" disabled>전체 결과 CSV</button></div><p id="btBatchSnapshot" class="bt-batch-snapshot"></p><div id="btBatchResults"></div><div class="bt-batch-pagination"><button id="btBatchPrevious" type="button">이전</button><span id="btBatchPage">1페이지</span><button id="btBatchNext" type="button">다음</button></div><details class="bt-batch-method"><summary>속도·저장 공간·자료 범위</summary><p>동시에 한 코인만 처리하고 계산과 수집은 별도 작업에서 수행합니다. 일반 API 요청 간격은 최소 0.5초, Binance 정산 이력은 0.75초, BingX는 1.2초입니다. API 요청 제한이 계속되면 전체 작업을 멈추고 대기 시간을 표시합니다. 거래소 연결 실패가 계속되면 같은 거래소의 남은 코인은 조회 보류로 두어 반복 요청을 줄입니다.</p><p>캔들은 가격을 반올림하지 않는 숫자 배열로 압축 저장합니다. 과거 파일은 공식 SHA-256·ZIP CRC·봉 간격·행 수를 확인합니다. 파일이 없거나 검증이 실패한 구간은 같은 코인의 기존 API로 이어갑니다. 시장자료 캐시는 최대 32MiB이며 오래 사용하지 않은 페이지부터 비웁니다. 일괄 기록은 최대 3회이며, 완료한 실행을 우선 보관합니다. 상세 결과는 별도의 압축 64MiB 한도에 보관합니다. 1분봉 실행 때 다른 주기도 미리 준비할 수 있습니다. 이전 요약만 남은 경우 거래 보기에서 요약이 바로 열립니다. 빠진 거래 상세나 주기는 필요할 때만 계산합니다. 중지·새로고침 후 완료 코인은 건너뛰고 이어서 실행하며, 진행 중이던 코인은 저장된 페이지를 재사용해 다시 계산합니다.</p><p>전체 과거 조회는 거래소가 제공하는 캔들과 실제 정산 기록까지 조회합니다. 상장일부터 모든 기록이 제공된다는 보장은 없습니다. 빠진 기간·조회 실패는 결과에서 따로 표시합니다. 메모리 보호 기준을 넘으면 일부 자료만 계산하지 않고 해당 코인의 실패 이유를 표시합니다.</p><span id="btBatchCacheInfo"></span><button type="button" id="btBatchCacheClear">저장한 시장자료 비우기</button></details>';
  // The monitor is a flex sibling of the scroll area, so it never covers a result row.
  const monitor=node('header',undefined,'bt-batch-monitor'),content=node('div',undefined,'bt-batch-content'),options=node('details',undefined,'bt-batch-options');
  content.setAttribute('tabindex','0');content.setAttribute('aria-label','일괄 결과 목록');options.open=true;options.id='btBatchOptions';
  const summary=node('summary','실행 설정 · 기간과 데이터 관리');options.append(summary);
  const optionBody=node('div',undefined,'bt-batch-options-body');options.append(optionBody);
  for(const selector of ['.bt-batch-heading','.bt-batch-setup','#btBatchRange','#btBatchPlan','.bt-batch-estimates','#btBatchRangeWarning','.bt-footnote']){const item=panel.querySelector(selector);if(item)optionBody.append(item);}
  monitor.innerHTML='<div class="bt-batch-counter" role="status" aria-live="polite" aria-atomic="true"><span>코인 검토 완료</span></div><details class="bt-batch-activity"><summary><span id="btBatchActivity">실행 대기</span><span class="bt-batch-activity-hint">상세</span></summary></details><div class="bt-batch-monitor-actions"><button type="button" id="btBatchOptionsToggle" aria-controls="btBatchOptions" aria-expanded="true">실행 설정</button></div>';
  monitor.querySelector('.bt-batch-counter').append(panel.querySelector('#btBatchCount'));
  monitor.querySelector('.bt-batch-activity').append(panel.querySelector('#btBatchStatus'));
  for(const id of ['btBatchStart','btBatchResume','btBatchPause'])monitor.querySelector('.bt-batch-monitor-actions').append(optionBody.querySelector('#'+id));
  monitor.append(panel.querySelector('#btBatchProgress'));panel.querySelector('.bt-batch-progress').remove();
  content.append(options,...Array.from(panel.children));panel.append(monitor,content);
  const numbers=new Map(),dateFormat=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  const $=id=>panel.querySelector('#'+id),fmt=(n,d=2)=>{if(!Number.isFinite(n))return '—';if(!numbers.has(d))numbers.set(d,new Intl.NumberFormat('ko-KR',{maximumFractionDigits:d}));return numbers.get(d).format(n);},stamp=t=>dateFormat.format(t*1000),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const runOptionsKey='funding-chart-bt-run-options-v1';
  const verifyChoice=node('input');verifyChoice.type='checkbox';verifyChoice.id='btBatchVerifyLatest';
  const verifyLabel=node('label',undefined,'bt-batch-speed');verifyLabel.append(verifyChoice,'최신 검증 · 누락 구간 확인');$('btBatchResearchOnly').parentElement.after(verifyLabel);
  const workerSlots=new Set();
  let runner,job=null,locked=false,ready=false,serial=0,page=0,detailAbort=null,nextNetworkAt=0,archiveRetryAt=0,networkTail=Promise.resolve(),ioBusy=false,planning=false,researchUI=null,lastRowsAt=0;
  const working=()=>!ready||locked||ioBusy||planning||isBusy();
  const wait=(ms,signal)=>new Promise((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);},timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});});
  function setLocked(value){locked=value;onBusy(value);controls();}
  function status(text,error=false){$('btBatchStatus').textContent=text;$('btBatchActivity').textContent=text;$('btBatchActivity').title=text;$('btBatchStatus').classList.toggle('bt-error',error);monitor.classList.toggle('bt-monitor-error',error);}
  const frameLabel=tf=>tf==='all'?'전체 주기':M.labels[tf]||tf;
  const hasResults=row=>Boolean(row?.items.some(i=>i.status==='done'));
  const storedStates=async()=>root.BacktestResearchStore?await root.BacktestResearchStore.getDefault().then(s=>s.states()).catch(()=>[]):[];
  const splitLabel=c=>(Math.max(1,c.splitCount)===1?'진입 1회':c.splitCount+'분할 · 최대 '+c.splitCount+'회 진입')+(c.dcaMethod==='cumulative'?' · 회차별 배수':'');
  const sizingText=c=>c.positionSizing==='first_entry'?'첫 진입 '+fmt(c.firstEntryAmount,2)+' USDT 고정':'주문 '+fmt(c.allocationPerTradePct)+'%';
  const multiplierText=c=>c.dcaMethod==='cumulative'&&c.dcaMultipliers?.length?' · 2회차부터 '+c.dcaMultipliers.map(v=>v+'배').join(' → '):'';
  function config(useSaved=false){
   const c=useSaved?job.config:getConfig(),tf=$('btBatchFrame').value||c.timeframe,verifyLatest=!useSaved&&$('btBatchVerifyLatest').checked;
   return {...root.BacktestEngine.normalizeConfig({...c,timeframe:tf==='all'?'1m':tf}),timeframe:tf,useBinanceArchive:$('btBatchArchive').checked,reuseCompleted:!verifyLatest,verifyLatest,precomputeTimeframes:!verifyLatest&&$('btBatchPrepare').checked,researchOnly:!verifyLatest&&$('btBatchResearchOnly').checked};
  }
  function controls(updatePlan=true){const size=F.store.snapshot().size,useSaved=$('btBatchUseSaved');useSaved.hidden=!hasResults(job);useSaved.disabled=working()||!size;$('btBatchStart').disabled=!ready||locked||ioBusy||planning||isBusy()||!size;$('btBatchResume').disabled=!ready||locked||ioBusy||planning||isBusy();$('btBatchResume').textContent='이전 설정으로 이어서';$('btBatchResume').hidden=!job||!job.items.some(i=>['pending','error','deferred'].includes(i.status));$('btBatchPause').hidden=!locked;for(const b of panel.querySelectorAll('[data-batch-detail]'))b.disabled=working();for(const id of ['btBatchFrame','btBatchPeriod','btBatchSavedJob','btBatchCacheClear','btBatchSettings','btBatchArchive','btBatchPrepare','btBatchResearchOnly','btBatchVerifyLatest','btBatchExport','btBatchImport'])$(id).disabled=!ready||locked||ioBusy||planning;$('btBatchPrepare').disabled||=verifyChoice.checked;$('btBatchPrepare').title=verifyChoice.checked?'최신 검증은 선택한 주기만 계산합니다.':'';researchUI?.controls();if(!updatePlan)return;let c;try{c=config();}catch{return;}$('btBatchPlan').textContent='현재 설정 · '+size+'개 거래소·코인 · '+frameLabel(c.timeframe)+' · 각 초기 자본 '+fmt(c.initialCapital)+' USDT · '+splitLabel(c)+' · RSI '+c.rsiOversold+' · TP '+fmt(c.takeProfitPct)+'% / SL '+fmt(c.stopLossPct)+'% · 펀딩 '+(c.fundingIntervalHours?c.fundingIntervalHours+'시간':'전체 주기')+' / '+c.minFundingRate+'% 이하 · 수수료 '+c.feePct+'% / 슬리피지 '+c.slippagePct+'% (각 체결)';renderPlan(c);}
  function plan(c,mode=$('btBatchPeriod').value,markets=F.store.snapshot().markets,source=null){
   const exchanges=[...new Set(markets.map(m=>m.exchange))];if(!exchanges.length)exchanges.push('BINANCE');
   const {allHistory,fixedRange}=root.BacktestBatch.rangeFor(mode,c,source||job,root.BacktestResults?.sameStrategy,markets);
   const startTime=fixedRange?.startTime??(allHistory?Date.UTC(2009,0,1)/1000:c.startTime),endTime=Math.min(fixedRange?.endTime??(allHistory?Date.now()/1000:c.endTime),Date.now()/1000);
   const intervals=c.timeframe==='all'?Object.keys(root.TimeframeEngine?.seconds||{'1m':60}):[c.timeframe];const estimates=exchanges.map(exchange=>root.BacktestData.estimate({exchange,startTime,endTime,intervals,requireMinuteData:c.timeframe==='all'||c.splitTrigger==='rsi_cross_up_1m',rsiPeriod:c.rsiPeriod}));
   return {startTime,endTime,estimates,allHistory,fixedRange};
  }
  function renderPlan(c){
   let p;try{p=plan(c);}catch(error){$('btBatchRange').textContent=error.message;return;}
   const frame=p.estimates[0].frames[c.timeframe]||p.estimates[0].frames['1m']||Object.values(p.estimates[0].frames)[0],extra=c.timeframe!=='1m'&&(c.timeframe==='all'||c.splitTrigger==='rsi_cross_up_1m'),pages=p.estimates.map(e=>e.expectedPages),range=Math.min(...pages)===Math.max(...pages)?fmt(pages[0],0):fmt(Math.min(...pages),0)+' ~ '+fmt(Math.max(...pages),0);
   panel.querySelector('.bt-batch-estimates').hidden=Boolean(c.researchOnly||c.verifyLatest);
   $('btBatchRange').classList.toggle('bt-batch-all-history',p.allHistory);
   if(c.verifyLatest){$('btBatchRange').textContent='최신 검증 · '+frameLabel(c.timeframe)+' · '+(p.allHistory?'거래소 제공 최초 기록':stamp(p.startTime)+' KST')+' ~ '+stamp(p.endTime)+' KST의 확정 봉과 정산 확인. 보관 원본은 재사용하고, 확인하지 못한 종목은 순위에서 제외합니다.';}
   else if(c.researchOnly){$('btBatchRange').textContent='보관 원본만 사용 · '+frameLabel(c.timeframe)+' · 거래소 재조회 없음. 일치하는 저장 결과는 즉시 열고, 새 계산만 보관 원본이 필요합니다.';}
   else{$('btBatchRange').textContent=(p.fixedRange?(p.allHistory?'전체 과거 · 기존 자료 시점 재사용':'설정 기간')+' · '+stamp(p.startTime)+' ~ '+stamp(p.endTime)+' KST':p.allHistory?'전체 과거 직접 선택 · 코인별 거래소 제공 최초 기록 ~ 현재 자동 수집':'설정 기간 사용 · '+stamp(p.startTime)+' ~ '+stamp(p.endTime)+' KST')+(c.researchOnly?' · 보관 원본만 사용 (보관 종료 시점까지)':'')+'\n코인당 '+(c.timeframe==='all'?'실제 1분봉 수집 후 3분봉~월봉 집계 · 주기별 예열 추가 · 성과 비교':(frameLabel(c.timeframe)||c.timeframe)+(p.allHistory?' 거래소 제공 전체 과거 수집':' 최대 '+fmt(frame.count,0)+'봉 + 예열 '+fmt(frame.warmup,0)+'봉'))+(extra&&c.timeframe!=='all'?' · 보조 1분봉 추가':'')+(p.allHistory?'':' · 캔들 API 약 '+range+'페이지');
   const entries=Object.entries(M.labels).map(([tf,label])=>{const sample={...c,timeframe:tf},e=plan(sample).estimates,signal=e[0].frames[tf],counts=e.map(x=>x.expectedPages),pageRange=Math.min(...counts)===Math.max(...counts)?fmt(counts[0],0):fmt(Math.min(...counts),0)+' ~ '+fmt(Math.max(...counts),0);return '<tr'+(tf===c.timeframe?' class="bt-batch-selected-frame"':'')+'><td>'+label+'</td><td>'+fmt(signal.count,0)+'</td><td>'+fmt(signal.warmup,0)+'</td><td>'+(tf!=='1m'&&sample.splitTrigger==='rsi_cross_up_1m'?fmt(e[0].frames['1m'].totalCount,0):'—')+'</td><td>약 '+pageRange+'</td></tr>';});
   $('btBatchEstimates').innerHTML='<div class="bt-table-scroll"><table class="bt-table"><thead><tr><th>기준 주기</th><th>기간 안의 완성 봉</th><th>RSI 예열</th><th>보조 1분봉</th><th>코인당 캔들 API</th></tr></thead><tbody>'+entries.join('')+'</tbody></table></div>';}
   const strategyChanged=job&&!root.BacktestResults?.sameStrategy(c,job.config,c.timeframe);const mismatch=job&&(strategyChanged||job.allHistory!==p.allHistory||job.config.timeframe!==c.timeframe||(job.config.useBinanceArchive!==false)!==c.useBinanceArchive||job.config.startTime!==p.startTime||Math.abs(job.config.endTime-p.endTime)>60);
   $('btBatchRangeWarning').hidden=!mismatch;if(mismatch)$('btBatchRangeWarning').textContent=(strategyChanged?'새 실행은 현재 전략 · '+Math.max(1,c.splitCount)+'회 진입 / RSI '+c.rsiOversold+'을 사용합니다. ':'')+'저장된 이전 작업: '+(job.allHistory?'전체 과거':'설정 기간')+' · '+frameLabel(job.config.timeframe)+' · '+stamp(job.config.startTime)+' ~ '+stamp(job.config.endTime)+' KST. 이어서 실행하면 이 범위를 유지합니다. 위 기간을 적용하려면 새 일괄 테스트를 시작하세요.';
  }
  async function cacheInfo(){const store=await storePromise,info=await store.info(),doneInfo=await (await resultsPromise)?.info();$('btBatchCacheInfo').textContent=(info.persistent?'자동 저장 켜짐':'임시 저장 · 브라우저 저장을 사용할 수 없습니다.')+' · 시장자료 '+fmt(info.bytes/1048576,1)+' / '+fmt(info.maxBytes/1048576,0)+'MiB'+(doneInfo?' · 압축 완료 결과 '+fmt(doneInfo.bytes/1048576,1)+' / '+fmt(doneInfo.maxBytes/1048576,0)+'MiB'+(doneInfo.persistent?'':' · 결과 임시 저장'):'');}
  function stopWorker(slot){clearTimeout(slot.timer);slot.worker.terminate();workerSlots.delete(slot);}
  function acquireWorker(){
   let slot=[...workerSlots].find(w=>!w.busy);
   if(!slot){slot={worker:new Worker('backtest-batch-worker.js?v=20261112-divergence-1'),timer:0,busy:false};workerSlots.add(slot);}
   clearTimeout(slot.timer);slot.busy=true;return slot;
  }
  function officialRequest(signal,load){
   const task=networkTail.then(async()=>{
    signal.throwIfAborted();
    try{return await load();}
    catch(error){if(error.name==='RateLimitError')nextNetworkAt=Math.max(nextNetworkAt,error.retryAt||Date.now()+60000);throw error;}
   });
   networkTail=task.catch(()=>{});return task;
  }
  async function parallelPlan(items,c){
   if((!c.verifyLatest&&!c.researchOnly)||(root.navigator?.hardwareConcurrency||1)<4||root.navigator?.deviceMemory<4)return [];
   const T=root.TimeframeEngine,S=root.BacktestResearchStore,from=T.start(c.startTime,'1m'),to=T.start(c.endTime,'1m'),allowed=new Set(items.map(m=>m.exchange+':'+m.symbol));
   const frames=c.timeframe==='all'?Object.keys(T.seconds):[c.timeframe,...(c.splitTrigger==='rsi_cross_up_1m'?['1m']:[])];
   const warmFrom=Math.min(...frames.map(tf=>Math.max(0,T.shift(T.start(c.startTime,tf),tf,-Math.max(80,(c.rsiPeriod||14)*3)))));
   // Two independent calculations only for modest archives; cold or large
   // histories still run alone with the existing memory budget.
   return (await storedStates()).filter(s=>allowed.has(s.id)&&s.completed?.from<=from&&s.candles.count>0&&s.candles.count<=1500000&&to-s.completed.to<=7*86400&&(s.candles.first>from||!S.missing(s.candles.ranges,warmFrom,from).length)).map(s=>s.id);
  }
  async function execute(item,c,signal,onProgress,detail=false,strictSnapshot=false,purpose='backtest'){
   if(purpose==='backtest'&&c.timeframe!=='all'&&!c.researchOnly&&root.BacktestResults&&(strictSnapshot&&detail||c.reuseCompleted!==false)){signal.throwIfAborted();const store=await resultsPromise,heads=await store.find(item,c,{snapshot:!strictSnapshot}),output=(detail&&heads||root.BacktestResults.readyFor(heads,c,strictSnapshot))?await root.BacktestResults.fromHeads(store,heads,c,{detail}):null;signal.throwIfAborted();if(output){onProgress({phase:'reuse',text:'저장된 완료 결과 · 원본 재조회 0회 · 재계산 없음'});return output;}}
   return new Promise((resolve,reject)=>{
    signal.throwIfAborted();const slot=acquireWorker(),id=++serial,task=slot.worker;let settled=false;
    const hosts={BINANCE:'fapi.binance.com',BYBIT:'api.bybit.com',BINGX:'open-api.bingx.com',BITGET:'api.bitget.com',MEXC:'api.mexc.com',OKX:'www.okx.com'},retry=event=>{if(event.detail.host===hosts[item.exchange])onProgress({phase:'wait',...event.detail});};
    const finish=(fn,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);root.removeEventListener('market-api-wait',retry);task.onmessage=null;task.onerror=null;if(fn===resolve){slot.busy=false;slot.timer=setTimeout(()=>stopWorker(slot),25000);}else stopWorker(slot);fn(value);},abort=()=>finish(reject,signal.reason);signal.addEventListener('abort',abort,{once:true});root.addEventListener('market-api-wait',retry);
    task.onmessage=async event=>{
     if(event.data.id!==id||signal.aborted||settled)return;
     if(event.data.archiveRequest){const q=event.data.archiveRequest;let response;try{const tf=new URL(q.url).pathname.split('/')[7];const allowedTf=c.timeframe==='all'||c.timeframe==='1m'&&c.precomputeTimeframes!==false||tf===c.timeframe||tf==='1m';if(item.exchange!=='BINANCE'||!M.labels[tf]||!root.BacktestArchive?.allowedUrl(q.url,item.symbol,tf)||!allowedTf||!['zip','checksum'].includes(q.kind)||q.url.endsWith('.CHECKSUM')!==(q.kind==='checksum'))throw Error('공식 과거 파일의 거래소·계약·주기가 일치하지 않습니다.');if(archiveRetryAt>Date.now())throw Object.assign(Error('공식 파일 연결 대기 · 기존 API로 확인합니다.'),{name:'ArchiveUnavailableError'});const data=await officialRequest(signal,()=>root.BacktestArchive.fetchAsset(q.url,q.kind,signal));response={requestId:q.requestId,data};}catch(error){if(!signal.aborted&&(error.name==='TypeError'||error.name==='TimeoutError'||[403,429].includes(error.status)||error.status>=500))archiveRetryAt=Date.now()+300000;response={requestId:q.requestId,error:{message:error.message,name:error.name,status:error.status}};}if(!settled&&!signal.aborted)task.postMessage({marketResponse:response},response.data instanceof ArrayBuffer?[response.data]:[]);return;}
     if(event.data.marketRequest){const q=event.data.marketRequest;let response;try{const url=new URL(q.url);if(url.protocol!=='https:'||url.hostname!==hosts[item.exchange])throw Error('공식 거래소 요청 주소가 일치하지 않습니다.');const data=await officialRequest(signal,async()=>{const delay=nextNetworkAt-Date.now();if(delay>0)await wait(delay,signal);signal.throwIfAborted();nextNetworkAt=Date.now()+Math.max(500,item.exchange==='BINGX'?1200:0,item.exchange==='BINANCE'&&/^\/fapi\/v1\/funding(?:Rate|Info)$/.test(url.pathname)?750:0);return root.MarketAPI.json(q.url,q.params,signal);});response={requestId:q.requestId,data};}catch(error){response={requestId:q.requestId,error:{message:error.message,name:error.name,retryAt:error.retryAt}};}if(!settled&&!signal.aborted)task.postMessage({marketResponse:response});return;}
     if(event.data.progress){onProgress(event.data.progress);return;}if(event.data.error){const e=Object.assign(Error(event.data.error.message),event.data.error);finish(reject,e);}else finish(resolve,event.data.output);
    };
    task.onerror=()=>finish(reject,Error('일괄 백테스트 작업을 시작하지 못했습니다. 페이지를 새로고침한 뒤 이어서 실행하세요.'));task.postMessage({id,market:item,config:c,detail,strictSnapshot,purpose,deviceMemory:root.navigator?.deviceMemory});
   });
  }
  async function savedJobs(){const store=await storePromise;return store.listJobs?store.listJobs():job?[job]:[];}
  async function preferredJobs(){const rows=await savedJobs();return job?[...rows.filter(r=>r.id===job.id),...rows.filter(r=>r.id!==job.id)]:rows;}
  async function refreshHistory(){const rows=await savedJobs(),select=$('btBatchSavedJob');select.replaceChildren(...(rows.length?rows.map(j=>{const option=node('option',frameLabel(j.config.timeframe)+' · '+j.items.filter(i=>i.status==='done').length+'/'+j.items.length+' 완료 · '+strategyText(j.config)+(Number.isFinite(j.config.endTime)?' · '+stamp(j.config.endTime):''));option.value=j.id;return option;}):[node('option','보관 기록 없음')]));if(job)select.value=job.id;select.disabled=!ready||locked||ioBusy||planning||!rows.length;}
  function rememberRunOptions(){try{root.localStorage.setItem(runOptionsKey,JSON.stringify({frame:$('btBatchFrame').value,period:$('btBatchPeriod').value,verifyLatest:verifyChoice.checked}));}catch{}}
  function readRunOptions(){
   try{const saved=JSON.parse(root.localStorage.getItem(runOptionsKey)||'{}');if(saved.frame==='all'||Object.hasOwn(M.labels,saved.frame))$('btBatchFrame').value=saved.frame;if(saved.period==='all')$('btBatchPeriod').value='all';verifyChoice.checked=saved.verifyLatest===true;if(verifyChoice.checked)researchChoice.checked=false;}catch{}
  }
  function useCurrentSettings({periodChanged=false}={}){if(periodChanged){$('btBatchPeriod').value='settings';rememberRunOptions();}controls();}
  async function openIndividual(item,c,signal,onProgress){
   const R=root.BacktestResults,store=await resultsPromise;if(!R||!store)return null;
   let result=await R.openIndividual(store,item,c,{listJobs:preferredJobs,signal,sameRange:true});
   if(!result&&root.BacktestResearchStore&&root.BacktestResearch){
    const state=await root.BacktestResearchStore.getDefault().then(s=>s.state(item)).catch(()=>null),saved=root.BacktestResearch.executionProfile(state,c);
    if(saved){signal.throwIfAborted();const heads=await store.find(item,saved.config,{snapshot:false});if(heads?.[0]?.success)result=await R.fromHeads(store,heads,saved.config,{detail:true});}
   }
   signal.throwIfAborted();if(result)onProgress({phase:'reuse',text:'저장된 완료 결과 · 재조회 없음'});return result;
  }
  function progress(item,p){const index=job?.items.findIndex(i=>i.exchange===item.exchange&&i.symbol===item.symbol)??0,m={ex:item.exchange,symbol:item.symbol,int:job?.config.timeframe||config().timeframe};status((job?(index+1)+' / '+job.items.length+'번째 · ':'')+(p.phase==='wait'?item.symbol+' · '+Math.ceil(p.delay/1000)+'초 API 대기 후 재시도':M.backtestProgress(m,'single',p)+(p.cached?' · 저장 자료 '+p.cached+'묶음 재사용':'')));}
  function refresh(next){const fresh=job?.id!==next.id;job=next;if(fresh||['done','partial','paused'].includes(job.status))void refreshHistory();if(fresh){options.open=false;content.scrollTop=0;$('btBatchOptionsToggle').setAttribute('aria-expanded','false');}const done=job.items.filter(i=>i.status==='done').length,errors=job.items.filter(i=>['error','deferred'].includes(i.status)).length,reused=job.items.filter(i=>i.status==='done'&&i.meta?.reuse).length;$('btBatchProgress').max=job.items.length;$('btBatchProgress').value=done+errors;$('btBatchCount').textContent=done+' / '+job.items.length;monitor.querySelector('.bt-batch-counter>span').textContent=(reused?'재사용 '+reused+'개 · 새 계산 '+(job.items.length-reused)+'개':'코인 검토 완료')+(errors?' · 실패·보류 '+errors+'개':'');$('btBatchSnapshot').textContent='요청 조건 · '+frameLabel(job.config.timeframe)+' · '+(job.allHistory?'전체 과거 · '+stamp(job.config.startTime):'설정 기간 · '+stamp(job.config.startTime))+' ~ '+stamp(job.config.endTime)+' KST · '+(job.sourceJobId?'저장한 기간·전략':'실행 당시 현재 설정')+' · '+splitLabel(job.config)+' · RSI '+job.config.rsiOversold+' · 각 자본 '+fmt(job.config.initialCapital)+' USDT · Binance 공식 파일 '+(job.config.useBinanceArchive!==false?'켜짐':'꺼짐');$('btBatchCsv').disabled=!done&&!errors;
   if(job.status==='ready'&&reused)status(reused+'개 저장 결과 재사용 · '+(job.items.length-reused)+'개 새 계산 대기');else if(job.status==='done')status('전체 처리 완료 · '+done+'개 결과 · '+reused+'개 저장 결과 재사용 · 자료 시점은 각 결과에 표시됩니다.');else if(job.status==='partial')status('처리 완료 · '+done+'개 성공 / '+errors+'개 실패·보류 · 이어서 실행으로 실패 코인을 다시 시도할 수 있습니다.');else if(job.status==='paused')status(job.message||'일시 중지 · 이어서 실행할 수 있습니다.');if(fresh||job.status!=='running'||performance.now()-lastRowsAt>140){lastRowsAt=performance.now();renderRows();}controls(fresh||job.status!=='running');if(fresh||job.status!=='running')void cacheInfo();
  }
  function inspectionControls(item){
   if(item.status!=='done')return '';
   const frames=(item.comparison||[]).filter(r=>M.labels[r.timeframe]),selected=item.summary?.bestTimeframe||frames[0]?.timeframe;
   const choice=frames.length?'<label class="bt-batch-inspection">거래 보기 주기<select data-batch-frame="'+item.index+'" aria-label="'+escape(item.symbol)+' 거래 보기 주기">'+frames.map(r=>'<option value="'+r.timeframe+'"'+(r.timeframe===selected?' selected':'')+'>'+frameLabel(r.timeframe)+'</option>').join('')+'</select></label>':'';
   const comparison=frames.length?'<details class="bt-batch-comparison"><summary>'+frames.length+'개 주기 성과</summary><ul>'+frames.map(r=>'<li><strong>'+frameLabel(r.timeframe)+'</strong><span>승률 '+fmt(r.winRatePct)+'% · PF '+(r.profitFactorInfinite?'∞':fmt(r.profitFactor))+'<br>순손익 '+fmt(r.netPnl)+' USDT</span></li>').join('')+'</ul></details>':'';
   return choice+'<button type="button" data-batch-detail="'+item.index+'" '+(locked?'disabled':'')+'>거래 보기</button>'+comparison;
  }
  function renderRows(){const list=$('btBatchResults');if(!job){$('btBatchPrevious').disabled=true;$('btBatchNext').disabled=true;list.innerHTML='<div class="bt-empty">★ 즐겨찾기 '+F.store.snapshot().size+'개 · 새 일괄 테스트로 검토를 시작하세요.<br>결과에서 각 코인의 거래 내역과 날짜별 차트를 열 수 있습니다.</div>';return;}let items=job.items.map((value,index)=>({...value,index}));const sort=$('btBatchSort').value;if(sort==='symbol')items.sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.exchange.localeCompare(b.exchange));else if(sort!=='original')items.sort((a,b)=>{const value=r=>r.status!=='done'?-Infinity:sort==='profitFactor'&&r.summary.profitFactorInfinite?Infinity:r.summary[sort]??-Infinity;return value(b)-value(a)||a.index-b.index;});const pages=Math.max(1,Math.ceil(items.length/100));page=Math.min(page,pages-1);
   const th=['코인 / 거래소','타임프레임','상태 · 실제 자료 범위','거래수','승률','수익계수 PF','평균 이익/손실 비','순손익 · USDT','최종 자본','MDD','거래·차트'];
   list.innerHTML='<div class="bt-table-scroll"><table class="bt-table"><thead><tr>'+th.map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+items.slice(page*100,page*100+100).map(item=>{const s=item.summary,targetTf=job.config.timeframe==='all'?(s?.bestTimeframe||'1h'):job.config.timeframe,cov=item.meta?.coverage?.[targetTf]||Object.values(item.meta?.coverage||{})[0],issues=M.backtestCoverageIssues(item.meta),bestBadge=s?.bestTimeframe?'<small class="bt-batch-best">최고: '+escape(frameLabel(s.bestTimeframe))+'</small>':'',state=item.status==='done'?(item.meta?.reuse?'저장 결과 · 재계산 없음':item.meta?.research?(item.meta.research.tailRefreshed?'보관 원본 + 최신 구간 계산':item.meta.research.gapsFilled?'보관 원본 + 부족 구간 계산':'보관 원본으로 계산'):issues.hasIssues?'자료 부족·간격 확인':'계산 완료'):({pending:'대기',running:'검토 중',error:item.error?.startsWith('원본 확인 보류 · ')?'원본 확인 보류':'조회·계산 실패',deferred:'거래소 조회 보류'})[item.status],range=cov?.first?stamp(cov.first)+' ~ '+stamp(cov.last)+' KST':'';return '<tr data-batch-row="'+item.index+'"><td><strong>'+escape(item.symbol)+'</strong><small>'+escape(M.exchanges[item.exchange])+'</small>'+bestBadge+'</td><td class="bt-batch-tf"><b class="bt-tf-cell">'+escape(frameLabel(targetTf))+'</b></td><td class="bt-batch-coverage '+(issues.hasIssues||['error','deferred'].includes(item.status)?'bt-error':'')+'">'+escape(state)+'<small>'+escape(item.error?.replace(/^원본 확인 보류 · /,'')||range)+'</small>'+(item.meta?.research?.cutoffDiffers?'<small>자료 시점 '+escape(stamp(item.meta.research.through))+' KST</small>':'')+(item.meta?.carriedFrames?'<small>저장 주기 '+fmt(item.meta.carriedFrames,0)+'개 재사용</small>':'')+(item.meta?.retentionWarning?'<small>'+escape(item.meta.retentionWarning)+'</small>':'')+(item.meta?.verification?'<small>최신 검증 · '+escape(stamp(item.meta.verification.through))+' KST</small>':'')+(item.meta?.reuse?'<small>자료 시점 '+escape(stamp(item.meta.reuse.snapshotEnd))+' KST</small>':'')+(item.meta?.preparedTimeframes?'<small>주기 '+item.meta.preparedTimeframes.length+'개 결과 미리 준비</small>':'')+(item.meta?.preparationWarning?'<small>다른 주기 준비 보류 · '+escape(item.meta.preparationWarning)+'</small>':'')+(item.meta?.fundingCoverage?.first?'<small>정산 '+escape(stamp(item.meta.fundingCoverage.first))+' ~ '+escape(stamp(item.meta.fundingCoverage.last))+'</small>':'')+(item.meta?.archive?.files?'<small>공식 과거 '+fmt(item.meta.archive.files,0)+'파일 · API '+fmt(item.meta.archive.restPages,0)+'페이지'+(item.meta.archive.cachedFiles?' · 파일 '+fmt(item.meta.archive.cachedFiles,0)+'개 재사용':'')+'</small>':'')+'</td>'+(s?[s.totalTrades,fmt(s.winRatePct)+'%',s.profitFactorInfinite?'∞':fmt(s.profitFactor),fmt(s.riskRewardRatio),'<span class="'+(s.netPnl>=0?'bt-positive':'bt-negative')+'">'+fmt(s.netPnl)+'</span>',fmt(s.finalCapital),fmt(s.maxDrawdownPct)+'%'].map(v=>'<td>'+v+'</td>').join(''):'<td colspan="7">—</td>')+'<td>'+inspectionControls(item)+'</td></tr>';}).join('')+'</tbody></table></div>';for(const tr of list.querySelectorAll('tbody>tr'))for(let i=0;i<tr.cells.length;i++)tr.cells[i].setAttribute('data-label',th[i]||'결과');$('btBatchPage').textContent=(page+1)+' / '+pages+'페이지';$('btBatchPrevious').disabled=!page;$('btBatchNext').disabled=page>=pages-1;
  }
  async function inspect(task){
   planning=true;controls(false);
   try{return await task();}
   finally{planning=false;controls(false);}
  }
  async function checkResearch(markets,c,states){return root.BacktestResearch.checkBatch(markets,states??await storedStates(),c);}
  function sourceNotice(check,resume=false,reused=0){
   const absent=check.missing.filter(m=>m.reason==='source').length,outside=check.missing.length-absent;
   return (reused?'저장 결과 '+reused+'개 재사용 가능. ':'')+'새 계산에 필요한 원본 '+check.ready.length+' / '+check.total+'개 준비'+(absent?' · 원본 미수집 '+absent+'개':'')+(outside?' · 기간·주기 범위 부족 '+outside+'개':'')+'. '+(resume?'이어서 실행하기 전에 부족한 원본을 채워 주세요. ':'')+'저장된 결과는 그대로 있습니다. 새 계산은 원본 수집·이어서를 실행하거나 보관 범위의 기간을 선택하세요.';
  }
  function showSourceNotice(check,resume=false,reused=0){
   const message=sourceNotice(check,resume,reused);if(researchUI)researchUI.reveal(message);else status(message);
  }
  const strategyText=c=>splitLabel(c)+' · RSI '+c.rsiOversold+(c.dcaMethod==='cumulative'?multiplierText(c)+' · '+sizingText(c):'');
  const entryText=c=>Math.max(1,c.splitCount)===1?'1회 진입':c.splitCount+'분할';
  const conditionGroups=[
   ['진입 횟수',['splitCount']],['RSI',['rsiOversold','rsiPeriod','rsiSource','rsiExitLevel']],
   ['펀딩 조건',['fundingIntervalHours','fundingIntervalBasis','minFundingRate','maxFundingRate','fundingWindowSeconds','fundingTransitionLookbackSeconds']],
   ['재진입·대기',['oneEntryPerFunding','entryCooldownBars','requireFreshFundingAfterCooldown']],
   ['진입·분할 방식',['entryTrigger','splitTrigger','splitStepPct','dcaMethod','dcaMultipliers']],
   ['청산·익절·손절',['stopLossMode','exitType','takeProfitPct','stopLossPct','maxHoldBars']],
   ['자본·주문 크기',['initialCapital','allocationPerTradePct','positionSizing','firstEntryAmount']],['거래 비용',['feePct','slippagePct','includeFundingPayment']]
  ];
  async function savedComparison(next,markets){
   const wanted=new Set(markets.map(m=>m.exchange+':'+m.symbol));
   const saved=(await preferredJobs()).map(row=>({row,count:row.items.filter(i=>i.status==='done'&&wanted.has(i.exchange+':'+i.symbol)).length})).filter(x=>x.count);
   if(!saved.length)return null;
   const {row,count}=saved[0],prior=row.config,current=next.config,changed=new Set(root.BacktestResults.strategyDifferences(prior,current));
   const labels=conditionGroups.filter(([,keys])=>keys.some(k=>changed.has(k))).map(([label])=>label);
   if(prior.timeframe!=='all'&&prior.timeframe!==current.timeframe)labels.push('주기');
   if(Boolean(row.allHistory)!==Boolean(next.allHistory)||prior.startTime!==current.startTime||!next.allHistory&&(prior.cacheRangeEnd??prior.endTime)!==(current.cacheRangeEnd??current.endTime))labels.push('기간');
   const alt=saved.slice(1).filter(x=>entryText(x.row.config)===entryText(current)).sort((a,b)=>b.count-a.count)[0];
   return {row,count,lines:[
    '저장 결과: '+count+'개 · '+frameLabel(prior.timeframe)+' · '+strategyText(prior),
    '이번 실행: '+markets.length+'개 · '+frameLabel(current.timeframe)+' · '+strategyText(current),
    ...(alt?['다른 저장 실행: '+alt.count+'개 · '+frameLabel(alt.row.config.timeframe)+' · '+strategyText(alt.row.config)]:[]),
    ...(labels.length?['달라진 조건: '+labels.join(', ')]:[])
   ]};
  }
  async function showStoredRun({row,count}){
   if(job?.id!==row.id){const store=await storePromise;if(await store.selectJob?.(row.id))await runner.restore(row.id);}
   options.open=false;content.scrollTop=0;
   status('저장 결과 '+count+'개 표시 · '+frameLabel(row.config.timeframe)+' · '+strategyText(row.config)+' · 재계산 없음');
   $('btBatchSavedJob').focus({preventScroll:true});
  }
  async function perform(start,useSaved=false){
   if(working()||useSaved&&!job)return;
   if(!start&&job?.retryAt>Date.now()){status('API 대기 중 · '+Math.ceil((job.retryAt-Date.now())/1000)+'초 후 이어서 실행하세요.',true);return;}
   let prepared;
   try{
    if(start){
     const c=config(useSaved),markets=F.store.snapshot().markets;if(!markets.length)return;
     const source=useSaved?job:null,mode=source?(source.allHistory?'all':'saved'):$('btBatchPeriod').value,p=plan(c,mode,markets,source);
     const {next,check,reused,local,previous}=await inspect(async()=>{
      const next=await runner.prepare(markets,c,{allHistory:p.allHistory,fixedRange:p.fixedRange}),pending=next.items.filter(i=>i.status!=='done');
      if(source)next.sourceJobId=source.sourceJobId||source.id;
      else{
       const origins=new Set(next.items.flatMap(i=>i.meta?.reuse?.sourceJobId?[i.meta.reuse.sourceJobId]:[]));
       if(origins.size===1)next.sourceJobId=[...origins][0];
      }
      const states=pending.length?await storedStates():[],byId=new Map(states.map(s=>[s.id,s]));
      const local=pending.filter(m=>root.BacktestResearch?.executionProfile(byId.get(m.exchange+':'+m.symbol),m.frameReuse?{...next.config,endTime:m.frameReuse.snapshotEnd}:next.config,{strictSnapshot:c.verifyLatest||Boolean(m.frameReuse)})).length;
      const reused=next.items.length-pending.length,check=c.researchOnly&&pending.length?await checkResearch(pending,next.config,states):null;
      return {next,local,reused,check,previous:!c.verifyLatest&&!useSaved&&!reused&&!check?.missing.length?await savedComparison(next,markets):null};
     });
     if(working())return;
     const partial=Boolean(check?.missing.length);
     if(partial){
      showSourceNotice(check,false,reused);
      if(!check.ready.length&&!reused)return;
      const readyItems=new Set(check.ready);next.items=next.items.filter(i=>i.status==='done'||readyItems.has(i));
     }
     const period=source?'저장한 기간·전략':'이 브라우저의 현재 설정',fresh=next.items.length-reused;
     const rawText=c.verifyLatest?' 요청한 확정 시점까지 검사합니다. 확인되지 않은 종목은 순위에 넣지 않습니다.':local?' 보관 원본 '+local+'개는 거래소 재조회 없이 저장한 범위에서 계산합니다.':(fresh?' 새 계산에 필요한 전체 원본이 준비되지 않았습니다. 보관된 자료는 재사용하고 빠진 구간을 조회합니다.':'');
     const rangeText=c.researchOnly||local===fresh?'':(p.allHistory?' 추가 자료가 필요한 코인의 요청 기간 · 거래소 제공 과거 ~ ':' 추가 자료가 필요한 코인의 요청 기간 · '+stamp(next.config.startTime)+' ~ ')+stamp(next.config.endTime)+' KST.';
     const reuseText=c.verifyLatest?'확정 시점·전략·보관 원본이 동일한 검증 결과만 재사용합니다.':reused?'저장 결과 '+reused+'개 재사용 · 새 계산 '+fresh+'개. 저장 결과는 원래 자료 시점을 유지합니다.':'현재 선택한 기간·주기·전략과 일치하는 저장 결과 0개 · 새 계산 '+fresh+'개.';
     let accepted;
     if(previous){
      const choice=await root.CoinFavoritesUI.choose({
       host,title:'저장 결과와 이번 실행 조건',message:'저장 결과 '+previous.count+'개는 남아 있습니다. 이번 조건과 일치하는 결과만 0개입니다.',
       details:previous.lines.join('\n')+'\n'+reuseText+rawText+rangeText,
       choices:[{value:'saved',label:'저장 결과 보기',primary:true},{value:'run',label:'현재 설정으로 새 계산'}]
      });
      if(choice==='saved'){if(!working())await showStoredRun(previous);return;}
      accepted=choice==='run';
     }else accepted=!useSaved&&!partial&&reused>0||await root.CoinFavoritesUI.confirm({
      host,title:partial?'일부 코인의 원본만 준비됨':c.verifyLatest?'최신 검증으로 일괄 실행':source?'저장 설정으로 일괄 실행':'현재 설정으로 일괄 실행',
      message:partial?markets.length+'개 중 '+next.items.length+'개만 '+frameLabel(c.timeframe)+' 결과에 포함할까요?':markets.length+'개 거래소·코인을 '+frameLabel(c.timeframe)+' 설정으로 테스트하시겠습니까?',
      details:reuseText+rawText+(partial?' 원본이 부족한 '+check.missing.length+'개는 제외합니다. 그 코인도 계산하려면 원본을 수집하거나 보관 원본만 사용을 끄세요.':'')+rangeText+' '+period+' · '+splitLabel(c)+multiplierText(c)+' / RSI '+c.rsiOversold+' · 각 자본 '+fmt(c.initialCapital)+' USDT · '+sizingText(c)+' · 수수료 '+fmt(c.feePct,4)+'% · 슬리피지 '+fmt(c.slippagePct,4)+'%.',
      action:partial?'준비된 '+next.items.length+'개 실행':'테스트 시작'
     });
     if(!accepted||working())return;
     prepared=next;
    }else if(job?.config.researchOnly){
     const pending=job.items.filter(i=>['pending','error','deferred','running'].includes(i.status));if(!pending.length)return;
     const check=await inspect(()=>checkResearch(pending,job.config));if(working())return;
     if(check.missing.length){showSourceNotice(check,true);return;}
    }
   }catch(error){status(error.message,true);return;}
   setLocked(true);try{if(start){page=0;await runner.startPrepared(prepared);}else await runner.resume({retryErrors:true});}catch(error){status(error.message,true);}finally{setLocked(false);void cacheInfo();}
  }
  $('btBatchOptionsToggle').onclick=()=>{options.open=!options.open;if(options.open){content.scrollTop=0;summary.focus();}};options.ontoggle=()=>{$('btBatchOptionsToggle').setAttribute('aria-expanded',String(options.open));};
  $('btBatchSavedJob').onchange=async()=>{if(working())return;const id=$('btBatchSavedJob').value,store=await storePromise;if(await store.selectJob?.(id)){await runner.restore(id);await refreshHistory();}};
  $('btBatchSettings').onclick=()=>onSettings?.();$('btBatchStart').onclick=()=>void perform(true);$('btBatchUseSaved').onclick=()=>void perform(true,true);$('btBatchResume').onclick=()=>void perform(false);$('btBatchPause').onclick=()=>{runner?.pause();detailAbort?.abort();};$('btBatchFrame').onchange=$('btBatchPeriod').onchange=()=>{rememberRunOptions();controls();};$('btBatchArchive').onchange=controls;$('btBatchPrepare').onchange=controls;
  $('btBatchManage').onclick=()=>{root.ChartWorkspace?.openPicker();};
  $('btBatchSort').onchange=()=>{page=0;renderRows();};$('btBatchPrevious').onclick=()=>{page--;renderRows();};$('btBatchNext').onclick=()=>{page++;renderRows();};
  $('btBatchResults').onclick=async event=>{const button=event.target.closest('button[data-batch-detail]');if(!button||working()||!job)return;const item=job.items[Number(button.dataset.batchDetail)];if(item?.status!=='done')return;
   const tf=job.config.timeframe==='all'?$('btBatchResults').querySelector('[data-batch-frame="'+item.index+'"]')?.value||item.summary.bestTimeframe||'1m':job.config.timeframe,row=root.BacktestResults?.batchCandidate(job,item,tf);if(!row){status('저장된 결과의 종목·주기를 확인할 수 없습니다.',true);return;}setLocked(true);detailAbort=new AbortController();
   try{const output=await root.BacktestResults.openBatchResult(await resultsPromise,row);detailAbort.signal.throwIfAborted();if(!output)throw Error('선택한 주기의 저장 결과가 없습니다.');onResult(output);status(item.symbol+(output.summaryOnly?' · 저장한 요약 표시 · 상세는 따로 만들 수 있습니다.':' · 저장된 거래 내역을 열었습니다.'));
   }catch(error){if(error.name!=='AbortError')status(error.message,true);else status('거래 상세 불러오기를 중지했습니다.');}finally{detailAbort=null;setLocked(false);}};
  $('btBatchCsv').onclick=()=>{if(!job)return;const fields=['exchange','symbol','timeframe','status','initialCapital','finalCapital','netPnl','totalReturnPct','totalTrades','winRatePct','profitFactor','profitFactorInfinite','riskRewardRatio','maxDrawdownPct','totalFees','totalFundingEarned','candleFirst','candleLast','fundingFirst','fundingLast','incomplete','error'],values=job.items.map(i=>{const c=i.meta?.coverage?.[job.config.timeframe],f=i.meta?.fundingCoverage;return {...i,...i.summary,timeframe:job.config.timeframe,candleFirst:c?.first?stamp(c.first):'',candleLast:c?.last?stamp(c.last):'',fundingFirst:f?.first?stamp(f.first):'',fundingLast:f?.last?stamp(f.last):'',incomplete:i.meta?M.backtestCoverageIssues(i.meta).hasIssues:'',initialCapital:job.config.initialCapital};}),quote=v=>'"'+String(typeof v==='string'&&/^[=+\-@]/.test(v)?"'"+v:v??'').replace(/"/g,'""')+'"',csv='\uFEFF'+[fields,...values.map(i=>fields.map(k=>i[k]))].map(r=>r.map(quote).join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=doc.createElement('a');a.href=url;a.download=job.id+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('btBatchCacheClear').onclick=async()=>{if(locked)return;if(await root.CoinFavoritesUI.confirm({host,title:'시장자료 캐시 비우기',message:'저장한 캔들·정산 페이지를 비우시겠습니까?',details:'즐겨찾기와 완료된 일괄 결과 요약은 유지합니다. 다음 실행에서는 시장자료를 다시 조회합니다.',action:'비우기',danger:true})){await(await storePromise).clearPages();void cacheInfo();}};
  function setTransferBusy(value){ioBusy=value;onBusy(locked||value);controls();}
  async function readBackup(includePages=true){return {...await (await storePromise).exportAll({includePages}),favorites:F.store.snapshot().keys,completedResults:await (await resultsPromise)?.exportAll()};}
  const researchChoice=$('btBatchResearchOnly');
  function researchMode(value){researchChoice.checked=value;if(value&&verifyChoice.checked){verifyChoice.checked=false;rememberRunOptions();}try{root.localStorage.setItem('funding-chart-bt-research-only-v1',String(value));}catch{}controls();}
  verifyChoice.onchange=()=>{if(verifyChoice.checked)researchMode(false);rememberRunOptions();controls();};
  if(root.BacktestResearchUI){
   $('btBatchResearchChoice').hidden=false;try{researchChoice.checked=root.localStorage.getItem('funding-chart-bt-research-only-v1')==='true';}catch{}
   researchChoice.onchange=()=>researchMode(researchChoice.checked);
   researchUI=root.BacktestResearchUI.bind({host,panel:content,getMarkets:()=>F.store.snapshot().markets,collect:(item,c,signal,onProgress)=>execute(item,c,signal,onProgress,false,false,'collect-research'),readResults:()=>readBackup(false),setBusy:setTransferBusy,isBusy:working,onReady:()=>{if(!verifyChoice.checked)researchMode(true);},officialFiles:()=>$('btBatchArchive').checked,fmt,stamp,batchStatus:status});
  }
  const exportBtn=$('btBatchExport'),importBtn=$('btBatchImport'),importFile=$('btBatchImportFile');
  if(exportBtn){
   exportBtn.onclick=async()=>{
    if(working())return;
    try{
     setTransferBusy(true);
     const result=root.BacktestResearchFile?await root.BacktestResearchFile.save(root.BacktestResearchStore.getDefault().catch(()=>null),includeRaw=>readBackup(!includeRaw),{environment:root,document:doc,optional:true,onProgress:p=>researchUI?.fileProgress(p)}):await root.BacktestBackup.save({environment:root,document:doc,onProgress:status,readBackup});
     status((result.method==='file'?'백업 저장 완료':'백업 다운로드 시작')+' · 즐겨찾기 '+result.favorites+'개 · 결과 '+result.jobs+'회 · 상세 결과 '+result.completedResults+'개 · '+(result.includesRaw?'보관 원본 '+result.markets+'개 포함':'완료 원본 없음 · 저장 결과와 남은 시장자료 포함')+' · '+fmt(result.bytes/1048576,1)+'MiB');
    }catch(error){status(error.name==='AbortError'?'백업 저장을 취소했습니다. 기존 데이터는 유지됩니다.':'백업 실패: '+error.message,true);}
    finally{setTransferBusy(false);}
   };
  }
  if(importBtn&&importFile){
   importBtn.onclick=()=>{if(working())return;importFile.value='';importFile.click();};
   importFile.onchange=async()=>{
    const file=importFile.files?.[0];if(!file)return;if(working()){importFile.value='';return;}
    try{
     setTransferBusy(true);status('백업 파일 확인 중…');let archive,payload,migrated,sourceError;
     if(root.BacktestResearchFile&&await root.BacktestResearchFile.isResearch(file)){
      detailAbort=new AbortController();
      archive=await root.BacktestResearchFile.restore(file,await root.BacktestResearchStore.getDefault(),{signal:detailAbort.signal,onProgress:p=>researchUI?.fileProgress(p),beforeImport:async data=>{root.BacktestBackup.readFavorites(data,F.parseKey);status('백업 파일 복원 중…');}});
      payload=archive.legacy;
     }else{
      if(file.size>160*1048576)throw Error('기존 형식 복원 파일은 최대 160MiB까지 읽을 수 있습니다. 현재 데이터는 유지합니다.');
      payload=JSON.parse(await file.text());status('백업 파일 복원 중…');
     }
     const store=await storePromise,result=await root.BacktestBackup.restore(payload,{store,favorites:F.store,parseKey:F.parseKey});
     if(!archive&&payload.pages.length&&root.BacktestResearch){try{migrated=await root.BacktestResearch.carryLegacy(await root.BacktestResearchStore.getDefault(),root.BacktestCache.backupHistoryEntries(payload),{Cache:root.BacktestCache,Archive:root.BacktestArchive});}catch(error){sourceError=error.message;}}
     let completed,completionError;try{completed=await (await resultsPromise)?.importAll(payload.completedResults);}catch(error){completionError=error.message;}await runner.restore(result.restoredJobId||undefined);await refreshHistory();void cacheInfo();void researchUI?.refresh();
     const current=new Set(F.store.snapshot().keys),states=await storedStates(),readyCount=states.filter(s=>s.completed&&current.has(s.id)).length;
     const runNote=result.restoredJobId&&job?' · '+frameLabel(job.config.timeframe)+' 결과 '+job.items.filter(i=>i.status==='done').length+' / '+job.items.length+'개 ('+strategyText(job.config)+')':' · 백업에 저장 실행 없음';
     status('데이터 복원 완료 · 즐겨찾기 '+result.localFavorites+'개'+(result.backupFavorites===null?' 유지 · 구형 파일에 목록 없음':' 복원')+runNote+(readyCount?' · 원본 준비 '+readyCount+' / '+result.localFavorites+'개':' · 전체 기간 원본 0 / '+result.localFavorites+'개')+(migrated?.pages?' · 남아 있던 자료 '+migrated.pages+'묶음 이관':'')+(sourceError?' · 원본 이관 제외: '+sourceError:'')+(completed?' · 상세 결과 '+completed.imported+'개 복원'+(completed.skipped?' · 호환·용량 제외 '+completed.skipped+'개':''):'')+(completionError?' · 상세 결과 제외: '+completionError:'')+(result.skippedPages?' · 용량·유효기간에 따라 '+result.skippedPages+'개 제외':'')+'. '+(result.favoritesPersistent?'':'즐겨찾기는 임시 저장입니다. ')+'새 실행은 현재 백테스팅 설정을 사용합니다.');
    }catch(err){status(err.name==='AbortError'?'복원을 중지했습니다.':'복원 실패: '+err.message,err.name!=='AbortError');}
    finally{detailAbort=null;setTransferBusy(false);importFile.value='';}
   };
  }
  async function lookup(markets,c){
   const [resultStore,jobs]=await Promise.all([resultsPromise,preferredJobs()]);
   const archivedPairs=root.BacktestResearch?async missing=>{
    const states=new Map((await storedStates()).map(s=>[s.id,s]));
    return missing.map(m=>{const p=root.BacktestResearch.executionProfile(states.get(m.exchange+':'+m.symbol),c);return p?{market:m,config:p.config}:null;});
   }:undefined;
   return root.BacktestResults.findBatch(resultStore,jobs,markets,c,{archivedPairs,withPartial:true});
  }
  F.store.subscribe(()=>{controls();void researchUI?.refresh();if(!job)renderRows();});void(async()=>{const store=await storePromise;runner=root.BacktestBatch.create({store,execute,parallelPlan,lookup:resultsPromise?lookup:undefined,validateStrategy:root.BacktestResults?.sameStrategy,onUpdate:refresh,onProgress:({item,progress:p})=>progress(item,p)});await runner.restore();readRunOptions();ready=true;controls();renderRows();void refreshHistory();void cacheInfo();})();
  const request=()=>{onOpen();};root.addEventListener('favorite-backtest-request',request);root.addEventListener('pagehide',()=>{runner?.pause();detailAbort?.abort();researchUI?.cancel();for(const slot of workerSlots)stopWorker(slot);root.removeEventListener('favorite-backtest-request',request);},{once:true});
  return {execute,openIndividual,render(){report.classList.add('bt-report-batch');if(panel.parentElement!==report)report.replaceChildren(panel);controls();},cancel(){runner?.pause();detailAbort?.abort();researchUI?.cancel();},refresh:controls,useCurrentSettings};
 }
 root.BacktestBatchUI={bind};
})(globalThis);
