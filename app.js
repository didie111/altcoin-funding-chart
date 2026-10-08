'use strict';
const $ = id => document.getElementById(id);
const LC = LightweightCharts;
// [최적화] toLocaleString(locale, options)는 호출할 때마다 Intl 포매터를 새로 생성해서 줌/스크롤 시 매 프레임 느립니다.
// 포매터를 한 번만 만들어 재사용하고, 눈금 라벨은 캐시합니다. (출력 문자열은 기존과 동일)
const tickFmt = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
const fullFmt = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',hour12:false,year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric'});
const tickCache = new Map();
const tickLabel = t => { const k = Number(t); let s = tickCache.get(k); if (s === undefined) { s = tickFmt.format(new Date(k * 1000)); if (tickCache.size > 6000) tickCache.clear(); tickCache.set(k, s); } return s; };
const chart = LC.createChart($('unified-chart'), {
 autoSize:true, layout:{background:{type:'solid',color:'#111827'},textColor:'#9ca3af',panes:{separatorColor:'#374151',separatorHoverColor:'#4b5563'}},
 grid:{vertLines:{color:'#1f2937'},horzLines:{color:'#1f2937'}},
 crosshair:{mode:LC.CrosshairMode.Normal},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:false,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:false}},rightPriceScale:{minimumWidth:100,borderColor:'#374151'},
 timeScale:{timeVisible:true,secondsVisible:false,rightOffset:3,lockVisibleTimeRangeOnResize:true,tickMarkFormatter:tickLabel},localization:{locale:'ko-KR',timeFormatter:t=>fullFmt.format(new Date(Number(t)*1000))}
});
const candles=chart.addSeries(LC.CandlestickSeries,{upColor:'#22c55e',downColor:'#ef4444',borderVisible:false,wickUpColor:'#22c55e',wickDownColor:'#ef4444',priceFormat:{type:'price',precision:8,minMove:0.00000001}},0);
// indicators.js(StudyPanelManager)가 패널 삭제/재추가 시 아래 변수들을 다시 대입하므로 let 이어야 합니다.
let volume=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'volume'},lastValueVisible:false},1);
let funding=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'custom',minMove:0.000001,formatter:v=>v.toFixed(6)+'%'},lastValueVisible:false},2);
let settlementCycle=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'custom',minMove:1,formatter:v=>Number(v.toFixed(2))+'시간'},lastValueVisible:false,priceLineVisible:false},3);
let cycleMarkers=LC.createSeriesMarkers(settlementCycle,[]);
chart.panes()[3].setStretchFactor(1.5);
const cycleCaption=document.createElement('div');cycleCaption.style.cssText='padding:4px 12px;font-size:12px;color:#cbd5e1';cycleCaption.textContent='정산 주기: 기록 대기 · 8h 파랑 / 4h 주황 / 1h 빨강';$('coverage').before(cycleCaption);
let cycleHistory=[],cycleTransitions=[],cycleValues=new Map(),officialCycle=null,otherCycles=[],cycleFast=new Uint8Array(0);
// 정산 주기 배지: 현재 주기를 차트 우상단에 크게 표시 (8h가 아니면 강조)
const cycleBadge=document.createElement('div');cycleBadge.id='cycle-badge';cycleBadge.hidden=true;cycleBadge.setAttribute('role','status');$('unified-chart').append(cycleBadge);
function updateCycleBadge(){const latest=cycleHistory.at(-1)?.hours??null,official=officialCycle?.hours??null,hours=official||latest;
 const sel=$('exchangeSelect').value,selName=$('exchangeSelect').selectedOptions[0].text;
 // 거래소별 현재 주기 (선택 거래소가 목록에 없거나 조회 실패하면 선택 거래소 값만 따로 추가)
 const entries=otherCycles.filter(o=>o.hours).map(o=>({name:o.name,hours:o.hours,sel:o.ex===sel}));
 if(hours&&!entries.some(e=>e.sel))entries.push({name:selName,hours,sel:true});
 if(!entries.length){cycleBadge.hidden=true;return;}
 entries.sort((x,y)=>x.hours-y.hours||x.name.localeCompare(y.name));
 const min=entries[0].hours,fast=min<8;cycleBadge.hidden=false;cycleBadge.classList.toggle('fast',fast);cycleBadge.style.background=cycleColor(min);
 cycleBadge.textContent=(fast?'⚡ ':'')+'정산 '+entries.map(e=>e.name+' '+e.hours+'h').join(' · ');
 const changed=cycleTransitions.length?` · 이 기간 ${selName} 주기 변경 ${cycleTransitions.length}회`:'';
 cycleBadge.title=`거래소별 현재 펀딩 정산 주기: ${entries.map(e=>e.name+' '+e.hours+'시간'+(e.sel?' (현재 보는 거래소)':'')).join(' / ')}${changed}`;}
const CYCLE_EXCHANGES=[['BINANCE','Binance'],['BYBIT','Bybit'],['OKX','OKX'],['BITGET','Bitget'],['MEXC','MEXC']];
// 현재 보는 거래소와 무관하게 주요 거래소의 공식 현재 정산 주기를 모두 조회 (개별 실패는 무시)
async function fetchAllCycles(s,signal){const out=await Promise.all(CYCLE_EXCHANGES.map(async([ex,name])=>{try{const r=await fetchOfficialCycle(ex,s,signal);return r?{ex,name,hours:r.hours,note:r.note}:null;}catch(e){if(e.name==='AbortError')throw e;return null;}}));return out.filter(Boolean);}
// 8시간보다 짧은 정산 구간(1h/4h 등)을 전체 패널에 옅게 칠하고 라벨 표시
function drawCycleBands(w,h){if(!all.length||!cycleValues.size||cycleFast.length!==all.length)return;const ts=chart.timeScale(),range=ts.getVisibleLogicalRange();if(!range)return;
 const plotWidth=ts.width(),part=windowEnd-windowStart,i0=Math.max(0,Math.floor(range.from)),i1=Math.min(part-1,Math.ceil(range.to));
 const fundingPane=getPaneLayout().find(p=>p.series===funding);let run=null,lastPill=-1e9;
 const flush=end=>{if(!run)return;const x1=Math.max(0,run.x1),x2=Math.min(plotWidth,end);if(x2>x1){ctx.fillStyle=cycleColor(run.hours)+'22';ctx.fillRect(x1,0,x2-x1,h-28);
  if(fundingPane&&x2-x1>34){const text=run.hours+'h 정산',px=Math.max(6,Math.min(plotWidth-64,x1+4));if(px-lastPill>70){lastPill=px;ctx.font='bold 12px sans-serif';const tw=ctx.measureText(text).width+14;ctx.fillStyle=cycleColor(run.hours);ctx.beginPath();ctx.roundRect(px,fundingPane.top+32,tw,20,5);ctx.fill();ctx.fillStyle='#111827';ctx.textAlign='left';ctx.fillText(text,px+7,fundingPane.top+46);}}}run=null;};
 for(let i=i0;i<=i1;i++){const fh=cycleFast[windowStart+i],fast=fh?fh:null;
  if(fast===null){if(run){flush(ts.logicalToCoordinate(i-.5)??0);}continue;}
  if(run&&run.hours!==fast)flush(ts.logicalToCoordinate(i-.5)??0);
  if(!run){const x=ts.logicalToCoordinate(i-.5);if(x===null)continue;run={hours:fast,x1:x};}}
 if(run){const x=ts.logicalToCoordinate(i1+.5);flush(x===null?plotWidth:x);}}
