(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./backtest-engine.js'),require('./timeframes.js'));else root.BacktestOverlay=factory(root.BacktestEngine,TimeframeEngine);})(typeof globalThis!=='undefined'?globalThis:this,function(E,T){
 'use strict';
 const clean=s=>String(s||'').replace(/[-_]/g,'');
 function displayTimeframe(result){const source=result.market,view=result.displayMarket;return view&&view.ex===source?.ex&&clean(view.symbol)===clean(source.symbol)&&Object.hasOwn(T.seconds,view.int)?view.int:source?.int;}
 function matches(result,market){return result&&market&&result.market?.ex===market.ex&&clean(result.market.symbol)===clean(market.symbol)&&displayTimeframe(result)===market.int;}
 function lower(rows,time,key='time'){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][key]<time)lo=mid+1;else hi=mid;}return lo;}
 const levels=[['avgPrice','평단','#8ab8ff'],['takeProfit','TP 익절','#34d399'],['stopLoss','SL 손절','#fb7185']];
 const entryTypes={
  initial:['첫 BUY','#60a5fa'],step_pct:['직전 체결가 대비 하락','#fbbf24'],
  rsi_cross_up:['테스트 주기 RSI 상향 돌파','#22d3ee'],rsi_cross_up_1m:['1분봉 고정 RSI 상향 돌파','#c4b5fd'],
  rsi_oversold:['RSI 과매도 이하 마감','#f9a8d4'],bar:['다음 봉마다 진입','#5eead4']
 };
 const displaySections=[
  {label:'거래 가격선',items:[...levels,['exit','청산 체결','#e2e8f0'],['tails','짧은 선 연장','#94a3b8']]},
  {label:'진입 신호와 체결',items:Object.entries(entryTypes).map(([key,[label,color]])=>[key,label,color])}
 ];
 const displayKey='backtest-chart-display-v1',displayEvent='backtest-chart-display',keys=displaySections.flatMap(s=>s.items.map(([key])=>key));
 function displayOptions(input){return Object.fromEntries(keys.map(key=>[key,input?.[key]!==false]));}
 function readDisplay(storage){try{return displayOptions(JSON.parse((storage??globalThis.localStorage)?.getItem(displayKey)||'null'));}catch{return displayOptions();}}
 function entryTrace(result,trade,index){
  const entry=trade.entries[index],config=result.config||{},signal=entry?.signal,first=index===0;
  if(!entry)return null;
  const candidate=signal?.kind||(first?config.entryTrigger:config.splitTrigger),kind=typeof candidate==='string'?candidate:null,key=first?'initial':kind;
  if(!Object.hasOwn(entryTypes,key))return null;
  const timeframe=signal?.timeframe||(kind==='rsi_cross_up_1m'?'1m':config.timeframe||result.market?.int);
  const time=signal?.time??(first?trade.fundingCondition?.signalTime:entry.time)??entry.time;
  const barTime=signal?.barTime??(Object.hasOwn(T.seconds,timeframe)&&Number.isFinite(time)?T.shift(time,timeframe,-1):null);
  const referencePrice=signal?.referencePrice??(kind==='step_pct'&&Number.isFinite(config.splitStepPct)&&Number.isFinite(trade.entries[index-1]?.price)?trade.entries[index-1].price*(1-config.splitStepPct/100):null);
  const threshold=signal?.threshold??(kind?.startsWith('rsi_')?config.rsiOversold:null);
  const rsiName=kind==='rsi_cross_up_1m'?'1분 RSI':kind==='rsi_cross_up'&&timeframe==='1m'?'1분 RSI':'RSI';
  const short=kind==='step_pct'?(Number.isFinite(config.splitStepPct)?'하락 '+config.splitStepPct+'%':'추가 하락'):kind==='bar'?'매 봉':kind==='rsi_oversold'?'RSI ≤ '+(threshold??'설정선'):kind?.startsWith('rsi_')?rsiName+' '+(threshold??'설정선')+'↑':'';
  const label=first?'첫 BUY'+(short?' · '+short:''):(entry.step??index+1)+'차 · '+short;
  return {key,kind,label,color:entryTypes[key][1],timeframe,time,barTime,referencePrice,threshold,rsi:signal?.rsi,previousRsi:signal?.previousRsi,low:signal?.low,close:signal?.close};
 }
 function markers(result,bars,display,{nativeEntries=true}={}){
  if(!result||!bars.length)return [];const interval=displayTimeframe(result),rows=result.signals||[],visible=rows.slice(lower(rows,bars[0].time),lower(rows,T.end(bars.at(-1).time,interval))),groups=[],entries=new Map();
  for(const s of visible){const exit=s.type==='EXIT',key=exit?'exit':s.type==='BUY_INITIAL'?'initial':result.config?.splitTrigger;
   if(display?.[key]===false||!exit&&!nativeEntries)continue;
   const i=T.indexAt(bars,s.time,interval);if(i<0)continue;const time=bars[i].time,marker={time,position:exit?'aboveBar':'belowBar',color:s.type==='BUY_INITIAL'?'#60a5fa':s.type==='DCA_BUY'?'#22d3ee':s.reason==='STOP_LOSS'?'#fb7185':s.reason==='TAKE_PROFIT'?'#34d399':'#c4b5fd',shape:exit?'arrowDown':'arrowUp',text:E.signalLabel(s)};
   if(exit){groups.push({marker});continue;}
   let group=entries.get(time);if(!group){group={marker,initial:false,steps:[]};entries.set(time,group);groups.push(group);}if(s.type==='BUY_INITIAL')group.initial=true;else group.steps.push(s.step);
  }
  const stride=Math.max(1,Math.ceil(groups.length/180));return groups.filter((_,i)=>i%stride===0).map(g=>{if(g.steps?.length){const first=Math.min(...g.steps),last=Math.max(...g.steps);g.marker.text=(g.initial?'BUY 1 · ':'')+'DCA '+first+(last>first?'–'+last:'');g.marker.color='#22d3ee';}return g.marker;});
 }
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 function geometry(result,{chart,series,bars,width,height,display}){
  const scene={segments:[],exits:[],entries:[],groups:[]};if(!result?.trades?.length||!bars.length||width<=0||height<=0)return scene;
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
   const trade=trades[index],tradeId=trade.id??index+1,phases=[];
   for(let j=0;j<trade.entries.length;j++){
    const entry=trade.entries[j],next=trade.entries[j+1],until=next?.time??trade.exitTime;
    if(entry.time>=from&&Number.isFinite(entry.price)&&entry.price>0){
     const trace=entryTrace(result,trade,j);
     if(trace&&display?.[trace.key]!==false){
      const px=x(entry.time),py=series.priceToCoordinate(entry.price);
      let signal=null;
      if(Number.isFinite(trace.barTime)&&trace.barTime>=from&&trace.barTime<to){
       const sx=x(trace.barTime),source=trace.timeframe===interval?bars[lower(bars,trace.barTime)]:null;
       const signalPrice=trace.referencePrice??trace.close??(source?.time===trace.barTime?source.close:null);
       const sy=Number.isFinite(signalPrice)?series.priceToCoordinate(signalPrice):null;
       if(Number.isFinite(sx)&&sx>=0&&sx<=width&&Number.isFinite(sy)&&sy>=0&&sy<=height)signal={x:sx,y:sy};
      }
      const fill=entry.time<to&&Number.isFinite(px)&&Number.isFinite(py)&&px>=0&&px<=width&&py>=0&&py<=height?{x:px,y:py}:null;
      if(fill||signal)scene.entries.push({fill,signal,tradeId,step:entry.step??j+1,value:entry.price,...trace});
     }
    }
    if(until<from||entry.time>=to)continue;
    // Clip the dates before projection: a spanning position can start outside
    // the loaded chart window, but its visible part still has exact coordinates.
    const a=x(Math.max(from,entry.time)),b=x(Math.min(to,until));if(!Number.isFinite(a)||!Number.isFinite(b))continue;
    const x1=Math.max(0,a),x2=Math.min(width,b);if(x2<x1)continue;
    // The muted tail is a display aid after the actual exit. Never extend a
    // previous average or TP/SL into the next DCA phase or the next trade.
    const following=trades[index+1]?.entryTime,followingX=Number.isFinite(following)&&following<to?x(following):null;
    const tailEnd=display?.tails!==false&&!next&&until<to&&x2-x1<42?Math.max(x2,Math.min(width,x1+42,Number.isFinite(followingX)?followingX-3:width)):x2;
    const group={tradeId,step:entry.step??j+1,lines:[]};
    for(const [key,label,color]of levels){
     const value=entry[key];if(display?.[key]===false||!Number.isFinite(value)||value<=0)continue;const y=series.priceToCoordinate(value);if(!Number.isFinite(y)||y<0||y>height)continue;
     const line={x1,x2,tailEnd,y,value,label:key==='avgPrice'?group.step+'차 '+label:label,color,tradeId,step:group.step,key};scene.segments.push(line);group.lines.push(line);
    }
    if(group.lines.length)phases.push(group);
   }
   // Identify the average that was in force before each later fill. Keep TP
   // and SL labels on the latest visible phase to avoid covering the candles.
   for(let j=0;j<phases.length-1;j++){
    const phase=phases[j],average=phase.lines.find(line=>line.key==='avgPrice');
    if(average&&average.x2-average.x1>=20)scene.groups.push({...phase,prior:true,lines:[average]});
   }
   if(phases.length)scene.groups.push(phases.at(-1));
   if(display?.exit!==false&&trade.exitTime>=from&&trade.exitTime<to){const px=x(trade.exitTime),py=series.priceToCoordinate(trade.exitPrice);
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
   if(labels.length>=48)return labels;let text='#'+group.tradeId+' · '+line.label+' '+format(line.value),w=Math.ceil(measure(text))+10;
   const compact=line.compact||(line.key==='avgPrice'?line.label+' '+format(line.value):'');
   if(w>width-2*padding&&compact){text=compact;w=Math.ceil(measure(text))+10;}
   if(w>width-2*padding)continue;const labelEnd=line.tailEnd??line.x2,anchorX=clamp(group.prior?(line.x1+line.x2)/2:line.x2,padding,width-padding),anchorY=line.y;
   const positions=group.prior?[clamp(anchorX-w/2,padding,width-padding-w),line.x1+3,line.x2-w-3]:[labelEnd+6,line.x2-w-4,line.x1-w-8,clamp(anchorX-w/2,padding,width-padding-w)];let placed=null;
   for(const left of positions){if(left<padding||left+w>width-padding)continue;
    for(const offset of [0,-21,21,-42,42,-63,63]){const box={x:left,y:clamp(anchorY-lineHeight/2+offset,top,height-padding-lineHeight),width:w,height:lineHeight};
     if(!labels.some(other=>overlaps(box,other))){placed={...box,text,color:line.color,anchorX,anchorY,tradeId:group.tradeId,key:line.key};break;}
    }if(placed)break;
   }if(placed)labels.push(placed);
  }return labels;
 }
 function draw(ctx,result,options){
  const {width,height,series}=options,scene=geometry(result,options);if(!scene.segments.length&&!scene.exits.length&&!scene.entries.length)return;
  ctx.save();try{
   ctx.beginPath();ctx.rect(0,0,width,height);ctx.clip();ctx.font='11px sans-serif';ctx.setLineDash([]);ctx.lineCap='round';
   const stroke=(x1,y1,x2,y2,color,weight)=>{ctx.strokeStyle=color;ctx.lineWidth=weight;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();};
   const dot=(p,color,r)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,r,0,2*Math.PI);ctx.fill();};
   for(const s of scene.segments){
    if(s.tailEnd>s.x2){ctx.globalAlpha=.56;stroke(s.x2,s.y,s.tailEnd,s.y,s.color,1.8);ctx.globalAlpha=1;}
    if(s.tailEnd>s.x2||s.x2===s.x1)dot({x:s.x2,y:s.y},s.color,2);
    if(s.x2>s.x1)stroke(s.x1,s.y,s.x2,s.y,s.color,1.8);
   }
   for(const e of scene.entries){
    const {fill,signal,color}=e;
    if(signal&&fill&&fill.x-signal.x>=5){ctx.globalAlpha=.44;stroke(signal.x,signal.y,fill.x,signal.y,color,1);stroke(fill.x,signal.y,fill.x,fill.y,color,1);ctx.globalAlpha=1;}
    if(signal&&(!fill||Math.hypot(fill.x-signal.x,fill.y-signal.y)>=5)){
     const {x,y}=signal;ctx.fillStyle='#111827';ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();
     ctx.moveTo(x,y-4);ctx.lineTo(x+4,y);ctx.lineTo(x,y+4);ctx.lineTo(x-4,y);ctx.lineTo(x,y-4);ctx.fill();ctx.stroke();
    }
    if(fill){stroke(fill.x-8,fill.y,fill.x+8,fill.y,color,2.2);dot(fill,'#111827',4.5);dot(fill,color,3.2);}
   }
   for(const p of scene.exits){dot(p,'#111827',4.8);dot(p,p.color,3.5);}
   const fills=scene.entries.filter(e=>e.fill).slice(-18).map(e=>({tradeId:e.tradeId,lines:[{...e,x1:e.fill.x-8,x2:e.fill.x,tailEnd:e.fill.x+8,y:e.fill.y,compact:e.label}]}));
   const formatter=series.priceFormatter(),labels=labelLayout([...scene.groups,...fills],{width,height,measure:text=>ctx.measureText(text).width,format:value=>formatter.format(value)});
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
  const renderer={draw:target=>{if(!attached)return;const {result,market,bars,display}=getState();if(!matches(result,market))return;
   target.useMediaCoordinateSpace(({context,mediaSize})=>draw(context,result,{chart:attached.chart,series:attached.series,bars,display,width:mediaSize.width,height:mediaSize.height}));
  }},views=[{zOrder:()=> 'top',renderer:()=>renderer}];
  return {attached:parameters=>{attached=parameters;parameters.requestUpdate();},detached:()=>{attached=null;},paneViews:()=>views,updateAllViews(){},invalidate:()=>attached?.requestUpdate()};
 }
 return {matches,markers,geometry,labelLayout,draw,create,entryTrace,displaySections,displayOptions,readDisplay,displayKey,displayEvent};
});
