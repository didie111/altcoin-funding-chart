(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DrawingEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const clone=v=>JSON.parse(JSON.stringify(v));
const tools=[
 ['cross','크로스','cursor',0],['dot','점','cursor',0],['pointer','화살표 커서','cursor',0],['demo','데모 커서','cursor',0],['eraser','지우개','cursor',0],
 ['trend','추세선','lines',2,'Alt+T'],['ray','레이','lines',2],['extended','연장선','lines',2],['angle','추세 각도','lines',2],['hline','수평선','lines',1,'Alt+H'],['hray','수평 레이','lines',1,'Alt+J'],['vline','수직선','lines',1,'Alt+V'],['crossline','크로스라인','lines',1,'Alt+C'],['parallel','평행 채널','lines',3],['regression','회귀 추세','lines',2],['flatChannel','수평 상단/하단','lines',2],['disjoint','평행하지 않은 채널','lines',4],['pitchfork','피치포크','lines',3],['schiff','쉬프 피치포크','lines',3],
 ['fib','피보나치 되돌림','fib',2,'Alt+F'],['fibExtension','추세 기반 피보나치 확장','fib',3],['fibFan','피보나치 팬','fib',2],['fibTime','피보나치 시간대','fib',2],['gannFan','간 팬','fib',2],
 ['xabcd','XABCD 패턴','patterns',5],['abc','ABC 패턴','patterns',3],['elliott','엘리엇 충격파','patterns',6],['triangle','삼각형 패턴','patterns',3],
 ['long','매수 포지션','measure',2],['short','매도 포지션','measure',2],['vwap','고정 VWAP','measure',1],['priceRange','가격 범위','measure',2],['dateRange','날짜 범위','measure',2],['range','날짜 및 가격 범위','measure',2],
 ['brush','브러시','shapes',-1],['highlighter','하이라이터','shapes',-1],['arrow','화살표','shapes',2],['arrowUp','위쪽 화살표','shapes',1],['arrowDown','아래쪽 화살표','shapes',1],['rectangle','사각형','shapes',2,'Alt+Shift+R'],['rotatedRect','회전된 사각형','shapes',3],['circle','원','shapes',2],['ellipse','타원','shapes',2],['polyline','폴리라인','shapes',99],['arc','호','shapes',3],['curve','곡선','shapes',3],['doubleCurve','이중 곡선','shapes',4],
 ['text','텍스트','text',1],['note','노트','text',1],['priceNote','가격 노트','text',1],['pin','핀','text',1],['table','테이블','text',1],['callout','말풍선','text',2],['comment','코멘트','text',1],['priceLabel','가격 라벨','text',1],['signpost','이정표','text',1],['flag','깃발 마크','text',1],['emoji','아이콘','icons',1],
 ['ruler','측정','utility',2],['zoom','확대','utility',2]
].map(([id,name,group,points,shortcut])=>({id,name,group,points,shortcut:shortcut||''}));
const catalog=Object.fromEntries(tools.map(t=>[t.id,t]));
const groups=[['cursor','커서','cross'],['lines','추세선 도구','trend'],['fib','피보나치 및 간 도구','fib'],['patterns','패턴','xabcd'],['measure','예측 및 측정 도구','long'],['shapes','브러시·화살표·도형','brush'],['text','텍스트 및 노트','text'],['icons','아이콘','emoji']];
const defaultFavorites=['hline','vline','trend','parallel','hray','ray'];
function finite(n){return typeof n==='number'&&Number.isFinite(n);}
function cleanItem(item){
 if(!item||!catalog[item.tool]||catalog[item.tool].points===0||!Array.isArray(item.points)||!item.points.length)return null;
 const points=item.points.slice(0,2000).filter(p=>finite(p.time)&&finite(p.price)&&p.time>=0).map(p=>({time:p.time,price:p.price}));
 if(points.length!==Math.min(item.points.length,2000))return null;
 const color=/^#[0-9a-f]{6}$/i.test(item.color)?item.color:'#60a5fa';
 return {id:String(item.id||'').slice(0,100),tool:item.tool,pane:String(item.pane||'price').slice(0,40),points,color,width:Math.max(1,Math.min(8,Number(item.width)||2)),dash:[0,1,2].includes(item.dash)?item.dash:0,fill:Math.max(0,Math.min(.8,finite(item.fill)?item.fill:.12)),text:String(item.text||'').slice(0,1000),fontSize:Math.max(10,Math.min(40,Number(item.fontSize)||14)),locked:Boolean(item.locked),hidden:Boolean(item.hidden)};
}
function normalize(value){const ids=new Set();return {items:(Array.isArray(value?.items)?value.items:[]).slice(0,500).map(cleanItem).filter(v=>{if(!v||!v.id||ids.has(v.id))return false;ids.add(v.id);return true;}),hidden:Boolean(value?.hidden),locked:Boolean(value?.locked)};}
class Store {
 constructor(storage,key='funding-chart-drawings-v1'){this.storage=storage;this.key=key;this.markets=new Map();this.market='';this.state=normalize(null);this.past=[];this.future=[];}
 switchMarket(key){if(this.market===key)return false;if(this.market)this.markets.set(this.market,{state:this.state,past:this.past,future:this.future});this.market=key;let entry=this.markets.get(key);if(!entry){let saved;try{saved=JSON.parse(this.storage?.getItem(this.key+':'+key));}catch{}entry={state:normalize(saved),past:[],future:[]};}this.state=entry.state;this.past=entry.past;this.future=entry.future;return true;}
 persist(){try{this.storage?.setItem(this.key+':'+this.market,JSON.stringify(this.state));return true;}catch{return false;}}
 commit(next){const state=normalize(next);if(JSON.stringify(state)===JSON.stringify(this.state))return false;this.past.push(clone(this.state));if(this.past.length>100)this.past.shift();this.future=[];this.state=state;this.persist();return true;}
 add(item){const next=clone(this.state);next.items.push(item);return this.commit(next);}
 update(id,patch){const next=clone(this.state),i=next.items.findIndex(v=>v.id===id);if(i<0)return false;next.items[i]={...next.items[i],...clone(patch),id};return this.commit(next);}
 remove(id){return this.commit({...this.state,items:this.state.items.filter(v=>v.id!==id)});}
 undo(){if(!this.past.length)return false;this.future.push(clone(this.state));this.state=this.past.pop();this.persist();return true;}
 redo(){if(!this.future.length)return false;this.past.push(clone(this.state));this.state=this.future.pop();this.persist();return true;}
}
function lower(rows,time){let lo=0,hi=rows.length;while(lo<hi){const m=(lo+hi)>>>1;if(rows[m].time<time)lo=m+1;else hi=m;}return lo;}
function logicalTime(rows,index,step){if(!rows.length||!finite(index))return null;if(index<=0)return rows[0].time+index*step;const last=rows.length-1;if(index>=last)return rows[last].time+(index-last)*step;const i=Math.floor(index),f=index-i;return rows[i].time+(rows[i+1].time-rows[i].time)*f;}
function timeLogical(rows,time,step){if(!rows.length||!finite(time))return null;const i=lower(rows,time);if(i===0)return (time-rows[0].time)/step;if(i===rows.length)return i-1+(time-rows[i-1].time)/step;const a=rows[i-1].time,b=rows[i].time;return i-1+(time-a)/(b-a);}
function segmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);}
function extendLine(a,b,width,height,mode){const dx=b.x-a.x,dy=b.y-a.y;if(Math.abs(dx)+Math.abs(dy)<1e-8)return [a,b];let lo=mode==='line'?-Infinity:0,hi=mode==='segment'?1:Infinity;
 for(const [v,d,min,max] of [[a.x,dx,0,width],[a.y,dy,0,height]]){if(Math.abs(d)<1e-9){if(v<min||v>max)return null;continue;}const x=(min-v)/d,y=(max-v)/d;lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));}if(lo>hi)return null;return [{x:a.x+lo*dx,y:a.y+lo*dy},{x:a.x+hi*dx,y:a.y+hi*dy}];}