chart.panes()[0].setStretchFactor(6);chart.panes()[1].setStretchFactor(1.5);chart.panes()[2].setStretchFactor(2.5);
funding.createPriceLine({price:0,color:'#6b7280',lineWidth:1,lineStyle:LC.LineStyle.Dotted,axisLabelVisible:false});
const markers=LC.createSeriesMarkers(candles,[]);
let all=[],rates=[],signals=[],mapped=new Map(),controller,run=0,windowStart=0,windowEnd=0,showLines=true,log=false,busy=false,selectedSignal=null,changingWindow=false;
let selectedGuideVisible=false, selectedGuideTimer, selectedCountdownTimer, selectedGuideDeadline=0;
const WINDOW=10000, duration={'15m':900,'1h':3600,'4h':14400,'1d':86400};
let paneScaleSeries=[candles,volume,funding,settlementCycle];
let studyPanels=null;
const overlay=document.createElement('canvas');overlay.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:4';$('unified-chart').append(overlay);
const guideCountdown=document.createElement('div');guideCountdown.hidden=true;guideCountdown.style.cssText='position:absolute;top:12px;pointer-events:none;z-index:6;padding:7px 12px;background:#fbbf24;color:#111827;border:2px solid #fffbeb;border-radius:8px;font-size:14px;font-weight:800;white-space:nowrap;box-shadow:0 2px 10px #000b;transform:translateX(-50%)';guideCountdown.setAttribute('role','timer');guideCountdown.setAttribute('aria-label','선택 신호 기준선 남은 시간');$('unified-chart').append(guideCountdown);
function updateGuideCountdown(){const seconds=Math.max(0,Math.ceil((selectedGuideDeadline-performance.now())/1000));const label='기준선 '+seconds+'초';if(guideCountdown.textContent!==label)guideCountdown.textContent=label;}
const ctx=overlay.getContext('2d');let frame=0,paneLayoutCache=null;
const date=t=>fullFmt.format(new Date(t*1000));
const status=(s,error=false)=>{$('status-msg').textContent=s;$('status-msg').classList.toggle('error',error);};
function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});}
// [최적화] draw 한 번 안에서 getPaneLayout()이 6번 넘게 불리며 매번 getBoundingClientRect(강제 리플로우)를 했음 -> 1회로 축소
function draw(){paneLayoutCache=computePaneLayout();try{drawInner();}finally{paneLayoutCache=null;}}
// 변경 없는 스타일은 다시 쓰지 않아 불필요한 스타일 재계산을 막음
function setStyle(el,k,v){const c=el._st||(el._st={});if(c[k]!==v){c[k]=v;el.style[k]=v;}}
function drawInner(){const w=$('unified-chart').clientWidth,h=$('unified-chart').clientHeight,dpr=devicePixelRatio||1,plotWidth=chart.timeScale().width();
 if(overlay.width!==Math.round(w*dpr)||overlay.height!==Math.round(h*dpr)){overlay.width=Math.round(w*dpr);overlay.height=Math.round(h*dpr);overlay.style.width=w+'px';overlay.style.height=h+'px';}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);guideCountdown.hidden=true;drawCycleBands(w,h);drawRuler(w,h);placeChartNavigation();placeLegendToggle();studyPanels?.position();
 if(selectedSignal&&selectedGuideVisible){const x=chart.timeScale().timeToCoordinate(selectedSignal.time);if(x!==null&&x>=0&&x<=plotWidth){guideCountdown.hidden=false;guideCountdown.style.left=Math.max(65,Math.min(plotWidth-65,x))+'px';ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;ctx.setLineDash([6,3]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h-28);ctx.stroke();ctx.lineWidth=1;}}
 if(!showLines)return;
 const range=chart.timeScale().getVisibleRange();if(!range)return;
 const ts=chart.timeScale(),iEnd=lowerBound(signals,Number(range.to)+1),pathExt=new Path2D(),pathWarn=new Path2D();let last=-100,i=lowerBound(signals,Number(range.from)),any=false;
 while(i<iEnd){const s=signals[i],x=ts.timeToCoordinate(s.time);if(x===null){i++;continue;}
  if(x-last<2){let lo=i+1,hi=iEnd;while(lo<hi){const m=(lo+hi)>>>1,xm=ts.timeToCoordinate(signals[m].time);if(xm!==null&&xm-last<2)lo=m+1;else hi=m;}i=lo;continue;}
  last=x;any=true;const pth=s.type==='EXTREME'?pathExt:pathWarn;pth.moveTo(x,0);pth.lineTo(x,h-28);i++;}
 if(any){ctx.setLineDash([3,4]);ctx.lineWidth=1;ctx.strokeStyle='#ef444480';ctx.stroke(pathWarn);ctx.strokeStyle='#a855f780';ctx.stroke(pathExt);}
}

let rulerEnabled=false,rulerStart=null,rulerEnd=null,rulerLocked=false,shiftHeld=false,rulerTemporary=false,rulerDragging=false,rulerPointer=null;
const rulerBtn=$('btnRuler');rulerBtn.className='btn-toggle';rulerBtn.textContent='📏 줄자';rulerBtn.title='드래그로 측정 · Shift+드래그: 임시 줄자 · Esc 종료';rulerBtn.setAttribute('aria-pressed','false');
const rulerLabel=document.createElement('div');rulerLabel.hidden=true;rulerLabel.style.cssText='position:absolute;pointer-events:none;z-index:7;background:#2563eb;color:#fff;border:1px solid #93c5fd;padding:8px 12px;border-radius:4px;font-size:13px;font-weight:700;line-height:1.6;text-align:center;white-space:pre-line;box-shadow:0 2px 8px #0009;max-width:280px';$('unified-chart').append(rulerLabel);
function priceChange(start,end){if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0)return null;return {difference:end-start,percent:(end-start)/start*100};}
function clearRuler(){rulerStart=null;rulerEnd=null;rulerLocked=false;rulerTemporary=false;rulerLabel.hidden=true;schedule();}
function rulerInteraction(){const active=rulerEnabled||shiftHeld||rulerDragging;chart.applyOptions({handleScroll:active?false:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:active?false:{mouseWheel:false,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:false}}});$('unified-chart').style.cursor=active?'crosshair':'';}
function endRulerDrag(){if(rulerPointer!==null&&$('unified-chart').hasPointerCapture(rulerPointer))$('unified-chart').releasePointerCapture(rulerPointer);rulerDragging=false;rulerPointer=null;rulerInteraction();}
function toggleRuler(enabled){endRulerDrag();rulerEnabled=enabled;rulerBtn.classList.toggle('active',enabled);rulerBtn.setAttribute('aria-pressed',String(enabled));clearRuler();rulerInteraction();if(enabled)status('줄자: 가격 차트에서 누른 채 드래그하세요. Shift+드래그도 가능 · Esc 종료');}
rulerBtn.onclick=()=>toggleRuler(!rulerEnabled);
function typingTarget(t){return t instanceof Element&&Boolean(t.closest('input,textarea,select,[contenteditable="true"]'));}
document.addEventListener('keydown',e=>{if(typingTarget(e.target))return;if(e.key==='Shift'&&!shiftHeld){shiftHeld=true;rulerInteraction();}if(e.key==='Escape'){shiftHeld=false;toggleRuler(false);}});
document.addEventListener('keyup',e=>{if(e.key==='Shift'){shiftHeld=false;rulerInteraction();}});
window.addEventListener('blur',()=>{shiftHeld=false;if(rulerDragging){endRulerDrag();rulerLocked=true;}rulerInteraction();});
const rulerHost=$('unified-chart');

