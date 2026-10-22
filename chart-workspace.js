(function(root,factory){
 'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.ChartWorkspace=api.create(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const exchangeIds=['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'],timeframes=['1m','3m','5m','15m','30m','1h','2h','4h','1d'],channel='funding-chart-workspace-v1',storageKey='funding-chart-layout-v1';
 function market(value,fallback={ex:'BINANCE',symbol:'BTCUSDT',int:'4h'}){return {ex:exchangeIds.includes(value?.ex)?value.ex:fallback.ex,symbol:typeof value?.symbol==='string'&&/^[A-Z0-9_-]{1,48}$/.test(value.symbol)?value.symbol:fallback.symbol,int:timeframes.includes(value?.int)?value.int:fallback.int};}
 function preferences(value){return {layout:value?.layout===4?4:1,markets:Array.isArray(value?.markets)?value.markets.slice(0,4).map(m=>m?market(m):null):[]};}
 function embedUrl(href,value,index){const url=new URL(href);url.hash='';url.search='';url.searchParams.set('chart-embed','1');url.searchParams.set('cell',String(index));const m=market(value);for(const [key,v]of Object.entries(m))url.searchParams.set(key,v);return url.href;}
 function create(win){
  const doc=win.document,$=id=>doc.getElementById(id),params=new URLSearchParams(win.location.search),embedded=params.get('chart-embed')==='1';
  let saved;try{saved=preferences(JSON.parse(win.localStorage.getItem(storageKey)||'{}'));}catch{saved=preferences();}
  let mode=1,api,grid,firstCell,picker,toggle,active=0,frames=[],startup=[],disposed=false,statusNode;
  const markets=saved.markets;
  if(embedded)doc.documentElement.classList.add('chart-embedded');
  const explicit=params.has('symbol')||params.has('ex')||params.has('int'),initial=embedded||explicit?market(Object.fromEntries(['ex','symbol','int'].map(k=>[k,params.get(k)]))):markets[0];
  if(initial){$('exchangeSelect').value=initial.ex;$('symbolInput').value=initial.symbol;$('intervalSelect').value=initial.int;}
  function send(message){if(embedded&&win.parent!==win)win.parent.postMessage({channel,...message},win.location.origin);}
  function persist(){if(embedded)return;try{win.localStorage.setItem(storageKey,JSON.stringify({layout:mode,markets}));}catch{}}
  function selected(index){active=index;firstCell?.classList.toggle('selected',index===0);for(const frame of frames)frame.classList.toggle('selected',Number(frame.dataset.chartCell)===index);}
  function current(){return market(api?.getMarket()||{ex:$('exchangeSelect').value,symbol:$('symbolInput').value,int:$('intervalSelect').value});}
  function choose(value,index=0){const m=market({...value,int:markets[index]?.int||current().int});if(index===0){api.selectMarket(m);return;}const frame=frames.find(f=>Number(f.dataset.chartCell)===index);if(frame)frame.contentWindow.postMessage({channel,type:'select',market:m},win.location.origin);}
  function setLayout(next){
   if(embedded||!api)return;next=next===4?4:1;if(mode===next)return;mode=next;
   doc.body.classList.toggle('chart-layout-four',mode===4);api.workspace.classList.toggle('chart-quad',mode===4);grid.classList.toggle('four',mode===4);
   toggle.setAttribute('aria-pressed',String(mode===4));toggle.title=mode===4?'1화면으로 돌아가기':'4분할 차트';toggle.setAttribute('aria-label',toggle.title);toggle.textContent=mode===4?'▣ 1화면':'⊞ 4분할';
   for(const timer of startup)clearTimeout(timer);startup=[];
   if(mode===1){for(const frame of frames){frame.contentWindow.postMessage({channel,type:'dispose'},win.location.origin);frame.remove();}frames=[];selected(0);}
   else{
    const primary=current();markets[0]=primary;const intervals=[primary.int,'1h','15m','5m'];
    for(let index=1;index<=3;index++){
     const m=market(markets[index]||{...primary,int:intervals[index]});markets[index]=m;
     const frame=doc.createElement('iframe');frame.className='chart-cell chart-frame';frame.dataset.chartCell=String(index);frame.title=(index+1)+'번 독립 차트';frame.setAttribute('allow','fullscreen');frame.referrerPolicy='same-origin';grid.append(frame);frames.push(frame);
     startup.push(setTimeout(()=>{if(mode===4&&frame.isConnected)frame.src=embedUrl(win.location.href,m,index);},(index-1)*350));
    }
    api.onSplit?.();selected(0);
   }
   persist();api.schedule();
  }
  function marketChanged(value){const m=market(value);if(embedded)send({type:'market',market:m});else{markets[0]=m;persist();}const badge=$('chartExchangeBadge');if(badge)badge.textContent=({BINANCE:'Binance',BYBIT:'Bybit',BINGX:'BingX',BITGET:'Bitget',MEXC:'MEXC',OKX:'OKX'})[m.ex];}
  function reportStatus(text,error){if(statusNode){statusNode.hidden=!error;statusNode.textContent=error?text:'';statusNode.title=text;}}
  function bind(options){
   api=options;
   const badge=doc.createElement('span');badge.id='chartExchangeBadge';badge.className='chart-market-exchange';api.symbolButton.before(badge);
   api.symbolButton.setAttribute('aria-haspopup','dialog');api.symbolButton.title='코인 목록 열기';
   api.symbolButton.onclick=()=>{if(embedded)send({type:'picker',market:current()});else picker.open(current(),0);};
   statusNode=doc.createElement('div');statusNode.className='chart-cell-status';statusNode.setAttribute('role','status');statusNode.hidden=true;api.host.append(statusNode);
   const dateButton=doc.createElement('button');dateButton.id='chartCellDate';dateButton.type='button';dateButton.className='chart-cell-date';dateButton.textContent='▦';dateButton.title='날짜로 이동';dateButton.setAttribute('aria-label','날짜로 이동');dateButton.onclick=()=>api.jumpDate();$('drawingHistoryControls').append(dateButton);
   if(embedded){
    doc.addEventListener('pointerdown',()=>send({type:'active'}),{capture:true,passive:true});
    win.addEventListener('message',event=>{if(event.origin!==win.location.origin||event.source!==win.parent||event.data?.channel!==channel)return;
     if(event.data.type==='select')api.selectMarket(market(event.data.market,current()));
     else if(event.data.type==='dispose'){disposed=true;api.dispose();}
    });
   }else{
    grid=doc.createElement('div');grid.id='chartGrid';firstCell=doc.createElement('section');firstCell.className='chart-cell chart-cell-main selected';firstCell.setAttribute('aria-label','1번 독립 차트');firstCell.append($('chartTopbar'),$('chartBody'));grid.append(firstCell);api.workspace.prepend(grid);
    firstCell.addEventListener('pointerdown',()=>selected(0),{capture:true,passive:true});
    let catalog;try{catalog=win.MarketCatalog.create();}catch{}
    picker=win.SymbolPicker.bind({host:api.workspace,catalog,onSelect:choose});
    toggle=doc.createElement('button');toggle.id='chartLayoutToggle';toggle.type='button';toggle.className='chart-layout-toggle';toggle.textContent='⊞ 4분할';toggle.setAttribute('aria-label','4분할 차트');toggle.title='4분할 차트';toggle.setAttribute('aria-pressed','false');toggle.onclick=()=>setLayout(mode===4?1:4);$('drawingHistoryControls').append(toggle);
    win.addEventListener('message',event=>{
     if(event.origin!==win.location.origin||event.data?.channel!==channel)return;
     const frame=frames.find(f=>f.contentWindow===event.source);if(!frame)return;const index=Number(frame.dataset.chartCell),data=event.data;
     if(data.type==='market'){markets[index]=market(data.market);persist();}
     else if(data.type==='picker'){selected(index);markets[index]=market(data.market);picker.open(markets[index],index);}
     else if(data.type==='active')selected(index);
     else if(data.type==='fullscreen')void api.fullscreen();
    });
    if(saved.layout===4)setLayout(4);
   }
   marketChanged(current());
   win.addEventListener('pagehide',()=>{disposed=true;api.dispose();},{once:true});
  }
  return {embedded,bind,marketChanged,reportStatus,isMulti:()=>embedded||mode===4,visible:()=>!disposed&&!doc.hidden,requestFullscreen:()=>{if(embedded&&win.parent!==win){send({type:'fullscreen'});return true;}return false;},setLayout};
 }
 return {create,market,preferences,embedUrl};
});
