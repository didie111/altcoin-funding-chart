'use strict';
const TimeframeEngine = (() => {
  const seconds = Object.freeze({'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'1d':86400});
  const native = {
    BYBIT: {'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','1d':'D'},
    BITGET: {'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','4h':'4H','1d':'1Dutc'},
    OKX: {'1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1H','2h':'2H','4h':'4H','1d':'1Dutc'},
    MEXC: {'1m':'Min1','5m':'Min5','15m':'Min15','30m':'Min30','1h':'Min60','4h':'Hour4','1d':'Day1'}
  };
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
    return index>=0 && time<bars[index].time+seconds[interval] ? index : -1;
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
    const step=seconds[interval], margin=Math.ceil(span/2)+10;
    let end=Math.min(now,Math.floor((target+margin*step)*1000)), bars=[];
    for (let n=0;n<6;n++) {
      signal.throwIfAborted();
      const rows=sorted(await page(end,signal)).filter(bar=>bar.time*1000<=end);
      if (!rows.length) break;
      bars=sorted([...bars,...rows]);
      if (bars[0].time<=target-margin*step) break;
      const next=rows[0].time*1000-1;
      if (next>=end) break;
      end=next;
    }
    signal.throwIfAborted();
    return indexAt(bars,target,interval)<0 ? [] : bars;
  }
  return {seconds, plan, sorted, aggregate, indexAt, kstFields, parseKst, dateWindow};
})();
if (typeof module !== 'undefined' && module.exports) module.exports=TimeframeEngine;
