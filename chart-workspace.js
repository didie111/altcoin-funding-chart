(function(root,factory){
 'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
 else root.ChartWorkspace=api.create(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const exchangeIds=['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'],timeframes=['1m','3m','5m','15m','30m','1h','2h','4h','1d','1w','1M'],channel='funding-chart-workspace-v1',storageKey='funding-chart-layout-v1';
 function market(value,fallback={ex:'BINANCE',symbol:'BTCUSDT',int:'4h'}){return {ex:exchangeIds.includes(value?.ex)?value.ex:fallback.ex,symbol:typeof value?.symbol==='string'&&/^[A-Z0-9_-]{1,48}$/.test(value.symbol)?value.symbol:fallback.symbol,int:timeframes.includes(value?.int)?value.int:fallback.int};}
 function preferences(value){return {layout:value?.layout===4?4:1,markets:Array.isArray(value?.markets)?value.markets.slice(0,4).map(m=>m?market(m):null):[]};}
 function assetRevision(sources){let hash=2166136261;for(const char of sources.join('|')){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(36);}
 function embedUrl(href,value,index,revision){const url=new URL(href);url.hash='';url.search='';url.searchParams.set('chart-embed','1');url.searchParams.set('cell',String(index));if(revision)url.searchParams.set('build',revision);const m=market(value);for(const [key,v]of Object.entries(m))url.searchParams.set(key,v);return url.href;}
 function create(win){
  const doc=win.document,$=id=>doc.getElementById(id),params=new URLSearchParams(win.location.search),embedded=params.get('chart-embed')==='1';
  let saved;try{saved=preferences(JSON.parse(win.localStorage.getItem(storageKey)||'{}'));}catch{saved=preferences();}
  let mode=1,api,grid,firstCell,picker,toggle,active=0,frames=[],startup=[],disposed=false,statusNode,maximized=-1,workspaceFullscreen=false,maximizeButton,workspaceButton;
  const ownCell=embedded?Number(params.get('cell')):0;
  const markets=saved.markets;
  const controls=[],listeners=new Set(),actions=new Set(['ruler','ruler-settings','lines','indicators']);
  const signalViews=[],signalRevisions=[],signalListeners=new Set();let signalsWatched=false;
  const sameMarket=(a,b)=>a&&b&&a.ex===b.ex&&a.symbol===b.symbol&&a.int===b.int;
  function notifySignals(){for(const listener of signalListeners)listener();}
  function signalsChanged(){if(embedded){if(signalsWatched)send({type:'signals',value:api?.signalSnapshot?.()});}else if(active===0)notifySignals();}
  function activeSignals(){return hasRemoteTarget()?signalViews[active]||null:api?.signalSnapshot?.()||null;}
  function watchSignals(){if(!embedded)for(const frame of frames)if(frame.chartReady)frame.contentWindow.postMessage({channel,type:'signals-watch',enabled:Number(frame.dataset.chartCell)===active},win.location.origin);}
  function signalCommand(command,index=active,expectedMarket,revision){
   if(embedded||index!==active||!['settings','filter','page','focus'].includes(command?.kind))return false;
   const target=hasRemoteTarget()?market(markets[index],current()):current();if(expectedMarket&&!sameMarket(target,expectedMarket))return false;
   if(index===0||mode===1){if(revision!==undefined&&revision!==api?.signalSnapshot?.()?.revision)return false;api?.signalCommand?.(command);return true;}
   const frame=frames.find(f=>Number(f.dataset.chartCell)===index);if(!frame?.chartReady)return false;
   deliver(frame,{type:'signal-command',command,market:target,revision});return true;
  }
  function notify(){for(const listener of listeners)listener();}
  let lastControls='';
  if(embedded)doc.documentElement.classList.add('chart-embedded');
  const explicit=params.has('symbol')||params.has('ex')||params.has('int'),initial=embedded||explicit?market(Object.fromEntries(['ex','symbol','int'].map(k=>[k,params.get(k)]))):markets[0];
  if(initial){$('exchangeSelect').value=initial.ex;$('symbolInput').value=initial.symbol;$('intervalSelect').value=initial.int;}
  function send(message){if(embedded&&win.parent!==win)win.parent.postMessage({channel,...message},win.location.origin);}
  function persist(){if(embedded)return;try{win.localStorage.setItem(storageKey,JSON.stringify({layout:mode,markets}));}catch{}}
  function applyControls(){const state=controls[active];if(!state)return;for(const [id,key]of [['btnRuler','ruler'],['btnToggleLines','lines']]){const button=$(id);button?.classList.toggle('active',state[key]);button?.setAttribute('aria-pressed',String(state[key]));}}
  function selected(index){const changed=active!==index;active=index;firstCell?.classList.toggle('selected',index===0);for(const frame of frames)frame.classList.toggle('selected',Number(frame.dataset.chartCell)===index);applyControls();notify();if(changed){watchSignals();notifySignals();}}
  function controlsChanged(value){const state={ruler:value.ruler===true,lines:value.lines===true},key=JSON.stringify(state);controls[ownCell]=state;if(embedded&&key!==lastControls)send({type:'controls',state});lastControls=key;if(!embedded)applyControls();}
  function hasRemoteTarget(){return !embedded&&mode===4&&active>0;}
  function deliver(frame,message){if(frame.chartReady)frame.contentWindow.postMessage({channel,...message},win.location.origin);else{frame.chartQueue??=[];if(message.type==='select')frame.chartQueue=frame.chartQueue.filter(item=>item.type==='backtest-result').slice(-1);frame.chartQueue.push(message);}}
  function expandControl(button,pressed,label,kind='chart'){
   if(!button)return;button.title=label;button.setAttribute('aria-label',label);button.setAttribute('aria-pressed',String(pressed));
   const shape=kind==='workspace'
    ?'<rect x="2" y="3" width="16" height="11" rx="1.5"/><path d="M10 14v4m-4 0h8'+(pressed?'M7 8.5h6':'')+'"/>'
    :pressed?'<rect x="3" y="3" width="14" height="14" rx="1"/><path d="M10 3v14M3 10h14"/>'
    :'<rect x="3" y="3" width="14" height="14" rx="1"/><path d="m6 14 8-8M9 6h5v5"/>';
   button.innerHTML='<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+shape+'</svg>';
  }
  function fullscreenState(){return embedded||mode===4?{active:maximized===ownCell,label:maximized===ownCell?'4분할로 돌아가기 (Alt+Enter)':'이 차트 최대화 (Alt+Enter)'}:null;}
  function updateControls(){const state=fullscreenState();if(maximizeButton)maximizeButton.hidden=!state;if(workspaceButton)workspaceButton.hidden=false;expandControl(maximizeButton,Boolean(state?.active),state?.label||'이 차트 최대화 (Alt+Enter)');expandControl(workspaceButton,workspaceFullscreen,workspaceFullscreen?'작업 영역 전체화면 해제':'작업 영역 전체화면','workspace');}
  function broadcastLayout(){if(!embedded)for(const frame of frames)frame.contentWindow.postMessage({channel,type:'layout-state',maximized,fullscreen:workspaceFullscreen},win.location.origin);}
  function syncWorkspaceFullscreen(value){if(embedded||workspaceFullscreen===value)return;workspaceFullscreen=value;updateControls();broadcastLayout();}
  function setMaximized(index){
   if(embedded||mode!==4||!Number.isInteger(index)||index< -1||index>3)return;
   if(index>0&&!frames.some(frame=>Number(frame.dataset.chartCell)===index))return;
   maximized=index;grid.classList.toggle('cell-maximized',index>=0);firstCell.classList.toggle('maximized',index===0);
   for(const frame of frames)frame.classList.toggle('maximized',Number(frame.dataset.chartCell)===index);
   if(index>=0)selected(index);updateControls();broadcastLayout();api.syncFullscreen?.();api.schedule();
  }
  function toggleMaximized(index){setMaximized(maximized===index?-1:index);}
  function restoreMaximized(){if(maximized<0)return false;if(embedded)send({type:'restore'});else setMaximized(-1);return true;}
  function requestFullscreen(){if(embedded){send({type:'maximize'});return true;}if(mode===4){toggleMaximized(0);return true;}return false;}
  function requestWorkspaceFullscreen(){if(embedded)send({type:'workspace-fullscreen'});else void api.fullscreen({workspace:true});}
  function exitWorkspaceFullscreen(){if(!embedded||!workspaceFullscreen)return false;send({type:'exit-workspace-fullscreen'});return true;}
  function current(){return market(api?.getMarket()||{ex:$('exchangeSelect').value,symbol:$('symbolInput').value,int:$('intervalSelect').value});}
  function choose(value,index=0,navigation){const m=market(value,markets[index]||current());if(index===0){api.selectMarket(m,navigation);return;}const frame=frames.find(f=>Number(f.dataset.chartCell)===index);if(frame){markets[index]=m;signalViews[index]=null;persist();if(active===index){notify();notifySignals();}deliver(frame,{type:'select',market:m,navigation});}}
  function setBacktest(value,index=active){if(embedded)return;if(mode===1||index===0){api.backtest?.(value);return;}const frame=frames.find(f=>Number(f.dataset.chartCell)===index);if(frame)deliver(frame,{type:'backtest-result',value});}
  function selectActive(value,navigation){if(!hasRemoteTarget())return false;choose(value,active,navigation);return true;}
  function runOnActive(action){if(!hasRemoteTarget()||!actions.has(action))return false;const frame=frames.find(f=>Number(f.dataset.chartCell)===active);if(!frame)return false;deliver(frame,{type:'action',action});return true;}
  function setLayout(next){
   if(embedded||!api)return;next=next===4?4:1;if(mode===next)return;if(maximized>=0)setMaximized(-1);mode=next;
   doc.body.classList.toggle('chart-layout-four',mode===4);api.workspace.classList.toggle('chart-quad',mode===4);grid.classList.toggle('four',mode===4);
   toggle.setAttribute('aria-pressed',String(mode===4));toggle.title=mode===4?'1화면으로 돌아가기':'4분할 차트';toggle.setAttribute('aria-label',toggle.title);toggle.textContent=mode===4?'▣ 1화면':'⊞ 4분할';
   for(const timer of startup)clearTimeout(timer);startup=[];
   if(mode===1){for(const frame of frames){frame.contentWindow.postMessage({channel,type:'dispose'},win.location.origin);frame.remove();}frames=[];signalViews.length=0;signalRevisions.length=0;selected(0);}
   else{
    const primary=current();markets[0]=primary;const intervals=[primary.int,'1h','15m','5m'],revision=assetRevision(Array.from(doc.querySelectorAll?.('script[src],link[rel="stylesheet"]')||[],element=>element.src||element.href));
    for(let index=1;index<=3;index++){
     const m=market(markets[index]||{...primary,int:intervals[index]});markets[index]=m;
     const frame=doc.createElement('iframe');frame.className='chart-cell chart-frame';frame.dataset.chartCell=String(index);frame.title=(index+1)+'번 독립 차트';frame.setAttribute('allow','fullscreen');frame.referrerPolicy='same-origin';grid.append(frame);frames.push(frame);
     startup.push(setTimeout(()=>{if(mode===4&&frame.isConnected)frame.src=embedUrl(win.location.href,m,index,revision);},(index-1)*350));
    }
    api.onSplit?.();selected(0);
   }
   updateControls();broadcastLayout();api.syncFullscreen?.();persist();api.schedule();
  }
  function marketChanged(value){const m=market(value);if(embedded)send({type:'market',market:m,revision:value.id});else{markets[0]=m;persist();notify();if(active===0)notifySignals();}const badge=$('chartExchangeBadge');if(badge)badge.textContent=({BINANCE:'Binance',BYBIT:'Bybit',BINGX:'BingX',BITGET:'Bitget',MEXC:'MEXC',OKX:'OKX'})[m.ex];}
  function reportStatus(text,error){if(statusNode){statusNode.hidden=!error;statusNode.textContent=error?text:'';statusNode.title=text;}}
  function bind(options){
   api=options;
   const badge=doc.createElement('span');badge.id='chartExchangeBadge';badge.className='chart-market-exchange';api.symbolButton.before(badge);
   api.symbolButton.setAttribute('aria-haspopup','dialog');api.symbolButton.title='코인 목록 열기';
   api.symbolButton.onclick=()=>{if(embedded)send({type:'picker',market:current()});else picker.open(current(),0);};
   statusNode=doc.createElement('div');statusNode.className='chart-cell-status';statusNode.setAttribute('role','status');statusNode.hidden=true;api.host.append(statusNode);
   const dateButton=doc.createElement('button');dateButton.id='chartCellDate';dateButton.type='button';dateButton.className='chart-cell-date';dateButton.innerHTML='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2v4m8-4v4M3 10h18M3 14V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/><path d="M2 19h9m-3-3 3 3-3 3"/></svg>';dateButton.title='날짜로 이동';dateButton.setAttribute('aria-label','날짜로 이동');dateButton.onclick=()=>api.jumpDate();$('drawingHistoryControls').append(dateButton);
   maximizeButton=doc.createElement('button');maximizeButton.id='chartCellMaximize';maximizeButton.type='button';maximizeButton.className='chart-workspace-control';maximizeButton.onclick=()=>{if(embedded)send({type:'maximize'});else toggleMaximized(0);};
   workspaceButton=doc.createElement('button');workspaceButton.id='chartWorkspaceFullscreen';workspaceButton.type='button';workspaceButton.className='chart-workspace-control';workspaceButton.onclick=requestWorkspaceFullscreen;$('drawingHistoryControls').append(maximizeButton,workspaceButton);
   doc.addEventListener('keydown',event=>{if(event.defaultPrevented||!event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.key!=='Enter'||event.target?.closest?.('input,textarea,select,[contenteditable="true"]')||doc.querySelector('dialog[open]'))return;event.preventDefault();if(embedded)send({type:'maximize'});else if(mode===4)toggleMaximized(maximized>=0?maximized:active);else void api.fullscreen({workspace:true});});
   if(embedded){
    doc.addEventListener('pointerdown',()=>send({type:'active'}),{capture:true,passive:true});doc.addEventListener('focusin',()=>send({type:'active'}));
    win.addEventListener('message',event=>{if(event.origin!==win.location.origin||event.source!==win.parent||event.data?.channel!==channel)return;
     if(event.data.type==='backtest-result')api.backtest?.(event.data.value);
     else if(event.data.type==='signals-watch'){signalsWatched=event.data.enabled===true;signalsChanged();}
     else if(event.data.type==='signal-command'&&sameMarket(event.data.market,current())&&event.data.revision===api?.signalSnapshot?.()?.revision&&['settings','filter','page','focus'].includes(event.data.command?.kind))api.signalCommand?.(event.data.command);
     else if(event.data.type==='select')api.selectMarket(market(event.data.market,current()),event.data.navigation);
     else if(event.data.type==='action'&&actions.has(event.data.action))api.action?.(event.data.action);
     else if(event.data.type==='dispose'){disposed=true;api.dispose();}
     else if(event.data.type==='layout-state'){maximized=Number.isInteger(event.data.maximized)&&event.data.maximized>=-1&&event.data.maximized<=3?event.data.maximized:-1;workspaceFullscreen=event.data.fullscreen===true;updateControls();api.syncFullscreen?.();}
    });
   }else{
    grid=doc.createElement('div');grid.id='chartGrid';firstCell=doc.createElement('section');firstCell.className='chart-cell chart-cell-main selected';firstCell.setAttribute('aria-label','1번 독립 차트');firstCell.append($('chartTopbar'),$('chartBody'));grid.append(firstCell);api.workspace.prepend(grid);
    firstCell.addEventListener('pointerdown',()=>selected(0),{capture:true,passive:true});firstCell.addEventListener('focusin',()=>selected(0));
    let catalog;try{catalog=win.MarketCatalog.create();}catch{}
    picker=win.SymbolPicker.bind({host:api.workspace,catalog,onSelect:choose});
    toggle=doc.createElement('button');toggle.id='chartLayoutToggle';toggle.type='button';toggle.className='chart-layout-toggle';toggle.textContent='⊞ 4분할';toggle.setAttribute('aria-label','4분할 차트');toggle.title='4분할 차트';toggle.setAttribute('aria-pressed','false');toggle.onclick=()=>setLayout(mode===4?1:4);$('drawingHistoryControls').append(toggle);
    win.addEventListener('message',event=>{
     if(event.origin!==win.location.origin||event.data?.channel!==channel)return;
     const frame=frames.find(f=>f.contentWindow===event.source);if(!frame)return;const index=Number(frame.dataset.chartCell),data=event.data;
     if(data.type==='market'){markets[index]=market(data.market);signalViews[index]=null;signalRevisions[index]=Number.isInteger(data.revision)?data.revision:null;persist();if(active===index){notify();notifySignals();}}
     else if(data.type==='signals'){
      const value=data.value;if(!value||!sameMarket(value.market,markets[index])||value.revision!==signalRevisions[index])return;
      signalViews[index]=value;if(active===index)notifySignals();
     }
     else if(data.type==='controls'){controls[index]={ruler:data.state?.ruler===true,lines:data.state?.lines===true};applyControls();}
     else if(data.type==='picker'){selected(index);markets[index]=market(data.market);picker.open(markets[index],index);}
     else if(data.type==='active')selected(index);
     else if(data.type==='maximize')toggleMaximized(index);
     else if(data.type==='restore')setMaximized(-1);
     else if(data.type==='workspace-fullscreen')void api.fullscreen({workspace:true});
     else if(data.type==='exit-workspace-fullscreen'&&workspaceFullscreen)void api.fullscreen({workspace:true});
     else if(data.type==='ready'){frame.chartReady=true;for(const message of frame.chartQueue||[])deliver(frame,message);frame.chartQueue=[];broadcastLayout();watchSignals();}
    });
    if(saved.layout===4)setLayout(4);
   }
   updateControls();marketChanged(current());if(embedded)send({type:'ready'});api.syncFullscreen?.();
   win.addEventListener('pagehide',()=>{disposed=true;api.dispose();},{once:true});
  }
  return {openPicker(){if(embedded){send({type:'picker',market:current()});return;}picker?.open(mode===4?markets[active]||current():current(),mode===4?active:0);},embedded,bind,marketChanged,reportStatus,selectActive,runOnActive,controlsChanged,setBacktest,signalsChanged,activeSignals,signalCommand,subscribeSignals:listener=>{signalListeners.add(listener);return ()=>signalListeners.delete(listener);},activeCell:()=>active,subscribe:listener=>{listeners.add(listener);return ()=>listeners.delete(listener);},activeMarket:()=>hasRemoteTarget()?market(markets[active],current()):current(),isMulti:()=>embedded||mode===4,visible:()=>!disposed&&!doc.hidden,requestFullscreen,requestWorkspaceFullscreen,exitWorkspaceFullscreen,restoreMaximized,fullscreenState,syncWorkspaceFullscreen,setLayout};
 }
 return {create,market,preferences,embedUrl,assetRevision};
});
