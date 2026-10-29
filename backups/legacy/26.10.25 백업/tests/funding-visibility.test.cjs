'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function harness(){
 const funding={active:true,hidden:false},cycle={active:true,hidden:false},rows=Array.from({length:6},(_,i)=>({time:10+i*10}));
 const markerCalls=[],strokes=[],guide={style:{},hidden:true},canvas={style:{},setTransform(){},clearRect(){},setLineDash(){},beginPath(){},moveTo(){},lineTo(){},stroke(path){strokes.push({color:this.strokeStyle,path});}};
 const context={Map,Math,devicePixelRatio:1,lastFundingSignalVisibility:undefined,all:rows,windowStart:0,windowEnd:6,signals:[{time:30,rate:-1.5,type:'WARN'}],
  strategySignals:[{time:20,text:'1h70▼',type:'RSI_SELL'}],studyPanels:{panels:new Map([['funding',funding],['cycle',cycle]]),position(){}},
  markers:{setMarkers:markers=>markerCalls.push(markers)},lowerBound:(array,time)=>{let lo=0,hi=array.length;while(lo<hi){const mid=(lo+hi)>>>1;if(array[mid].time<time)lo=mid+1;else hi=mid;}return lo;},
  overlay:{style:{}},$:()=>({clientWidth:300,clientHeight:200}),ctx:canvas,guideCountdown:guide,
  chart:{timeScale:()=>({width:()=>270,getVisibleRange:()=>({from:10,to:60}),timeToCoordinate:time=>time})},
  drawCycleBands(){},drawRuler(){},drawSurgeHighlight(){},placeChartSymbol(){},placeChartNavigation(){},placeChartClock(){},placeLegendToggle(){},chartDrawings:null,
  selectedGuideVisible:false,selectedGuideTime:null,selectedGuideKind:'signal',selectedSignal:null,showLines:true,
  Path2D:class {moveTo(){}lineTo(){}}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('function fundingSignalsVisible()'),source.indexOf('function renderWindow('))+
  source.slice(source.indexOf('function drawInner()'),source.indexOf('const rulerColors=')),context);
 return {context,funding,cycle,markerCalls,strokes,guide,rows};
}
test('hiding funding clears percentage arrows and restoring it brings them back while RSI markers remain',()=>{
 const h=harness();h.context.syncFundingSignalVisibility();assert.deepEqual(Array.from(h.markerCalls.at(-1),m=>m.text),['1h70▼','-1.500%']);
 h.funding.hidden=true;h.context.syncFundingSignalVisibility();assert.deepEqual(Array.from(h.markerCalls.at(-1),m=>m.text),['1h70▼']);
 h.context.signals.push({time:40,rate:-2,type:'EXTREME'});h.context.renderSignalMarkers(h.rows);assert.deepEqual(Array.from(h.markerCalls.at(-1),m=>m.text),['1h70▼']);
 h.funding.hidden=false;h.context.syncFundingSignalVisibility();assert.deepEqual(Array.from(h.markerCalls.at(-1),m=>m.text),['1h70▼','-1.500%','-2.000%']);
});
test('funding warning dotted lines follow funding visibility and do not depend on the cycle pane',()=>{
 const h=harness();h.context.drawInner();assert.ok(h.strokes.some(s=>s.color==='#ef444480'));
 h.strokes.length=0;h.cycle.hidden=true;h.context.drawInner();assert.ok(h.strokes.some(s=>s.color==='#ef444480'));
 h.strokes.length=0;h.funding.hidden=true;h.context.drawInner();assert.equal(h.strokes.length,0);
 h.strokes.length=0;h.funding.hidden=false;h.context.showLines=false;h.context.drawInner();assert.equal(h.strokes.length,0);
});
test('removing the funding pane hides its markers and merely maximizing the price pane preserves its enabled state',()=>{
 const h=harness();h.funding.active=false;h.context.syncFundingSignalVisibility();assert.deepEqual(Array.from(h.markerCalls.at(-1),m=>m.text),['1h70▼']);
 h.funding.active=true;h.context.studyPanels.maximized={id:'price'};h.context.syncFundingSignalVisibility();assert.ok(h.markerCalls.at(-1).some(m=>m.text==='-1.500%'));
});
test('a funding selection guide hides with funding while date and strategy position guides still work',()=>{
 const h=harness();h.funding.hidden=true;h.context.selectedGuideVisible=true;h.context.selectedGuideTime=30;h.context.selectedSignal={rate:-1.5};h.context.drawInner();assert.equal(h.guide.hidden,true);
 h.context.selectedGuideKind='date';h.context.drawInner();assert.equal(h.guide.hidden,false);assert.ok(h.strokes.some(s=>s.color==='#60a5fa'));
 h.context.selectedGuideKind='signal';h.context.selectedSignal={type:'RSI_SELL'};h.context.drawInner();assert.equal(h.guide.hidden,false);assert.ok(h.strokes.some(s=>s.color==='#fbbf24'));
});
test('unchanged visibility does not rebuild markers every frame and an empty chart clears old labels',()=>{
 const h=harness();h.context.drawInner();const calls=h.markerCalls.length;for(let i=0;i<20;i++)h.context.drawInner();assert.equal(h.markerCalls.length,calls);
 h.context.renderSignalMarkers([]);assert.equal(h.markerCalls.at(-1).length,0);
});
