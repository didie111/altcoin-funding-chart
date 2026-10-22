'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),ChartDrawings=require('../chart-drawings.js'),E=require('../drawing-engine.js');
function harness(tool='trend'){
 const m=Object.create(ChartDrawings.prototype),captures=new Set(),pane={id:'price',top:0,bottom:300,height:300,visible:true,series:{coordinateToPrice:y=>y}};
 Object.assign(m,{tool,selected:null,draft:null,gesture:null,preview:null,marketRun:1,preferences:{color:'#60a5fa',width:2,dash:0,stay:false,magnet:0},store:new E.Store(null),host:{getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)},api:{schedule:()=>{},interaction:()=>{},status:()=>{},step:()=>60,data:()=>[{time:0},{time:1000}],windowStart:()=>0,chart:{timeScale:()=>({width:()=>1000,coordinateToLogical:x=>x})}},sync:()=>{},refreshUI:()=>{},changed:()=>{},hit:()=>null,layout:()=>[pane],project:p=>({x:p.time,y:p.price}),point:e=>({x:e.clientX,y:e.clientY,pane,anchor:{time:e.clientX,price:e.clientY}}),setTool:id=>{m.tool=id;m.cancel();}});
 m.store.switchMarket('BINGX:BTCUSDT');
 const event=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,target:{closest:()=>false},preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}});
 return {m,event,captures};
}
test('two clicks create one trend with one undo entry and return to the normal cursor',()=>{
 const {m,event,captures}=harness();m.onDown(event(100,80));m.onUp(event(100,80));assert.equal(m.store.state.items.length,0);m.onMove(event(220,50));m.onDown(event(220,50));m.onUp(event(220,50));assert.equal(m.store.state.items.length,1);assert.deepEqual(m.store.state.items[0].points,[{time:100,price:80},{time:220,price:50}]);assert.equal(m.store.past.length,1);assert.equal(m.tool,'cross');assert.equal(captures.size,0);
});
test('drag creation produces a single completed shape and never leaves chart input captured',()=>{
 const {m,event,captures}=harness('rectangle');m.onDown(event(80,40));m.onMove(event(240,130));m.onUp(event(240,130));assert.equal(m.store.state.items[0].tool,'rectangle');assert.equal(m.store.state.items[0].points[1].time,240);assert.equal(m.store.past.length,1);assert.equal(captures.size,0);
});
test('a three-point channel waits for its offset and continuous drawing keeps its tool',()=>{
 const {m,event}=harness('parallel');m.preferences.stay=true;m.onDown(event(60,100));m.onUp(event(60,100));m.onDown(event(250,70));m.onUp(event(250,70));assert.equal(m.store.state.items.length,0);m.onDown(event(100,180));m.onUp(event(100,180));assert.equal(m.store.state.items[0].points.length,3);assert.equal(m.tool,'parallel');assert.equal(m.draft,null);
});
test('freehand samples its path once and canceled gestures add no history',()=>{
 const {m,event}=harness('brush');m.onDown(event(20,20));m.onMove(event(30,40));m.onMove(event(45,30));m.onUp(event(45,30));assert.equal(m.store.state.items[0].points.length,3);assert.equal(m.store.past.length,1);
 const other=harness('trend');other.m.onDown(other.event(50,50));other.m.onMove(other.event(120,100));other.m.cancel();assert.equal(other.m.store.state.items.length,0);assert.equal(other.m.store.past.length,0);assert.equal(other.captures.size,0);
});
test('horizontal lines need one click and normal empty-chart clicks remain available for panning',()=>{
 const h=harness('hline');h.m.onDown(h.event(50,60));assert.equal(h.m.store.state.items.length,1);assert.equal(h.m.store.state.items[0].points.length,1);
 const e=h.event(200,80);h.m.onDown(e);assert.equal(e.stopped,undefined);assert.equal(h.m.gesture,null);
});
test('locked drawings can be selected without starting a move or changing the undo stack',()=>{
 const {m,event}=harness('cross'),item={id:'locked',tool:'trend',pane:'price',points:[{time:50,price:50},{time:100,price:70}],locked:true};m.store.add(item);m.hit=()=>({item:m.store.state.items[0],pane:{id:'price'},handle:-1});const before=m.store.past.length;m.onDown(event(75,60));assert.equal(m.selected,'locked');assert.equal(m.gesture,null);assert.equal(m.store.past.length,before);
});
