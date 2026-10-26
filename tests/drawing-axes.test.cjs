'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const R=require('../drawing-renderer.js'),E=require('../drawing-engine.js'),Manager=require('../chart-drawings.js');
const env={width:900,totalWidth:1000,height:628,plotBottom:600,formatTime:t=>'date '+t};
const pane={id:'price',top:0,bottom:200,height:200},project=p=>({x:p.time,y:p.price});
const axesSvg=(...args)=>R.axisOverlay(...args).svg;
function entry(tool,points=[{time:150,price:70}],extra={}){const item={id:tool,tool,pane:'price',points,color:'#60a5fa',width:2};return {item,pane,geometry:R.geometry(item,{width:900,height:200,project}),formatPrice:v=>v.toFixed(8),...extra};}
test('vertical drawings extend through every pane to the time axis and retain an exact date label',()=>{
 for(const tool of ['vline','crossline']){const svg=axesSvg([entry(tool)],env);assert.match(svg,/M150 0V600/);assert.match(svg,/data-drawing-axis="time"/);assert.match(svg,/date 150/);assert.match(svg,/y="600"/);assert.doesNotMatch(svg,/NaN|Infinity/);}
});
test('horizontal levels use the price axis formatter and a lower indicator keeps its own pane offset',()=>{
 const e=entry('hline',[{time:150,price:70}]);e.pane={id:'funding',top:202,bottom:600,height:398};e.formatPrice=v=>v.toFixed(6)+'%';
 const svg=axesSvg([e],env);assert.match(svg,/70\.000000%/);assert.match(svg,/data-drawing-axis="price"/);assert.match(svg,/x="900" y="262\.5"/);assert.doesNotMatch(svg,/data-drawing-axis="time"/);
});
test('selecting an ordinary tool reveals its anchor prices and times; deselection keeps the chart clear',()=>{
 const e=entry('trend',[{time:150,price:50},{time:500,price:120}]);assert.equal(axesSvg([e],env),'');
 const selected=axesSvg([{...e,selected:true}],env);assert.equal((selected.match(/data-drawing-axis="price"/g)||[]).length,2);assert.equal((selected.match(/data-drawing-axis="time"/g)||[]).length,2);
 assert.match(selected,/50\.00000000/);assert.match(selected,/date 500/);
});
test('panning does not stick an offscreen date to an edge while a visible horizontal level retains its price',()=>{
 assert.equal(axesSvg([entry('vline',[{time:-100,price:50}])],env),'');
 const svg=axesSvg([entry('hline',[{time:-100,price:50}],{selected:true})],env);assert.match(svg,/50\.00000000/);assert.doesNotMatch(svg,/data-drawing-axis="time"/);
 assert.equal(axesSvg([entry('hline',[{time:100,price:-50}])],env),'');
});
test('axis collisions prioritize the selected drawing and date labels stay inside the time axis',()=>{
 const a=entry('hline',[{time:150,price:70}]),b=entry('hray',[{time:155,price:71}],{selected:true});
 const svg=axesSvg([a,b],env);assert.match(svg,/71\.00000000/);assert.doesNotMatch(svg,/70\.00000000/);
 const date=axesSvg([entry('vline',[{time:899,price:60}])],{...env,formatTime:()=> '2026-10-22 01:03'});const rect=/<rect x="([\d.]+)" y="600" width="([\d.]+)"/.exec(date);assert.ok(rect);assert.ok(Number(rect[1])+Number(rect[2])<=900);
});
function manager(){
 const m=Object.create(Manager.prototype),node=()=>({attrs:{},innerHTML:'',setAttribute(k,v){this.attrs[k]=v;}}),series={priceFormatter:()=>({format:v=>v.toFixed(8)})};
 const panes=[{...pane,visible:true,series},{id:'rsi',top:202,bottom:600,height:398,visible:true,series}];
 Object.assign(m,{host:{clientWidth:1000,clientHeight:628,getBoundingClientRect:()=>({left:10,top:20})},scene:node(),labelScene:node(),axisScene:node(),rendered:[],store:new E.Store(null),selected:'line',preferences:{magnet:0},draft:null,gesture:null,measurement:null,preview:null,tool:'cross',sync(){},refreshUI(){},layout:()=>panes,project,api:{data:()=>[{time:0},{time:1000}],windowStart:()=>0,step:()=>1,chart:{timeScale:()=>({width:()=>900,getVisibleLogicalRange:()=>({from:0,to:500})})},formatAxisTime:t=>'date '+t,formatTime:String,rulerColors:{get:()=>({up:'#3b82f6',down:'#ef4444'})}}});
 m.store.switchMarket('BITGET:BTCUSDT');m.store.add({id:'line',tool:'vline',pane:'price',points:[{time:150,price:70}],color:'#60a5fa',width:2});return {m,panes};
}
test('the actual drawing manager renders the global line and lets a lower-pane click select it',()=>{
 const {m}=manager();m.render();assert.match(m.scene.innerHTML,/M150 0V600/);assert.match(m.axisScene.innerHTML,/date 150/);
 assert.equal(m.hit({clientX:160,clientY:420}).item.id,'line');assert.equal(m.hit({clientX:400,clientY:420}),null);
 m.store.commit({...m.store.state,hidden:true});m.render();assert.equal(m.axisScene.innerHTML,'');assert.equal(m.hit({clientX:160,clientY:420}),null);
 m.store.undo();m.render();assert.match(m.axisScene.innerHTML,/date 150/);
});
test('a vertical line survives hiding its original pane without drawing an unrelated price level',()=>{
 const {m,panes}=manager();panes.shift();m.render();assert.match(m.scene.innerHTML,/M150 0V600/);assert.match(m.axisScene.innerHTML,/date 150/);assert.doesNotMatch(m.axisScene.innerHTML,/data-drawing-axis="price"/);
});
test('new vertical and cross lines snap to an actual candle timestamp while ordinary drawings keep continuous coordinates',()=>{
 const {m,panes}=manager();m.api.data=()=>[{time:100},{time:160},{time:220}];m.api.chart.timeScale=()=>({width:()=>900,coordinateToLogical:()=>1.4});panes[0].series.coordinateToPrice=y=>y;
 for(const tool of ['vline','crossline']){m.tool=tool;assert.equal(m.point({clientX:151,clientY:70}).anchor.time,160);}
 m.tool='trend';assert.equal(m.point({clientX:151,clientY:70}).anchor.time,184);
});
function cursor(){
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),label={hidden:true,textContent:'',style:{},dataset:{}},ctx={cursorPrice:label,chart:{timeScale:()=>({width:()=>900})},rulerHost:{clientWidth:1000},chartDrawings:null,setStyle:(el,k,v)=>el.style[k]=v};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function placeCursorPrice('),source.indexOf('setInterval(()=>{if(!document.hidden)placeChartClock();}')),ctx);
 const pane={index:2,top:40,bottom:240,height:200,series:{coordinateToPrice:y=>-y/1000,priceFormatter:()=>({format:v=>v.toFixed(6)+'%'})}};return {ctx,label,pane};
}
test('mouse prices use the hovered pane and native precision even at the current-price label',()=>{
 const {ctx,label,pane}=cursor();ctx.placeCursorPrice({pane,x:400,y:100});assert.equal(label.hidden,false);assert.equal(label.textContent,'-0.060000%');assert.equal(label.dataset.pane,'2');assert.equal(label.style.left,'900px');assert.equal(label.style.top,'90.5px');
 pane.series.coordinateToPrice=()=>.000012345678;pane.series.priceFormatter=()=>({format:v=>v.toFixed(8)});ctx.placeCursorPrice({pane,x:400,y:100});assert.equal(label.textContent,'0.00001235');
});
test('cursor labels clear on axes, controls, absent data and captured drawing gestures',()=>{
 const {ctx,label,pane}=cursor();for(const hit of [undefined,{pane,x:901,y:100},{pane,x:400,y:100,blocked:true}]){ctx.placeCursorPrice(hit);assert.equal(label.hidden,true);}
 ctx.chartDrawings={tool:'pointer'};ctx.placeCursorPrice({pane,x:400,y:100});assert.equal(label.hidden,true);
 ctx.chartDrawings={tool:'cross',gesture:{}};ctx.placeCursorPrice({pane,x:400,y:100});assert.equal(label.hidden,true);
 ctx.chartDrawings=null;pane.series.coordinateToPrice=()=>null;ctx.placeCursorPrice({pane,x:400,y:100});assert.equal(label.hidden,true);
});
