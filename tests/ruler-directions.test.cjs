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
