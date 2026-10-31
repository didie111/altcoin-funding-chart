(function(root){
 'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const money=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2});
 const price=new Intl.NumberFormat('en-US',{maximumFractionDigits:8});
 function bind({host,catalog,onSelect}){
  const F=root.CoinFavorites,store=F.store;
  const dialog=el('dialog','symbol-picker');dialog.id='symbolPickerDialog';dialog.setAttribute('aria-labelledby','symbolPickerTitle');
  const heading=el('div','symbol-picker-heading'),title=el('h2','','종목 선택');title.id='symbolPickerTitle';
  const close=el('button','symbol-picker-close','×');close.type='button';close.setAttribute('aria-label','종목 선택 닫기');heading.append(title,close);
  const controls=el('div','symbol-picker-controls'),exchange=el('select');exchange.id='symbolPickerExchange';exchange.setAttribute('aria-label','종목 목록 거래소');
  for(const [value,label]of [['ALL','모든 거래소'],...MarketCatalog.exchanges]){const o=el('option','',label);o.value=value;exchange.append(o);}exchange.value='ALL';
  const search=el('input');search.type='search';search.id='symbolPickerSearch';search.placeholder='코인 검색 (예: BTC, NIL, SAHARA)';search.setAttribute('aria-label','코인 검색');
  search.maxLength=12000;controls.append(exchange,search);
  const tabs=el('div','symbol-picker-tabs'),all=el('button','','전체'),favorite=el('button','','★ 즐겨찾기'),refresh=el('button','','새로고침');
  for(const b of [all,favorite,refresh])b.type='button';all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');tabs.append(all,favorite,refresh);
  const columns=el('div','symbol-picker-columns'),name=el('button','','종목 / 거래소'),last=el('span','','현재가'),change=el('button','','24시간 등락'),volume=el('button','','거래대금');
  for(const b of [name,change,volume])b.type='button';columns.append(name,last,change,volume);
  const viewport=el('div','symbol-picker-viewport');viewport.id='symbolPickerList';viewport.setAttribute('role','list');viewport.setAttribute('aria-label','USDT 무기한 코인 목록');
  const spacer=el('div','symbol-picker-spacer'),layer=el('div','symbol-picker-rows'),empty=el('p','symbol-picker-empty');empty.hidden=true;viewport.append(spacer,layer,empty);
  const footer=el('div','symbol-picker-footer'),message=el('span'),manual=el('button','','입력한 종목으로 이동');manual.type='button';manual.hidden=true;footer.append(message,manual);
  const tools=el('details','favorites-tools'),toolsTitle=el('summary','','★ 즐겨찾기 관리'),toolbar=el('div','favorites-toolbar'),paste=el('button','','목록 붙여넣기'),edit=el('button','','편집 모드'),addFiltered=el('button','','검색 결과 추가'),removeFiltered=el('button','','검색 결과 해제'),clearFavorites=el('button','favorites-danger','전체 해제'),undo=el('button','','↶ 되돌리기');
  for(const b of [paste,edit,addFiltered,removeFiltered,clearFavorites,undo])b.type='button';paste.id='favoritesPaste';edit.id='favoritesEdit';edit.setAttribute('aria-pressed','false');toolbar.append(paste,edit,addFiltered,removeFiltered,clearFavorites,undo);
  const bulk=el('div','favorites-bulk');bulk.hidden=true;const bulkLabel=el('label','','코인 목록 · 줄바꿈, 쉼표, 공백으로 구분'),bulkText=el('textarea');bulkText.id='favoritesBulkText';bulkText.rows=3;bulkText.maxLength=12000;bulkText.placeholder='AKEUSDT\nBIRBUSDT\n1000TOSHIUSDT';bulkText.spellcheck=false;bulkLabel.htmlFor=bulkText.id;
  const scopeLabel=el('label','favorites-bulk-scope'),scope=el('input');scope.type='checkbox';scope.id='favoritesAllVenues';scopeLabel.append(scope,el('span','','모든 거래소 선택 시 같은 코인의 거래소별 계약도 모두 추가'));
  const preview=el('p','favorites-preview'),confirmBulk=el('button','favorites-primary','목록을 즐겨찾기에 추가');confirmBulk.id='favoritesBulkAdd';confirmBulk.type='button';bulk.append(bulkLabel,bulkText,scopeLabel,preview,confirmBulk);
  const favoriteHint=el('p','favorites-hint','별을 클릭하거나 위아래로 쓸어 추가·해제하세요. 편집 모드에서는 행 전체를 선택할 수 있습니다.'),favoriteStatus=el('p','favorites-status');favoriteStatus.setAttribute('role','status');favoriteStatus.id='favoritesStatus';tools.append(toolsTitle,toolbar,bulk,favoriteHint,favoriteStatus);
  const batch=el('button','favorites-batch','★ 일괄 백테스트');batch.id='favoritesBacktest';batch.type='button';footer.append(batch);
  dialog.append(heading,controls,tabs,tools,columns,viewport,footer);host.append(dialog);
  let rows=[],filtered=[],onlyFavorites=false,sort='volume',direction=-1,frame=0,requestId=0,abort,timer,target=0,current,selected=-1,query='',failure='',resultInfo=null,loading=false;
  const exchangeName=value=>value==='ALL'?'모든 거래소':MarketCatalog.exchanges.find(([id])=>id===value)?.[1]||value;
  let favorites=new Set(store.snapshot().keys),editing=false,painting=null,paintFrame=0,suppressUntil=0,rangeAnchor=null,confirming=false,pendingCatalog=null;
  const say=text=>{favoriteStatus.textContent=text+(store.snapshot().persistent?'':' · 임시 저장: 브라우저 저장을 사용할 수 없습니다.');};
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});}
  function updateMessage(){
   const parts=[exchangeName(exchange.value),'USDT 무기한',`검색 ${filtered.length.toLocaleString()} / ${rows.length.toLocaleString()}종목`],states=resultInfo?.exchangeStates;
   if(states){const done=states.filter(s=>s.status!=='pending').length;parts.push(`${done}/${states.length}개 거래소 조회${done<states.length?' 중':' 완료'}`);for(const [status,label]of [['error','조회 실패'],['stale','갱신 지연 · 이전 목록']]){const names=states.filter(s=>s.status===status).map(s=>exchangeName(s.exchange));if(names.length)parts.push(names.join(', ')+' '+label);}}
   else if(loading)parts.push('목록 조회 중');
   else if(resultInfo?.fetchedAt)parts.push(new Date(resultInfo.fetchedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})+' 조회'+(resultInfo.stale?' · 갱신 실패, 이전 목록':''));
   if(failure)parts.push(failure);message.textContent=parts.join(' · ');message.title=message.textContent;
  }
  function applyFilter(keepPosition=false){const chosen=keepPosition?filtered[selected]:null;query=search.value;const parsed=F.parse(query),multiple=parsed.symbols.length>1;filtered=multiple?MarketCatalog.filter(rows,'',onlyFavorites?favorites:null,sort,direction).filter(r=>parsed.symbols.includes(r.symbol)):MarketCatalog.filter(rows,query,onlyFavorites?favorites:null,sort,direction);selected=chosen?filtered.findIndex(r=>r.exchange===chosen.exchange&&r.symbol===chosen.symbol):-1;if(!keepPosition)viewport.scrollTop=0;manual.hidden=multiple||exchange.value==='ALL'||!/^[A-Z0-9]{1,40}$/.test(query.toUpperCase().replace(/[-_/]/g,''));updateMessage();updateFavorites();schedule();}
  function select(row){onSelect({ex:row.exchange,symbol:row.symbol},target);dialog.close();}
  function render(){
   spacer.style.height=filtered.length*52+'px';empty.hidden=filtered.length!==0;
   if(!filtered.length)empty.textContent=failure||(loading?'종목 목록을 불러오고 있습니다. 받은 결과부터 표시합니다.':onlyFavorites?'즐겨찾기에 추가한 종목이 없습니다.':'검색 결과가 없습니다.');
   const range=MarketCatalog.visibleRange(filtered.length,viewport.scrollTop,viewport.clientHeight||300),fragment=document.createDocumentFragment();
   for(let i=range.start;i<range.end;i++){
    const row=filtered[i],key=row.exchange+':'+row.symbol,record=el('div','symbol-picker-row');record.style.top=i*52+'px';record.dataset.index=String(i);record.setAttribute('role','listitem');record.classList.toggle('keyboard-selected',i===selected);
    const star=el('button','symbol-picker-star',favorites.has(key)?'★':'☆');star.type='button';star.setAttribute('aria-label',row.base+' · '+exchangeName(row.exchange)+' 즐겨찾기');star.setAttribute('aria-pressed',String(favorites.has(key)));star.onclick=event=>{if(Date.now()<suppressUntil)return;toggleFavorite(i,event?.shiftKey);};
    const button=el('button','symbol-picker-select');button.type='button';button.setAttribute('aria-label',row.base+' USDT · '+exchangeName(row.exchange)+' 선택');button.classList.toggle('current',row.symbol===current?.symbol&&row.exchange===current?.ex);
    const identity=el('span','symbol-picker-name'),base=el('strong','',row.base),quote=el('small','symbol-picker-market',row.base+'/USDT · '+exchangeName(row.exchange));identity.append(base,quote);
    const lastPrice=el('span','',row.price!==null?(row.price<.000001?row.price.toPrecision(6):price.format(row.price)):'—'),delta=el('span',row.change===null?'':row.change>=0?'positive':'negative',row.change===null?'—':(row.change>0?'+':'')+row.change.toFixed(2)+'%'),vol=el('span','symbol-picker-volume',row.volume!==null?(row.volumeApprox?'≈':'')+money.format(row.volume):'—');
    if(row.volumeApprox)vol.title='기초자산 거래량 × 현재가로 계산한 USDT 추정 거래대금';
    button.append(identity,lastPrice,delta,vol);button.onclick=event=>{if(Date.now()<suppressUntil)return;editing?toggleFavorite(i,event?.shiftKey):select(row);};record.append(star,button);fragment.append(record);
   }
   layer.replaceChildren(fragment);dialog.classList.toggle('favorites-editing',editing);
  }
  function updateFavorites(){
   const saved=store.snapshot();favorite.textContent='★ 즐겨찾기 '+saved.size;undo.disabled=!saved.canUndo;clearFavorites.disabled=!saved.size;batch.disabled=!saved.size;
   addFiltered.disabled=!filtered.some(r=>!favorites.has(F.marketKey(r)));removeFiltered.disabled=!filtered.some(r=>favorites.has(F.marketKey(r)));
   const result=F.resolve(bulkText.value,rows,{exchange:exchange.value,preferredExchange:current?.ex,allExchanges:scope.checked}),fresh=result.keys.filter(k=>!favorites.has(k));
   preview.textContent=(exchange.value==='ALL'?(scope.checked?'모든 거래소 계약':'코인당 1개 · '+exchangeName(current?.ex)+' 우선'):exchangeName(exchange.value))+' · 새로 추가 '+fresh.length+'개 · 이미 저장 '+(result.keys.length-fresh.length)+'개'+(result.missing.length?' · 목록 미확인 '+result.missing.length+'개 ('+result.missing.slice(0,8).join(', ')+')':'')+(result.invalid.length?' · 잘못된 입력 '+result.invalid.length+'개':'')+(result.duplicates?' · 입력 중복 '+result.duplicates+'개 제거':'');
   if(resultInfo?.exchangeStates?.some(v=>['error','pending','stale'].includes(v.status)))preview.textContent+=' · 미조회·갱신 지연 거래소는 원인 확인 후 다시 시도하세요.';
   confirmBulk.disabled=!fresh.length||confirming;scope.disabled=exchange.value!=='ALL';
  }
  async function confirmChange(keys,on,title){
   if(confirming||!keys.length)return;confirming=true;updateFavorites();
   try{const fresh=[...new Set(keys)].filter(k=>favorites.has(k)!==on);if(!fresh.length)return;const accepted=await root.CoinFavoritesUI.confirm({host,title,message:fresh.length+'개 거래소·코인을 즐겨찾기에 '+(on?'추가하시겠습니까?':'해제하시겠습니까?'),details:fresh.slice(0,6).join(' · ')+(fresh.length>6?' 외 '+(fresh.length-6)+'개':'')+' · 실행 후 되돌리기를 사용할 수 있습니다.',action:on?'추가':'해제',danger:!on});if(accepted){store.change(fresh,on);say(fresh.length+'개 즐겨찾기 '+(on?'추가':'해제')+' 완료');}}
   finally{confirming=false;updateFavorites();}
  }
  function toggleFavorite(index,range=false){const row=filtered[index];if(!row)return;const key=F.marketKey(row),on=!favorites.has(key),start=range&&rangeAnchor!==null?Math.min(rangeAnchor,index):index,end=range&&rangeAnchor!==null?Math.max(rangeAnchor,index):index;store.change(filtered.slice(start,end+1).map(F.marketKey),on);rangeAnchor=index;say((end-start+1)+'개 '+(on?'추가':'해제')+' · ↶ 되돌리기 가능');}
  store.subscribe(value=>{if(!painting)favorites=new Set(value.keys);if(onlyFavorites&&!painting)applyFilter(true);else{updateFavorites();schedule();}});
  function paintTo(index){if(!painting||!filtered.length)return;index=Math.max(0,Math.min(filtered.length-1,index));for(let i=Math.min(painting.last,index);i<=Math.max(painting.last,index);i++){const key=F.marketKey(filtered[i]);painting.keys.add(key);painting.on?favorites.add(key):favorites.delete(key);}painting.last=index;schedule();}
  function indexAt(y){const b=viewport.getBoundingClientRect();return Math.floor((y-b.top+viewport.scrollTop)/52);}
  function autoPaint(){paintFrame=0;if(!painting?.moved)return;const b=viewport.getBoundingClientRect(),y=painting.y,delta=y<b.top+30?-Math.ceil((b.top+30-y)/4):y>b.bottom-30?Math.ceil((y-b.bottom+30)/4):0;if(!delta)return;viewport.scrollTop=Math.max(0,Math.min(viewport.scrollTop+Math.max(-16,Math.min(16,delta)),Math.max(0,filtered.length*52-viewport.clientHeight)));paintTo(indexAt(y));paintFrame=requestAnimationFrame(autoPaint);}
  viewport.addEventListener('pointerdown',event=>{const control=event.target.closest?.('.symbol-picker-star')||(editing&&event.target.closest?.('.symbol-picker-select'));if(!control||event.button!==0||painting)return;const record=control.closest('.symbol-picker-row'),index=Number(record.dataset.index);painting={pointer:event.pointerId,start:index,last:index,on:!favorites.has(F.marketKey(filtered[index])),keys:new Set(),x:event.clientX,y:event.clientY,startY:event.clientY,moved:false};viewport.setPointerCapture?.(event.pointerId);event.preventDefault();});
  viewport.addEventListener('pointermove',event=>{if(!painting||painting.pointer!==event.pointerId)return;painting.y=event.clientY;if(!painting.moved&&Math.hypot(event.clientX-painting.x,event.clientY-painting.startY)<4)return;painting.moved=true;paintTo(indexAt(event.clientY));if(!paintFrame)paintFrame=requestAnimationFrame(autoPaint);event.preventDefault();});
  function finishPaint(event,canceled=false){if(!painting||event.pointerId!==painting.pointer)return;const p=painting;if(!canceled&&!p.moved)paintTo(p.start);painting=null;if(paintFrame){cancelAnimationFrame(paintFrame);paintFrame=0;}suppressUntil=Date.now()+350;if(!canceled&&p.keys.size){store.change([...p.keys],p.on);say(p.keys.size+'개 '+(p.on?'추가':'해제')+' · ↶ 되돌리기 가능');}else{favorites=new Set(store.snapshot().keys);schedule();}if(viewport.hasPointerCapture?.(event.pointerId))viewport.releasePointerCapture(event.pointerId);if(pendingCatalog){rows=pendingCatalog.rows;resultInfo=pendingCatalog;pendingCatalog=null;applyFilter(true);}}
  viewport.addEventListener('pointerup',event=>finishPaint(event));viewport.addEventListener('pointercancel',event=>finishPaint(event,true));viewport.addEventListener('lostpointercapture',event=>finishPaint(event,true));
  paste.onclick=()=>{bulk.hidden=!bulk.hidden;if(!bulk.hidden){if(F.parse(search.value).symbols.length>1)bulkText.value=search.value;updateFavorites();bulkText.focus();}};
  edit.onclick=()=>{editing=!editing;edit.setAttribute('aria-pressed',String(editing));say(editing?'편집 모드 · 행을 누르거나 위아래로 쓸어 즐겨찾기를 변경합니다.':'종목 선택 모드');schedule();};
  addFiltered.onclick=()=>void confirmChange(filtered.map(F.marketKey),true,'검색 결과 추가');removeFiltered.onclick=()=>void confirmChange(filtered.map(F.marketKey),false,'검색 결과 해제');clearFavorites.onclick=()=>void confirmChange(store.snapshot().keys,false,'즐겨찾기 전체 해제');undo.onclick=()=>{if(store.undo())say('직전 즐겨찾기 변경을 되돌렸습니다.');};
  bulkText.addEventListener('input',updateFavorites);scope.onchange=updateFavorites;confirmBulk.onclick=()=>{const r=F.resolve(bulkText.value,rows,{exchange:exchange.value,preferredExchange:current?.ex,allExchanges:scope.checked});void confirmChange(r.keys,true,'코인 목록 한 번에 추가');};
  batch.onclick=()=>{dialog.close();root.dispatchEvent(new CustomEvent('favorite-backtest-request'));};
  search.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text')||'',parsed=F.parse(text);if(parsed.symbols.length>1){event.preventDefault();search.value=parsed.symbols.join(' ');bulkText.value=text;bulk.hidden=false;tools.open=true;applyFilter();say('목록을 확인한 뒤 추가 버튼을 누르세요.');}});
  async function load(force=false){
   const id=++requestId;abort?.abort();abort=new AbortController();const signal=abort.signal;refresh.disabled=true;failure='';loading=true;const ex=exchange.value;
   updateMessage();schedule();
   const receive=result=>{if(signal.aborted||id!==requestId||!dialog.open)return;if(painting){pendingCatalog=result;return;}rows=result.rows;resultInfo=result;failure='';applyFilter(true);};
   try{const result=await catalog.load(ex,signal,{refresh:force,onUpdate:receive});receive(result);}
   catch(error){if(signal.aborted||id!==requestId||!dialog.open)return;rows=[];failure=error.message;applyFilter();}
   finally{if(id===requestId){loading=false;refresh.disabled=false;updateMessage();schedule();}}
  }
  function open(market,index=0,options={}){pendingCatalog=null;target=index;current={...market,symbol:MarketCatalog.base(market.symbol)+'USDT'};title.textContent='종목 선택 · '+(index+1)+'번 차트';search.value='';bulk.hidden=true;bulkText.value='';scope.checked=false;editing=false;edit.setAttribute('aria-pressed','false');rangeAnchor=null;manual.hidden=true;rows=[];filtered=[];failure='';resultInfo=null;viewport.scrollTop=0;selected=-1;onlyFavorites=false;const parsed=F.parse(options.query||'');if(options.query){search.value=parsed.symbols.length>1?parsed.symbols.join(' '):options.query;if(parsed.symbols.length>1){bulkText.value=options.query;bulk.hidden=false;tools.open=true;}}all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');empty.hidden=false;empty.textContent='종목 목록을 불러오고 있습니다.';if(!dialog.open)dialog.showModal();search.focus();schedule();void load();clearInterval(timer);timer=setInterval(()=>{if(dialog.open&&!document.hidden&&!loading&&!painting)void load(true);},15000);}
  search.addEventListener('input',()=>{const parsed=F.parse(search.value);if(parsed.symbols.length>1){bulkText.value=search.value;bulk.hidden=false;tools.open=true;}applyFilter();});exchange.onchange=()=>{rows=[];resultInfo=null;applyFilter();void load();};refresh.onclick=()=>void load(true);
  all.onclick=()=>{onlyFavorites=false;all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');applyFilter();};favorite.onclick=()=>{onlyFavorites=true;all.setAttribute('aria-pressed','false');favorite.setAttribute('aria-pressed','true');applyFilter();};
  for(const [button,field]of [[name,'symbol'],[change,'change'],[volume,'volume']])button.onclick=()=>{direction=sort===field?-direction:field==='symbol'?1:-1;sort=field;applyFilter();};
  manual.onclick=()=>{if(exchange.value!=='ALL')select({exchange:exchange.value,symbol:MarketCatalog.base(search.value.toUpperCase().replace(/[-_/]/g,''))+'USDT'});};
  search.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&filtered.length){event.preventDefault();selected=Math.max(0,Math.min(filtered.length-1,selected+(event.key==='ArrowDown'?1:-1)));if(selected*52<viewport.scrollTop||selected*52+52>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=Math.max(0,selected*52-viewport.clientHeight/2);schedule();}else if(event.key==='Enter'){event.preventDefault();if(F.parse(search.value).symbols.length>1){tools.open=true;bulk.hidden=false;confirmBulk.focus();}else if(filtered.length)select(filtered[Math.max(0,selected)]);else if(!manual.hidden)manual.click();}});
  viewport.addEventListener('scroll',schedule,{passive:true});new ResizeObserver(schedule).observe(viewport);
  close.onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{if(painting)finishPaint({pointerId:painting.pointer},true);abort?.abort();clearInterval(timer);requestId++;});
  return {open,close:()=>dialog.close()};
 }
 root.SymbolPicker={bind};
})(globalThis);