// 화면에 그려진 패널 위치 (패널 이동·최대화·사용자 크기 조절 반영)
function getPaneLayout() {
  return paneLayoutCache || computePaneLayout();
}
function computePaneLayout() {
  const hostTop = rulerHost.getBoundingClientRect().top;
  return chart.panes().map((pane, index) => {
    const element = pane.getHTMLElement();
    if (!element) return null;
    const top = element.getBoundingClientRect().top - hostTop;
    const height = pane.getHeight();
    return {
      index, top, height, bottom: top + height,
      series: studyPanels ? studyPanels.primary(studyPanels.panelForPane(pane)) : paneScaleSeries[index]
    };
  }).filter(Boolean);
}

function getPaneInfoAtY(y) {
  return getPaneLayout().find(pane => y >= pane.top && y < pane.bottom) || null;
}

// 마우스가 올라가 있는 패널(메인/지표) 추적 -> 해당 패널의 위/아래/최대화 버튼만 표시
let hoveredPaneIndex = -1;
// 최신 차트를 열었을 때의 오른쪽 끝 위치(마지막 봉 기준 봉 수). 이 위치에서 벗어나면 이동한 것으로 판단
let latestOffset = null;
let hoverPoint = null, hoverRaf = 0;
rulerHost.addEventListener('pointermove', e => {
  hoverPoint = { x: e.clientX, y: e.clientY };
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (!hoverPoint) return;
    const box = rulerHost.getBoundingClientRect();
    const x = hoverPoint.x - box.left, y = hoverPoint.y - box.top;
    const info = x >= 0 && x <= box.width ? getPaneInfoAtY(y) : null;
    const idx = info ? info.index : -1;
    if (idx !== hoveredPaneIndex) { hoveredPaneIndex = idx; schedule(); }
  });
});
rulerHost.addEventListener('pointerleave', () => {
  hoverPoint = null;
  if (hoveredPaneIndex !== -1) { hoveredPaneIndex = -1; schedule(); }
});

function paneAtY(y) {
  return getPaneInfoAtY(y)?.index ?? -1;
}

function pricePane() {
  return getPaneLayout().find(pane => pane.series === candles) || null;
}

const manualPriceSpans = new WeakMap();
let wheelTimeAnchor = null, wheelTimeFrame = 0;

function holdPriceAxisWidth() {
  const series = paneScaleSeries[0];
  const width = series ? series.priceScale().width() : 0;
  if (width > chart.options().rightPriceScale.minimumWidth) {
    chart.applyOptions({ rightPriceScale: { minimumWidth: width } });
  }
}

function keepWheelTimeAnchor() {
  if (wheelTimeFrame) return;
  wheelTimeFrame = requestAnimationFrame(() => {
    wheelTimeFrame = 0;
    const anchor = wheelTimeAnchor;
    wheelTimeAnchor = null;
    const timeScale = chart.timeScale(), width = timeScale.width();
    if (!anchor || width <= 0 || width === anchor.width) return;
    holdPriceAxisWidth();
    const range = timeScale.getVisibleLogicalRange();
    if (!range) return;
    const span = range.to - range.from + 1;
    const from = anchor.absolute - windowStart - (anchor.x + 1) / width * span + .5;
    moveChartRange({ from, to: from + span - 1 });
  });
}

function resetCustomPriceRange(series) {
  if (!series) return;
  manualPriceSpans.delete(series);
  series.priceScale().applyOptions({ autoScale: true });
}

// 패널(가격축) 위에서 휠: 해당 패널의 가격 범위 확대/축소
function zoomPanePrice(pane, localY, factor) {
  const series = pane.series, scale = series.priceScale();
  const anchorPrice = series.coordinateToPrice(localY);
  const range = scale.getVisibleRange();
  if (anchorPrice === null || !Number.isFinite(anchorPrice) || !range) return;
  const span = range.to - range.from;
  if (!Number.isFinite(span) || span <= 0) return;
  const base = manualPriceSpans.get(series) ?? span;
  manualPriceSpans.set(series, base);
  const minMove = scale.options().mode === LC.PriceScaleMode.Normal ? (series.options().priceFormat?.minMove || 0) : 0;
  const nextSpan = Math.max(base * .0001, minMove * 2, Math.min(base * 1000, span * factor));
  const actualFactor = nextSpan / span;
  if (Math.abs(actualFactor - 1) < 1e-12) return;
  let next;
  if (scale.options().mode === LC.PriceScaleMode.Normal) {
    next = { from: anchorPrice - (anchorPrice - range.from) * actualFactor, to: anchorPrice + (range.to - anchorPrice) * actualFactor };
  } else {
    const center = (range.from + range.to) / 2;
    next = { from: center - nextSpan / 2, to: center + nextSpan / 2 };
    scale.setVisibleRange(next);
    const anchorY = series.priceToCoordinate(anchorPrice), probe = nextSpan * .01;
    scale.setVisibleRange({ from: next.from + probe, to: next.to + probe });
    const shiftedY = series.priceToCoordinate(anchorPrice);
    if (anchorY !== null && shiftedY !== null && Math.abs(shiftedY - anchorY) > 1e-9) {
      const shift = (localY - anchorY) * probe / (shiftedY - anchorY);
      next = { from: next.from + shift, to: next.to + shift };
    }
  }
  if (!Number.isFinite(next.from) || !Number.isFinite(next.to) || next.from >= next.to) return;
  scale.setVisibleRange(next);
  $('btnAutoFit').classList.remove('active');
}

function zoomPaneTime(x, factor) {
  const timeScale = chart.timeScale(), range = timeScale.getVisibleLogicalRange();
  if (!all.length || !range || timeScale.width() <= 0) return;
  const span = range.to - range.from + 1;
  const left = range.from - .5, right = range.to + .5;
  const anchor = left + (x + 1) / timeScale.width() * span;
  if (span <= 0) return;
  const maxSpan = Math.max(8, Math.min(WINDOW - 10, all.length * 1.25));
  const nextSpan = Math.max(8, Math.min(maxSpan, span * factor));
  const actualFactor = nextSpan / span;
  wheelTimeAnchor = { x, absolute: anchor + windowStart, width: timeScale.width() };
  if (Math.abs(actualFactor - 1) >= 1e-12) {
    moveChartRange({ from: anchor - (anchor - left) * actualFactor + .5, to: anchor + (right - anchor) * actualFactor - .5 });
  }
  keepWheelTimeAnchor();
}

let wheelPending = null, wheelRaf = 0;
function flushWheel() {
  wheelRaf = 0;
  const p = wheelPending;
  wheelPending = null;
  if (!p) return;
  holdPriceAxisWidth();
  wheelTimeAnchor = null;
  zoomPanePrice(p.pane, p.y - p.pane.top, p.factor);
  if (p.x < chart.timeScale().width()) zoomPaneTime(p.x, p.factor);
  schedule();
}
// 마우스 휠: 차트 위 = 가격 + 시간축 확대/축소, 가격표(오른쪽 축) 위 = 해당 패널 가격만 확대/축소
rulerHost.addEventListener('wheel', e => {
  if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;
  const box = rulerHost.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
  const pane = getPaneInfoAtY(y);
  if (!pane?.series || x < 0 || x >= box.width) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (rulerEnabled || shiftHeld || rulerDragging) return;
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pane.height : 1);
  const factor = Math.exp(Math.max(-240, Math.min(240, delta)) * .0015);
  // [최적화] 휠 이벤트는 프레임당 여러 번 들어옴 -> 배율만 누적하고 다음 프레임에 한 번만 적용
  if (wheelPending && wheelPending.pane.index !== pane.index) flushWheel();
  if (wheelPending) { wheelPending.factor *= factor; wheelPending.x = x; wheelPending.y = y; wheelPending.pane = pane; }
  else wheelPending = { pane, x, y, factor };
  if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheel);
}, { capture: true, passive: false });

