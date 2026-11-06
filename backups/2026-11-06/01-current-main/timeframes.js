'use strict';
const TimeframeEngine = (() => {
  // Month seconds are used only to estimate window sizes; actual boundaries are calendar based.
  const seconds = Object.freeze({'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'1d':86400,'1w':604800,'1M':2592000});
  const native = {
    BYBIT: {'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','1d':'D','1w':'W','1M':'M'},
    BITGET: {'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'},
    OKX: {'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','1d':'1Dutc','1w':'1Wutc','1M':'1Mutc'},
    MEXC: {'1m':'Min1','5m':'Min5','15m':'Min15','30m':'Min30','1h':'Min60','4h':'Hour4','1d':'Day1','1w':'Week1','1M':'Month1'}
  };
  function start(time, interval) {
    const date=new Date(time*1000);
    if(interval==='1M')return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)/1000;
    if(interval==='1w')return Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()-(date.getUTCDay()+6)%7)/1000;
    return Math.floor(time/seconds[interval])*seconds[interval];
  }
  function shift(time, interval, count) {
    if(interval!=='1M')return time+seconds[interval]*count;
    const date=new Date(time*1000);return Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+count,1)/1000;
  }
  function end(time,interval){return shift(time,interval,1);}
  function closedRange(from,to,interval){
    if(!seconds[interval]||!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw Error('캔들 수를 계산할 기간·주기를 확인하세요.');
    let first=start(from,interval);if(first<from)first=shift(first,interval,1);
    let last=start(to,interval);if(end(last,interval)>to)last=shift(last,interval,-1);
    const distance=interval==='1M'?((new Date(last*1000).getUTCFullYear()-new Date(first*1000).getUTCFullYear())*12+new Date(last*1000).getUTCMonth()-new Date(first*1000).getUTCMonth()):Math.round((last-first)/seconds[interval]);
    return {first:first<=last?first:null,last:first<=last?last:null,count:Math.max(0,distance+1)};
  }
  function requestEnd(milliseconds,interval){const time=milliseconds/1000,first=start(time,interval);return (time===first?first:end(first,interval))*1000;}
  function plan(exchange, interval) {
    if (!seconds[interval] || !['BINANCE','BYBIT','BINGX','BITGET','MEXC','OKX'].includes(exchange)) throw Error('지원하지 않는 타임프레임입니다.');
    const source = exchange === 'MEXC' && interval === '3m' ? '1m'
      : ['MEXC','BITGET'].includes(exchange) && interval === '2h' ? '1h' : interval;
    return {source, native: native[exchange]?.[source] ?? source, factor: seconds[interval] / seconds[source]};
  }
  function sorted(rows) {
    const unique = new Map();
    for (const row of rows) {
      if (!row || !['time','open','high','low','close','volume'].every(key => Number.isFinite(row[key]))) throw Error('캔들 응답 값이 올바르지 않습니다.');
      unique.set(row.time, row);
    }
    return [...unique.values()].sort((a,b) => a.time-b.time);
  }
  function aggregate(rows, interval, source, now = Date.now()/1000) {
    const bars = sorted(rows), size = seconds[interval], step = seconds[source], factor = size/step;
    if (!Number.isInteger(factor) || factor < 1) throw Error('합성 봉 주기가 올바르지 않습니다.');
    if (factor === 1) return bars;
    const result = []; let group = [];
    const flush = () => {
      if (!group.length) return;
      const time = Math.floor(group[0].time/size)*size;
      // A page boundary or a missing source bar must never become a false OHLCV candle.
      const consecutive = group[0].time === time && group.every((bar,i) => bar.time === time+i*step);
      if (consecutive && (group.length === factor || time+size > now)) result.push({
        time, open:group[0].open, high:Math.max(...group.map(b=>b.high)), low:Math.min(...group.map(b=>b.low)),
        close:group.at(-1).close, volume:group.reduce((sum,b)=>sum+b.volume,0)
      });
      group = [];
    };
    for (const bar of bars) {
      if (group.length && Math.floor(bar.time/size) !== Math.floor(group[0].time/size)) flush();
      group.push(bar);
    }
    flush(); return result;
  }
  function indexAt(bars, time, interval) {
    let low=0, high=bars.length;
    while (low<high) {const mid=Math.floor((low+high)/2); if (bars[mid].time<=time) low=mid+1; else high=mid;}
    const index=low-1;
    return index>=0 && time<end(bars[index].time,interval) ? index : -1;
  }
  function kstFields(time) {
    const iso = new Date(time*1000+9*3600000).toISOString();
    return {date:iso.slice(0,10),time:iso.slice(11,16)};
  }
  function parseKst(day, clock) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(clock)) throw Error('날짜와 시간을 선택하세요.');
    const [year,month,date]=day.split('-').map(Number),[hour,minute]=clock.split(':').map(Number);
    const value=new Date(Date.UTC(year,month-1,date,hour,minute));
    if (year<2009 || value.getUTCFullYear()!==year || value.getUTCMonth()!==month-1 || value.getUTCDate()!==date || hour>23 || minute>59) throw Error('올바른 날짜와 시간을 입력하세요.');
    return value.getTime()/1000-9*3600;
  }
  async function dateWindow(page, target, interval, span, signal, now=Date.now()) {
    const margin=Math.ceil(span/2)+10;
    let end=Math.min(now,Math.floor(shift(target,interval,margin)*1000)), bars=[];
    for (let n=0;n<6;n++) {
      signal.throwIfAborted();
      const rows=sorted(await page(end,signal)).filter(bar=>bar.time*1000<=end);
      if (!rows.length) break;
      bars=sorted([...bars,...rows]);
      if (bars[0].time<=shift(target,interval,-margin)) break;
      const next=rows[0].time*1000-1;
      if (next>=end) break;
      end=next;
    }
    signal.throwIfAborted();
    return indexAt(bars,target,interval)<0 ? [] : bars;
  }
  return {seconds, plan, sorted, aggregate, indexAt, kstFields, parseKst, dateWindow,start,end,shift,requestEnd,closedRange};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=TimeframeEngine;
