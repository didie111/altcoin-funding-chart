'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Manager=require('../chart-drawings.js'),E=require('../drawing-engine.js'),R=require('../drawing-renderer.js'),T=require('../timeframes.js');
const savedTime=T.parseKst('2026-02-03','20:56');
function chart(interval,{start=0,offset=0}={}){
 const first=T.shift(T.start(savedTime,interval),interval,-4),rows=Array.from({length:10},(_,i)=>({time:T.shift(first,interval,i)}));
 // Lightweight Charts 5.0.8 returns zero for fractional logical indices.
 const calls=[],scale={logicalToCoordinate:i=>{calls.push(i);return Number.isInteger(i)?180+(i+start)*40+offset:0;}};
 const m=Object.create(Manager.prototype),pane={id:'price',height:300,top:0,bottom:300,series:{priceToCoordinate:()=>120,priceFormatter:()=>({format:String})}};
 m.api={data:()=>rows,step:()=>T.seconds[interval],windowStart:()=>start,chart:{timeScale:()=>scale}};return {m,pane,rows,calls};
}
test('a one-minute vertical drawing keeps its timestamp and visible position on every supported timeframe',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},original=new E.Store(storage);original.switchMarket('BINANCE:BIRBUSDT');original.add({id:'saved-minute-line',tool:'vline',pane:'price',points:[{time:savedTime,price:.33}],color:'#60a5fa',width:2});
 const restored=new E.Store(storage);restored.switchMarket('BINANCE:BIRBUSDT');const item=restored.state.items[0];
 for(const interval of Object.keys(T.seconds)){
  const {m,pane,rows,calls}=chart(interval),p=m.project(item.points[0],pane,item.tool),bar=rows.findIndex(r=>r.time===T.start(savedTime,interval)),fraction=(savedTime-rows[bar].time)/(rows[bar+1].time-rows[bar].time),expected=180+(bar+fraction)*40;
  assert.ok(Math.abs(p.x-expected)<1e-8,interval+' must retain its intrabar time position');assert.ok(calls.every(Number.isInteger),'native coordinate calls must use integer indices');
  const geometry=R.geometry(item,{width:900,height:300,project:a=>m.project(a,pane,item.tool)}),svg=R.axisOverlay([{item,pane,geometry,formatPrice:String}],{width:900,totalWidth:1000,height:328,plotBottom:300,formatTime:t=>T.kstFields(t).date+' '+T.kstFields(t).time}).svg;
  assert.match(svg,/data-drawing-vertical="saved-minute-line"/);assert.match(svg,/2026-02-03 20:56/);assert.equal(item.points[0].time,savedTime);
 }
});
test('cross lines, Fibonacci time anchors and ordinary drawings use the same correct fractional projection',()=>{
 const {m,pane}=chart('2h',{start:3});
 for(const tool of ['vline','crossline','fibTime','trend','hray','range'])assert.ok(Math.abs(m.project({time:savedTime,price:.33},pane,tool).x-(180+(4+116/120)*40))<1e-8,tool);
});
test('panning an old minute line outside the coarser chart hides it instead of sticking its date label to the left edge',()=>{
 const {m,pane}=chart('2h',{offset:-1000}),item={id:'offscreen',tool:'vline',points:[{time:savedTime,price:.33}],color:'#60a5fa'},geometry=R.geometry(item,{width:900,height:300,project:a=>m.project(a,pane,item.tool)});
 assert.ok(geometry.points[0].x<0);assert.equal(R.axisOverlay([{item,pane,geometry,selected:true,formatPrice:String}],{width:900,totalWidth:1000,height:328,plotBottom:300,formatTime:String}).svg,'');
});