// 가격축 더블클릭: 해당 패널 가격축만 자동 정렬
rulerHost.addEventListener('dblclick', e => {
  if (rulerEnabled || shiftHeld || rulerDragging) return;
  const box = rulerHost.getBoundingClientRect(),
        x = e.clientX - box.left,
        y = e.clientY - box.top,
        timeWidth = chart.timeScale().width();
  if (x >= timeWidth) {
    const paneInfo = getPaneInfoAtY(y);
    if (paneInfo && paneInfo.series) {
      e.preventDefault();
      e.stopImmediatePropagation();
      resetCustomPriceRange(paneInfo.series);
      paneInfo.series.priceScale().applyOptions({ autoScale: true, scaleMargins: { top: 0.12, bottom: 0.12 } });
      schedule();
    }
  }
}, { capture: true });

function pointerPrice(e,clamp=false){const pl=pricePane();if(!pl)return null;const box=rulerHost.getBoundingClientRect();let x=e.clientX-box.left,y=e.clientY-box.top-pl.top;const width=chart.timeScale().width(),height=pl.height;
 if(clamp){x=Math.max(0,Math.min(width-1,x));y=Math.max(0,Math.min(height-1,y));}else if(x<0||x>=width||y<0||y>=height)return null;
 const logical=chart.timeScale().coordinateToLogical(x),price=candles.coordinateToPrice(y);if(logical===null||price===null||price<=0)return null;return {index:Math.round(logical)+windowStart,price};}
rulerHost.addEventListener('pointerdown',e=>{if(e.target instanceof Element&&e.target.closest('[data-chart-nav]'))return;if(e.button!==0)return;const active=rulerEnabled||e.shiftKey||shiftHeld;if(!active){if(rulerTemporary)clearRuler();return;}const point=pointerPrice(e);if(!point)return;e.preventDefault();e.stopImmediatePropagation();rulerTemporary=!rulerEnabled;rulerStart=point;rulerEnd=point;rulerLocked=false;rulerDragging=true;rulerPointer=e.pointerId;rulerHost.setPointerCapture(e.pointerId);rulerInteraction();schedule();},{capture:true});
rulerHost.addEventListener('pointermove',e=>{if(!rulerDragging||e.pointerId!==rulerPointer)return;e.preventDefault();e.stopImmediatePropagation();const point=pointerPrice(e,true);if(point){rulerEnd=point;schedule();}},{capture:true});
rulerHost.addEventListener('pointerup',e=>{if(!rulerDragging||e.pointerId!==rulerPointer)return;e.preventDefault();e.stopImmediatePropagation();const point=pointerPrice(e,true);if(point)rulerEnd=point;rulerLocked=true;endRulerDrag();status('줄자 측정 완료 · 다시 드래그해 측정 / Esc 종료');schedule();},{capture:true});
rulerHost.addEventListener('pointercancel',()=>{if(rulerDragging){endRulerDrag();clearRuler();}});
let rulerVolumeData=null,rulerVolumePrefix=[];
function measureDetails(a,b){if(rulerVolumeData!==all){rulerVolumeData=all;rulerVolumePrefix=[0];for(const c of all)rulerVolumePrefix.push(rulerVolumePrefix.at(-1)+(Number.isFinite(c.volume)?c.volume:0));}
 const ai=Math.max(0,Math.min(all.length-1,Math.round(a.index))),bi=Math.max(0,Math.min(all.length-1,Math.round(b.index))),lo=Math.min(ai,bi),hi=Math.max(ai,bi);const seconds=all[ai]&&all[bi]?Math.abs(all[bi].time-all[ai].time):0;const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);return {bars:Math.round(b.index-a.index),period:[days?days+'일':'',hours?hours+'시간':'',minutes?minutes+'분':''].filter(Boolean).join(' ')||'0분',volume:(rulerVolumePrefix[hi+1]||0)-(rulerVolumePrefix[lo]||0),start:all[ai]?.time,end:all[bi]?.time};}
function drawRuler(w,h){rulerLabel.hidden=true;if(!(rulerEnabled||rulerTemporary)||!rulerStart||!rulerEnd)return;
 const pl=pricePane();if(!pl)return;
 const x1=chart.timeScale().logicalToCoordinate(rulerStart.index-windowStart),x2=chart.timeScale().logicalToCoordinate(rulerEnd.index-windowStart),y1=candles.priceToCoordinate(rulerStart.price),y2=candles.priceToCoordinate(rulerEnd.price);
 if([x1,x2,y1,y2].some(v=>v===null))return;const change=priceChange(rulerStart.price,rulerEnd.price);if(!change)return;
 const color=change.percent>=0?'#3b82f6':'#ef4444';const ph=pl.height,plotWidth=chart.timeScale().width();ctx.save();ctx.translate(0,pl.top);ctx.beginPath();ctx.rect(0,0,plotWidth,ph);ctx.clip();ctx.setLineDash([]);ctx.strokeStyle=color;ctx.fillStyle=change.percent>=0?'#3b82f633':'#ef444433';ctx.lineWidth=1.5;ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctx.beginPath();const mx=(x1+x2)/2,my=(y1+y2)/2;ctx.moveTo(x1,my);ctx.lineTo(x2,my);ctx.moveTo(mx,y1);ctx.lineTo(mx,y2);ctx.stroke();for(const [ax,ay,dx,dy] of [[x2,my,-Math.sign(x2-x1)*6,0],[mx,y2,0,-Math.sign(y2-y1)*6]]){ctx.beginPath();ctx.moveTo(ax+dx+(dy?4:0),ay+dy+(dx?4:0));ctx.lineTo(ax,ay);ctx.lineTo(ax+dx-(dy?4:0),ay+dy-(dx?4:0));ctx.stroke();}
 for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.beginPath();ctx.fillStyle=color;ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();}ctx.restore();

 const details=measureDetails(rulerStart,rulerEnd),sign=change.percent>=0?'+':'';rulerLabel.textContent=`${change.difference>=0?'+':''}${change.difference.toPrecision(6)} (${sign}${change.percent.toFixed(2)}%)\n${details.bars}봉 · ${details.period}\n거래량 ${new Intl.NumberFormat('ko-KR',{notation:'compact',maximumFractionDigits:2}).format(details.volume)}`;
 rulerLabel.style.background=color;rulerLabel.style.borderColor=color;rulerLabel.style.left=Math.max(8,Math.min(w-370,(x1+x2)/2-100))+'px';rulerLabel.style.top=pl.top+Math.max(8,Math.min(ph-85,Math.min(y1,y2)-85))+'px';rulerLabel.hidden=false;
 ctx.save();ctx.translate(0,pl.top);ctx.setLineDash([]);ctx.font='bold 11px sans-serif';ctx.textAlign='left';for(const [price,y] of [[rulerStart.price,y1],[rulerEnd.price,y2]]){if(y<0||y>ph)continue;ctx.fillStyle=color;ctx.fillRect(plotWidth,y-9,w-plotWidth,18);ctx.fillStyle='#fff';ctx.fillText(price.toPrecision(7),plotWidth+4,y+4);}ctx.restore();
}

