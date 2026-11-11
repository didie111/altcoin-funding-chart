(function(root){
 'use strict';
 function bind({host,panel,getMarkets,collect,readResults,setBusy,isBusy,onReady,officialFiles,fmt,stamp,batchStatus}){
  const doc=host.ownerDocument,storage=()=>root.BacktestResearchStore.getDefault(),H=root.BacktestResearch;
  const element=doc.createElement('details');element.className='bt-research';element.id='btResearchPanel';
  element.innerHTML='<summary>원본 보관 · 저장 자료로 연구 <span id="btResearchBadge">원본 확인 중</span></summary><p>즐겨찾기의 실제 1분봉과 공식 펀딩 정산을 모읍니다. 이미 보관한 기간은 건너뜁니다. 일반 백업의 완료 결과와 새 계산에 필요한 원본은 별개입니다.</p><div class="bt-research-actions"><button id="btResearchCollect" type="button">원본 수집·이어서</button><button id="btResearchExport" type="button">원본 포함 백업</button><button id="btResearchStop" type="button" hidden>원본 작업 중지</button></div><progress id="btResearchProgress" max="1" value="0" aria-label="원본 수집 또는 백업 진행률" hidden></progress><p id="btResearchStatus" role="status" aria-live="polite">수집한 뒤 개별 실행의 원본 계산 또는 일괄 설정의 보관 원본만 사용을 선택하세요.</p><p id="btResearchSpace"></p><details><summary>코인별 보관 범위</summary><ul id="btResearchMarkets"></ul></details>';
  panel.prepend(element);const $=id=>element.querySelector('#'+id);
  let controller=null,busy=false,hasData=false,refreshId=0,retryAt=0;
  function controls(){
   const blocked=busy||isBusy();$('btResearchCollect').disabled=blocked||!getMarkets().length;$('btResearchExport').disabled=blocked||!hasData;$('btResearchStop').hidden=!busy;
  }
  function status(text,error=false){$('btResearchStatus').textContent=text;$('btResearchStatus').classList.toggle('bt-error',error);batchStatus(text,error);}
  function progress(p){$('btResearchProgress').hidden=false;$('btResearchProgress').max=Math.max(1,p.total);$('btResearchProgress').value=p.count;}
  function fileProgress(p){if(p.phase==='archive-staging'){$('btResearchProgress').hidden=true;status('원본 백업 파일을 다운로드용으로 준비 중…');return;}const verb=p.phase==='archive-import'?'복원':'저장';progress({count:p.blocks,total:p.total});status('원본 '+verb+' 중 · '+fmt(p.blocks,0)+' / '+fmt(p.total,0)+'묶음 · '+fmt(p.bytes/1048576,1)+'MiB');}
  async function refresh(){
   const id=++refreshId;
   try{
    const store=await storage(),[states,space]=await Promise.all([store.states(),root.navigator?.storage?.estimate?.().catch(()=>null)]);
    if(id!==refreshId)return;
    const all=states.filter(s=>s.candles.count||s.funding.count),bytes=all.reduce((n,s)=>n+s.bytes,0),byId=new Map(all.map(s=>[s.id,s])),selected=getMarkets(),complete=selected.filter(m=>byId.get(m.exchange+':'+m.symbol)?.completed).length;
    hasData=all.length>0;$('btResearchBadge').textContent=complete+' / '+selected.length+'개 준비 · '+fmt(bytes/1048576,1)+'MiB';
    $('btResearchSpace').textContent='원본 '+all.length+'개 코인 · '+fmt(bytes/1048576,1)+'MiB'+(space?.quota?' · 브라우저 저장 공간 추정 '+fmt((space.quota-(space.usage||0))/1073741824,1)+'GiB 남음':'')+'. 사이트 데이터 초기화 전에는 원본 포함 백업을 저장하세요.';
    const list=$('btResearchMarkets'),rows=new Map(selected.map(m=>[m.exchange+':'+m.symbol,m]));for(const s of all)if(!rows.has(s.id))rows.set(s.id,s);
    list.replaceChildren(...[...rows].map(([id,m])=>{const state=byId.get(id),li=doc.createElement('li');li.textContent=m.exchange+' '+m.symbol+' · '+(state?.candles.count?stamp(state.candles.first)+' ~ '+stamp(state.completed?.to??state.candles.last+60)+' KST · 1분봉 '+fmt(state.candles.count,0)+'개 · 정산 '+fmt(state.funding.count,0)+'건'+(state.completed?' · 계산 가능':' · 수집 이어서'):'원본 미보관');return li;}));
   }catch(error){if(id!==refreshId)return;hasData=false;$('btResearchBadge').textContent='원본 보관소 사용 불가';$('btResearchSpace').textContent=error.message;}
   controls();
  }
  function setActive(value){busy=value;setBusy(value);controls();}
  const explain=error=>error.name==='QuotaExceededError'?'브라우저 저장 공간이 부족합니다. 이미 저장한 원본과 결과는 유지됩니다.':error.message;
  $('btResearchStop').onclick=()=>controller?.abort(new DOMException('원본 작업을 중지했습니다. 저장한 구간은 남아 있습니다.','AbortError'));
  $('btResearchCollect').onclick=async()=>{
   if(busy||isBusy())return;
   if(retryAt>Date.now()){status('거래소 요청 대기 중 · '+Math.ceil((retryAt-Date.now())/1000)+'초 후 이어서 실행하세요.',true);return;}
   const markets=getMarkets();if(!markets.length)return;
   const accepted=await root.CoinFavoritesUI.confirm({host,title:'즐겨찾기 원본 보관',message:markets.length+'개 코인의 실제 1분봉·펀딩을 보관할까요?',details:'거래소가 제공하는 최초 기록부터 최근 완성 봉까지 확인합니다. 보관된 기간은 건너뛰며, 필요한 저장 용량은 종목과 기간에 따라 달라집니다. 기존 백테스트를 다시 계산하지 않습니다.',action:'원본 수집 시작'});
   if(!accepted||busy||isBusy())return;
   void root.navigator?.storage?.persist?.().catch(()=>false);
   controller=new AbortController();setActive(true);let done=0,failed=0,partial=0,deferred=0;const notes=[],blocked=new Set();
   const run=async()=>{
    const endTime=root.TimeframeEngine.start(Date.now()/1000,'1m'),config={timeframe:'1m',startTime:H.earliest,endTime,useBinanceArchive:officialFiles(),rsiPeriod:14};
    for(const [i,item] of markets.entries()){
     controller.signal.throwIfAborted();progress({count:i,total:markets.length});
     if(blocked.has(item.exchange)){deferred++;continue;}
     const prefix=(i+1)+' / '+markets.length+' · '+item.symbol+' · ';
     try{
      status(prefix+'보관 구간 확인 중…');
      const out=await collect(item,config,controller.signal,p=>status(prefix+(p.text||'공식 원본 확인 중…')));
      if(out.incomplete){partial++;if(notes.length<4)notes.push(item.symbol+' 제공 범위만 저장');}else done++;
     }catch(error){
      if(error.name==='AbortError'||error.name==='QuotaExceededError')throw error;
      if(error.name==='RateLimitError'){retryAt=error.retryAt||Date.now()+60000;throw error;}
      if(error.name==='MarketServiceError'||/연결 실패:|HTTP (?:403|451|5\d\d)/.test(error.message))blocked.add(item.exchange);
      failed++;if(notes.length<4)notes.push(item.symbol+': '+error.message);
     }
    }
    progress({count:markets.length,total:markets.length});status('원본 확인 완료 · '+done+'개 준비 · '+partial+'개 제공 범위만 · '+failed+'개 실패 · '+deferred+'개 보류'+(notes.length?' · '+notes.join(' / '):''),Boolean(failed||deferred));
    if(done||partial)onReady();
   };
   try{
    if(root.navigator?.locks?.request)await root.navigator.locks.request('funding-chart-research-collect',{ifAvailable:true},lock=>{if(!lock)throw Error('다른 탭에서 원본을 수집하고 있습니다.');return run();});
    else await run();
   }catch(error){status(explain(error),error.name!=='AbortError');}
   finally{controller=null;setActive(false);await refresh();}
  };
  $('btResearchExport').onclick=async()=>{
   if(busy||isBusy()||!hasData)return;
   controller=new AbortController();setActive(true);
   try{
    const result=await root.BacktestResearchFile.save(storage(),readResults,{document:doc,onProgress:fileProgress,signal:controller.signal});
    status((result.method==='file'?'원본 포함 백업 저장 완료':'원본 포함 백업 다운로드 시작')+' · '+result.markets+'개 코인 · '+fmt(result.blocks,0)+'묶음 · '+fmt(result.bytes/1048576,1)+'MiB');
   }catch(error){status(error.name==='AbortError'?'원본 백업을 취소했습니다.':explain(error),error.name!=='AbortError');}
   finally{controller=null;setActive(false);}
  };
  void refresh();
  return {refresh,controls,fileProgress,reveal(message){element.open=true;status(message);element.scrollIntoView({block:'nearest'});},cancel:()=>$('btResearchStop').onclick()};
 }
 root.BacktestResearchUI={bind};
})(globalThis);
