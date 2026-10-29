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
  for(const [value,label]of MarketCatalog.exchanges){const o=el('option','',label);o.value=value;exchange.append(o);}
  const search=el('input');search.type='search';search.id='symbolPickerSearch';search.placeholder='코인 검색 (예: BTC, NIL, SAHARA)';search.setAttribute('aria-label','코인 검색');
  controls.append(exchange,search);
  const tabs=el('div','symbol-picker-tabs'),all=el('button','','전체'),favorite=el('button','','★ 즐겨찾기'),refresh=el('button','','새로고침');
  for(const b of [all,favorite,refresh])b.type='button';all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');tabs.append(all,favorite,refresh);
  const columns=el('div','symbol-picker-columns'),name=el('button','','종목'),last=el('span','','현재가'),change=el('button','','24시간 등락'),volume=el('button','','거래대금');
  for(const b of [name,change,volume])b.type='button';columns.append(name,last,change,volume);
  const viewport=el('div','symbol-picker-viewport');viewport.id='symbolPickerList';viewport.setAttribute('role','list');viewport.setAttribute('aria-label','USDT 무기한 코인 목록');
  const spacer=el('div','symbol-picker-spacer'),layer=el('div','symbol-picker-rows'),empty=el('p','symbol-picker-empty');empty.hidden=true;viewport.append(spacer,layer,empty);
  const footer=el('div','symbol-picker-footer'),message=el('span'),manual=el('button','','입력한 종목으로 이동');manual.type='button';manual.hidden=true;footer.append(message,manual);
  dialog.append(heading,controls,tabs,columns,viewport,footer);host.append(dialog);
  let rows=[],filtered=[],onlyFavorites=false,sort='volume',direction=-1,frame=0,requestId=0,abort,timer,target=0,current,selected=-1,query='',failure='';
  let favorites=new Set();try{const saved=JSON.parse(localStorage.getItem('funding-chart-symbol-favorites-v1')||'[]');if(Array.isArray(saved))favorites=new Set(saved.filter(x=>typeof x==='string'));}catch{}
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});}
  function applyFilter(){query=search.value;filtered=MarketCatalog.filter(rows,query,onlyFavorites?favorites:null,sort,direction);selected=-1;viewport.scrollTop=0;manual.hidden=!/^[A-Z0-9]{1,40}$/.test(query.toUpperCase().replace(/[-_/]/g,''));schedule();}
  function select(row){onSelect({ex:row.exchange,symbol:row.symbol},target);dialog.close();}
  function render(){
   spacer.style.height=filtered.length*52+'px';empty.hidden=filtered.length!==0;
   if(!filtered.length)empty.textContent=failure|| (rows.length?(onlyFavorites?'즐겨찾기에 추가한 종목이 없습니다.':'검색 결과가 없습니다.'):'종목 목록을 불러오고 있습니다.');
   const range=MarketCatalog.visibleRange(filtered.length,viewport.scrollTop,viewport.clientHeight||300),fragment=document.createDocumentFragment();
   for(let i=range.start;i<range.end;i++){
    const row=filtered[i],key=row.exchange+':'+row.symbol,record=el('div','symbol-picker-row');record.style.top=i*52+'px';record.setAttribute('role','listitem');record.classList.toggle('keyboard-selected',i===selected);
    const star=el('button','symbol-picker-star',favorites.has(key)?'★':'☆');star.type='button';star.setAttribute('aria-label',row.base+' 즐겨찾기');star.setAttribute('aria-pressed',String(favorites.has(key)));star.onclick=()=>{favorites.has(key)?favorites.delete(key):favorites.add(key);try{localStorage.setItem('funding-chart-symbol-favorites-v1',JSON.stringify([...favorites]));}catch{}if(onlyFavorites)applyFilter();else schedule();};
    const button=el('button','symbol-picker-select');button.type='button';button.setAttribute('aria-label',row.base+' USDT 선택');button.classList.toggle('current',row.symbol===current?.symbol&&row.exchange===current?.ex);
    const identity=el('span','symbol-picker-name'),base=el('strong','',row.base),quote=el('small','','/USDT');identity.append(base,quote);
    const lastPrice=el('span','',row.price!==null?(row.price<.000001?row.price.toPrecision(6):price.format(row.price)):'—'),delta=el('span',row.change===null?'':row.change>=0?'positive':'negative',row.change===null?'—':(row.change>0?'+':'')+row.change.toFixed(2)+'%'),vol=el('span','symbol-picker-volume',row.volume!==null?(row.volumeApprox?'≈':'')+money.format(row.volume):'—');
    if(row.volumeApprox)vol.title='기초자산 거래량 × 현재가로 계산한 USDT 추정 거래대금';
    button.append(identity,lastPrice,delta,vol);button.onclick=()=>select(row);record.append(star,button);fragment.append(record);
   }
   layer.replaceChildren(fragment);
  }
  async function load(force=false,keepPosition=false){
   const id=++requestId;abort?.abort();abort=new AbortController();const signal=abort.signal;refresh.disabled=true;failure='';const ex=exchange.value;
   message.textContent='USDT 무기한 · 목록 조회 중';
   try{const result=await catalog.load(ex,signal,{refresh:force});if(signal.aborted||id!==requestId||!dialog.open)return;rows=result.rows;failure='';if(keepPosition){filtered=MarketCatalog.filter(rows,search.value,onlyFavorites?favorites:null,sort,direction);schedule();}else applyFilter();message.textContent=`USDT 무기한 · ${rows.length.toLocaleString()}종목 · ${new Date(result.fetchedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})} 조회`+(result.stale?' · 갱신 실패, 이전 목록':'');}
   catch(error){if(signal.aborted||id!==requestId)return;rows=[];failure='종목 목록을 불러오지 못했습니다. 새로고침하거나 검색창에 심볼을 직접 입력하세요.';applyFilter();message.textContent=error.message;}
   finally{if(id===requestId)refresh.disabled=false;}
  }
  function open(market,index=0){target=index;current={...market,symbol:MarketCatalog.base(market.symbol)+'USDT'};title.textContent='종목 선택 · '+(index+1)+'번 차트';exchange.value=market.ex;search.value='';manual.hidden=true;rows=[];filtered=[];failure='';viewport.scrollTop=0;selected=-1;onlyFavorites=false;all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');empty.hidden=false;empty.textContent='종목 목록을 불러오고 있습니다.';if(!dialog.open)dialog.showModal();search.focus();schedule();void load();clearInterval(timer);timer=setInterval(()=>{if(dialog.open&&!document.hidden)void load(true,true);},15000);}
  search.addEventListener('input',applyFilter);exchange.onchange=()=>{rows=[];applyFilter();void load();};refresh.onclick=()=>void load(true);
  all.onclick=()=>{onlyFavorites=false;all.setAttribute('aria-pressed','true');favorite.setAttribute('aria-pressed','false');applyFilter();};favorite.onclick=()=>{onlyFavorites=true;all.setAttribute('aria-pressed','false');favorite.setAttribute('aria-pressed','true');applyFilter();};
  for(const [button,field]of [[name,'symbol'],[change,'change'],[volume,'volume']])button.onclick=()=>{direction=sort===field?-direction:field==='symbol'?1:-1;sort=field;applyFilter();};
  manual.onclick=()=>select({exchange:exchange.value,symbol:MarketCatalog.base(search.value.toUpperCase().replace(/[-_/]/g,''))+'USDT'});
  search.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)&&filtered.length){event.preventDefault();selected=Math.max(0,Math.min(filtered.length-1,selected+(event.key==='ArrowDown'?1:-1)));if(selected*52<viewport.scrollTop||selected*52+52>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=Math.max(0,selected*52-viewport.clientHeight/2);schedule();}else if(event.key==='Enter'){event.preventDefault();if(filtered.length)select(filtered[Math.max(0,selected)]);else if(!manual.hidden)manual.click();}});
  viewport.addEventListener('scroll',schedule,{passive:true});new ResizeObserver(schedule).observe(viewport);
  close.onclick=()=>dialog.close();dialog.addEventListener('click',event=>{if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>{abort?.abort();clearInterval(timer);requestId++;});
  return {open,close:()=>dialog.close()};
 }
 root.SymbolPicker={bind};
})(globalThis);
