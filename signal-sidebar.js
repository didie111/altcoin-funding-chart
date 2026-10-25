(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SignalSidebar=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const filters=['all','funding_rsi','rsi','combo'],names={BINANCE:'Binance',BYBIT:'Bybit',BINGX:'BingX',BITGET:'Bitget',MEXC:'MEXC',OKX:'OKX'},frames={'1m':'1분','3m':'3분','5m':'5분','15m':'15분','30m':'30분','1h':'1시간','2h':'2시간','4h':'4시간','1d':'일봉','1w':'주봉','1M':'월봉'};
 function settings(value={}){return {rsi:value.rsi!==false,fundingRsi:value.fundingRsi!==false,combo:value.combo===true,fundingThreshold:Number.isFinite(Number(value.fundingThreshold))?Number(value.fundingThreshold):-.5};}
 function snapshot({market,revision=0,settings:options,filter='all',strategy=[],funding=[],page=0,loading=false}){
  filter=filters.includes(filter)?filter:'all';
  const coin=strategy.filter(s=>!s.symbol||s.symbol===market.symbol),filtered=filter==='all'?coin:coin.filter(s=>s.category===filter);
  page=Math.max(0,Math.min(Math.floor(Number(page)||0),Math.max(0,Math.ceil(funding.length/100)-1)));
  const copy=s=>Object.fromEntries(['time','eventTime','type','category','color','price','rate','timeframe','title','badgeText','conditionDesc','symbol'].filter(k=>s[k]!==undefined).map(k=>[k,s[k]]));
  return {market:{ex:market.ex,symbol:market.symbol,int:market.int},revision,settings:settings(options),filter,loading,
   strategyTotal:coin.length,strategyFiltered:filtered.length,strategy:filtered.slice(-80).reverse().map(copy),
   fundingTotal:funding.length,page,funding:funding.slice(Math.max(0,funding.length-(page+1)*100),funding.length-page*100).reverse().map(copy)};
 }
 function bind({workspace,document:doc,formatTime,formatPrice}){
  const $=id=>doc.getElementById(id);let timer,disposed=false;
  const publish=()=>{if(disposed||timer)return;timer=setTimeout(()=>{timer=null;if(!disposed)workspace?.signalsChanged();},80);};
  if(workspace?.embedded)return {publish,dispose(){disposed=true;clearTimeout(timer);}};
  const fieldNames={stratRsiToggle:'rsi',stratFundingRsiToggle:'fundingRsi',stratComboToggle:'combo',stratFundingThresh:'fundingThreshold'};
  function command(value,view=workspace.activeSignals(),index=workspace.activeCell()){
   if(!view)return false;return workspace.signalCommand(value,index,view.market,view.revision);
  }
  for(const [id,key]of Object.entries(fieldNames))if($(id))$(id).onchange=event=>{
   const value=key==='fundingThreshold'?Number(event.target.value):event.target.checked;
   if(key==='fundingThreshold'&&!Number.isFinite(value)){render();return;}
   command({kind:'settings',patch:{[key]:value}});
  };
  for(const button of doc.querySelectorAll('.btn-strat-filter'))button.onclick=()=>command({kind:'filter',filter:button.dataset.filter});
  function node(tag,text,cls){const n=doc.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
  function context(id,view,market,index){
   let el=$(id);if(!el){el=node('div',undefined,'signal-chart-context');el.id=id;if(id==='strategyChartContext')doc.querySelector('#tab-strategy .strategy-title')?.before(el);else doc.querySelector('#tab-funding .sidebar-header')?.before(el);}
   if(el){el.textContent=(index+1)+'번 차트 · '+(names[market.ex]||market.ex)+' '+market.symbol+' · '+(frames[market.int]||market.int);el.title='선택한 차트의 신호와 설정입니다.';el.dataset.cell=String(index);}
  }
  function render(){
   const view=workspace.activeSignals(),market=view?.market||workspace.activeMarket(),index=workspace.activeCell();
   context('strategyChartContext',view,market,index);context('fundingChartContext',view,market,index);
   for(const [id,key]of Object.entries(fieldNames)){const el=$(id);if(!el)continue;el.disabled=!view;if(key==='fundingThreshold'){if(doc.activeElement!==el||!view)el.value=view?.settings[key]??-.5;}else el.checked=view?.settings[key]===true;}
   for(const button of doc.querySelectorAll('.btn-strat-filter')){const selected=button.dataset.filter===(view?.filter||'all');button.classList.toggle('active',selected);button.style.background=selected?'#2563eb':'#374151';button.style.color=selected?'#fff':'#cbd5e1';button.disabled=!view;}
   if($('strategyCurrentCoinLabel'))$('strategyCurrentCoinLabel').textContent='['+market.symbol+'] 전략 신호';
   const total=view?.fundingTotal||0;for(const id of ['fundingCountBadge','signalCountTag'])if($(id))$(id).textContent=total+'개';
   if($('strategyCountTag'))$('strategyCountTag').textContent=!view?'확인 중':view.filter==='all'?view.strategyTotal+'개':view.strategyFiltered+'개 / 전체 '+view.strategyTotal+'개';
   renderItems('strategyListContainer',view?.strategy||[],view,index,true);
   renderItems('signalListContainer',view?.funding||[],view,index,false);
  }
  function renderItems(id,items,view,index,strategy){
   const container=$(id);if(!container)return;const fragment=doc.createDocumentFragment(),scroll=container.scrollTop;
   if(!items.length){const message=node('div',!view?'선택한 차트의 신호를 확인하고 있습니다.':view.loading?'['+view.market.symbol+'] 신호 데이터 분석 중…':'['+view.market.symbol+'] 조건에 맞는 '+(strategy?'전략':'펀딩비')+' 신호가 없습니다.','signal-panel-empty');fragment.append(message);}
   for(const s of items){
    const item=node('div',undefined,'signal-item '+(s.type||'')),info=node('div',undefined,'signal-info'),header=node('div',undefined,'signal-panel-item-header');
    if(strategy){item.style.borderLeftColor=/^#[0-9a-f]{6}$/i.test(s.color||'')?s.color:'#60a5fa';header.append(node('span',s.timeframe||frames[view.market.int],'signal-panel-timeframe'),node('span',s.badgeText||s.type,'signal-panel-badge'));}
    else header.append(node('span',s.type==='EXTREME'?'극단 경고':'1차 경고','signal-panel-timeframe'),node('span',Number(s.rate).toFixed(4)+'%','signal-rate '+s.type));
    info.append(header,node('div',formatTime(s.eventTime||s.time),'signal-panel-date'));
    if(strategy){info.append(node('div',s.title||'전략 신호','signal-panel-title'));info.append(node('div',(s.conditionDesc||'')+' · 가격: $'+formatPrice(s.price),'signal-panel-description'));}
    else info.append(node('div','봉 시각: '+formatTime(s.time)+' (정산 기준)','signal-panel-description'));
    const move=node('button','이동','btn-move');move.type='button';item.append(info,move);
    item.onclick=()=>{if(command({kind:'focus',source:strategy?'strategy':'funding',time:s.time,eventTime:s.eventTime,type:s.type},view,index)){for(const el of container.querySelectorAll('.signal-item'))el.removeAttribute('aria-current');item.setAttribute('aria-current','true');}};
    fragment.append(item);
   }
   if(!strategy&&view&&view.fundingTotal>100){const pages=node('div',undefined,'signal-panel-pages'),previous=node('button','이전 100개','more'),next=node('button','다음 100개','more');previous.type=next.type='button';previous.disabled=view.page===0;next.disabled=(view.page+1)*100>=view.fundingTotal;previous.onclick=()=>command({kind:'page',page:view.page-1},view,index);next.onclick=()=>command({kind:'page',page:view.page+1},view,index);pages.append(previous,node('span',(view.page+1)+'페이지'),next);fragment.append(pages);}
   container.replaceChildren(fragment);container.scrollTop=scroll;
  }
  const unsubscribe=workspace?.subscribeSignals(render);render();
  return {publish,render,dispose(){disposed=true;clearTimeout(timer);unsubscribe?.();}};
 }
 return {settings,snapshot,bind};
});
