(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory(require('./backtest-engine.js'),require('./timeframes.js'));else root.BacktestOverlay=factory(root.BacktestEngine,TimeframeEngine);})(typeof globalThis!=='undefined'?globalThis:this,function(E,T){
 'use strict';
 function matches(result,market){const clean=s=>String(s||'').replace(/[-_]/g,'');return result&&market&&result.market?.ex===market.ex&&clean(result.market.symbol)===clean(market.symbol)&&result.market.int===market.int;}
 function lower(rows,time,key='time'){let lo=0,hi=rows.length;while(lo<hi){const mid=(lo+hi)>>>1;if(rows[mid][key]<time)lo=mid+1;else hi=mid;}return lo;}
 function markers(result,bars){if(!result||!bars.length)return [];const rows=result.signals||[],visible=rows.slice(lower(rows,bars[0].time),lower(rows,T.end(bars.at(-1).time,result.market.int))),stride=Math.max(1,Math.ceil(visible.length/180));return visible.filter((_,i)=>i%stride===0).filter(s=>T.indexAt(bars,s.time,result.market.int)>=0).map(s=>({time:s.time,position:s.type==='EXIT'?'aboveBar':'belowBar',color:s.type==='BUY_INITIAL'?'#60a5fa':s.type==='DCA_BUY'?'#22d3ee':s.reason==='STOP_LOSS'?'#fb7185':s.reason==='TAKE_PROFIT'?'#34d399':'#c4b5fd',shape:s.type==='EXIT'?'arrowDown':'arrowUp',text:E.signalLabel(s)}));}
 function draw(ctx,result,{chart,series,bars,windowStart,pane,width}){
  if(!result?.trades?.length||!bars.length||!pane)return;const range=chart.timeScale().getVisibleRange();if(!range)return;const from=Number(range.from),to=Number(range.to),trades=result.trades;
  let index=lower(trades,from,'exitTime');ctx.save();ctx.translate(0,pane.top);ctx.beginPath();ctx.rect(0,0,width,pane.height);ctx.clip();ctx.font='11px sans-serif';ctx.lineWidth=1.2;
  const x=time=>{let i=lower(bars,time);if(i>=bars.length)i=bars.length-1;return chart.timeScale().logicalToCoordinate(i-windowStart);};
  for(let n=0;index<trades.length&&trades[index].entryTime<=to&&n<80;index++,n++){
   const trade=trades[index];for(let j=0;j<trade.entries.length;j++){
    const entry=trade.entries[j],until=trade.entries[j+1]?.time??trade.exitTime;if(until<from||entry.time>to)continue;const a=x(entry.time),b=x(until);if(a===null||b===null)continue;
    for(const [value,label,color]of [[entry.avgPrice,'평단','#8ab8ff'],[entry.takeProfit,'TP','#34d399'],[entry.stopLoss,'SL','#fb7185']]){
     if(!(value>0))continue;const y=series.priceToCoordinate(value);if(y===null||y<0||y>pane.height)continue;ctx.setLineDash([5,4]);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(Math.max(0,a),y);ctx.lineTo(Math.min(width,Math.max(a+8,b)),y);ctx.stroke();if(Math.abs(b-a)>45){ctx.setLineDash([]);ctx.fillStyle=color;ctx.fillText(label+' '+Number(value.toPrecision(7)),Math.max(2,Math.min(width-125,b-120)),Math.max(12,y-4));}
    }
   }
   if(trade.exitTime>=from&&trade.exitTime<=to){const px=x(trade.exitTime),py=series.priceToCoordinate(trade.exitPrice);if(px!==null&&py!==null&&py>=0&&py<=pane.height){ctx.setLineDash([]);ctx.fillStyle=trade.exitReason==='STOP_LOSS'?'#fb7185':trade.exitReason==='TAKE_PROFIT'?'#34d399':'#c4b5fd';ctx.beginPath();ctx.arc(px,py,3.5,0,2*Math.PI);ctx.fill();}}
  }ctx.restore();
 }
 return {matches,markers,draw};
});
