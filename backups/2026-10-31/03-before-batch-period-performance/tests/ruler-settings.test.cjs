'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../ruler-settings.js'),R=require('../drawing-renderer.js');
test('ruler colors follow price direction, including leftward measurements and a flat price',()=>{
 assert.equal(S.colorFor(10,20),'#3b82f6');assert.equal(S.colorFor(20,10),'#ef4444');assert.equal(S.colorFor(10,10),'#3b82f6');
 assert.equal(S.colorFor(-10,-5),'#3b82f6');assert.equal(S.colorFor(-5,-10),'#ef4444');
});
test('independent user colors persist and changing them notifies the current measurement',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},settings=S.create(storage),updates=[];
 settings.subscribe(v=>updates.push(v));assert.equal(settings.set({up:'#12AB34',down:'#FEA020'}),true);assert.deepEqual(updates,[{up:'#12ab34',down:'#fea020'}]);
 assert.equal(settings.color(1,2),'#12ab34');assert.equal(settings.color(2,1),'#fea020');const restored=S.create(storage);assert.deepEqual(restored.get(),{up:'#12ab34',down:'#fea020'});
});
test('canceling a color form can leave its values uncommitted and invalid settings never replace a valid pair',()=>{
 const s=S.create(null),draft=s.get();draft.up='#112233';assert.equal(s.color(1,2),'#3b82f6');assert.equal(s.set({up:'not-a-color',down:'#ff0000'}),false);assert.deepEqual(s.get(),S.defaults);
 assert.deepEqual(S.normalize({up:'#ABCDEF',down:'url(unsafe)'}),{up:'#abcdef',down:'#ef4444'});
});
test('corrupt or unavailable browser storage preserves usable colors',()=>{
 const s=S.create({getItem:()=>'{invalid',setItem:()=>{throw Error('full');}});assert.deepEqual(s.get(),S.defaults);assert.equal(s.set({up:'#123456',down:'#654321'}),true);assert.equal(s.saved,false);assert.equal(s.color(1,2),'#123456');
});
test('the drawn ruler changes stroke, shaded area and result background together while keeping readable text',()=>{
 const env={width:600,height:300,rows:[],step:60,project:p=>({x:p.time,y:250-p.price}),rulerColors:{up:'#1122aa',down:'#aa2211'}};
 for(const [end,color]of [[140,'#1122aa'],[60,'#aa2211']]){
  const ruler={id:'measurement',tool:'ruler',points:[{time:100,price:100},{time:350,price:end}],color:'#00ff00',width:2,fill:.15,fontSize:14};
  const svg=R.geometry(ruler,env).svg;assert.match(svg,new RegExp('stroke="'+color+'"'));assert.match(svg,new RegExp('fill="'+color+'"'));assert.match(svg,new RegExp('fill:'+color+';fill-opacity'));assert.match(svg,/fill="#fff"/);assert.doesNotMatch(svg,/#00ff00/);
 }
});
test('directional ruler settings do not recolor ordinary drawings',()=>{
 const svg=R.geometry({tool:'trend',points:[{time:10,price:10},{time:100,price:50}],color:'#abcdef',width:2},{width:500,height:200,project:p=>({x:p.time,y:p.price}),rulerColors:{up:'#000000',down:'#ffffff'}}).svg;
 assert.match(svg,/stroke="#abcdef"/);
});
test('measurements are locked by default and an explicit unlock persists without replacing colors',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const s=S.create(storage);assert.equal(s.isLocked(),true);
 s.set({up:'#112233',down:'#aabbcc'});assert.equal(s.setLocked(false),true);
 const restored=S.create(storage);assert.equal(restored.isLocked(),false);assert.deepEqual(restored.get(),s.get());
 assert.equal(restored.setLocked('false'),false);assert.equal(restored.isLocked(),false);
 restored.setLocked(true);assert.equal(S.create(storage).isLocked(),true);
});
