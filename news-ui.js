(function(root){
 'use strict';
 function bind({doc,$,workspace,selectMarket,icon}){
  const M=root.DashboardModel,tab=$('tabBtnDelistings'),panel=$('tab-delistings'),sidebar=$('signal-sidebar');if(!M||!tab||!panel)return;
  const sources={BINANCE:'https://www.binance.com/en/support/announcement/list/161',BYBIT:'https://announcements.bybit.com/en/?category=delistings',BINGX:'https://bingx.com/en/support/categories/360002065274',BITGET:'https://www.bitget.com/support/sections/12508313443290',MEXC:'https://www.mexc.com/announcements/delistings',OKX:'https://www.okx.com/help/section/announcements-delistings'};
  panel.innerHTML='<div class="news-header"><div class="news-eyebrow"><i class="news-dot"></i>EXCHANGE NOTICE</div><div class="news-heading-row"><h2>상장폐지 소식</h2><button id="newsExpand" type="button" title="소식 넓게 보기" aria-label="소식 넓게 보기" aria-pressed="false">'+icon('expand')+'</button><button id="newsSidebarClose" type="button" aria-label="소식 닫기">'+icon('close')+'</button></div><p>공식 공지를 보관하고, 과거 소식까지 찾아보세요.</p></div><div class="news-filters"><label class="news-search">'+icon('search')+'<input type="search" id="newsSearch" maxlength="80" placeholder="보관 공지에서 코인·제목 검색" aria-label="상장폐지 코인·공지 검색"></label><div id="newsExchanges" class="news-exchanges" role="group" aria-label="거래소 필터"></div><div class="news-scopes" role="group" aria-label="시장 필터"><button type="button" data-scope="all" aria-pressed="true">전체</button><button type="button" data-scope="futures" aria-pressed="false">선물</button><button type="button" data-scope="spot" aria-pressed="false">현물</button><span class="news-count" id="newsCount"></span></div><form id="newsDateForm" class="news-date-form"><div class="news-date-row"><label>게시 시작일 · KST<input type="date" id="newsStart" aria-label="공지 게시 시작일"></label><label>게시 종료일 · KST<input type="date" id="newsEnd" aria-label="공지 게시 종료일"></label></div><div class="news-date-actions"><button type="button" id="newsDateReset">전체 기간</button><button type="submit">기간 적용</button></div></form></div><div class="news-update"><span id="newsUpdate" role="status" aria-live="polite">공식 공지 보관함을 불러오는 중</span><button type="button" id="newsRefresh">'+icon('refresh',12)+' 새로고침</button></div><div class="news-list" id="newsList" aria-label="공식 상장폐지 공지"></div><div class="news-archive-footer"><div class="news-pagination"><button type="button" id="newsPrevious">이전 목록</button><span id="newsPageLabel"></span><button type="button" id="newsNext">다음 목록</button></div><button type="button" id="newsCollectOlder" class="news-collect">'+icon('calendar',13)+' 과거 공지 더 가져오기</button><p id="newsArchiveRange"></p></div><div class="news-source-note">자동 확인 약 15분 · 게시일 기준 정렬<details><summary>공식 출처·거래소별 보관 범위</summary><div class="news-source-links" id="newsSources"></div><p>기간·검색은 보관된 공지에 적용됩니다. 원하는 과거가 없으면 위 버튼으로 공식 이전 페이지를 추가로 수집하세요. 수집 오류·같은 페이지 반복은 전체 수집 완료로 처리하지 않습니다.</p></details></div>';
  const toggle=doc.createElement('button');toggle.id='chartNewsToggle';toggle.type='button';toggle.title='상장폐지 소식 열기';toggle.setAttribute('aria-label','상장폐지 소식 열기');toggle.innerHTML=icon('news',15)+'<span>소식</span>';$('backtestDock').querySelector('.backtest-bar').insertBefore(toggle,$('backtestDock').querySelector('.backtest-actions'));
  const originalParent=sidebar.parentNode,originalNext=sidebar.nextSibling;
  function restoreSidebar(){if(sidebar.parentNode!==originalParent)originalParent.insertBefore(sidebar,originalNext?.parentNode===originalParent?originalNext:null);}
  function openNews(){tab.click();if(root.innerWidth<=1100||doc.fullscreenElement===workspace||workspace.classList.contains('chart-fullscreen-fallback')){if(doc.fullscreenElement===workspace||workspace.classList.contains('chart-fullscreen-fallback'))workspace.append(sidebar);doc.body.classList.add('news-drawer-open');}if(Date.now()-lastLatest>=900000)void load('latest');}
  toggle.onclick=()=>doc.body.classList.contains('news-drawer-open')?$('newsSidebarClose').click():openNews();
  $('newsSidebarClose').onclick=()=>{doc.body.classList.remove('news-drawer-open');restoreSidebar();toggle.focus();};
  doc.addEventListener('fullscreenchange',()=>{if(!doc.fullscreenElement)restoreSidebar();});
  $('newsExpand').onclick=()=>{const wide=doc.body.classList.toggle('news-wide');$('newsExpand').setAttribute('aria-pressed',String(wide));$('newsExpand').innerHTML=icon(wide?'restore':'expand');$('newsExpand').title=wide?'소식 너비 줄이기':'소식 넓게 보기';$('newsExpand').setAttribute('aria-label',$('newsExpand').title);};
  let filter={exchange:'ALL',scope:'all',query:'',start:'',end:''},items=[],states={},history={},coverage=[],archiveTotal=0,pagination={total:0,hasMore:false},cursor=null,previous=[],busy=false,serial=0,controller,lastLatest=0,debounce,serverReady=false;
  const dateFmt=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}),timeFmt=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit'});
  const date=v=>v?dateFmt.format(v):'게시일 미제공';
  const selected=()=>filter.exchange==='ALL'?Object.keys(sources):[filter.exchange];
  function refreshFilter(){void load('archive',{resetScroll:true,targetCursor:null,targetPrevious:[]});}
  for(const [id,label]of [['ALL','전체'],...Object.entries(M.exchanges)]){
   const button=doc.createElement('button');button.type='button';button.textContent=label;button.dataset.exchange=id;button.setAttribute('aria-pressed',String(id==='ALL'));button.onclick=()=>{filter.exchange=id;for(const b of $('newsExchanges').children)b.setAttribute('aria-pressed',String(b===button));refreshFilter();};$('newsExchanges').append(button);
  }
  for(const button of panel.querySelectorAll('[data-scope]'))button.onclick=()=>{filter.scope=button.dataset.scope;for(const b of panel.querySelectorAll('[data-scope]'))b.setAttribute('aria-pressed',String(b===button));refreshFilter();};
  $('newsSearch').oninput=event=>{filter.query=event.target.value;clearTimeout(debounce);debounce=setTimeout(refreshFilter,300);};
  $('newsDateForm').onsubmit=event=>{event.preventDefault();const start=$('newsStart').value,end=$('newsEnd').value;if(start&&end&&start>end){$('newsUpdate').textContent='시작일이 종료일보다 늦습니다.';return;}filter.start=start;filter.end=end;refreshFilter();};
  $('newsDateReset').onclick=()=>{$('newsStart').value='';$('newsEnd').value='';filter.start='';filter.end='';refreshFilter();};
  function render(){
   const scroll=$('newsList').scrollTop,frag=doc.createDocumentFragment();
   $('newsCount').textContent=(serverReady?'보관 ':'수집본 ')+pagination.total+'건';
   for(const n of items){
    const card=doc.createElement('article');card.className='news-card';card.dataset.exchange=n.exchange;card.dataset.noticeId=n.id;
    const top=doc.createElement('div');top.className='news-card-top';const ex=doc.createElement('span');ex.className='news-exchange';ex.textContent=M.exchanges[n.exchange];const scope=doc.createElement('span');scope.className='news-scope '+n.scope;scope.textContent=({futures:'선물',spot:'현물',alpha:'Alpha',margin:'마진',other:'거래 지원'})[n.scope];const time=doc.createElement('time');time.textContent=date(n.publishedAt);if(n.publishedAt){time.dateTime=new Date(n.publishedAt).toISOString();time.title='게시일 '+date(n.publishedAt)+(n.dateOnly?' · 날짜만 제공':' KST');}top.append(ex,scope,time);
    const heading=doc.createElement('h3'),link=doc.createElement('a');link.href=n.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=n.symbols.length?n.symbols.join(', ')+(n.change?' · 상장폐지 일정 변경':n.scope==='futures'?' · 선물 상장폐지':n.scope==='spot'?' · 현물 거래 지원 종료':' · 거래 지원 변경'):n.title;heading.append(link);card.append(top,heading);
    if(n.symbols.length){const chips=doc.createElement('div');chips.className='news-symbols';for(const symbol of n.symbols.slice(0,10)){const chip=doc.createElement('span');chip.textContent=symbol;chips.append(chip);}card.append(chips);const details=doc.createElement('details'),label=doc.createElement('summary'),title=doc.createElement('p');label.textContent='공식 공지 제목';title.textContent=n.title;details.append(label,title);card.append(details);}
    if(n.effectiveAt){const schedule=doc.createElement('p');schedule.className='news-effective';schedule.textContent='거래 종료 · '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(n.effectiveAt)+' KST';card.append(schedule);}
    if(n.change){const change=doc.createElement('span');change.className='news-change';change.textContent='일정 변경 공지 · 최종 일정은 원문 확인';card.append(change);}
    const bottom=doc.createElement('div');bottom.className='news-card-bottom';const original=doc.createElement('a');original.href=n.url;original.target='_blank';original.rel='noopener noreferrer';original.innerHTML='공식 원문 '+icon('link',12);bottom.append(original);
    if(n.scope==='futures'&&n.symbols.length)for(const symbol of n.symbols.slice(0,3)){const button=doc.createElement('button');button.type='button';button.className='news-chart-link';button.textContent=symbol+' 차트';button.title='선택한 차트에 '+M.exchanges[n.exchange]+' '+symbol+'USDT 선물 불러오기';button.onclick=()=>{selectMarket({ex:n.exchange,symbol:symbol+'USDT'});if(root.innerWidth<=650)$('newsSidebarClose').click();};bottom.append(button);}
    card.append(bottom);frag.append(card);
   }
   if(!items.length){const empty=doc.createElement('p');empty.className='news-empty';empty.textContent=busy?'공식 공지를 확인하고 있습니다.':'조건에 맞는 보관 공지가 없습니다.\n과거 공지를 추가로 가져오거나 조건을 바꿔 보세요.';frag.append(empty);}
   $('newsList').replaceChildren(frag);$('newsList').scrollTop=scroll;
   const sf=doc.createDocumentFragment();for(const [id,url]of Object.entries(sources)){
    const a=doc.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=M.exchanges[id]+' ↗';const small=doc.createElement('small'),s=states[id],h=history[id],c=coverage.find(c=>c.exchange===id);
    small.textContent=(s?.status==='ok'?'최신 확인 '+date(s.checkedAt):s?.status==='error'?'최신 갱신 지연':'최신 확인 대기')+(c?' · '+c.count+'건':'');
    if(c?.oldest_at){const range=doc.createElement('small');range.textContent=date(c.oldest_at)+' ~ '+date(c.newest_at);a.append(range);}
    if(h?.message){const detail=doc.createElement('small');detail.className='news-source-error';detail.textContent=h.message;a.append(detail);}a.append(small);sf.append(a);
   }$('newsSources').replaceChildren(sf);
   const ranges=coverage.filter(c=>selected().includes(c.exchange)&&c.oldest_at),oldest=ranges.length?Math.min(...ranges.map(c=>c.oldest_at)):null;
   $('newsArchiveRange').textContent=serverReady?'서버 보관 '+archiveTotal+'건'+(oldest?' · 선택 출처 '+date(oldest)+'부터':'')+' · 전체 과거 수집을 뜻하지 않습니다.':'서버 연결 전에는 기본 수집본만 표시합니다.';
   $('newsPageLabel').textContent=(previous.length+1)+'페이지 · '+items.length+'건';updateButtons();
  }
  function updateButtons(){
   $('newsRefresh').disabled=busy;$('newsPrevious').disabled=busy||!previous.length;$('newsNext').disabled=busy||!pagination.hasMore;
   const canCollect=selected().some(ex=>!['complete','blocked'].includes(history[ex]?.status));
   const canRetry=selected().some(ex=>history[ex]?.status==='error'||states[ex]?.status==='error');
   $('newsCollectOlder').disabled=busy||(!canCollect&&serverReady);
   const blocked=selected().some(ex=>history[ex]?.status==='blocked');
   $('newsCollectOlder').innerHTML=icon('calendar',13)+(busy?' 공지를 확인하는 중…':!canCollect&&serverReady?(blocked?' 추가 수집 제한 · 공식 출처 확인':' 공개 이전 목록 마지막 페이지'):canRetry?' 과거 공지 가져오기 · 재시도':' 과거 공지 더 가져오기');
  }
  async function load(mode,{resetScroll=false,targetCursor=cursor,targetPrevious=previous}={}){
   const requestId=++serial;controller?.abort();controller=new AbortController();busy=true;updateButtons();$('newsUpdate').textContent=mode==='older'?'공식 이전 페이지를 수집하고 보관하는 중…':'공지 보관함 확인 중…';
   try{
    const url=new URL(root.MARKET_RELAY_URL);url.pathname=url.pathname.replace(/\/market\/?$/,'/news');url.search='';
    for(const [k,v]of Object.entries({mode,exchange:filter.exchange,scope:filter.scope,q:filter.query,start:filter.start,end:filter.end,cursor:targetCursor,limit:30}))if(v!==null&&v!=='')url.searchParams.set(k,String(v));
    const response=await fetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)]),cache:'no-store',credentials:'omit'}),data=await response.json();
    if(!response.ok)throw Error(data.message||'공지 보관함 연결 지연');
    if(!Array.isArray(data.items)||!data.pagination||!data.archive?.durable)throw Error('공지 보관함 응답 확인 필요');
    if(requestId!==serial)return;
    const before=archiveTotal;items=M.mergeNotices(data.items);states=data.sources||{};history=data.history||{};coverage=data.archive.coverage||[];archiveTotal=data.archive.total;pagination=data.pagination;serverReady=true;cursor=targetCursor;previous=[...targetPrevious];
    if(mode==='latest')lastLatest=Date.now();
    const failed=selected().filter(ex=>states[ex]?.status==='error').length;
    const historyFailed=selected().filter(ex=>['error','blocked'].includes(history[ex]?.status)).length;
    $('newsUpdate').textContent=(mode==='older'?(historyFailed?'일부 과거 수집 지연 · 보관 목록 표시':archiveTotal>before?'과거 공지 추가 보관 완료':'이전 목록 확인 · 추가 수집 가능'):(failed?'일부 최신 갱신 지연 · 보관 목록 표시':mode==='latest'?'공식 공지 확인 완료':'보관 공지 검색 완료'))+' · '+timeFmt.format(Date.now())+' KST';
    render();if(resetScroll)$('newsList').scrollTop=0;
   }catch(error){
    if(requestId!==serial||controller.signal.aborted)return;
    if(!serverReady){
     try{const response=await fetch('data/delistings.json?v=20261024',{signal:controller.signal});if(!response.ok)throw Error();const data=await response.json();if(requestId!==serial)return;items=M.filterNotices(M.mergeNotices(data.items),filter).slice(0,30);pagination={total:items.length,hasMore:false};render();}catch{}
    }
    $('newsUpdate').textContent=error.message+' · 이전 목록 유지';
   }finally{if(requestId===serial){busy=false;updateButtons();}}
  }
  $('newsRefresh').onclick=()=>void load('latest');
  $('newsPrevious').onclick=()=>void load('archive',{resetScroll:true,targetCursor:previous.at(-1),targetPrevious:previous.slice(0,-1)});
  $('newsNext').onclick=()=>{if(pagination.nextCursor)void load('archive',{resetScroll:true,targetCursor:pagination.nextCursor,targetPrevious:[...previous,cursor]});};
  $('newsCollectOlder').onclick=()=>void load('older',{resetScroll:true,targetCursor:null,targetPrevious:[]});
  tab.addEventListener('click',()=>{if(!busy&&Date.now()-lastLatest>=900000)void load('latest');});
  const interval=setInterval(()=>{if(!doc.hidden&&panel.classList.contains('active')&&!busy&&Date.now()-lastLatest>=900000)void load('latest');},60000);
  root.addEventListener('pagehide',()=>{serial++;controller?.abort();clearInterval(interval);clearTimeout(debounce);},{once:true});
  if(panel.classList.contains('active'))void load('latest');
 }
 root.ChartNews={bind};
})(typeof globalThis!=='undefined'?globalThis:this);
