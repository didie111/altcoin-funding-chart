'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Sidebar=require('../workspace-sidebar.js');
function harness({saved,width=1400}={}){
 const ids=new Map(),storage=new Map(saved?[['funding-chart-sidebar-v1',saved]]:[]),events=[],visibility=[];
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classes=new Set();this.classList={add:n=>this.classes.add(n),contains:n=>this.classes.has(n),toggle:(n,on)=>on?this.classes.add(n):this.classes.delete(n)};}
  set id(value){this._id=value;ids.set(value,this);}get id(){return this._id;}
  set className(value){this.classes=new Set(value.split(' '));}
  append(...nodes){for(const n of nodes){n.remove();n.parentNode=this;this.children.push(n);}}
  prepend(n){n.remove();n.parentNode=this;this.children.unshift(n);}
  remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}
  setAttribute(k,v){this.attrs[k]=String(v);}focus(){doc.activeElement=this;}
  querySelectorAll(selector){const out=[];function walk(n){for(const c of n.children){if(selector==='.sidebar-tab-btn'&&c.classList.contains('sidebar-tab-btn'))out.push(c);walk(c);}}walk(this);return out;}
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}removeEventListener(type,fn){this.listeners[type]=(this.listeners[type]||[]).filter(x=>x!==fn);}
  click(){this.onclick?.();for(const fn of this.listeners.click||[])fn();}
 }
 const doc={documentElement:new Element('html'),activeElement:null,createElement:tag=>new Element(tag),getElementById:id=>ids.get(id)};
 function el(id,parent){const n=new Element('div');n.id=id;parent?.append(n);return n;}
 const body=el('body'),workspace=el('workspace',body),grid=el('chartGrid',workspace),dock=el('backtestDock',workspace),panel=el('signal-sidebar',body);
 const state=el('stratRsiToggle',panel);state.checked=false;
 for(const id of ['tab-strategy','tab-funding','tab-delistings','tab-scanner','tab-funding-rank']){const tab=el('btn-'+id,panel);tab.classList.add('sidebar-tab-btn');tab.dataset.tab=id;el(id,panel);tab.onclick=()=>{events.push(id);for(const key of ['tab-strategy','tab-funding','tab-delistings','tab-scanner','tab-funding-rank'])ids.get(key).classList.toggle('active',key===id);};}
 const win={document:doc,innerWidth:width,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
 const control=Sidebar.bind({window:win,workspace,onVisibilityChange:v=>visibility.push(v)});
 return {control,workspace,grid,dock,panel,state,ids,events,storage,visibility,win};
}
test('the actual sidebar, chart grid and backtest dock remain inside the fullscreen workspace without cloning',()=>{
 const h=harness();assert.equal(h.grid.parentNode.id,'workspaceChartColumn');assert.equal(h.dock.parentNode,h.grid.parentNode);assert.equal(h.panel.parentNode.id,'workspaceSidebarDock');assert.equal(h.panel.parentNode.parentNode,h.workspace);assert.equal(h.state.checked,false);
 const parent=h.panel.parentNode;h.control.close();h.workspace.classList.add('chart-fullscreen-fallback');h.control.open('tab-strategy');assert.equal(h.panel.parentNode,parent);assert.equal(h.state.checked,false);assert.equal(h.control.isOpen(),true);assert.deepEqual(h.events,['tab-strategy']);
});
test('collapse releases the panel, preserves settings and exposes an accessible restore button',()=>{
 const h=harness();h.control.close();assert.equal(h.panel.hidden,true);assert.equal(h.ids.get('workspaceSidebarToggle').attrs['aria-expanded'],'false');assert.equal(h.ids.get('workspaceSidebarToggle').attrs['aria-controls'],'signal-sidebar');assert.equal(h.state.checked,false);assert.equal(h.ids.get('workspaceSidebarToggle').id,h.win.document.activeElement.id);
 h.ids.get('workspaceSidebarToggle').click();assert.equal(h.panel.hidden,false);assert.equal(h.state.checked,false);assert.equal(h.ids.get('workspaceSidebarToggle').attrs['aria-expanded'],'true');assert.deepEqual(h.visibility,[true,false,true]);
});
test('collapsed preference survives a new document and small screens start with the compact rail',()=>{
 const a=harness();a.control.close();const saved=a.storage.get('funding-chart-sidebar-v1');assert.equal(harness({saved}).control.isOpen(),false);assert.equal(harness({width:600}).control.isOpen(),false);
 assert.equal(harness({saved:'{"collapsed":false}',width:600}).control.isOpen(),true);assert.equal(harness({saved:'bad-json'}).control.isOpen(),true);assert.equal(Sidebar.preference({collapsed:'false'},600),true);
});
test('quick rail buttons reopen the intended existing tab and keep the sidebar controls alive',()=>{
 const h=harness();h.control.close();const rail=h.ids.get('workspaceSidebarRail'),funding=rail.children.find(n=>n.attrs['aria-label']==='펀딩 신호 열기');funding.click();assert.equal(h.control.isOpen(),true);assert.deepEqual(h.events,['tab-funding']);assert.equal(funding.attrs['aria-pressed'],'true');assert.equal(h.state.checked,false);
 h.control.close();assert.equal(funding.attrs['aria-pressed'],'false');h.control.dispose();h.control.open('tab-strategy');assert.equal(h.control.isOpen(),false);
});
