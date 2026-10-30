(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./backtest-engine.js'),require('./timeframes.js'));else root.BacktestOverlay=factory(root.BacktestEngine,TimeframeEngine);})(typeof globalThis!=='undefined'?globalThis:this,function(E,T){
 'use strict';
 const clean=s=>String(s||'').replace(/[-_]/g,'');
 function displayTimeframe(result){const source=result.market,view=result.displayMarket;return view&&view.ex===source?.ex&&clean(view.symbol)===clean(source.symbol)&&Object.hasOwn(T.seconds,view.int)?view.int:source?.int;}
 function matches(result,market){return result&&market&&result.market?.ex===market.ex&&clean(result.market.symbol)===clean(market.symbol)&&displayTimeframe(result)===market.int;}
 function lower(rows,time,key='time'){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][key]<time)lo=mid+1;else hi=mid;}return lo;}
 function markers(result,bars){
  if(!result||!bars.length)return [];const interval=displayTimeframe(result),rows=result.signals||[],visible=rows.slice(lower(rows,bars[0].time),lower(rows,T.end(bars.at(-1).time,interval))),groups=[],entries=new Map();
  for(const s of visible){const i=T.indexAt(bars,s.time,interval);if(i<0)continue;const time=bars[i].time,exit=s.type==='EXIT',marker={time,position:exit?'aboveBar':'belowBar',color:s.type==='BUY_INITIAL'?'#60a5fa':s.type==='DCA_BUY'?'#22d3ee':s.reason==='STOP_LOSS'?'#fb7185':s.reason==='TAKE_PROFIT'?'#34d399':'#c4b5fd',shape:exit?'arrowDown':'arrowUp',text:E.signalLabel(s)};
   if(exit){groups.push({marker});continue;}
   let group=entries.get(time);if(!group){group={marker,initial:false,steps:[]};entries.set(time,group);groups.push(group);}if(s.type==='BUY_INITIAL')group.initial=true;else group.steps.push(s.step);
  }
  const stride=Math.max(1,Math.ceil(groups.length/180));return groups.filter((_,i)=>i%stride===0).map(g=>{if(g.steps?.length){const first=Math.min(...g.steps),last=Math.max(...g.steps);g.marker.text=(g.initial?'BUY 1 · ':'')+'DCA '+first+(last>first?'–'+last:'');g.marker.color='#22d3ee';}return g.marker;});
 }
 const levels=[['avgPrice','평단','#8ab8ff'],['takeProfit','TP 익절','#34d399'],['stopLoss','SL 손절','#fb7185']];
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function geometry(result,{chart,series,bars,width,height}){
  const scene={segments:[],exits:[],groups:[]};if(!result?.trades?.length||!bars.length||width<=0||height<=0)return scene;
  const scale=chart.timeScale(),range=scale.getVisibleRange();if(!range)return scene;
  const interval=displayTimeframe(result),from=Number(range.from),to=T.end(Number(range.to),interval),spacing=scale.options().barSpacing;
  if(!Number.isFinite(from)||!Number.isFinite(to)||!(spacing>0))return scene;
  // Use the chart's real time coordinates, including when older price pages
  // are prepended or the rendered data window changes. Never snap a gap to a bar.
  const x=time=>{let i=lower(bars,time);if(i>=bars.length||bars[i].time>time)i--;if(i<0)return null;
   let bar=bars[i],anchor=scale.timeToCoordinate(bar.time);
   // The right edge is the end of the final visible candle. The next candle
   // may exist in history but not in the chart's current render window yet.
   if(!Number.isFinite(anchor)&&time===bar.time&&i>0&&T.end(bars[i-1].time,interval)===time){bar=bars[i-1];anchor=scale.timeToCoordinate(bar.time);}
   const end=T.end(bar.time,interval);if(time>end)return null;
   return Number.isFinite(anchor)?anchor+(time-bar.time)/(end-bar.time)*spacing:null;
  };
  const trades=result.trades,last=lower(trades,to,'entryTime');let index=Math.max(lower(trades,from,'exitTime'),last-80);
  for(;index<last;index++){
   const trade=trades[index];let group=null;
   for(let j=0;j<trade.entries.length;j++){
    const entry=trade.entries[j],next=trade.entries[j+1],until=next?.time??trade.exitTime;
    if(until<from||entry.time>=to)continue;
    // Clip the dates before projection: a spanning position can start outside
    // the loaded chart window, but its visible part still has exact coordinates.
    const a=x(Math.max(from,entry.time)),b=x(Math.min(to,until));if(!Number.isFinite(a)||!Number.isFinite(b))continue;
    const x1=Math.max(0,a),x2=Math.min(width,b+(next?0:spacing*.45));if(x2<=x1)continue;
    group={tradeId:trade.id??index+1,step:entry.step??j+1,lines:[]};
    for(const [key,label,color]of levels){
     const value=entry[key];if(!Number.isFinite(value)||value<=0)continue;const y=series.priceToCoordinate(value);if(!Number.isFinite(y)||y<0||y>height)continue;
     const line={x1,x2,y,value,label,color,tradeId:group.tradeId,step:group.step,key};scene.segments.push(line);group.lines.push(line);
    }
   }
   // All DCA phases retain their true lines. Only the last visible phase of a
   // trade needs value labels, instead of three overlapping labels at every fill.
   if(group?.lines.length)scene.groups.push(group);
   if(trade.exitTime>=from&&trade.exitTime<to){const px=x(trade.exitTime),py=series.priceToCoordinate(trade.exitPrice);
    if(Number.isFinite(px)&&Number.isFinite(py)&&px>=0&&px<=width&&py>=0&&py<=height)scene.exits.push({x:px,y:py,color:trade.exitReason==='STOP_LOSS'?'#fb7185':trade.exitReason==='TAKE_PROFIT'?'#34d399':'#c4b5fd'});
   }
  }return scene;
 }
 function labelLayout(groups,{width,height,measure,format}){
  const labels=[],padding=4,lineHeight=18,top=24;if(width<60||height<top+lineHeight+padding)return labels;
  const overlaps=(a,b)=>a.x<b.x+b.width+3&&a.x+a.width+3>b.x&&a.y<b.y+b.height+3&&a.y+a.height+3>b.y;
  // Recent visible trades get first choice when the chart is very dense. Bounds
  // and text measurement come from this pane, so split/fullscreen sizes agree.
  for(const group of [...groups].reverse())for(const line of [...group.lines].sort((a,b)=>a.y-b.y)){
   if(labels.length>=48)return labels;const text='#'+group.tradeId+' · '+line.label+' '+format(line.value),w=Math.ceil(measure(text))+10;
   if(w>width-2*padding)continue;const anchorX=clamp(line.x2,padding,width-padding),anchorY=line.y;
   const positions=[anchorX+8,line.x2-w-4,line.x1-w-8,clamp(anchorX-w/2,padding,width-padding-w)];let placed=null;
   for(const left of positions){if(left<padding||left+w>width-padding)continue;
    for(const offset of [0,-21,21,-42,42,-63,63]){const box={x:left,y:clamp(anchorY-lineHeight/2+offset,top,height-padding-lineHeight),width:w,height:lineHeight};
     if(!labels.some(other=>overlaps(box,other))){placed={...box,text,color:line.color,anchorX,anchorY,tradeId:group.tradeId,key:line.key};break;}
    }if(placed)break;
   }if(placed)labels.push(placed);
  }return labels;
 }
 function draw(ctx,result,options){
  const {width,height,series}=options,scene=geometry(result,options);if(!scene.segments.length&&!scene.exits.length)return;
  ctx.save();try{
   ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.font='11px sans-serif';ctx.lineWidth=1.2;ctx.setLineDash([5,4]);
   for(const s of scene.segments){ctx.strokeStyle=s.color;ctx.beginPath();ctx.moveTo(s.x1,s.y);ctx.lineTo(s.x2,s.y);ctx.stroke();}
   ctx.setLineDash([]);for(const p of scene.exits){ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,2*Math.PI);ctx.fill();}
   const formatter=series.priceFormatter(),labels=labelLayout(scene.groups,{width,height,measure:text=>ctx.measureText(text).width,format:value=>formatter.format(value)});
   ctx.textAlign='left';ctx.textBaseline='middle';ctx.lineWidth=1;
   for(const label of labels){
    const edgeX=clamp(label.anchorX,label.x,label.x+label.width),edgeY=clamp(label.anchorY,label.y,label.y+label.height);
    ctx.strokeStyle=label.color;ctx.beginPath();ctx.moveTo(label.anchorX,label.anchorY);ctx.lineTo(edgeX,edgeY);ctx.stroke();
    ctx.fillStyle='#111827ed';ctx.fillRect(label.x,label.y,label.width,label.height);ctx.fillStyle=label.color;ctx.fillRect(label.x,label.y,2,label.height);ctx.fillText(label.text,label.x+5,label.y+label.height/2);
   }
  }finally{ctx.restore();}
 }
 function create(getState){
  let attached=null;
  // The native series renderer runs after the chart has resolved its current
  // scales. An independent requestAnimationFrame canvas can read the old scale
  // during data replacement, vertical zoom, resizing or a historical date jump.
  const renderer={draw:target=>{if(!attached)return;const {result,market,bars}=getState();if(!matches(result,market))return;
   target.useMediaCoordinateSpace(({context,mediaSize})=>draw(context,result,{chart:attached.chart,series:attached.series,bars,width:mediaSize.width,height:mediaSize.height}));
  }},views=[{zOrder:()=> 'top',renderer:()=>renderer}];
  return {attached:parameters=>{attached=parameters;parameters.requestUpdate();},detached:()=>{attached=null;},paneViews:()=>views,updateAllViews(){},invalidate:()=>attached?.requestUpdate()};
 }
 return {matches,markers,geometry,labelLayout,draw,create};
});