const chartNavigation=document.createElement('div');chartNavigation.dataset.chartNav='true';chartNavigation.setAttribute('role','toolbar');chartNavigation.setAttribute('aria-label','차트 확대 및 좌우 이동');chartNavigation.style.cssText='position:absolute;z-index:9;display:flex;gap:4px;transform:translateX(-50%);padding:3px;border-radius:6px;background:#111827dd;box-shadow:0 1px 8px #0006;pointer-events:auto';
$('unified-chart').append(chartNavigation);
function moveChartRange(range){if(!all.length)return;const absolute={from:range.from+windowStart,to:range.to+windowStart},middle=(absolute.from+absolute.to)/2;
 // [최적화] 최신봉 오른쪽 여백/데이터 끝을 넘겨 줌아웃할 때마다 10000봉 setData를 다시 하던 문제:
 // 윈도우 위치가 실제로 바뀔 때만 재렌더하고, 아니면 가시 범위만 바꿈
 const center=Math.max(0,Math.min(all.length-1,middle));
 if((absolute.from<windowStart||absolute.to>=windowEnd)&&windowStartFor(center)!==windowStart)renderWindow(center,false,240,absolute);else chart.timeScale().setVisibleLogicalRange(range);
 {const hv=String(Math.max(0,Math.min(all.length-1,Math.round(middle))));if($('historyPosition').value!==hv)$('historyPosition').value=hv;}schedule();}
function navigationRange(range,action){const span=Math.max(8,range.to-range.from),center=(range.from+range.to)/2;if(action==='left'||action==='right'){const shift=span*.25*(action==='left'?-1:1);return {from:range.from+shift,to:range.to+shift};}
 const width=Math.max(8,Math.min(Math.max(10000,all.length*1.5),span*(action==='in'?.8:1.25)));return {from:center-width/2,to:center+width/2};}
function navigateChart(action){if(!all.length)return;
 if(action==='reset'){resetScales();const span=Math.min(180,Math.max(20,all.length*1.2)),end=all.length-1;latestOffset=5;moveChartRange({from:end-span+5-windowStart,to:end+5-windowStart});}
 else {const range=chart.timeScale().getVisibleLogicalRange();if(range)moveChartRange(navigationRange(range,action));}}
for(const [action,label,title] of [['out','-','축소'],['in','+','확대'],['left','<','이전 구간으로 이동'],['right','>','다음 구간으로 이동'],['reset','R','최근 차트로 이동 및 화면 초기화']]){
 const button=document.createElement('button');button.type='button';button.dataset.nav=action;button.textContent=label;button.title=title;button.setAttribute('aria-label',title);button.style.cssText='width:30px;height:28px;padding:0;background:#263244;border:1px solid #475569;color:#e2e8f0;border-radius:4px;font-size:20px;line-height:24px';
 button.onclick=e=>{e.stopPropagation();navigateChart(action);};button.onmouseenter=()=>button.style.background='#475569';button.onmouseleave=()=>button.style.background='#263244';chartNavigation.append(button);
}
chartNavigation.addEventListener('pointerdown',e=>e.stopPropagation());chartNavigation.addEventListener('dblclick',e=>e.stopPropagation());
// 이동 버튼(-, +, <, >, R): 항상 "맨 아래 패널"에만 표시.
// 지표 패널이 모두 없으면 맨 아래 패널 = 가격(메인) 차트가 됩니다.
function placeChartNavigation(){
  const layout = getPaneLayout().filter(p => p.height > 1);
  if (!layout.length) return;
  const bottom = layout.reduce((a, b) => (b.bottom > a.bottom ? b : a)).bottom;
  // 최신 차트 기준 위치에서 벗어나 이동했을 때만 버튼 5개(- + < > R) 표시
  const range = chart.timeScale().getVisibleLogicalRange();
  const lastRel = all.length - 1 - windowStart;
  const atLatest = !all.length || !range || latestOffset === null ||
    (windowEnd === all.length && Math.abs(range.to - lastRel - latestOffset) <= 2);
  setStyle(chartNavigation, 'display', atLatest ? 'none' : 'flex');
  setStyle(chartNavigation, 'left', chart.timeScale().width() / 2 + 'px');
  setStyle(chartNavigation, 'top', Math.max(4, bottom - 38) + 'px');
}

// 지표 이름 접기/펼치기 (TradingView의 "^" 버튼). 상태는 새로고침 후에도 유지됩니다.
const LEGEND_KEY = 'funding-chart-legend-collapsed';
let legendCollapsed = false;
try { legendCollapsed = localStorage.getItem(LEGEND_KEY) === '1'; } catch {}
const legendStyle = document.createElement('style');
legendStyle.textContent = '.legend-collapsed .pane-header-left{display:none!important}';
document.head.append(legendStyle);
const legendToggle = document.createElement('button');
legendToggle.type = 'button';
legendToggle.dataset.chartNav = 'true';
legendToggle.style.cssText = 'position:absolute;left:6px;z-index:9;width:26px;height:20px;padding:0;display:flex;align-items:center;justify-content:center;background:#111827dd;border:1px solid #475569;border-radius:4px;color:#cbd5e1;cursor:pointer';
for (const type of ['pointerdown', 'dblclick']) legendToggle.addEventListener(type, e => e.stopPropagation());
function applyLegendState() {
  rulerHost.classList.toggle('legend-collapsed', legendCollapsed);
  legendToggle.title = legendCollapsed ? '지표 이름 보이기' : '지표 이름 숨기기';
  legendToggle.setAttribute('aria-label', legendToggle.title);
  legendToggle.setAttribute('aria-pressed', String(legendCollapsed));
  legendToggle.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="' + (legendCollapsed ? 'm3 6 5 5 5-5' : 'm3 10 5-5 5 5') + '"/></svg>';
  placeLegendToggle();
  schedule();
}
function placeLegendToggle() {
  const layout = getPaneLayout();
  if (!layout.length) return;
  legendToggle.hidden = Boolean(studyPanels?.priceCollapsed());
  if (legendToggle.hidden) return;
  const top = Math.min(...layout.map(p => p.top));
  setStyle(legendToggle, 'top', top + (legendCollapsed ? 5 : 32) + 'px');
}
legendToggle.onclick = e => {
  e.stopPropagation();
  legendCollapsed = !legendCollapsed;
  try { localStorage.setItem(LEGEND_KEY, legendCollapsed ? '1' : '0'); } catch {}
  applyLegendState();
};
$('unified-chart').append(legendToggle);
applyLegendState();
new ResizeObserver(placeChartNavigation).observe($('unified-chart'));

function windowStartFor(c){return Math.max(0,Math.min(all.length-WINDOW,Math.floor(c-WINDOW/2)));}
function lowerBound(a,t){let l=0,r=a.length;while(l<r){const m=(l+r)>>>1;if(a[m].time<t)l=m+1;else r=m;}return l;}
function thresholds(){const warn=Number($('warnThresh').value),ext=Number($('extThresh').value);if(!$('warnThresh').value||!$('extThresh').value||!Number.isFinite(warn)||!Number.isFinite(ext)||ext>warn)throw Error('극단 경고는 1차 경고 이하의 숫자로 입력하세요.');return {warn,ext};}
function rebuild(){const {warn,ext}=thresholds();mapped=new Map();signals=[];
 let i=0;for(const f of rates){while(i+1<all.length&&all[i+1].time<=f.time)i++;const c=all[i];if(!c||f.time<c.time||f.time>=c.time+duration[$('intervalSelect').value])continue;
 const old=mapped.get(c.time);if(!old||f.rate<old.rate)mapped.set(c.time,{time:c.time,rate:f.rate,events:(old?.events||0)+1});else old.events++;
 const type=f.rate<=ext?'EXTREME':f.rate<=warn?'WARN':null;if(type)signals.push({time:c.time,eventTime:f.time,rate:f.rate,type});}
 rebuildCycles();renderList();}

function observedCycles(records){const periods=[];const allowed=[1,2,4,8,12,24];for(let i=1;i<records.length;i++){const seconds=records[i].time-records[i-1].time;const hours=allowed.find(h=>Math.abs(seconds-h*3600)<=60);periods.push({start:records[i-1].time,end:records[i].time,hours:hours??null});}
 for(let i=0;i<periods.length;i++){const p=periods[i],before=periods[i-1],after=periods[i+1];if(before&&after&&before.hours===after.hours&&before.hours&&p.hours>before.hours){p.hours=null;p.gap=true;}}
 return periods;}
