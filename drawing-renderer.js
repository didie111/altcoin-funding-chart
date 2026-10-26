(function(root,factory){'use strict';const api=factory(typeof module==='object'&&module.exports?require('./drawing-engine.js'):root.DrawingEngine,typeof module==='object'&&module.exports?require('./ruler-settings.js'):root.RulerSettings);if(typeof module==='object'&&module.exports)module.exports=api;else root.DrawingRenderer=api;})(typeof globalThis!=='undefined'?globalThis:this,function(E,S){
'use strict';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const vwapCache=new WeakMap();
const volumeCache=new WeakMap();
const volumeFormat=new Intl.NumberFormat('ko-KR',{notation:'compact',maximumFractionDigits:2});
function measure(rows,from,to,step=60){
 let cached=volumeCache.get(rows);const tail=rows.at(-1);
 if(!cached||cached.length!==rows.length||cached.tail!==tail||cached.volume!==tail?.volume){const prefix=new Float64Array(rows.length+1);for(let i=0;i<rows.length;i++)prefix[i+1]=prefix[i]+(Number.isFinite(rows[i].volume)?rows[i].volume:0);cached={length:rows.length,tail,volume:tail?.volume,prefix};volumeCache.set(rows,cached);}
 const lower=(time,after=false)=>{let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid].time<time||(after&&rows[mid].time===time))lo=mid+1;else hi=mid;}return lo;};
 const lo=lower(Math.min(from,to)),hi=lower(Math.max(from,to),true),first=E.timeLogical(rows,from,step),last=E.timeLogical(rows,to,step);
 return {bars:Math.round((last??0)-(first??0)),volume:cached.prefix[hi]-cached.prefix[lo]};
}
const n=v=>Number.isFinite(v)?Math.round(Math.max(-1e7,Math.min(1e7,v))*100)/100:0;
function rulerLabelBox({width,height,labelHeight=height,a,b,boxWidth,boxHeight,pointer=b}){
 const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,left=Math.min(a.x,b.x),right=Math.max(a.x,b.x),top=Math.min(a.y,b.y),bottom=Math.max(a.y,b.y),gap=14;
 const above={x:mx-boxWidth/2,y:top-boxHeight-gap},below={x:mx-boxWidth/2,y:bottom+gap};
 const options=[...(b.y<=a.y?[above,below]:[below,above]),{x:left-boxWidth-gap,y:my-boxHeight/2},{x:right+gap,y:my-boxHeight/2}];
 const clamp=(p,h)=>({x:Math.max(6,Math.min(width-boxWidth-6,p.x)),y:Math.max(6,Math.min(h-boxHeight-6,p.y)),width:boxWidth,height:boxHeight});
 const avoids=p=>pointer.x<=p.x-gap||pointer.x>=p.x+p.width+gap||pointer.y<=p.y-gap||pointer.y>=p.y+p.height+gap;
 const available=height>=boxHeight+12?height:Math.max(height,labelHeight),candidates=options.map(p=>clamp(p,available));
 let found=candidates.find(avoids);if(found)return found;
 if(labelHeight>available){found=options.map(p=>clamp(p,labelHeight)).concat([clamp({x:mx-boxWidth/2,y:pointer.y+gap+1},labelHeight),clamp({x:mx-boxWidth/2,y:pointer.y-boxHeight-gap-1},labelHeight)]).find(avoids);if(found)return found;}
 return candidates.sort((p,q)=>Math.hypot(q.x+q.width/2-pointer.x,q.y+q.height/2-pointer.y)-Math.hypot(p.x+p.width/2-pointer.x,p.y+p.height/2-pointer.y))[0];
}
function geometry(item,env){
 const {width:w,height:h,project,rows=[]}=env,points=item.points.map(project);if(points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)))return null;
 const segments=[],boxes=[],parts=[],labels=[],labelBoxes=[],color=item.tool==='ruler'?S.colorFor(item.points[0].price,item.points.at(-1).price,env.rulerColors):item.color||'#60a5fa',lineWidth=item.width||2,dash=item.dash===1?'2 4':item.dash===2?'8 5':'',fill=item.fill??.12;
 const attrs=(c=color,sw=lineWidth)=>`stroke="${esc(c)}" stroke-width="${n(sw)}" fill="none" stroke-linecap="round" stroke-linejoin="round"${dash?' stroke-dasharray="'+dash+'"':''}`;
 const path=(d,c=color,sw=lineWidth,extra='')=>parts.push(`<path d="${d}" ${attrs(c,sw)} ${extra}/>`);
 const line=(a,b,c=color,sw=lineWidth,mode='segment')=>{const clip=E.extendLine(a,b,w,h,mode);if(!clip)return;const [p,q]=clip;segments.push([p,q]);path(`M${n(p.x)} ${n(p.y)}L${n(q.x)} ${n(q.y)}`,c,sw);};
 const text=(x,y,value,c=color,size=item.fontSize||12,bg=false)=>{let lines=String(value).split('\n').slice(0,12);const ruler=item.tool==='ruler',out=ruler?labels:parts;
  if(ruler){if(w<40)return;const count=Math.max(1,Math.floor((w-24)/(size*.65)));lines=lines.flatMap(s=>{const chunks=[];while(s.length>count){const at=s.lastIndexOf(' ',count);const split=at>count/2?at:count;chunks.push(s.slice(0,split));s=s.slice(split).trimStart();}return [...chunks,s];});}
  const tw=Math.max(...lines.map(t=>[...t].length))*size*.65+12,th=lines.length*(size+4)+8;
  if(ruler){const placed=rulerLabelBox({width:w,height:h,labelHeight:env.labelHeight,boxWidth:tw,boxHeight:th,a:points[0],b:points.at(-1),pointer:env.pointer||points.at(-1)});x=placed.x;y=placed.y;}else if(x+tw<0||x>w||y+th<0||y>h)return;
  if(bg)out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(tw)}" height="${n(th)}" rx="4" fill="${ruler?esc(c):'#172033'}" fill-opacity=".94" stroke="${esc(c)}"/>`);lines.forEach((s,i)=>out.push(`<text x="${n(x+6)}" y="${n(y+size+4+i*(size+4))}" fill="${bg&&ruler?'#fff':esc(c)}" font-size="${size}" font-family="sans-serif">${esc(s)}</text>`));const box={x,y,width:tw,height:th};boxes.push(box);if(ruler)labelBoxes.push(box);};
 const poly=(ps,closed=false,c=color,opacity=fill)=>{if(ps.length<2)return;const d=ps.map((p,i)=>(i?'L':'M')+n(p.x)+' '+n(p.y)).join('')+(closed?'Z':'');parts.push(`<path d="${d}" ${attrs(c)}${closed?` style="fill:${esc(c)};fill-opacity:${opacity}"`:''}/>`);for(let i=1;i<ps.length;i++)segments.push([ps[i-1],ps[i]]);if(closed)segments.push([ps.at(-1),ps[0]]);};
 const rect=(a,b,c=color,opacity=fill)=>{const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),width=Math.abs(b.x-a.x),height=Math.abs(b.y-a.y);poly([{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}],true,c,opacity);if(opacity>0)boxes.push({x,y,width,height});};
 const arrow=(a,b,c=color,sw=lineWidth,r=9)=>{line(a,b,c,sw);const angle=Math.atan2(b.y-a.y,b.x-a.x);line(b,{x:b.x-r*Math.cos(angle-.45),y:b.y-r*Math.sin(angle-.45)},c,sw);line(b,{x:b.x-r*Math.cos(angle+.45),y:b.y-r*Math.sin(angle+.45)},c,sw);};
 const [a,b=a,c=b,d=c]=points,ap=item.points[0],bp=item.points[1]||ap;
 switch(item.tool){
 case 'hline':line({x:0,y:a.y},{x:w,y:a.y});break;
 case 'hray':line(a,{x:w,y:a.y});break;
 case 'vline':line({x:a.x,y:0},{x:a.x,y:h});break;
 case 'crossline':line({x:0,y:a.y},{x:w,y:a.y});line({x:a.x,y:0},{x:a.x,y:h});break;
 case 'trend':case 'ray':case 'extended':case 'angle':line(a,b,color,lineWidth,item.tool==='ray'?'ray':item.tool==='extended'?'line':'segment');if(item.tool==='angle')text(b.x+6,b.y-25,(-Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI).toFixed(1)+'°');break;
 case 'arrow':arrow(a,b);break;
 case 'arrowUp':case 'arrowDown':{const s=item.tool==='arrowUp'?1:-1;arrow({x:a.x,y:a.y+s*30},a);break;}
 case 'rectangle':rect(a,b);break;
 case 'rotatedRect':{const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,dist=((c.x-a.x)*-dy+(c.y-a.y)*dx)/len,off={x:-dy/len*dist,y:dx/len*dist};poly([a,b,{x:b.x+off.x,y:b.y+off.y},{x:a.x+off.x,y:a.y+off.y}],true);break;}
 case 'circle':case 'ellipse':{const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=item.tool==='circle'?rx:Math.abs(b.y-a.y)/2;poly(Array.from({length:49},(_,i)=>({x:cx+rx*Math.cos(i/48*2*Math.PI),y:cy+ry*Math.sin(i/48*2*Math.PI)})),true);break;}
 case 'triangle':poly(points.slice(0,3),true);break;
 case 'polyline':case 'brush':case 'highlighter':poly(points,false,color);if(item.tool==='highlighter'){parts.length=0;const dd=points.map((p,i)=>(i?'L':'M')+n(p.x)+' '+n(p.y)).join('');path(dd,color,Math.max(12,lineWidth*6),'opacity=".3"');}break;
 case 'curve':case 'arc':case 'doubleCurve':{const samples=[];for(let i=0;i<=50;i++){const t=i/50,u=1-t;if(item.tool==='doubleCurve')samples.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y});else samples.push({x:u*u*a.x+2*u*t*b.x+t*t*c.x,y:u*u*a.y+2*u*t*b.y+t*t*c.y});}poly(samples);break;}
 case 'parallel':case 'flatChannel':case 'disjoint':{let p=a,q=b,r=c,s;if(item.tool==='flatChannel'){q={x:b.x,y:a.y};r={x:a.x,y:b.y};s=b;}else if(item.tool==='disjoint')s=d;else s={x:b.x+c.x-a.x,y:b.y+c.y-a.y};poly([p,q,s,r],true);line({x:(p.x+r.x)/2,y:(p.y+r.y)/2},{x:(q.x+s.x)/2,y:(q.y+s.y)/2},color,1);break;}
 case 'regression':{const data=rows.filter(r=>r.time>=Math.min(ap.time,bp.time)&&r.time<=Math.max(ap.time,bp.time)),fit=E.regression(data);if(!fit){line(a,b);break;}const start={time:data[0].time,price:fit.start},end={time:data.at(-1).time,price:fit.end},offset=2*fit.deviation;const ps=[project({...start,price:start.price+offset}),project({...end,price:end.price+offset}),project({...end,price:end.price-offset}),project({...start,price:start.price-offset})];if(ps.every(Boolean))poly(ps,true);const x=project(start),y=project(end);if(x&&y)line(x,y);break;}
 case 'pitchfork':case 'schiff':{const origin=item.tool==='schiff'?{x:(a.x+b.x)/2,y:(a.y+b.y)/2}:a,mid={x:(b.x+c.x)/2,y:(b.y+c.y)/2},delta={x:mid.x-origin.x,y:mid.y-origin.y};line(b,c,color,1);for(const p of [origin,b,c])line(p,{x:p.x+delta.x,y:p.y+delta.y},color,lineWidth,'ray');break;}
 case 'fib':case 'fibExtension':{const levels=item.tool==='fib'?[0,.236,.382,.5,.618,.786,1]:[0,.618,1,1.272,1.618,2,2.618],palette=['#94a3b8','#ef4444','#fb923c','#eab308','#22c55e','#38bdf8','#a78bfa'];line(a,b,color,1);const left=Math.min(a.x,b.x,item.tool==='fibExtension'?c.x:a.x),right=Math.max(a.x,b.x,item.tool==='fibExtension'?c.x:b.x);let last;levels.forEach((level,i)=>{const price=item.tool==='fib'?bp.price+(ap.price-bp.price)*level:(item.points[2]?.price??bp.price)+(bp.price-ap.price)*level,p=project({time:ap.time,price});if(!p)return;const yy=p.y,col=palette[i%palette.length];if(last!==undefined)parts.push(`<rect x="${n(left)}" y="${n(Math.min(last,yy))}" width="${n(Math.max(1,right-left))}" height="${n(Math.abs(yy-last))}" fill="${col}" fill-opacity="${fill}"/>`);line({x:left,y:yy},{x:right,y:yy},col,1);text(left+3,yy-21,level+' ('+price.toPrecision(6)+')',col,11);last=yy;});break;}
 case 'fibFan':case 'gannFan':{const levels=item.tool==='fibFan'?[.382,.5,.618,1]:[.125,.25,.5,1,2,4,8];for(const level of levels){line(a,{x:b.x,y:a.y+(b.y-a.y)*level},color,1,'ray');text(b.x,b.y+(b.y-a.y)*(level-1),String(level),color,10);}break;}
 case 'fibTime':{for(const v of [0,1,2,3,5,8,13,21]){const x=a.x+(b.x-a.x)*v;line({x,y:0},{x,y:h},color,1);if(x>=0&&x<=w)text(x+2,5,String(v),color,11);}break;}
 case 'xabcd':case 'abc':case 'elliott':{poly(points);const labels=item.tool==='xabcd'?['X','A','B','C','D']:item.tool==='elliott'?['0','1','2','3','4','5']:['A','B','C'];points.forEach((p,i)=>text(p.x-8,p.y-27,labels[i]||String(i)));if(item.tool==='xabcd'&&points.length===5){poly([points[0],points[1],points[2]],true);poly([points[2],points[3],points[4]],true);}break;}
 case 'vwap':{let cache=vwapCache.get(rows);if(!cache){cache=new Map();vwapCache.set(rows,cache);}let data=cache.get(ap.time);if(!data){data=E.vwap(rows.filter(r=>r.time>=ap.time));cache.set(ap.time,data);}const visible=env.visible?data.filter(p=>p.time>=env.visible[0]&&p.time<=env.visible[1]):data,stride=Math.max(1,Math.floor(visible.length/Math.max(100,w*2))),ps=visible.filter((p,i)=>i%stride===0||i===visible.length-1).map(project).filter(Boolean);poly(ps);if(ps.length)text(ps.at(-1).x-90,ps.at(-1).y-24,'VWAP');break;}
 case 'long':case 'short':{const entry=a.y,target=b.y,stop=c.y,x2=b.x,positive='#22c55e',negative='#ef4444';rect(a,{x:x2,y:target},positive,.18);rect(a,{x:x2,y:stop},negative,.18);line({x:a.x,y:entry},{x:x2,y:entry});const reward=Math.abs(item.points[1].price-ap.price),risk=Math.abs((item.points[2]?.price??ap.price)-ap.price);text(Math.min(a.x,x2),Math.min(target,stop)-30,`목표 ${(reward/Math.abs(ap.price||1)*100).toFixed(2)}% · 손익비 ${risk?(reward/risk).toFixed(2):'—'}`,positive,11,true);text(Math.min(a.x,x2),Math.max(target,stop)+3,`손절 ${(risk/Math.abs(ap.price||1)*100).toFixed(2)}%`,negative,11,true);break;}
 case 'ruler':case 'range':case 'priceRange':case 'dateRange':case 'zoom':{
  rect(a,b,color,item.tool==='zoom'?.06:.15);
  if(item.tool==='ruler'){
   const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y);
   // Price and time directions follow the measurement endpoints, including leftward drags.
   if(dx>.01)arrow({x:a.x,y:my},{x:b.x,y:my},color,1,Math.min(7,dx/2));
   if(dy>.01)arrow({x:mx,y:a.y},{x:mx,y:b.y},color,1,Math.min(7,dy/2));
  }
  const diff=bp.price-ap.price,percent=ap.price?diff/Math.abs(ap.price)*100:0,{bars,volume}=measure(rows,ap.time,bp.time,env.step||60),minutes=Math.abs(bp.time-ap.time)/60,period=minutes>=1440?(minutes/1440).toFixed(1)+'일':minutes>=60?(minutes/60).toFixed(1)+'시간':minutes.toFixed(0)+'분';let label=[];if(item.tool!=='dateRange')label.push(`${diff>=0?'+':''}${diff.toPrecision(5)} (${percent>=0?'+':''}${percent.toFixed(2)}%)`);if(item.tool!=='priceRange')label.push(`${bars}봉 · ${period}`,`거래량 ${volumeFormat.format(volume)}`);if(item.tool!=='zoom')text(Math.min(a.x,b.x),Math.min(a.y,b.y)-label.length*18-12,label.join('\n'),color,11,true);break;}
 case 'flag':{line(a,{x:a.x,y:a.y-35});poly([{x:a.x,y:a.y-35},{x:a.x+25,y:a.y-29},{x:a.x,y:a.y-22}],true,color,.7);break;}
 case 'emoji':text(a.x-12,a.y-15,item.text||'★',color,item.fontSize||24);break;
 case 'pin':parts.push(`<circle cx="${n(a.x)}" cy="${n(a.y-10)}" r="7" fill="${esc(color)}"/>`);line(a,{x:a.x,y:a.y-10});segments.push([{x:a.x-6,y:a.y-10},{x:a.x+6,y:a.y-10}]);break;
 case 'priceNote':case 'priceLabel':text(a.x+7,a.y-23,(item.text?item.text+'\n':'')+ap.price.toPrecision(7),color,item.fontSize||12,true);line(a,{x:a.x+10,y:a.y});break;
 case 'callout':line(a,b);text(b.x,b.y,item.text||'텍스트',color,item.fontSize,true);break;
 case 'table':{const contents=(item.text||'항목 | 값\n메모 | 내용').split('\n').map(t=>t.split('|').map(s=>s.trim()).join('    │    '));text(a.x,a.y,contents.join('\n'),color,item.fontSize,true);break;}
 case 'text':case 'note':case 'comment':case 'signpost':text(a.x,a.y,item.text||'텍스트',color,item.fontSize,item.tool!=='text');if(item.tool==='signpost')line(a,{x:a.x,y:a.y+50});break;
 default:poly(points);
 }
 return {svg:parts.join('')+labels.join(''),shapeSvg:parts.join(''),labelSvg:labels.join(''),segments,boxes,labelBoxes,points};
}
function hit(geometry,p,tolerance=6){return geometry.segments.some(([a,b])=>E.segmentDistance(p,a,b)<=tolerance)||geometry.boxes.some(b=>p.x>=b.x&&p.x<=b.x+b.width&&p.y>=b.y&&p.y<=b.y+b.height);}
function axisOverlay(entries,{width,totalWidth,height,plotBottom,formatTime,rulerColors}){
 const vertical=[],prices=[],times=[],timeHeight=Math.min(22,Math.max(0,height-plotBottom)),axisWidth=totalWidth-width;
 const priceAlways=new Set(['hline','hray','crossline','priceNote','priceLabel','priceRange','range','ruler','long','short']),timeAlways=new Set(['vline','crossline','dateRange','range','ruler','fibTime']);
 for(const {item,pane,geometry,selected=false,draft=false,ownPane=true,formatPrice}of entries){
  const color=item.tool==='ruler'?S.colorFor(item.points[0].price,item.points.at(-1).price,rulerColors):item.color||'#60a5fa',priority=selected||draft?2:1;
  const indices=item.points.length<=6?item.points.map((_,i)=>i):[0,item.points.length-1];
  if(['vline','crossline'].includes(item.tool)){const x=geometry.points[0]?.x;if(x>=0&&x<=width)vertical.push(`<path data-drawing-vertical="${esc(item.id)}" d="M${n(x)} 0V${n(plotBottom)}" stroke="${esc(color)}" stroke-width="${n(item.width||2)}"${item.dash?' stroke-dasharray="'+(item.dash===1?'2 4':'8 5')+'"':''}${draft?' opacity=".8"':''}/>`);}
  for(const i of indices){const point=item.points[i],p=geometry.points[i];if(!p)continue;
   if(ownPane&&(selected||draft||priceAlways.has(item.tool))&&p.y>=0&&p.y<=pane.height&&axisWidth>10){const value=formatPrice(point.price);prices.push({id:item.id,pane:pane.id,value,y:pane.top+p.y,top:pane.top,bottom:pane.bottom,color,priority});}
   if((selected||draft||timeAlways.has(item.tool))&&p.x>=0&&p.x<=width&&timeHeight>5)times.push({id:item.id,value:formatTime(point.time),x:p.x,color,priority});
  }
 }
 const labels=[],acceptedPrice=[],acceptedTime=[];
 for(const p of prices.sort((a,b)=>b.priority-a.priority)){
  const labelHeight=Math.min(19,p.bottom-p.top);if(labelHeight<8)continue;const y=Math.max(p.top,Math.min(p.bottom-labelHeight,p.y-labelHeight/2));
  if(acceptedPrice.some(q=>q.pane===p.pane&&y<q.bottom&&y+labelHeight>q.top))continue;
  acceptedPrice.push({pane:p.pane,top:y,bottom:y+labelHeight});
  labels.push(`<g data-drawing-axis="price" data-drawing-id="${esc(p.id)}"><rect x="${n(width)}" y="${n(y)}" width="${n(axisWidth)}" height="${n(labelHeight)}" fill="${esc(p.color)}"/><text x="${n(width+axisWidth/2)}" y="${n(y+labelHeight/2)}" dominant-baseline="central" text-anchor="middle" fill="#fff" font-size="11" font-family="sans-serif">${esc(p.value)}</text></g>`);
 }
 for(const t of times.sort((a,b)=>b.priority-a.priority)){
  const boxWidth=Math.min(width,Math.max(56,[...t.value].length*6.5+14)),x=Math.max(0,Math.min(width-boxWidth,t.x-boxWidth/2));
  if(acceptedTime.some(q=>x<q.right&&x+boxWidth>q.left))continue;acceptedTime.push({left:x,right:x+boxWidth});
  labels.push(`<g data-drawing-axis="time" data-drawing-id="${esc(t.id)}"><rect x="${n(x)}" y="${n(plotBottom)}" width="${n(boxWidth)}" height="${n(timeHeight)}" rx="2" fill="${esc(t.color)}"/><text x="${n(x+boxWidth/2)}" y="${n(plotBottom+timeHeight/2)}" dominant-baseline="central" text-anchor="middle" fill="#fff" font-size="11" font-family="sans-serif">${esc(t.value)}</text></g>`);
 }
 return {verticalSvg:vertical.join(''),labelsSvg:labels.join(''),svg:vertical.join('')+labels.join('')};
}
return {geometry,hit,esc,n,measure,rulerLabelBox,axisOverlay};
});
