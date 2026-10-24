'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
function lowerBound(rows,time){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].time<time)lo=mid+1;else hi=mid;}return lo;}
function loadFunction(start,end,context){vm.createContext(context);vm.runInContext(app.slice(app.indexOf(start),app.indexOf(end)),context);return context;}

test('funding and strategy markers remain chronological when their signal times interleave',()=>{
 let result;
 const context=loadFunction('function renderSignalMarkers(', 'function renderWindow(',{
  lowerBound,fundingSignalsVisible:()=>true,signals:[{time:30,rate:-.5,type:'WARN'}],strategySignals:[{time:20,text:'BUY'},{time:35,text:'SELL'}],
  markers:{setMarkers:rows=>{result=rows;}}
 });
 context.renderSignalMarkers([{time:10},{time:40}]);
 assert.deepEqual(Array.from(result,r=>r.time),[20,30,35]);
});

test('signal navigation retains containing bars and nearest gap edges with logarithmic history lookup',()=>{
 let probes=0;
 const rows=new Proxy(Array.from({length:100000},(_,i)=>({time:1000+i*60})),{get(target,key){if(/^\d+$/.test(String(key)))probes++;return Reflect.get(target,key);}});
 const context=loadFunction('function findNearestBarIndex(', 'function focusSignal(',{all:rows,lowerBound,duration:{'1m':60},loadedMarket:{int:'1m'}});
 assert.equal(context.findNearestBarIndex(1000+99000*60+59),99000);
 assert.ok(probes<50,'large histories must not be scanned for every strategy point');
 context.all=[{time:1000},{time:1600}];
 for(const [time,index]of [[900,0],[1059,0],[1300,0],[1500,1],[1600,1],[2000,1]])assert.equal(context.findNearestBarIndex(time),index);
});

test('RSI band backgrounds preserve zero RGB channels in black, red and green user colors',()=>{
 const context={TimeframeEngine:require('../timeframes.js')};vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../indicators.js'),'utf8')+'\nthis.Primitive=RsiPanePrimitive;this.engine=RsiEngine;',context);
 for(const [color,expected]of [['#000000','rgba(0, 0, 0, 0.22)'],['#ff0000','rgba(255, 0, 0, 0.22)'],['#00ff00','rgba(0, 255, 0, 0.22)']]){
  const fills=[],settings=context.engine.normalize({showFill:true,showBands:false,fillColor:color}),state={visible:true,start:0,end:0,cache:{signals:[]},settings};
  const primitive=new context.Primitive(()=>state);
  primitive.attached({chart:{timeScale:()=>({getVisibleLogicalRange:()=>({from:0,to:0}),logicalToCoordinate:x=>x})},series:{priceToCoordinate:x=>100-x}});
  const ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(){fills.push(this.fillStyle);}};
  primitive.draw({context:ctx,mediaSize:{width:300,height:100}},'bottom');
  assert.equal(fills[0],expected);
 }
});