function regression(rows){if(rows.length<2)return null;let sx=0,sy=0,sxx=0,sxy=0;rows.forEach((r,i)=>{sx+=i;sy+=r.close;sxx+=i*i;sxy+=i*r.close;});const n=rows.length,m=(n*sxy-sx*sy)/(n*sxx-sx*sx),b=(sy-m*sx)/n;let error=0;rows.forEach((r,i)=>{error+=(r.close-b-m*i)**2;});return {start:b,end:b+m*(n-1),deviation:Math.sqrt(error/n)};}
function vwap(rows){let pv=0,vol=0;return rows.map(r=>{const v=Math.max(0,r.volume||0);pv+=(r.high+r.low+r.close)/3*v;vol+=v;return {time:r.time,price:vol?pv/vol:r.close};});}
function movePoints(points,dt,dp){return points.map(p=>({time:Math.max(0,p.time+dt),price:p.price+dp}));}
function complete(item){if(item.tool==='long'||item.tool==='short'){const [a,b]=item.points,d=Math.max(Math.abs(b.price-a.price),Math.abs(a.price)*.005,1e-12),direction=item.tool==='long'?1:-1;item.points=[a,{time:b.time,price:a.price+direction*d},{time:b.time,price:a.price-direction*d/2}];}return item;}
return {tools,catalog,groups,defaultFavorites,Store,normalize,cleanItem,logicalTime,timeLogical,segmentDistance,extendLine,regression,vwap,movePoints,complete,clone};
});