function rebuildCycles(){cycleHistory=observedCycles(rates);cycleTransitions=[];cycleValues=new Map();let previous=null;
 for(const p of cycleHistory){if(p.hours===null){previous=null;continue;}if(previous!==null&&previous!==p.hours)cycleTransitions.push({time:p.end,from:previous,to:p.hours});previous=p.hours;}
 let i=0;const seconds=duration[$('intervalSelect').value];for(const c of all){while(i<cycleHistory.length&&cycleHistory[i].end<=c.time)i++;let value=null,unknown=false;for(let j=i;j<cycleHistory.length&&cycleHistory[j].start<c.time+seconds;j++){const p=cycleHistory[j];if(p.end<=c.time)continue;if(p.hours===null)unknown=true;else value=value===null?p.hours:Math.min(value,p.hours);}
 if(value!==null)cycleValues.set(c.time,{hours:value,mixed:unknown});}
 cycleFast=new Uint8Array(all.length);for(let k=0;k<all.length;k++){const v=cycleValues.get(all[k].time);if(v&&v.hours<8)cycleFast[k]=Math.round(v.hours);}
 const latest=cycleHistory.at(-1);
 const official=(officialCycle?.hours?` · 거래소 공식 현재 주기: ${officialCycle.hours}시간${officialCycle.note}`:'')+(otherCycles.length?` · 거래소별 현재 주기: ${otherCycles.map(o=>o.name+' '+o.hours+'시간').join(' / ')}`:'');
 const mismatch=officialCycle?.hours&&latest?.hours&&latest.hours!==officialCycle.hours?` · ⚠ 이력 관측(${latest.hours}시간)과 공식(${officialCycle.hours}시간)이 다름: 최근 주기가 바뀌었거나 거래소 선택을 확인하세요`:'';
 cycleCaption.textContent=`정산 주기(기록 간격 관측): ${latest?.hours?latest.hours+'시간':'확인 불가'}${official}${mismatch} · 전환 ${cycleTransitions.length}회 · 8h 파랑 / 4h 주황 / 1h 빨강 · 일봉 등은 봉 내 최소 간격 · 데이터 누락 시 실제 정책과 다를 수 있음`;updateCycleBadge();}
function cycleColor(h){return h===1?'#ef4444':h===4?'#f59e0b':h===8?'#3b82f6':'#a78bfa';}
function renderCycles(part){if(!settlementCycle)return;settlementCycle.setData(part.map(c=>{const p=cycleValues.get(c.time);return p?{time:c.time,value:p.hours,color:cycleColor(p.hours)}:{time:c.time};}));
 const map=new Map();for(const t of cycleTransitions){const i=lowerBound(all,t.time);const k=all[i]?.time===t.time?all[i]:all[i-1];if(k&&k.time>=part[0].time&&k.time<=part.at(-1).time)map.set(k.time,{time:k.time,position:'aboveBar',color:cycleColor(t.to),shape:'arrowDown',size:2,text:'⚡ 정산 '+t.from+'h → '+t.to+'h'});}
 cycleMarkers?.setMarkers(map.size<=150?[...map.values()]:[]);}

function resetScales(){
 for(const series of paneScaleSeries){
  resetCustomPriceRange(series);
  series.priceScale().applyOptions({autoScale:true,scaleMargins:{top:0.12,bottom:0.12}});
 }
 $('btnAutoFit').classList.add('active');
}
function centeredRange(index,span=240){return {from:index-span/2,to:index+span/2};}
function focusSignal(s,element){selectedSignal=s;selectedGuideVisible=true;clearTimeout(selectedGuideTimer);clearInterval(selectedCountdownTimer);selectedGuideDeadline=performance.now()+5000;updateGuideCountdown();selectedCountdownTimer=setInterval(updateGuideCountdown,100);selectedGuideTimer=setTimeout(()=>{selectedGuideVisible=false;clearInterval(selectedCountdownTimer);guideCountdown.hidden=true;schedule();},5000);for(const el of $('signalListContainer').querySelectorAll('.signal-item')){el.style.outline='';el.setAttribute('aria-current','false');}element.style.outline='2px solid #fbbf24';element.setAttribute('aria-current','true');
 const old=chart.timeScale().getVisibleLogicalRange();const span=old?Math.max(80,Math.min(600,old.to-old.from)):240;
 renderWindow(lowerBound(all,s.time),true,span);
 chart.clearCrosshairPosition();
 $('chart-key').textContent=`선택 신호: ${date(s.eventTime)} · ${s.rate.toFixed(6)}% · 노란선: 해당 ${$('intervalSelect').selectedOptions[0].text} 캔들 (${date(s.time)})`;
 status(`신호 이동 완료 · ${date(s.eventTime)} · ${s.rate.toFixed(6)}%`);schedule();}
