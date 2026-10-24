'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../drawing-renderer.js');
const same=(a,b)=>Math.abs(a.x-b.x)<1e-8&&Math.abs(a.y-b.y)<1e-8;
const env={width:600,height:400,project:p=>({x:p.time,y:400-p.price})};
const ruler=(time,price)=>({tool:'ruler',width:2,points:[{time:250,price:150},{time,price}]});

test('ruler arrows cross at the center and point toward the endpoint in all four drag directions',()=>{
 for(const time of [100,450])for(const price of [80,250]){
  const geometry=R.geometry(ruler(time,price),env),[a,b]=geometry.points;
  const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
  for(const [start,end] of [[{x:a.x,y:my},{x:b.x,y:my}],[{x:mx,y:a.y},{x:mx,y:b.y}]]){
   assert.ok(geometry.segments.some(([p,q])=>same(p,start)&&same(q,end)),'center shaft follows drag');
   const heads=geometry.segments.filter(([p])=>same(p,end));
   assert.equal(heads.length,2,'arrowhead has two sides');
   for(const [,tail] of heads)assert.ok((tail.x-end.x)*(end.x-start.x)+(tail.y-end.y)*(end.y-start.y)<0,'arrowhead points forward');
  }
  const strokes=[...geometry.svg.matchAll(/<path[^>]*stroke="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(strokes.every(c=>c===(price>=150?'#3b82f6':'#ef4444')),'arrows follow price direction colors');
 }
});

test('flat, vertical and tiny measurements do not draw a spurious arrow on a collapsed axis',()=>{
 for(const [time,price,expectedArrows]of [[250,150,0],[450,150,1],[250,250,1],[250.1,150.1,2]]){
  const geometry=R.geometry(ruler(time,price),env);
  assert.equal((geometry.svg.match(/<path[^>]*stroke-width="1"/g)||[]).length,expectedArrows*3);
  assert.doesNotMatch(geometry.svg,/NaN|Infinity/);
  if(time===250.1)for(const [a,b]of geometry.segments)assert.ok(Math.hypot(b.x-a.x,b.y-a.y)<1,'tiny measurement keeps arrowheads small');
 }
});
test('ruler results remain inside the visible plot at every edge even when their anchors are offscreen',()=>{
 for(const [time,price]of [[-900,1200],[1600,1200],[-900,-500],[1600,-500]]){
  const g=R.geometry(ruler(time,price),env),label=g.labelBoxes[0];
  assert.ok(label.x>=6&&label.y>=6);
  assert.ok(label.x+label.width<=env.width-6&&label.y+label.height<=env.height-6);
  assert.match(g.labelSvg,/%/);assert.doesNotMatch(g.shapeSvg,/<text/);
 }
});
test('a short main pane can show the complete result in the chart overlay without pane clipping',()=>{
 const g=R.geometry(ruler(450,250),{...env,width:180,height:35,labelHeight:400}),label=g.labelBoxes[0];
 assert.ok(label.height>35);assert.ok(label.y+label.height<=400);
 assert.ok(label.x+label.width<=174);assert.match(g.labelSvg,/거래량/);assert.doesNotMatch(g.labelSvg,/clip-path/);
});
test('volume measurements include both endpoints in either direction and refresh with live volume',()=>{
 const rows=[{time:0,volume:2},{time:60,volume:3},{time:120,volume:5}];
 assert.deepEqual(R.measure(rows,0,120),{bars:2,volume:10});
 assert.deepEqual(R.measure(rows,120,60),{bars:-1,volume:8});
 rows.at(-1).volume=7;assert.equal(R.measure(rows,60,120).volume,10);
 assert.equal(R.measure(rows,61,119).volume,0);
});
test('repeated ruler moves reuse the volume snapshot and inspect a logarithmic number of rows',()=>{
 const source=Array.from({length:100000},(_,i)=>({time:i*60,volume:1}));let reads=0;
 const rows=new Proxy(source,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver);}});
 R.measure(rows,6000,12000);reads=0;
 assert.equal(R.measure(rows,12000,18000).volume,101);assert.ok(reads<150,'drag should not rescan the full history');
});
