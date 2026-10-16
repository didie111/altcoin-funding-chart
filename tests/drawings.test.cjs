'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../drawing-engine.js'),R=require('../drawing-renderer.js');
const make=(id='one',tool='trend')=>({id,tool,pane:'price',points:[{time:100,price:20},{time:160,price:30}],color:'#60a5fa',width:2});
function storage(){const values=new Map();return {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};}
test('one drag edit is one undo step, redo restores it, and a new branch discards redo',()=>{
 const s=new E.Store(storage());s.switchMarket('BINGX:BTCUSDT');s.add(make());s.update('one',{points:[{time:200,price:40},{time:260,price:50}]});
 assert.equal(s.past.length,2);s.undo();assert.deepEqual(s.state.items[0].points,make().points);s.redo();assert.equal(s.state.items[0].points[0].price,40);s.undo();s.update('one',{color:'#ef4444'});assert.equal(s.future.length,0);assert.equal(s.redo(),false);
});
test('undo and redo remain isolated by exchange and symbol while timeframe changes keep drawings',()=>{
 const s=new E.Store(storage());s.switchMarket('BINGX:BTCUSDT');s.add(make());assert.equal(s.switchMarket('BINGX:BTCUSDT'),false);s.switchMarket('MEXC:BTCUSDT');assert.equal(s.state.items.length,0);s.add(make('mexc'));s.undo();s.switchMarket('BINGX:BTCUSDT');assert.equal(s.state.items[0].id,'one');s.undo();assert.equal(s.state.items.length,0);s.switchMarket('MEXC:BTCUSDT');assert.equal(s.state.items.length,0);s.redo();assert.equal(s.state.items[0].id,'mexc');
});
test('reload restores persisted coordinates and hiding or locking is reversible',()=>{
 const disk=storage(),s=new E.Store(disk);s.switchMarket('OKX:SAHARAUSDT');s.add(make());s.commit({...s.state,hidden:true,locked:true});s.undo();assert.equal(s.state.hidden,false);s.redo();const loaded=new E.Store(disk);loaded.switchMarket('OKX:SAHARAUSDT');assert.equal(loaded.state.items[0].points[1].time,160);assert.equal(loaded.state.hidden,true);assert.equal(loaded.state.locked,true);
});
test('corrupt storage and unavailable storage do not stop drawing or undo',()=>{
 const s=new E.Store({getItem:()=>'{broken',setItem:()=>{throw Error('quota');}});s.switchMarket('BTC');assert.deepEqual(s.state.items,[]);assert.equal(s.add(make()),true);assert.equal(s.persist(),false);assert.equal(s.undo(),true);
});
test('normalization rejects invalid points, duplicate IDs and unknown tools without executing text',()=>{
 const value=E.normalize({items:[make(),make(),{...make('bad'),points:[{time:Infinity,price:10}]},{...make('unknown'),tool:'external-script'}]});assert.equal(value.items.length,1);assert.equal(E.cleanItem({...make(),width:50,fill:10}).width,8);assert.equal(E.cleanItem({...make(),fill:10}).fill,.8);
});
test('timestamp anchors survive older history insertion, gaps, and a different timeframe',()=>{
 const rows=[{time:100},{time:160},{time:760}],earlier=[{time:40},...rows];
 assert.equal(E.logicalTime(rows,1.5,60),460);assert.equal(E.timeLogical(rows,460,60),1.5);assert.equal(E.timeLogical(earlier,460,60),2.5);
 assert.equal(E.logicalTime(rows,5,60),940);assert.equal(E.timeLogical(rows,940,60),5);assert.equal(E.logicalTime(rows,-2,60),-20);
 const hourly=[{time:100},{time:3700},{time:7300}];assert.equal(E.timeLogical(hourly,1900,3600),.5);assert.equal(E.logicalTime(hourly,.5,3600),1900);
});
test('line clipping handles vertical, horizontal, reversed rays and a line entirely outside the pane',()=>{
 assert.deepEqual(E.extendLine({x:50,y:20},{x:50,y:60},100,80,'line'),[{x:50,y:0},{x:50,y:80}]);
 assert.deepEqual(E.extendLine({x:50,y:40},{x:20,y:40},100,80,'ray'),[{x:50,y:40},{x:0,y:40}]);
 assert.equal(E.extendLine({x:-10,y:0},{x:-10,y:80},100,80,'line'),null);
 assert.equal(E.segmentDistance({x:5,y:8},{x:0,y:0},{x:10,y:0}),8);
});
test('long and short positions retain independent target and stop handles with a 2:1 initial ratio',()=>{
 for(const tool of ['long','short']){const item=E.complete({...make('position',tool),points:[{time:100,price:100},{time:200,price:110}]});assert.equal(item.points.length,3);const [a,b,c]=item.points;assert.equal(Math.abs(b.price-a.price)/Math.abs(c.price-a.price),2);assert.equal(Math.sign(b.price-a.price),tool==='long'?1:-1);}
});
test('VWAP uses actual OHLCV and regression exactly recovers a straight price series',()=>{
 const rows=[{time:1,high:10,low:10,close:10,volume:1},{time:2,high:20,low:20,close:20,volume:3}];assert.equal(E.vwap(rows)[1].price,17.5);assert.deepEqual(E.regression([{close:2},{close:4},{close:6}]),{start:2,end:6,deviation:0});
});
test('every advertised drawing tool produces visible, finite geometry with escaped labels',()=>{
 const anchors=[{time:100,price:20},{time:160,price:40},{time:220,price:15},{time:280,price:35},{time:340,price:30},{time:400,price:50}],rows=Array.from({length:7},(_,i)=>({time:100+i*60,high:30+i,low:10+i,close:20+i,volume:1}));
 for(const tool of E.tools.filter(t=>t.points!==0)){let points=anchors.slice(0,tool.points<0?4:tool.points===99?4:tool.points);const item=E.complete({...make('tool',tool.id),points,text:'<script>alert("x")</script>',fill:.12,fontSize:14}),geometry=R.geometry(item,{width:700,height:300,rows,step:60,project:p=>({x:p.time-50,y:250-p.price*3})});assert.ok(geometry?.svg,tool.id);assert.doesNotMatch(geometry.svg,/NaN|Infinity|<script>/,tool.id);}
});
test('filled shape selection and thin line selection work without catching distant chart pans',()=>{
 const env={width:500,height:300,project:p=>({x:p.time,y:p.price})},rect=R.geometry({...make('rect','rectangle'),fill:.2},env),line=R.geometry(make(),env);
 assert.equal(R.hit(rect,{x:130,y:25}),true);assert.equal(R.hit(line,{x:130,y:27}),true);assert.equal(R.hit(line,{x:400,y:250}),false);
});
test('undo stack is bounded while the latest changes remain reversible',()=>{
 const s=new E.Store(storage());s.switchMarket('BTC');s.add(make());for(let i=0;i<140;i++)s.update('one',{text:String(i)});assert.equal(s.past.length,100);s.undo();assert.equal(s.state.items[0].text,'138');
});