function renderWindow(center,focus=true,span=240,preservedRange=null){if(!all.length)return;changingWindow=true;clearTimeout(navTimer);windowStart=windowStartFor(center);windowEnd=Math.min(all.length,windowStart+WINDOW);const part=all.slice(windowStart,windowEnd),{warn,ext}=thresholds();
 candles.setData(part.map(({time,open,high,low,close})=>({time,open,high,low,close})));
 volume?.setData(part.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#22c55e80':'#ef444480'})));
 funding?.setData(part.map(c=>{const f=mapped.get(c.time);return f?{time:c.time,value:f.rate,color:f.rate<=ext?'#a855f7':f.rate<=warn?'#ef4444':'#3b82f6'}:{time:c.time};}));
 renderCycles(part);
 studyPanels?.render(part);
 const visible=signals.slice(lowerBound(signals,part[0].time),lowerBound(signals,part.at(-1).time+1));
 const unique=new Map();for(const s of visible){const old=unique.get(s.time);if(!old||s.rate<old.rate)unique.set(s.time,s);}
 markers.setMarkers(unique.size<=300?[...unique.values()].map(s=>({time:s.time,position:'aboveBar',color:s.type==='EXTREME'?'#a855f7':'#ef4444',shape:'arrowDown',text:s.rate.toFixed(3)+'%'})):[]);
 $('historyPosition').max=Math.max(0,all.length-1);$('historyPosition').value=Math.max(0,Math.min(all.length-1,center));$('historyInfo').textContent=`${all.length.toLocaleString()}봉 · 화면 구간 ${date(part[0].time)} ~ ${date(part.at(-1).time)}`;
 if(focus){const ix=Math.max(0,Math.min(part.length-1,center-windowStart));resetScales();const rng=centeredRange(ix,Math.min(span,Math.max(20,all.length*1.2)));if(center>=all.length-1)latestOffset=rng.to-ix;chart.timeScale().setVisibleLogicalRange(rng);}else if(preservedRange){chart.timeScale().setVisibleLogicalRange({from:preservedRange.from-windowStart,to:preservedRange.to-windowStart});}requestAnimationFrame(()=>{changingWindow=false;schedule();});}
let listOffset=0;function renderList(){listOffset=0;$('signalListContainer').replaceChildren();$('signalCountTag').textContent=signals.length+'개';appendList();}
function appendList(){const container=$('signalListContainer');container.querySelector('.more')?.remove();const end=Math.min(signals.length,listOffset+100);const fragment=document.createDocumentFragment();for(;listOffset<end;listOffset++){const s=signals[signals.length-1-listOffset],el=document.createElement('div');el.className='signal-item '+s.type;const text=document.createElement('div');text.textContent=`${date(s.eventTime)} · ${s.rate.toFixed(6)}%`;el.append(text);el.onclick=()=>focusSignal(s,el);fragment.append(el);}container.append(fragment);if(listOffset<signals.length){const b=document.createElement('button');b.className='more';b.textContent='신호 100개 더 보기';b.onclick=appendList;container.append(b);}if(!signals.length)container.textContent='설정 조건에 해당하는 펀딩비 신호 없음';}
chart.subscribeCrosshairMove(p=>{studyPanels?.updateLegend(p.time??null);if(selectedSignal)return;if(!p.time)return;const setKey=t=>{const el=$('chart-key');if(el.textContent!==t)el.textContent=t;};const c=p.seriesData.get(candles),v=volume?p.seriesData.get(volume):undefined,f=funding?p.seriesData.get(funding):undefined,cycle=settlementCycle?p.seriesData.get(settlementCycle):undefined;setKey(`${date(Number(p.time))} · 종가 ${c?.close??'—'} · 거래량 ${v?.value??'—'} · 펀딩비 ${f?.value!==undefined?f.value.toFixed(6)+'%':'기록 없음'} (봉 내 최저 실현율) · 정산 간격 ${cycle?.value!==undefined?cycle.value+'시간':'기록 없음'}`);});
let navTimer;chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{schedule();if(!r||busy||changingWindow)return;clearTimeout(navTimer);navTimer=setTimeout(()=>{const absolute={from:r.from+windowStart,to:r.to+windowStart};const middle=(absolute.from+absolute.to)/2;if(((r.from<20&&windowStart>0)||(r.to>windowEnd-windowStart-20&&windowEnd<all.length))&&windowStartFor(middle)!==windowStart)renderWindow(middle,false,240,absolute);},180);});
new ResizeObserver(schedule).observe($('unified-chart'));
const pause=(ms,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(new DOMException('중지','AbortError'));const onAbort=()=>{clearTimeout(timer);reject(new DOMException('중지','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);signal.addEventListener('abort',onAbort,{once:true});});
function url(base,params){return base+'?'+new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined));}
async function json(base,params,signal){for(let attempt=0;attempt<4;attempt++){let response;try{response=await fetch(url(base,params),{signal});}catch(e){if(signal.aborted)throw e;if(attempt===3)throw Error('API 연결 실패 (CORS·지역 제한·네트워크 확인)');await pause(1000*(attempt+1),signal);continue;}if(response.status===429||response.status>=500){if(attempt===3)throw Error('API 요청 제한 / 서버 오류 '+response.status);await pause(1500*2**attempt,signal);continue;}if(!response.ok)throw Error('API HTTP '+response.status);const j=await response.json();if(j.retCode!==undefined&&j.retCode!==0)throw Error(j.retMsg);if(j.code!==undefined&&!['0','00000'].includes(String(j.code)))throw Error(j.msg||j.message||String(j.code));if(j.success===false)throw Error(j.message||'API 실패');return j;}throw Error('API 실패');}
function candle(row){if(Array.isArray(row))return {time:Math.floor(Number(row[0])/1000),open:+row[1],high:+row[2],low:+row[3],close:+row[4],volume:+row[5]};return {time:Math.floor(+row.time/1000),open:+row.open,high:+row.high,low:+row.low,close:+row.close,volume:+row.volume};}
function uniqueSorted(rows){const m=new Map();for(const r of rows)if(Number.isFinite(r.time))m.set(r.time,r);return [...m.values()].sort((a,b)=>a.time-b.time);}
function baseSymbol(s){return s.replace(/[-_]/g,'').replace(/USDT(?:SWAP)?$/,'');}
async function candlePage(ex,s,int,end,signal){const b=baseSymbol(s),ms=duration[int]*1000;let j,rows;
 switch(ex){
 case 'BINANCE':j=await json('https://fapi.binance.com/fapi/v1/klines',{symbol:b+'USDT',interval:int,limit:1000,endTime:end},signal);rows=j;break;
 case 'BYBIT':j=await json('https://api.bybit.com/v5/market/kline',{category:'linear',symbol:b+'USDT',interval:{'15m':'15','1h':'60','4h':'240','1d':'D'}[int],limit:1000,end},signal);rows=j.result.list;break;
 case 'BINGX':j=await json('https://open-api.bingx.com/openApi/swap/v3/quote/klines',{symbol:b+'-USDT',interval:int,limit:1000,endTime:end},signal);rows=j.data;break;
 case 'BITGET':j=await json('https://api.bitget.com/api/v2/mix/market/history-candles',{symbol:b+'USDT',productType:'USDT-FUTURES',granularity:{'15m':'15m','1h':'1H','4h':'4H','1d':'1Dutc'}[int],limit:200,endTime:end},signal);rows=j.data;break;
 case 'OKX':j=await json('https://www.okx.com/api/v5/market/history-candles',{instId:b+'-USDT-SWAP',bar:{'15m':'15m','1h':'1H','4h':'4H','1d':'1Dutc'}[int],limit:300,after:end},signal);rows=j.data.map(r=>[...r.slice(0,5),r[6]]);break;
 case 'MEXC':{const sec=Math.floor(end/1000);j=await json('https://contract.mexc.com/api/v1/contract/kline/'+b+'_USDT',{interval:{'15m':'Min15','1h':'Min60','4h':'Hour4','1d':'Day1'}[int],start:Math.max(0,sec-duration[int]*1999),end:sec},signal);const d=j.data;return (d.time||[]).map((t,i)=>({time:+t,open:+d.open[i],high:+d.high[i],low:+d.low[i],close:+d.close[i],volume:+d.vol[i]}));}
 }if(!Array.isArray(rows))throw Error('캔들 응답 형식 오류');return rows.map(candle).filter(c=>[c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite));}
async function fundingPage(ex,s,cursor,page,signal){const b=baseSymbol(s);let j,rows;
 switch(ex){
 case 'BINANCE':j=await json('https://fapi.binance.com/fapi/v1/fundingRate',{symbol:b+'USDT',limit:1000,startTime:cursor,endTime:Date.now()},signal);rows=j;break;
 case 'BYBIT':j=await json('https://api.bybit.com/v5/market/funding/history',{category:'linear',symbol:b+'USDT',limit:200,endTime:cursor},signal);rows=j.result.list;break;
 case 'BINGX':j=await json('https://open-api.bingx.com/openApi/swap/v2/quote/fundingRate',{symbol:b+'-USDT',limit:1000,endTime:cursor},signal);rows=j.data;break;
 case 'BITGET':j=await json('https://api.bitget.com/api/v2/mix/market/history-fund-rate',{symbol:b+'USDT',productType:'USDT-FUTURES',pageSize:100,pageNo:page},signal);rows=j.data;break;
 case 'MEXC':j=await json('https://contract.mexc.com/api/v1/contract/funding_rate/history',{symbol:b+'_USDT',page_size:1000,page_num:page},signal);rows=j.data.resultList;break;
 case 'OKX':j=await json('https://www.okx.com/api/v5/public/funding-rate-history',{instId:b+'-USDT-SWAP',limit:400,after:cursor},signal);rows=j.data;break;
 }if(!Array.isArray(rows))throw Error('펀딩비 응답 형식 오류');return uniqueSorted(rows.map(r=>({time:Math.floor(Number(r.fundingRateTimestamp??r.fundingTime??r.settleTime)/1000),rate:Number(ex==='OKX'&&r.realizedRate!==undefined&&r.realizedRate!==''?r.realizedRate:r.fundingRate)*100})).filter(r=>Number.isFinite(r.rate)));}
// 거래소가 공식 제공하는 "현재" 펀딩 정산 주기(시간). 실패해도 차트는 계속 동작합니다.
async function fetchOfficialCycle(ex,s,signal){const b=baseSymbol(s);let hours=null,note='';
 try{switch(ex){
 case 'BINANCE':{const j=await json('https://fapi.binance.com/fapi/v1/fundingInfo',{},signal);const r=Array.isArray(j)?j.find(x=>x.symbol===b+'USDT'):null;hours=r?Number(r.fundingIntervalHours):8;if(!r)note=' (조정 목록에 없음 = 기본 8시간)';break;}
 case 'BYBIT':{const j=await json('https://api.bybit.com/v5/market/instruments-info',{category:'linear',symbol:b+'USDT'},signal);hours=Number(j.result.list[0].fundingInterval)/60;break;}
 case 'OKX':{const j=await json('https://www.okx.com/api/v5/public/funding-rate',{instId:b+'-USDT-SWAP'},signal);hours=(Number(j.data[0].nextFundingTime)-Number(j.data[0].fundingTime))/3600000;break;}
 case 'BITGET':{const j=await json('https://api.bitget.com/api/v2/mix/market/current-fund-rate',{symbol:b+'USDT',productType:'USDT-FUTURES'},signal);hours=Number(j.data[0].fundingRateInterval);break;}
 case 'MEXC':{const j=await json('https://contract.mexc.com/api/v1/contract/funding_rate/'+b+'_USDT',{},signal);hours=Number(j.data.collectCycle);break;}
 default:return null;}
 }catch(e){if(e.name==='AbortError')throw e;return null;}
 return Number.isFinite(hours)&&hours>0?{hours:Math.round(hours*100)/100,note}:null;}
async function loadData(){try{thresholds();}catch(e){return status(e.message,true);}const symbol=$('symbolInput').value.trim().toUpperCase();if(!/^[A-Z0-9_-]+$/.test(symbol))return status('유효한 심볼을 입력하세요.',true);
 controller?.abort();controller=new AbortController();const signal=controller.signal,id=++run,ex=$('exchangeSelect').value,int=$('intervalSelect').value;busy=true;clearRuler();selectedSignal=null;for(const s of paneScaleSeries)resetCustomPriceRange(s);all=[];rates=[];signals=[];mapped.clear();candles.setData([]);volume?.setData([]);funding?.setData([]);settlementCycle?.setData([]);cycleMarkers?.setMarkers([]);studyPanels?.clearData();cycleHistory=[];cycleTransitions=[];cycleValues.clear();cycleFast=new Uint8Array(0);officialCycle=null;otherCycles=[];cycleCaption.textContent='정산 주기: 이력 수집 중';cycleBadge.hidden=true;markers.setMarkers([]);renderList();
 $('coverage').textContent='선택 거래소 USDT 무기한 선물 · 제공 가능한 이력 끝까지 수집 · 오래된 구간은 하단 슬라이더/최초 데이터로 이동';
 status(`${ex} ${symbol} · 과거 이력 수집 시작`);
 let candleEnd=Date.now(),chunks=[],count=0,candleNote='',fundNote='';
 try{for(;;){const rows=uniqueSorted(await candlePage(ex,symbol,int,candleEnd,signal)).filter(c=>c.time*1000<=candleEnd);if(!rows.length){candleNote='API 이력 끝';break;}chunks.push(rows);count+=rows.length;status(`${ex} ${symbol} · 캔들 ${count.toLocaleString()}봉 수집 중`);if(chunks.length===1){all=rows;renderWindow(all.length-1);}const next=rows[0].time*1000-1;if(next>=candleEnd){candleNote='API 페이지 진행 불가';break;}candleEnd=next;if(candleEnd<=0){candleNote='이력 끝';break;}await pause(ex==='BINGX'?1150:350,signal);}
 }catch(e){candleNote=e.name==='AbortError'?'사용자 중지':e.message;}
 if(id!==run)return;all=uniqueSorted(chunks.flat());if(!all.length){busy=false;return status(`${ex}: ${candleNote||'해당 심볼 데이터 없음'}`,true);}renderWindow(all.length-1);
 if(!signal.aborted){let cursor=ex==='BINANCE'?all[0].time*1000:Date.now(),parts=[],previous=-1;
 try{for(let page=1;;page++){const rows=await fundingPage(ex,symbol,cursor,page,signal);if(!rows.length){fundNote='API 이력 끝';break;}const useful=rows.filter(f=>f.time>=all[0].time);parts.push(useful);status(`${ex} · ${all.length.toLocaleString()}봉 / 펀딩비 ${parts.reduce((n,a)=>n+a.length,0).toLocaleString()}건 수집 중`);
 const edge=ex==='BINANCE'?rows.at(-1).time:rows[0].time;if(edge===previous){fundNote='API 페이지 반복: 제공 범위까지만 표시';break;}previous=edge;cursor=ex==='BINANCE'?edge*1000+1:edge*1000-1;if((ex==='BINANCE'&&cursor>=Date.now())||(ex!=='BINANCE'&&edge<=all[0].time)){fundNote='캔들 구간 수집 완료';break;}await pause(ex==='BINGX'?1150:350,signal);}
 }catch(e){fundNote=e.name==='AbortError'?'사용자 중지':e.message;}rates=uniqueSorted(parts.flat());}
 if(id!==run)return;try{officialCycle=await fetchOfficialCycle(ex,symbol,signal);}catch{officialCycle=null;}try{otherCycles=await fetchAllCycles(symbol,signal);}catch{otherCycles=[];}if(id!==run)return;rebuild();renderWindow(all.length-1);busy=false;
 $('coverage').textContent=`캔들: ${date(all[0].time)} ~ ${date(all.at(-1).time)} (${candleNote}) · 펀딩비: ${rates.length?date(rates[0].time)+' ~ '+date(rates.at(-1).time):'확인된 기록 없음'} (${fundNote||'미수집'}) · 봉 내 최저 실현 펀딩비 표시; 기록 없는 구간은 공백. ${ex==='OKX'?'OKX 펀딩비 API는 최근 3개월 제공. ':''}${ex==='MEXC'?'거래량 단위: 계약 수. ':'거래량 단위: 기초자산. '}`;
 status(`${ex} ${symbol} · ${all.length.toLocaleString()}봉 / 펀딩비 ${rates.length.toLocaleString()}건`,!rates.length);
}
$('searchBtn').onclick=loadData;$('symbolInput').onkeydown=e=>{if(e.key==='Enter')loadData();};$('stopBtn').onclick=()=>controller?.abort();
$('oldestBtn').onclick=()=>renderWindow(0);$('latestBtn').onclick=()=>renderWindow(all.length-1);
let sliderTimer;$('historyPosition').oninput=()=>{clearTimeout(sliderTimer);sliderTimer=setTimeout(()=>renderWindow(+$('historyPosition').value),100);};
$('btnToggleLines').onclick=function(){showLines=!showLines;this.classList.toggle('active',showLines);schedule();};$('btnLogScale').onclick=function(){log=!log;resetCustomPriceRange(candles);candles.priceScale().applyOptions({mode:log?LC.PriceScaleMode.Logarithmic:LC.PriceScaleMode.Normal});this.classList.toggle('active',log);schedule();};
$('btnAutoFit').onclick=()=>{resetScales();chart.timeScale().fitContent();schedule();};
for(const id of ['warnThresh','extThresh'])$(id).onchange=()=>{try{rebuild();renderWindow(+$('historyPosition').value);}catch(e){status(e.message,true);}};

// 지표 패널 매니저 (indicators.js) — 모든 함수/변수 정의가 끝난 뒤 생성
studyPanels=new StudyPanelManager();
for(const p of studyPanels.active()){const s=studyPanels.primary(p);if(s&&p.stretch>0)s.getPane().setStretchFactor(p.stretch);}
loadData();