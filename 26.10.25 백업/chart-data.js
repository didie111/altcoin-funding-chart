'use strict';
const ChartData = (() => {
  // History must not replace a newer live candle with an older page snapshot.
  function mergeHistory(bars, rows) {
    const values = new Map(rows.map(bar => [bar.time, bar]));
    for (const bar of bars) values.set(bar.time, bar);
    return [...values.values()].sort((a,b) => a.time-b.time);
  }
  function mergeLive(bars, rows, step, now=Date.now()/1000, endOfBar=time=>time+step) {
    const result=bars.slice(),changed=[];
    for (const row of [...rows].sort((a,b)=>a.time-b.time)) {
      let lo=0,hi=result.length;while(lo<hi){const mid=(lo+hi)>>>1;if(result[mid].time<row.time)lo=mid+1;else hi=mid;}
      const old=result[lo]?.time===row.time?result[lo]:null;
      if (old && (row.fetchedAt??Infinity)<(old.fetchedAt??0)) continue;
      const bar=old && endOfBar(row.time)>now ? {...row, open:old.open,
        high:Math.max(old.high,row.high), low:Math.min(old.low,row.low), volume:Math.max(old.volume,row.volume)} : row;
      if (!old || ['open','high','low','close','volume'].some(key=>old[key]!==bar[key])) changed.push(bar);
      if(old)result[lo]=bar;else result.splice(lo,0,bar);
    }
    return {bars:result,changed};
  }
  function historyRequests(bars, range, step, now=Date.now()/1000, calendar={}) {
    if (!bars.length || !range) return [];
    const margin=80, span=Math.max(100,range.to-range.from), requests=[],shift=calendar.shift||((time,n)=>time+n*step),endOfBar=calendar.end||((time)=>time+step);
    const add=(end,from,to,direction)=>requests.push({end:Math.floor(end*1000)-1,from,to,direction});
    if (range.from<margin) add(bars[0].time,shift(bars[0].time,-2000),shift(bars[0].time,-1),'older');
    const start=Math.max(1,Math.floor(range.from)-margin), end=Math.min(bars.length-1,Math.ceil(range.to)+margin);
    for(let i=start;i<=end;i++) {
      const left=bars[i-1].time, right=bars[i].time;
      if (right-left<=step*1.5) continue;
      const edge=i>(range.from+range.to)/2 ? Math.min(right,shift(left,Math.max(300,Math.ceil(span*2)))) : right;
      add(edge,endOfBar(left),shift(right,-1),'gap');
      if(requests.length>=3) break;
    }
    if(range.to>bars.length-1-margin && endOfBar(bars.at(-1).time)<(calendar.start?calendar.start(now):Math.floor(now/step)*step))
      add(now,endOfBar(bars.at(-1).time),now,'newer');
    return requests;
  }
  function countdown(time, interval, now=Date.now()/1000, closing=time+interval) {
    const remaining=Math.max(0,Math.ceil(closing-now));
    const h=Math.floor(remaining/3600),m=Math.floor(remaining%3600/60),s=remaining%60;
    const pad=v=>String(v).padStart(2,'0');
    return h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  function currentCycle(quote, official, records, now=Date.now()/1000) {
    if(!quote || !Number.isFinite(quote.fetchedAt)) return null;
    const last=records.at(-1),before=records.at(-2);
    const observed=last&&before?(last.time-before.time)/3600:null;
    const hours=quote.hours??official??([1,2,4,8,12,24].includes(observed)?observed:null);
    if(!(hours>0))return null;
    const end=quote.nextTime??(last?last.time+hours*3600:null);
    if(!end || end<=quote.fetchedAt || end-hours*3600>quote.fetchedAt)return null;
    // Only the unsettled period confirmed by this quote; never fill old gaps.
    return {start:Math.max(end-hours*3600,last?.time??-Infinity),end:Math.min(end,now+1),hours,
      source:quote.hours||official?'official':'observed'};
  }
  return {mergeHistory,mergeLive,historyRequests,countdown,currentCycle};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ChartData;
