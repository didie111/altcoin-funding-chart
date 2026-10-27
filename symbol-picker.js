(function(root){
 'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const money=new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2});
 const price=new Intl.NumberFormat('en-US',{maximumFractionDigits:8});
 function bind({host,catalog,onSelect}){
  const dialog=el('dialog','symbol-picker');dialog.id='symbolPickerDialog';dialog.setAttribute('aria-labelledby','symbolPickerTitle');
  const heading=el('div','symbol-picker-heading'),title=el('h2','','종목 선택');title.id='symbolPickerTitle';
  const close=el('button','symbol-picker-close','×');close.type='button';close.setAttribute('aria-label','종목 선택 닫기');heading.append(title,close);
  const controls=el('div','symbol-picker-controls'),exchange=el('select');exchange.id='symbolPickerExchange';exchange.setAttribute('aria-label','종목 목록 거래소');
  for(const [value,label]of [['ALL','모든 거래소'],...MarketCatalog.exchanges]){const o=el('option','',label);o.value=value;exchange.append(o);}exchange.value='ALL';
  const search=el('input');search.type='search';search.id='symbolPickerSearch';search.placeholder='코인 검색 (예: BTC, NIL, SAHARA)';search.setAttribute('aria-label','코인 검색');
  controls.append(exchange,search);
  const tabs=el('div','symbol-picker-tabs'),all=el('button','','전체'),favorite=el('button','','★ 즐겨찾기'),refresh=el('button','','새로고침');
  for(const b of [all,favorite,refresh])b.type='button';all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');tabs.append(all,favorite,refresh);
  const columns=el('div','symbol-picker-columns'),name=el('button','','종목 / 거래소'),last=el('span','','현재가'),change=el('button','','24시간 등락'),volume=el('button','','거래대금');
  for(const b of [name,change,volume])b.type='button';columns.append(name,last,change,volume);
  const viewport=el('div','symbol-picker-viewport');viewport.id='symbolPickerList';viewport.setAttribute('role','list');viewport.setAttribute('aria-label','USDT 무기한 코인 목록');
  const spacer=el('div','symbol-picker-spacer'),layer=el('div','symbol-picker-rows'),empty=el('p','symbol-picker-empty');empty.hidden=true;viewport.append(spacer,layer,empty);
  const footer=el('div','symbol-picker-footer'),message=el('span'),manual=el('button','','입력한 종목으로 이동');manual.type='button';manual.hidden=true;footer.append(message,manual);
  dialog.append(heading,controls,tabs,columns,viewport,footer);host.append(dialog);
  let rows=[],filtered=[],onlyFavorites=false,sort='volume',direction=-1,frame=0,requestId=0,abort,timer,target=0,current,selected=-1,query='',failure='',resultInfo=null,loading=false;
  const exchangeName=value=>value==='ALL'?'모든 거래소':MarketCatalog.exchanges.find(([id])=>id===value)?.[1]||value;
  let favorites=new Set();try{const saved=JSON.parse(localStorage.getItem('funding-chart-symbol-favorites-v1')||'[]');if(Array.isArray(saved))favorites=new Set(saved.filter(x=>typeof x==='string'));}catch{}
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});}
  function updateMessage(){
   const parts=[exchangeName(exchange.value),'USDT 무기한',`검색 ${filtered.length.toLocaleString()} / ${rows.length.toLocaleString()}종목`],states=resultInfo?.exchangeStates;
   if(states){const done=states.filter(s=>s.status!=='pending').length;parts.push(`${done}/${states.length}개 거래소 조회${done<states.length?' 중':' 완료'}`);for(const [status,label]of [['error','조회 실패'],['stale','갱신 지연 · 이전 목록']]){const names=states.filter(s=>s.status===status).map(s=>exchangeName(s.exchange));if(names.length)parts.push(names.join(', ')+' '+label);}}
   else if(loading)parts.push('목록 조회 중');
   else if(resultInfo?.fetchedAt)parts.push(new Date(resultInfo.fetchedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})+' 조회'+(resultInfo.stale?' · 갱신 실패, 이전 목록':''));
   if(failure)parts.push(failure);message.textContent=parts.join(' · ');message.title=message.textContent;
  }
  function applyFilter(keepPosition=false){const chosen=keepPosition?filtered[selected]:null;query=search.value;filtered=MarketCatalog.filter(rows,query,onlyFavorites?favorites:null,sort,direction);selected=chosen?filtered.findIndex(r=>r.exchange===chosen.exchange&&r.symbol===chosen.symbol):-1;if(!keepPosition)viewport.scrollTop=0;manual.hidden=exchange.value==='ALL'||!/^[A-Z0-9]{1,40}$/.test(query.toUpperCase().replace(/[-_/]/g,''));updateMessage();schedule();}
  function select(row){onSelect({ex:row.exchange,symbol:row.symbol},target);dialog.close();}
  function render(){
   spacer.style.height=filtered.length*52+'px';empty.hidden=filtered.length!==0;
   if(!filtered.length)empty.textContent=failure||(loading?'종목 목록을 불러오고 있습니다. 받은 결과부터 표시합니다.':onlyFavorites?'즐겨찾기에 추가한 종목이 없습니다.':'검색 결과가 없습니다.');
   const range=MarketCatalog.visibleRange(filtered.length,viewport.scrollTop,viewport.clientHeight||300),fragment=document.createDocumentFragment();
   for(let i=range.start;i<range.end;i++){
    const row=filtered[i],key=row.exchange+':'+row.symbol,record=el('div','symbol-picker-row');record.style.top=i*52+'px';record.setAttribute('role','listitem');record.classList.toggle('keyboard-selected',i===selected);
    const star=el('button','symbol-picker-star',favorites.has(key)?'★':'☆');star.type='button';star.setAttribute('aria-label',row.base+' · '+exchangeName(row.exchange)+' 즐겨찾기');star.setAttribute('aria-pressed',String(favorites.has(key)));star.onclick=()=>{favorites.has(key)?favorites.delete(key):favorites.add(key);try{localStorage.setItem('funding-chart-symbol-favorites-v1',JSON.stringify([...favorites]));}catch{}if(onlyFavorites)applyFilter();else schedule();};
    const button=el('button','symbol-picker-select');button.type='button';button.setAttribute('aria-label',row.base+' USDT · '+exchangeName(row.exchange)+' 선택');button.classList.toggle('current',row.symbol===current?.symbol&&row.exchange===current?.ex);
    const identity=el('span','symbol-picker-name'),base=el('strong','',row.base),quote=el('small','symbol-picker-market',row.base+'/USDT · '+exchangeName(row.exchange));identity.append(base,quote);
    const lastPrice=el('span','',row.price!==null?(row.price<.000001?row.price.toPrecision(6):price.format(row.price)):'—'),delta=el('span',row.change===null?'':row.change>=0?'positive':'negative',row.change===null?'—':(row.change>0?'+':'')+row.change.toFixed(2)+'%'),vol=el('span','symbol-picker-volume',row.volume!==null?(row.volumeApprox?'≈':'')+money.format(row.volume):'—');
    if(row.volumeApprox)vol.title='기초자산 거래량 × 현재가로 계산한 USDT 추정 거래대금';
    button.append(identity,lastPrice,delta,vol);button.onclick=()=>select(row);record.append(star,button);fragment.append(record);
   }
   layer.replaceChildren(fragment);
  }
  async function load(force=false){
   const id=++requestId;abort?.abort();abort=new AbortController();const signal=abort.signal;refresh.disabled=true;failure='';loading=true;const ex=exchange.value;
   updateMessage();schedule();
   const receive=result=>{if(signal.aborted||id!==requestId||!dialog.open)return;rows=result.rows;resultInfo=result;failure='';applyFilter(true);};
   try{const result=await catalog.load(ex,signal,{refresh:force,onUpdate:receive});receive(result);}
   catch(error){if(signal.aborted||id!==requestId||!dialog.open)return;rows=[];failure=error.message;applyFilter();}
   finally{if(id===requestId){loading=false;refresh.disabled=false;updateMessage();schedule();}}
  }
  function open(market,index=0){target=index;current={...market,symbol:MarketCatalog.base(market.symbol)+'USDT'};title.textContent='종목 선택 · '+(index+1)+'번 차트';search.value='';manual.hidden=true;rows=[];filtered=[];failure='';resultInfo=null;viewport.scrollTop=0;selected=-1;onlyFavorites=false;all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');empty.hidden=false;empty.textContent='종목 목록을 불러오고 있습니다.';if(!dialog.open)dialog.showModal();search.focus();schedule();void load();clearInterval(timer);timer=setInterval(()=>{if(dialog.open&&!document.hidden&&!loading)void load(true);},15000);}
  search.addEventListener('input',()=>applyFilter());exchange.onchange=()=>{rows=[];resultInfo=null;applyFilter();void load();};refresh.onclick=()=>void load(true);
  all.onclick=()=>{onlyFavorites=false;all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');applyFilter();};favorite.onclick=()=>{onlyFavorites=true;all.setAttribute('aria-pressed','false');favorite.setAttribute('aria-pressed','true');applyFilter();};
  for(const [button,field]of [[name,'symbol'],[change,'change'],[volume,'volume']])button.onclick=()=>{direction=sort===field?-direction:field==='symbol'?1:-1;sort=field;applyFilter();};
  manual.onclick=()=>{if(exchange.value!=='ALL')select({exchange:exchange.value,symbol:MarketCatalog.base(search.value.toUpperCase().replace(/[-_/]/g,''))+'USDT'});};
  search.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&filtered.length){event.preventDefault();selected=Math.max(0,Math.min(filtered.length-1,selected+(event.key==='ArrowDown'?1:-1)));if(selected*52<viewport.scrollTop||selected*52+52>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=Math.max(0,selected*52-viewport.clientHeight/2);schedule();}else if(event.key==='Enter'){event.preventDefault();if(filtered.length)select(filtered[Math.max(0,selected)]);else if(!manual.hidden)manual.click();}});
  viewport.addEventListener('scroll',schedule,{passive:true});new ResizeObserver(schedule).observe(viewport);
  close.onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{abort?.abort();clearInterval(timer);requestId++;});
  return {open,close:()=>dialog.close()};
 }
 root.SymbolPicker={bind};
})(globalThis);
