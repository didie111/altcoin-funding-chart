(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkspaceSidebar=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const storageKey='funding-chart-sidebar-v1';
 const paths={history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2"/>',panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',right:'<path d="m9 6 6 6-6 6"/>',left:'<path d="m15 6-6 6 6 6"/>',news:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',strategy:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m12 12 8-8"/>',funding:'<path d="m13 2-8 12h6l-1 8 9-12h-6z"/>',scanner:'<path d="M4 19V5m0 14h16M7 14l4-4 4 2 5-7"/>',rank:'<path d="M5 20V10h4v10m2 0V4h4v16m2 0v-7h4v7"/>'};
 const icon=name=>'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[name]+'</svg>';
 function preference(value,width){return typeof value?.collapsed==='boolean'?value.collapsed:width<960;}
 function bind({window:win,workspace,onVisibilityChange=()=>{}}){
  const doc=win.document,$=id=>doc.getElementById(id),sidebar=$('signal-sidebar'),grid=$('chartGrid');
  if(!sidebar||!grid||doc.documentElement.classList.contains('chart-embedded'))return null;
  let saved;try{saved=JSON.parse(win.localStorage.getItem(storageKey)||'{}');}catch{}
  let collapsed=preference(saved,win.innerWidth),disposed=false;
  const column=doc.createElement('div');column.id='workspaceChartColumn';
  column.append(grid);if($('backtestDock'))column.append($('backtestDock'));workspace.prepend(column);
  const dock=doc.createElement('div');dock.id='workspaceSidebarDock';
  const rail=doc.createElement('nav');rail.id='workspaceSidebarRail';rail.setAttribute('aria-label','신호·소식 패널 메뉴');
  const toggle=doc.createElement('button');toggle.id='workspaceSidebarToggle';toggle.type='button';toggle.setAttribute('aria-controls','signal-sidebar');rail.append(toggle);
  const quick=[];
  function button(label,image,id){const b=doc.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-controls',id);b.innerHTML=icon(image);b.onclick=()=>open(id);rail.append(b);quick.push({button:b,id});}
  button('전략 신호 열기','strategy','tab-strategy');button('펀딩 신호 열기','funding','tab-funding');button('상장폐지 소식 열기','news','tab-delistings');button('5일 급등락 열기','scanner','tab-scanner');button('펀딩비 순위 열기','rank','tab-funding-rank');button('펀딩 과거 이력 열기','history','tab-funding-history');
  const heading=doc.createElement('div');heading.className='workspace-sidebar-heading';
  const label=doc.createElement('span');label.textContent='신호·소식';const close=doc.createElement('button');close.type='button';close.title='오른쪽 패널 접기';close.setAttribute('aria-label','오른쪽 패널 접기');close.innerHTML=icon('right');close.onclick=()=>setCollapsed(true,true);heading.append(label,close);sidebar.prepend(heading);
  dock.append(sidebar,rail);workspace.append(dock);workspace.classList.add('has-sidebar-dock');
  function persist(){try{win.localStorage.setItem(storageKey,JSON.stringify({collapsed}));}catch{}}
  function syncTabs(){for(const {button,id}of quick){const selected=!collapsed&&$(id)?.classList.contains('active');button.setAttribute('aria-pressed',String(Boolean(selected)));}}
  function setCollapsed(value,focus=false){
   collapsed=Boolean(value);sidebar.hidden=collapsed;dock.classList.toggle('collapsed',collapsed);workspace.classList.toggle('sidebar-collapsed',collapsed);
   toggle.setAttribute('aria-expanded',String(!collapsed));toggle.title=collapsed?'오른쪽 신호 패널 펼치기':'오른쪽 신호 패널 접기';toggle.setAttribute('aria-label',toggle.title);toggle.innerHTML=icon(collapsed?'left':'right');
   syncTabs();persist();onVisibilityChange(!collapsed);if(focus)toggle.focus();
  }
  function open(id){if(disposed)return;setCollapsed(false);if(id){const tab=Array.from(sidebar.querySelectorAll('.sidebar-tab-btn')).find(b=>b.dataset.tab===id);tab?.click();}syncTabs();}
  toggle.onclick=()=>setCollapsed(!collapsed,true);
  const tabs=Array.from(sidebar.querySelectorAll('.sidebar-tab-btn'));for(const tab of tabs)tab.addEventListener('click',syncTabs);
  setCollapsed(collapsed);
  return {open,close:()=>setCollapsed(true,true),toggle:()=>setCollapsed(!collapsed,true),isOpen:()=>!collapsed,dispose(){disposed=true;for(const tab of tabs)tab.removeEventListener('click',syncTabs);}};
 }
 return {bind,preference};
});
