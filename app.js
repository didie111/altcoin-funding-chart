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
 crosshair:{mode:LC.CrosshairMode.Normal},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:false}},rightPriceScale:{minimumWidth:100,borderColor:'#374151'},
 timeScale:{timeVisible:true,secondsVisible:false,rightOffset:3,shiftVisibleRangeOnNewBar:false,lockVisibleTimeRangeOnResize:true,tickMarkFormatter:tickLabel},localization:{locale:'ko-KR',timeFormatter:t=>fullFmt.format(new Date(Number(t)*1000))}
});
const candles=chart.addSeries(LC.CandlestickSeries,{upColor:'#22c55e',downColor:'#ef4444',borderVisible:false,lastValueVisible:false,wickUpColor:'#22c55e',wickDownColor:'#ef4444',priceFormat:{type:'price',precision:8,minMove:0.00000001}},0);
// indicators.js(StudyPanelManager)가 패널 삭제/재추가 시 아래 변수들을 다시 대입하므로 let 이어야 합니다.
let volume=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'volume'},lastValueVisible:false},1);
let funding=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'custom',minMove:0.000001,formatter:v=>v.toFixed(6)+'%'},lastValueVisible:false},2);
function fundingLiveOptions(){return {color:'#fbbf24',lineWidth:2,lineStyle:LC.LineStyle.Dashed,title:'현재',priceFormat:{type:'custom',minMove:.000001,formatter:v=>v.toFixed(6)+'%'},lastValueVisible:true,priceLineVisible:true,priceLineStyle:LC.LineStyle.Dashed,pointMarkersVisible:false,crosshairMarkerVisible:false,autoscaleInfoProvider:original=>{const info=original();return info?.priceRange?{...info,priceRange:{minValue:Math.min(0,info.priceRange.minValue),maxValue:Math.max(0,info.priceRange.maxValue)}}:null;}};}
let fundingLive=chart.addSeries(LC.LineSeries,fundingLiveOptions(),2);
let settlementCycle=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'custom',minMove:1,formatter:v=>Number(v.toFixed(2))+'시간'},lastValueVisible:false,priceLineVisible:false},3);
let cycleMarkers=LC.createSeriesMarkers(settlementCycle,[]);
chart.panes()[3].setStretchFactor(1.5);
const cycleCaption=document.createElement('div');cycleCaption.style.cssText='padding:4px 12px;font-size:12px;color:#cbd5e1';cycleCaption.textContent='정산 주기: 기록 대기 · 8h 파랑 / 4h 주황 / 1h 빨강';$('coverage').before(cycleCaption);
let cycleHistory=[],cycleTransitions=[],cycleValues=new Map(),officialCycle=null,otherCycles=[],cycleFast=new Uint8Array(0);
// 정산 주기 배지: 코인명·시간봉 옆에 표시해 차트 도구와 겹치지 않게 함
const cycleBadge=document.createElement('div');cycleBadge.id='cycle-badge';cycleBadge.hidden=true;cycleBadge.setAttribute('role','status');$('chartIdentityControls').after(cycleBadge);
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
async function fetchAllCycles(s,signal){if(globalThis.ChartWorkspace?.embedded)return [];const out=await Promise.all(CYCLE_EXCHANGES.map(async([ex,name])=>{try{const r=await fetchOfficialCycle(ex,s,signal);return r?{ex,name,hours:r.hours,note:r.note}:null;}catch(e){if(e.name==='AbortError')throw e;return null;}}));return out.filter(Boolean);}
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
let all=[],rates=[],signals=[],mapped=new Map(),unmappedFunding=[],controller,run=0,windowStart=0,windowEnd=0,showLines=true,busy=false,selectedSignal=null,changingWindow=false;
let selectedGuideVisible=false, selectedGuideTimer, selectedCountdownTimer, selectedGuideDeadline=0, selectedGuideTime=null, selectedGuideKind='signal';

// [🚀 5일 급등락 하이라이트 상태 관리]
let surgeHighlight = {
  active: false,
  symbol: '',
  isSurge: true,
  changePct: 0,
  maxGain: 0,
  startTime: 0,
  startPrice: 0,
  currentPrice: 0,
  minLow: 0,
  minLowTime: 0,
  maxHigh: 0,
  maxHighTime: 0,
  deadline: 0,
  timer: null,
  countdownInterval: null
};

// 10초 카운트다운 알림 배지 (메인 차트 상단)
const surgeCountdownBadge = document.createElement('div');
surgeCountdownBadge.id = 'surgeCountdownBadge';
surgeCountdownBadge.hidden = true;
$('unified-chart').append(surgeCountdownBadge);

function triggerSurgeHighlight(coin) {
  clearTimeout(surgeHighlight.timer);
  clearInterval(surgeHighlight.countdownInterval);

  surgeHighlight = {
    active: true,
    symbol: coin.symbol,
    isSurge: coin.changePct >= 0,
    changePct: coin.changePct,
    maxGain: coin.maxGain,
    startTime: coin.startTime,
    startPrice: coin.startPrice,
    currentPrice: coin.currentPrice,
    minLow: coin.minLow,
    minLowTime: coin.minLowTime,
    maxHigh: coin.maxHigh,
    maxHighTime: coin.maxHighTime,
    deadline: performance.now() + 10000,
    timer: null,
    countdownInterval: null
  };

  surgeCountdownBadge.hidden = false;
  surgeHighlight.countdownInterval = setInterval(() => {
    if (!surgeHighlight.active) {
      clearInterval(surgeHighlight.countdownInterval);
      return;
    }
    schedule();
  }, 100);

  surgeHighlight.timer = setTimeout(() => {
    surgeHighlight.active = false;
    clearInterval(surgeHighlight.countdownInterval);
    if (surgeCountdownBadge) surgeCountdownBadge.hidden = true;
    schedule();
  }, 10000);

  schedule();
}

function drawSurgeHighlight(w, h, plotWidth) {
  if (!surgeHighlight.active || !all.length) {
    if (surgeCountdownBadge) surgeCountdownBadge.hidden = true;
    return;
  }
  const now = performance.now();
  if (now >= surgeHighlight.deadline) {
    surgeHighlight.active = false;
    if (surgeCountdownBadge) surgeCountdownBadge.hidden = true;
    schedule();
    return;
  }

  // 10초 카운트다운 배지 업데이트
  const remainingSec = Math.max(0, Math.ceil((surgeHighlight.deadline - now) / 1000));
  if (surgeCountdownBadge) {
    surgeCountdownBadge.hidden = false;
    const isGain = surgeHighlight.isSurge;
    surgeCountdownBadge.className = isGain ? 'surge-gain' : 'surge-loss';
    const sign = isGain ? '+' : '';
    const pctStr = sign + surgeHighlight.changePct.toFixed(2) + '%';
    const typeStr = isGain ? '🚀 급등' : '🔻 급락';
    surgeCountdownBadge.innerHTML = `
      <span>${typeStr} <strong>[${surgeHighlight.symbol}]</strong> 5일간 ${pctStr} 변동 구간 가이드</span>
      <span class="surge-timer-pill">⏱️ ${remainingSec}초</span>
    `;
  }

  const ts = chart.timeScale();
  // 5일 전 시작 시각 봉 찾기
  const idx = lowerBound(all, surgeHighlight.startTime);
  const startBar = idx < all.length ? all[idx] : all[0];
  if (!startBar) return;

  let xStart = ts.timeToCoordinate(startBar.time);
  if (xStart === null) {
    const range = ts.getVisibleLogicalRange();
    if (range && idx < windowStart + range.from) {
      xStart = 0;
    } else {
      return;
    }
  }

  const latestBar = all[all.length - 1];
  let xEnd = ts.timeToCoordinate(latestBar.time);
  if (xEnd === null) xEnd = plotWidth;

  const x1 = Math.max(0, Math.min(plotWidth, xStart));
  const x2 = Math.max(0, Math.min(plotWidth, xEnd));

  // 1) 반투명 그라데이션 하이라이트 밴드 (10초간 시각 효과)
  if (x2 > x1) {
    const grad = ctx.createLinearGradient(x1, 0, x2, 0);
    if (surgeHighlight.isSurge) {
      grad.addColorStop(0, 'rgba(34, 197, 94, 0.24)');
      grad.addColorStop(0.6, 'rgba(34, 197, 94, 0.08)');
      grad.addColorStop(1, 'rgba(34, 197, 94, 0.02)');
    } else {
      grad.addColorStop(0, 'rgba(239, 68, 68, 0.24)');
      grad.addColorStop(0.6, 'rgba(239, 68, 68, 0.08)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0.02)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(x1, 0, x2 - x1, h - 28);
  }

  // 2) 변동 시작점 수직 기준선 & 핀 배지
  if (xStart >= 0 && xStart <= plotWidth) {
    const isGain = surgeHighlight.isSurge;
    ctx.strokeStyle = isGain ? '#22c55e' : '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 3]);
    ctx.beginPath();
    ctx.moveTo(xStart, 0);
    ctx.lineTo(xStart, h - 28);
    ctx.stroke();
    ctx.setLineDash([]);

    // 시작점 상단 핀 배지
    const pInfo = pricePane();
    const pinY = pInfo ? pInfo.top + 28 : 36;
    const startPriceStr = (typeof ScannerEngine !== 'undefined') ? ScannerEngine.formatPrice(surgeHighlight.startPrice) : surgeHighlight.startPrice.toFixed(4);
    const startText = (isGain ? '📍 상승 시작: $' : '📍 하락 시작: $') + startPriceStr;

    ctx.font = 'bold 11px sans-serif';
    const textWidth = ctx.measureText(startText).width;
    const boxW = textWidth + 18;
    const boxH = 22;
    const boxX = Math.max(4, Math.min(plotWidth - boxW - 4, xStart - boxW / 2));

    ctx.fillStyle = isGain ? '#15803d' : '#b91c1c';
    ctx.beginPath();
    ctx.roundRect(boxX, pinY, boxW, boxH, 5);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(startText, boxX + boxW / 2, pinY + 15);
  }

  // 3) 극값(최고점 / 최저점) 위치 표시
  const peakTime = surgeHighlight.isSurge ? surgeHighlight.maxHighTime : surgeHighlight.minLowTime;
  const peakPrice = surgeHighlight.isSurge ? surgeHighlight.maxHigh : surgeHighlight.minLow;
  if (peakTime && peakTime !== surgeHighlight.startTime) {
    const pIdx = lowerBound(all, peakTime);
    const pBar = all[pIdx] || all[all.length - 1];
    const xPeak = ts.timeToCoordinate(pBar.time);
    if (xPeak !== null && xPeak >= 0 && xPeak <= plotWidth) {
      const isGain = surgeHighlight.isSurge;
      ctx.strokeStyle = isGain ? '#86efac' : '#fca5a5';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(xPeak, 0);
      ctx.lineTo(xPeak, h - 28);
      ctx.stroke();
      ctx.setLineDash([]);

      const pInfo = pricePane();
      const peakPinY = pInfo ? pInfo.top + 54 : 62;
      const peakPriceStr = (typeof ScannerEngine !== 'undefined') ? ScannerEngine.formatPrice(peakPrice) : peakPrice.toFixed(4);
      const peakText = (isGain ? '🔺 5일 최고: $' : '🔻 5일 최저: $') + peakPriceStr;

      ctx.font = 'bold 11px sans-serif';
      const tw = ctx.measureText(peakText).width;
      const bW = tw + 14;
      const bX = Math.max(4, Math.min(plotWidth - bW - 4, xPeak - bW / 2));

      ctx.fillStyle = isGain ? '#166534' : '#991b1b';
      ctx.beginPath();
      ctx.roundRect(bX, peakPinY, bW, 20, 4);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(peakText, bX + bW / 2, peakPinY + 14);
    }
  }
}

const WINDOW=10000, duration=TimeframeEngine.seconds;
let dateNavigation=null, navigationController=null, loadedMarket=null, chartDateFocus=null, chartBacktestResult=null;
let historyState={id:0,buffer:[],pending:new Set(),exhausted:new Set()};
let paneScaleSeries=[candles,volume,funding,settlementCycle];
let studyPanels=null,lastFundingSignalVisibility;
const overlay=document.createElement('canvas');overlay.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:4';$('unified-chart').append(overlay);
const guideCountdown=document.createElement('div');guideCountdown.id='chartLocationGuide';guideCountdown.hidden=true;guideCountdown.style.cssText='position:absolute;top:12px;pointer-events:none;z-index:6;padding:7px 12px;background:#fbbf24;color:#111827;border:2px solid #fffbeb;border-radius:8px;font-size:14px;font-weight:800;white-space:nowrap;box-shadow:0 2px 10px #000b;transform:translateX(-50%)';guideCountdown.setAttribute('role','timer');guideCountdown.setAttribute('aria-label','선택 신호 기준선 남은 시간');$('unified-chart').append(guideCountdown);
function updateGuideCountdown(){const seconds=Math.max(0,Math.ceil((selectedGuideDeadline-performance.now())/1000));const label=(selectedGuideKind==='date'?'이동 위치 · ':'기준선 ')+seconds+'초';if(guideCountdown.textContent!==label)guideCountdown.textContent=label;}
function clearLocationGuide(){clearTimeout(selectedGuideTimer);clearInterval(selectedCountdownTimer);selectedGuideVisible=false;selectedGuideTime=null;guideCountdown.hidden=true;}
function showLocationGuide(time,kind='signal'){
 clearLocationGuide();selectedGuideTime=time;selectedGuideKind=kind;selectedGuideVisible=true;selectedGuideDeadline=performance.now()+5000;
 guideCountdown.style.background=kind==='date'?'#60a5fa':'#fbbf24';guideCountdown.setAttribute('aria-label',kind==='date'?'날짜 이동 위치 남은 시간':'선택 신호 기준선 남은 시간');
 updateGuideCountdown();selectedCountdownTimer=setInterval(updateGuideCountdown,100);
 selectedGuideTimer=setTimeout(()=>{clearLocationGuide();schedule();},5000);schedule();
}
const ctx=overlay.getContext('2d');let frame=0,paneLayoutCache=null;
const date=t=>fullFmt.format(new Date(t*1000));
const status=(s,error=false)=>{$('status-msg').textContent=s;$('status-msg').classList.toggle('error',error);globalThis.ChartWorkspace?.reportStatus(s,error);};
function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});}
// [최적화] draw 한 번 안에서 getPaneLayout()이 6번 넘게 불리며 매번 getBoundingClientRect(강제 리플로우)를 했음 -> 1회로 축소
function draw(){paneLayoutCache=computePaneLayout();updatePaneHover();try{drawInner();}finally{paneLayoutCache=null;}}
// 변경 없는 스타일은 다시 쓰지 않아 불필요한 스타일 재계산을 막음
function setStyle(el,k,v){const c=el._st||(el._st={});if(c[k]!==v){c[k]=v;el.style[k]=v;}}
function drawInner(){const w=$('unified-chart').clientWidth,h=$('unified-chart').clientHeight,dpr=devicePixelRatio||1,plotWidth=chart.timeScale().width();
 if(overlay.width!==Math.round(w*dpr)||overlay.height!==Math.round(h*dpr)){overlay.width=Math.round(w*dpr);overlay.height=Math.round(h*dpr);overlay.style.width=w+'px';overlay.style.height=h+'px';}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);guideCountdown.hidden=true;drawCycleBands(w,h);drawRuler(w,h);drawSurgeHighlight(w,h,plotWidth);if(globalThis.BacktestOverlay?.matches(chartBacktestResult,loadedMarket))globalThis.BacktestOverlay.draw(ctx,chartBacktestResult,{chart,series:candles,bars:all,windowStart,pane:pricePane(),width:plotWidth});placeChartSymbol();placeChartNavigation();placeChartClock();placeLegendToggle();studyPanels?.position();syncFundingSignalVisibility();chartDrawings?.render();globalThis.ChartWorkspace?.controlsChanged({ruler:chartDrawings?.tool==='ruler',lines:showLines});
 if(selectedGuideVisible&&selectedGuideTime!==null&&(selectedGuideKind==='date'||selectedSignal?.rate===undefined||fundingSignalsVisible())){const x=chart.timeScale().timeToCoordinate(selectedGuideTime);if(x!==null&&x>=0&&x<=plotWidth){guideCountdown.hidden=false;guideCountdown.style.left=Math.max(65,Math.min(plotWidth-65,x))+'px';ctx.strokeStyle=selectedGuideKind==='date'?'#60a5fa':'#fbbf24';ctx.lineWidth=2;ctx.setLineDash([6,3]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h-28);ctx.stroke();ctx.lineWidth=1;}}
 if(!showLines||!fundingSignalsVisible())return;
 const range=chart.timeScale().getVisibleRange();if(!range)return;
 const ts=chart.timeScale(),iEnd=lowerBound(signals,Number(range.to)+1),pathExt=new Path2D(),pathWarn=new Path2D();let last=-100,i=lowerBound(signals,Number(range.from)),any=false;
 while(i<iEnd){const s=signals[i],x=ts.timeToCoordinate(s.time);if(x===null){i++;continue;}
  if(x-last<2){let lo=i+1,hi=iEnd;while(lo<hi){const m=(lo+hi)>>>1,xm=ts.timeToCoordinate(signals[m].time);if(xm!==null&&xm-last<2)lo=m+1;else hi=m;}i=lo;continue;}
  last=x;any=true;const pth=s.type==='EXTREME'?pathExt:pathWarn;pth.moveTo(x,0);pth.lineTo(x,h-28);i++;}
 if(any){ctx.setLineDash([3,4]);ctx.lineWidth=1;ctx.strokeStyle='#ef444480';ctx.stroke(pathWarn);ctx.strokeStyle='#a855f780';ctx.stroke(pathExt);}
}

const rulerColors=RulerSettings.create();
let chartDrawings;
let rulerEnabled=false,rulerStart=null,rulerEnd=null,rulerLocked=false,shiftHeld=false,rulerTemporary=false,rulerDragging=false,rulerPointer=null;
const rulerBtn=$('btnRuler');rulerBtn.className='btn-toggle';rulerBtn.textContent='📏 줄자';rulerBtn.title='드래그로 측정 · Shift+드래그: 임시 줄자 · Esc 종료';rulerBtn.setAttribute('aria-pressed','false');
const rulerLabel=document.createElement('div');rulerLabel.id='rulerMeasurementLabel';rulerLabel.hidden=true;rulerLabel.style.cssText='position:absolute;pointer-events:none;z-index:7;background:#2563eb;color:#fff;border:1px solid #93c5fd;padding:8px 12px;border-radius:4px;font-size:13px;font-weight:700;line-height:1.6;text-align:center;white-space:pre-line;box-shadow:0 2px 8px #0009;max-width:280px';$('unified-chart').append(rulerLabel);
function priceChange(start,end){if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0)return null;return {difference:end-start,percent:(end-start)/start*100};}
function clearRuler(){rulerStart=null;rulerEnd=null;rulerLocked=false;rulerTemporary=false;rulerLabel.hidden=true;schedule();}
function rulerInteraction(){const active=rulerEnabled||shiftHeld||rulerDragging||(typeof chartDrawings!=='undefined'&&Boolean(chartDrawings?.capturesChart()));chart.applyOptions({handleScroll:active?false:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:true},handleScale:active?false:{mouseWheel:true,pinch:true,axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:{time:true,price:false}}});$('unified-chart').style.cursor=active?'crosshair':'';}
function endRulerDrag(){if(rulerPointer!==null&&$('unified-chart').hasPointerCapture(rulerPointer))$('unified-chart').releasePointerCapture(rulerPointer);rulerDragging=false;rulerPointer=null;rulerInteraction();}
function toggleRuler(enabled){if(enabled&&chartDrawings?.capturesChart())chartDrawings.setTool('cross');endRulerDrag();rulerEnabled=enabled;rulerBtn.classList.toggle('active',enabled);rulerBtn.setAttribute('aria-pressed',String(enabled));clearRuler();rulerInteraction();if(enabled)status('줄자: 가격 차트에서 누른 채 드래그하세요. Shift+드래그도 가능 · Esc 종료');}
rulerBtn.onclick=()=>toggleRuler(!rulerEnabled);
function typingTarget(t){return t instanceof Element&&Boolean(t.closest('input,textarea,select,[contenteditable="true"]'));}
document.addEventListener('keydown',e=>{if(typingTarget(e.target))return;if(e.key==='Shift'&&!shiftHeld&&!chartDrawings?.capturesChart()){shiftHeld=true;rulerInteraction();}if(e.key==='Escape'){shiftHeld=false;toggleRuler(false);}});
document.addEventListener('keyup',e=>{if(e.key==='Shift'){shiftHeld=false;rulerInteraction();}});
window.addEventListener('blur',()=>{shiftHeld=false;if(rulerDragging){endRulerDrag();rulerLocked=true;}rulerInteraction();});
const rulerHost=$('unified-chart');
// A chosen date remains stable during backfill until the user navigates the chart.
rulerHost.addEventListener('pointerdown',event=>{
 if(event.button!==0||rulerEnabled||event.shiftKey||event.target.closest?.('[data-panel-ui],[data-chart-nav],[data-chart-identity],[data-chart-fullscreen],[data-pane-scale],[data-drawing-ui]'))return;
 if(event.clientX-rulerHost.getBoundingClientRect().left<chart.timeScale().width())chartDateFocus=null;
});
// Keep the symbol tied to the chart being loaded, rather than an unsubmitted input edit.
const chartIdentityControls=$('chartIdentityControls');
const chartSymbolLabel=$('chartSymbolLabel');
for (const type of ['pointerdown', 'dblclick', 'wheel']) {
  chartIdentityControls.addEventListener(type, e => {
    e.stopPropagation();
    if (type === 'wheel') e.preventDefault();
  });
}
const priceClock=document.createElement('div');priceClock.id='barCountdown';priceClock.hidden=true;priceClock.setAttribute('aria-label','현재가 및 봉 마감까지 남은 시간');rulerHost.append(priceClock);
const wallClock=document.createElement('div');wallClock.id='chartClock';wallClock.setAttribute('aria-label','한국 표준시');rulerHost.append(wallClock);
const wallTimeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
function placeChartClock(){
 const now=Date.now()/1000,latest=all.at(-1),pane=pricePane(),step=duration[loadedMarket?.int],width=chart.timeScale().width();
 wallClock.textContent=wallTimeFormat.format(new Date())+' UTC+9';setStyle(wallClock,'right','4px');setStyle(wallClock,'bottom','3px');
 const y=latest?candles.priceToCoordinate(latest.close):null;
 const live=latest&&step&&latest.time<=now&&TimeframeEngine.end(latest.time,loadedMarket.int)>now;
 priceClock.hidden=!pane||studyPanels?.priceCollapsed()||y===null||y<0||y>pane.height||windowEnd!==all.length;
 if(priceClock.hidden)return;
 priceClock.replaceChildren(Object.assign(document.createElement('span'),{textContent:latest.close.toFixed(8)}),Object.assign(document.createElement('span'),{textContent:live?ChartData.countdown(latest.time,step,now,TimeframeEngine.end(latest.time,loadedMarket.int)):'00:00'}));
 priceClock.dataset.live=String(Boolean(live));priceClock.title=live?'현재 '+$('intervalSelect').selectedOptions[0].text+' 봉 마감까지 남은 시간':'다음 실시간 캔들 확인 대기';
 setStyle(priceClock,'left',width+'px');setStyle(priceClock,'width',Math.max(70,rulerHost.clientWidth-width)+'px');setStyle(priceClock,'top',pane.top+Math.max(0,Math.min(pane.height-30,y-13))+'px');setStyle(priceClock,'background',latest.close>=latest.open?'#22c55e':'#ef4444');
}
setInterval(()=>{if(!document.hidden)placeChartClock();},1000);
function placeChartSymbol(){
  const pane=pricePane();
  const visible=Boolean(chartSymbolLabel.textContent && pane && !studyPanels?.priceCollapsed());
  chartIdentityControls.hidden=!visible;
  chartSymbolLabel.hidden=!visible;
  rulerHost.classList.toggle('chart-has-symbol',visible);
  if(!visible)return;
  setStyle(chartIdentityControls,'maxWidth',Math.max(0,chart.timeScale().width()-160)+'px');
}

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
let hoveredPaneIndex = -1, hoveredPriceAxisPaneIndex = -1;
// 최신 차트를 열었을 때의 오른쪽 끝 위치(마지막 봉 기준 봉 수). 이 위치에서 벗어나면 이동한 것으로 판단
let latestOffset = null;
let hoverPoint = null, hoverRaf = 0;
function updatePaneHover() {
  hoveredPaneIndex = hoveredPriceAxisPaneIndex = -1;
  if (!hoverPoint) return;
  const box = rulerHost.getBoundingClientRect();
  const x = hoverPoint.x - box.left, y = hoverPoint.y - box.top;
  if (x < 0 || x >= box.width) return;
  hoveredPaneIndex = getPaneInfoAtY(y)?.index ?? -1;
  if (x >= chart.timeScale().width()) hoveredPriceAxisPaneIndex = hoveredPaneIndex;
}
rulerHost.addEventListener('pointermove', e => {
  hoverPoint = { x: e.clientX, y: e.clientY };
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    if (!hoverPoint) return;
    const previous = hoveredPaneIndex, previousAxis = hoveredPriceAxisPaneIndex;
    updatePaneHover();
    if (previous !== hoveredPaneIndex || previousAxis !== hoveredPriceAxisPaneIndex) schedule();
  });
});
rulerHost.addEventListener('pointerleave', () => {
  hoverPoint = null;
  hoveredPaneIndex = hoveredPriceAxisPaneIndex = -1; schedule();
});

function paneAtY(y) {
  return getPaneInfoAtY(y)?.index ?? -1;
}

function pricePane() {
  return getPaneLayout().find(pane => pane.series === candles) || null;
}

const manualPriceSpans = new WeakMap();

function holdPriceAxisWidth() {
  const series = paneScaleSeries[0];
  const width = series ? series.priceScale().width() : 0;
  if (width > chart.options().rightPriceScale.minimumWidth) {
    chart.applyOptions({ rightPriceScale: { minimumWidth: width } });
  }
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
}

let wheelPending = null, wheelRaf = 0;
function flushWheel() {
  wheelRaf = 0;
  const p = wheelPending;
  wheelPending = null;
  if (!p) return;
  holdPriceAxisWidth();
  zoomPanePrice(p.pane, p.y - p.pane.top, p.factor);
  schedule();
}
// 차트 안의 휠은 라이브러리의 시간축 줌을 사용합니다. 자동 가격축은 보이는 봉에 맞춰 조정됩니다.
// 오른쪽 가격 축에서만 해당 패널의 가격 범위를 수동 확대/축소합니다.
rulerHost.addEventListener('wheel', e => {
  if (e.target instanceof Element && e.target.closest('[data-chart-fullscreen],[data-pane-scale],[data-chart-identity],[data-drawing-ui]')) return;
  if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;
  const box = rulerHost.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
  const pane = getPaneInfoAtY(y);
  if (!pane?.series || x < 0 || x >= box.width) return;
  if (rulerEnabled || shiftHeld || rulerDragging) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  // Let Lightweight Charts keep the candle under the pointer fixed while zooming time.
  // Do not set a manual price range when the wheel is over the chart plot.
  if (x < chart.timeScale().width()) {chartDateFocus=null;return;}
  e.preventDefault();
  e.stopImmediatePropagation();
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
  if (e.target instanceof Element && e.target.closest('[data-chart-fullscreen],[data-pane-scale],[data-chart-identity],[data-drawing-ui]')) return;
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
rulerHost.addEventListener('pointerdown',e=>{if(e.target instanceof Element&&e.target.closest('[data-chart-nav],[data-chart-fullscreen],[data-pane-scale],[data-chart-identity],[data-drawing-ui]'))return;if(e.button!==0||chartDrawings?.capturesChart())return;const active=rulerEnabled||e.shiftKey||shiftHeld;if(!active){if(rulerTemporary)clearRuler();return;}const point=pointerPrice(e);if(!point)return;e.preventDefault();e.stopImmediatePropagation();rulerTemporary=!rulerEnabled;rulerStart=point;rulerEnd=point;rulerLocked=false;rulerDragging=true;rulerPointer=e.pointerId;rulerHost.setPointerCapture(e.pointerId);rulerInteraction();schedule();},{capture:true});
rulerHost.addEventListener('pointermove',e=>{if(!rulerDragging||e.pointerId!==rulerPointer)return;e.preventDefault();e.stopImmediatePropagation();const point=pointerPrice(e,true);if(point){rulerEnd=point;schedule();}},{capture:true});
rulerHost.addEventListener('pointerup',e=>{if(!rulerDragging||e.pointerId!==rulerPointer)return;e.preventDefault();e.stopImmediatePropagation();const point=pointerPrice(e,true);if(point)rulerEnd=point;rulerLocked=true;endRulerDrag();status('줄자 측정 완료 · 다시 드래그해 측정 / Esc 종료');schedule();},{capture:true});
rulerHost.addEventListener('pointercancel',()=>{if(rulerDragging){endRulerDrag();clearRuler();}});
let rulerVolumeData=null,rulerVolumePrefix=[];
function measureDetails(a,b){if(rulerVolumeData!==all){rulerVolumeData=all;rulerVolumePrefix=[0];for(const c of all)rulerVolumePrefix.push(rulerVolumePrefix.at(-1)+(Number.isFinite(c.volume)?c.volume:0));}
 const ai=Math.max(0,Math.min(all.length-1,Math.round(a.index))),bi=Math.max(0,Math.min(all.length-1,Math.round(b.index))),lo=Math.min(ai,bi),hi=Math.max(ai,bi);const seconds=all[ai]&&all[bi]?Math.abs(all[bi].time-all[ai].time):0;const days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);return {bars:Math.round(b.index-a.index),period:[days?days+'일':'',hours?hours+'시간':'',minutes?minutes+'분':''].filter(Boolean).join(' ')||'0분',volume:(rulerVolumePrefix[hi+1]||0)-(rulerVolumePrefix[lo]||0),start:all[ai]?.time,end:all[bi]?.time};}
function drawRuler(w,h){if(!rulerStart||!rulerEnd)return;
 const pl=pricePane();if(!pl)return;
 const x1=chart.timeScale().logicalToCoordinate(rulerStart.index-windowStart),x2=chart.timeScale().logicalToCoordinate(rulerEnd.index-windowStart),y1=candles.priceToCoordinate(rulerStart.price),y2=candles.priceToCoordinate(rulerEnd.price);
 if([x1,x2,y1,y2].some(v=>v===null))return;const change=priceChange(rulerStart.price,rulerEnd.price);if(!change)return;
 const color=rulerColors.color(rulerStart.price,rulerEnd.price);const ph=pl.height,plotWidth=chart.timeScale().width();ctx.save();ctx.translate(0,pl.top);ctx.beginPath();ctx.rect(0,0,plotWidth,ph);ctx.clip();ctx.setLineDash([]);ctx.strokeStyle=color;ctx.fillStyle=color+'33';ctx.lineWidth=1.5;ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctx.beginPath();const mx=(x1+x2)/2,my=(y1+y2)/2;ctx.moveTo(x1,my);ctx.lineTo(x2,my);ctx.moveTo(mx,y1);ctx.lineTo(mx,y2);ctx.stroke();for(const [ax,ay,dx,dy] of [[x2,my,-Math.sign(x2-x1)*6,0],[mx,y2,0,-Math.sign(y2-y1)*6]]){ctx.beginPath();ctx.moveTo(ax+dx+(dy?4:0),ay+dy+(dx?4:0));ctx.lineTo(ax,ay);ctx.lineTo(ax+dx-(dy?4:0),ay+dy-(dx?4:0));ctx.stroke();}
 for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.beginPath();ctx.fillStyle=color;ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();}ctx.restore();

 const details=measureDetails(rulerStart,rulerEnd),sign=change.percent>=0?'+':'';rulerLabel.textContent=`${change.difference>=0?'+':''}${change.difference.toPrecision(6)} (${sign}${change.percent.toFixed(2)}%)\n${details.bars}봉 · ${details.period}\n거래량 ${new Intl.NumberFormat('ko-KR',{notation:'compact',maximumFractionDigits:2}).format(details.volume)}`;
 rulerLabel.style.background=color;rulerLabel.style.borderColor=color;rulerLabel.style.maxWidth=Math.max(40,Math.min(280,plotWidth-16))+'px';rulerLabel.hidden=false;const lw=rulerLabel.offsetWidth,lh=rulerLabel.offsetHeight;rulerLabel.style.left=Math.max(8,Math.min(plotWidth-lw-8,(x1+x2)/2-lw/2))+'px';rulerLabel.style.top=pl.top+Math.max(6,Math.min((ph>=lh+12?ph:h-pl.top)-lh-6,Math.min(y1,y2)-lh-8))+'px';
 ctx.save();ctx.translate(0,pl.top);ctx.setLineDash([]);ctx.font='bold 11px sans-serif';ctx.textAlign='left';for(const [price,y] of [[rulerStart.price,y1],[rulerEnd.price,y2]]){if(y<0||y>ph)continue;ctx.fillStyle=color;ctx.fillRect(plotWidth,y-9,w-plotWidth,18);ctx.fillStyle='#fff';ctx.fillText(price.toPrecision(7),plotWidth+4,y+4);}ctx.restore();
}

const chartNavigation=document.createElement('div');chartNavigation.id='chartNavigation';chartNavigation.dataset.chartNav='true';chartNavigation.setAttribute('role','toolbar');chartNavigation.setAttribute('aria-label','차트 확대 및 좌우 이동');chartNavigation.style.cssText='position:absolute;z-index:9;display:flex;gap:3px;transform:translateX(-100%);padding:2px;border-radius:5px;background:#111827dd;box-shadow:0 1px 8px #0006;pointer-events:auto';
$('unified-chart').append(chartNavigation);
function moveChartRange(range){if(!all.length)return;const absolute={from:range.from+windowStart,to:range.to+windowStart},middle=(absolute.from+absolute.to)/2;
 // [최적화] 최신봉 오른쪽 여백/데이터 끝을 넘겨 줌아웃할 때마다 10000봉 setData를 다시 하던 문제:
 // 윈도우 위치가 실제로 바뀔 때만 재렌더하고, 아니면 가시 범위만 바꿈
 const center=Math.max(0,Math.min(all.length-1,middle));
 if((absolute.from<windowStart||absolute.to>=windowEnd)&&windowStartFor(center)!==windowStart)renderWindow(center,false,240,absolute);else chart.timeScale().setVisibleLogicalRange(range);
 {const hv=String(Math.max(0,Math.min(all.length-1,Math.round(middle))));if($('historyPosition').value!==hv)$('historyPosition').value=hv;}schedule();}
function navigationRange(range,action){const span=Math.max(8,range.to-range.from),center=(range.from+range.to)/2;if(action==='left'||action==='right'){const shift=span*.25*(action==='left'?-1:1);return {from:range.from+shift,to:range.to+shift};}
 const width=Math.max(8,Math.min(Math.max(10000,all.length*1.5),span*(action==='in'?.8:1.25)));return {from:center-width/2,to:center+width/2};}
function navigateChart(action){if(!all.length)return;chartDateFocus=null;
 if(action==='reset'){resetScales();const span=Math.min(180,Math.max(20,all.length*1.2)),end=all.length-1;latestOffset=5;moveChartRange({from:end-span+5-windowStart,to:end+5-windowStart});}
 else {const range=chart.timeScale().getVisibleLogicalRange();if(range)moveChartRange(navigationRange(range,action));}}
for(const [action,label,title] of [['out','-','축소'],['in','+','확대'],['left','<','이전 구간으로 이동'],['right','>','다음 구간으로 이동'],['reset','R','최근 차트로 이동 및 화면 초기화']]){
 const button=document.createElement('button');button.type='button';button.dataset.nav=action;button.textContent=label;button.title=title;button.setAttribute('aria-label',title);button.style.cssText='width:24px;height:22px;padding:0;background:#263244;border:1px solid #475569;color:#e2e8f0;border-radius:3px;font-size:16px;line-height:20px';
 button.onclick=e=>{e.stopPropagation();navigateChart(action);};button.onmouseenter=()=>button.style.background='#475569';button.onmouseleave=()=>button.style.background='#263244';chartNavigation.append(button);
}
chartNavigation.addEventListener('focusin',schedule);chartNavigation.addEventListener('focusout',schedule);
chartNavigation.addEventListener('pointerdown',e=>e.stopPropagation());chartNavigation.addEventListener('dblclick',e=>e.stopPropagation());
// 이동 버튼(-, +, <, >, R): 맨 아래 패널 전체(가격 축 포함)에 마우스를 올릴 때만 표시.
// 지표 패널이 모두 없으면 맨 아래 패널 = 가격(메인) 차트가 됩니다.
function placeChartNavigation(){
  const layout = getPaneLayout().filter(p => p.height > 1);
  if (!layout.length) { setStyle(chartNavigation, 'display', 'none'); return; }
  const bottomPane = layout.reduce((a, b) => (b.bottom > a.bottom ? b : a));
  const bottom = bottomPane.bottom;
  const range = chart.timeScale().getVisibleLogicalRange();
  const hovered=hoveredPaneIndex===bottomPane.index || Boolean(chartNavigation.querySelector(':focus-visible'));
  setStyle(chartNavigation, 'display', all.length&&range&&hovered ? 'flex' : 'none');
  setStyle(chartNavigation, 'left', Math.max(8, chart.timeScale().width() - 8) + 'px');
  setStyle(chartNavigation, 'top', Math.max(4, bottom - 32) + 'px');
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
  const symbolOffset = !chartIdentityControls.hidden && pricePane()?.top === top ? 28 : 0;
  setStyle(legendToggle, 'top', top + symbolOffset + (legendCollapsed ? 5 : 32) + 'px');
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

// One fullscreen surface for the price chart and every active indicator pane.
const chartFullscreenZone = document.createElement('div');
chartFullscreenZone.id = 'chartFullscreenZone';
chartFullscreenZone.dataset.chartFullscreen = 'true';
const chartFullscreenBtn = document.createElement('button');
chartFullscreenBtn.id = 'chartFullscreenBtn';
chartFullscreenBtn.type = 'button';
chartFullscreenZone.append(chartFullscreenBtn);
rulerHost.append(chartFullscreenZone);
const chartWorkspace=$('chartWorkspace');
let chartFullscreenPending = false;
function isChartFullscreen() {
  return document.fullscreenElement === chartWorkspace || chartWorkspace.classList.contains('chart-fullscreen-fallback');
}
function syncChartFullscreen() {
  const workspaceActive = isChartFullscreen();
  globalThis.ChartWorkspace?.syncWorkspaceFullscreen(workspaceActive);
  const cellState = globalThis.ChartWorkspace?.fullscreenState();
  const active = cellState ? cellState.active : workspaceActive;
  chartWorkspace.classList.toggle('chart-is-fullscreen', workspaceActive || active);
  const label = cellState ? cellState.label : active ? '차트 전체화면 해제' : '가격 차트와 모든 지표 전체화면';
  chartFullscreenBtn.title = label;
  chartFullscreenBtn.setAttribute('aria-label', label);
  chartFullscreenBtn.setAttribute('aria-pressed', String(active));
  const path = active
    ? 'M3 7h4V3m10 4h-4V3M3 13h4v4m10-4h-4v4'
    : 'M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4';
  chartFullscreenBtn.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + path + '"/></svg>';
  schedule();
}
async function toggleChartFullscreen({workspace=false}={}) {
  if(!workspace&&globalThis.ChartWorkspace?.requestFullscreen())return;
  if (chartFullscreenPending) return;
  chartFullscreenPending = true;
  chartFullscreenBtn.disabled = true;
  try {
    if (isChartFullscreen()) {
      if (document.fullscreenElement === chartWorkspace) await document.exitFullscreen();
      chartWorkspace.classList.remove('chart-fullscreen-fallback');
    } else {
      // Pane-only maximization is a separate control; include the full layout here.
      studyPanels?.restoreMaximized();
      if (document.fullscreenEnabled && chartWorkspace.requestFullscreen) {
        try {await chartWorkspace.requestFullscreen();}
        catch {chartWorkspace.classList.add('chart-fullscreen-fallback');}
      } else chartWorkspace.classList.add('chart-fullscreen-fallback');
    }
  } finally {
    chartFullscreenPending = false;
    chartFullscreenBtn.disabled = false;
    syncChartFullscreen();
  }
}
chartFullscreenBtn.onclick = event => {event.stopPropagation(); void toggleChartFullscreen();};
for (const type of ['pointerdown', 'dblclick']) chartFullscreenZone.addEventListener(type, event => event.stopPropagation());
document.addEventListener('fullscreenchange', syncChartFullscreen);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (globalThis.ChartWorkspace?.restoreMaximized() || globalThis.ChartWorkspace?.exitWorkspaceFullscreen()) {event.preventDefault();return;}
  if (isChartFullscreen()) void toggleChartFullscreen({workspace:true});
});
syncChartFullscreen();


function windowStartFor(c){return Math.max(0,Math.min(all.length-WINDOW,Math.floor(c-WINDOW/2)));}
function lowerBound(a,t){let l=0,r=a.length;while(l<r){const m=(l+r)>>>1;if(a[m].time<t)l=m+1;else r=m;}return l;}
function thresholds(){const warn=Number($('warnThresh').value),ext=Number($('extThresh').value);if(!$('warnThresh').value||!$('extThresh').value||!Number.isFinite(warn)||!Number.isFinite(ext)||ext>warn)throw Error('극단 경고는 1차 경고 이하의 숫자로 입력하세요.');return {warn,ext};}
function rebuild(){const {warn,ext}=thresholds();
 const result=FundingEngine.mapToCandles(all,rates,duration[$('intervalSelect').value],warn,ext,time=>TimeframeEngine.end(time,$('intervalSelect').value));
 mapped=result.mapped;signals=result.signals;unmappedFunding=result.unmapped;
 rebuildCycles();renderList();renderFundingBoard();}

function observedCycles(records){const periods=[];const allowed=[1,2,4,8,12,24];for(let i=1;i<records.length;i++){const seconds=records[i].time-records[i-1].time;const hours=allowed.find(h=>Math.abs(seconds-h*3600)<=60);periods.push({start:records[i-1].time,end:records[i].time,hours:hours??null});}
 for(let i=0;i<periods.length;i++){const p=periods[i],before=periods[i-1],after=periods[i+1];if(before&&after&&before.hours===after.hours&&before.hours&&p.hours>before.hours){p.hours=null;p.gap=true;}}
 return periods;}
function currentCyclePeriod(){const session=fundingSession,entry=session?.entries.get(session.ex);return ChartData.currentCycle(entry?.quote,officialCycle?.hours,rates);}
function liveCycleValue(c){const p=currentCyclePeriod(),step=duration[loadedMarket?.int??$('intervalSelect').value];return p&&TimeframeEngine.end(c.time,loadedMarket?.int??$('intervalSelect').value)>p.start&&c.time<p.end?{hours:p.hours,current:true,source:p.source}:cycleValues.get(c.time);}
function rebuildCycles(){cycleHistory=observedCycles(rates);cycleTransitions=[];cycleValues=new Map();let previous=null;
 for(const p of cycleHistory){if(p.hours===null){previous=null;continue;}if(previous!==null&&previous!==p.hours)cycleTransitions.push({time:p.end,from:previous,to:p.hours});previous=p.hours;}
 let i=0;const seconds=duration[$('intervalSelect').value];for(const c of all){while(i<cycleHistory.length&&cycleHistory[i].end<=c.time)i++;let value=null,unknown=false;for(let j=i;j<cycleHistory.length&&cycleHistory[j].start<TimeframeEngine.end(c.time,$('intervalSelect').value);j++){const p=cycleHistory[j];if(p.end<=c.time)continue;if(p.hours===null)unknown=true;else value=value===null?p.hours:Math.min(value,p.hours);}
 if(value!==null)cycleValues.set(c.time,{hours:value,mixed:unknown});}
 const current=currentCyclePeriod();if(current)for(const c of all){if(TimeframeEngine.end(c.time,$('intervalSelect').value)>current.start&&c.time<current.end)cycleValues.set(c.time,{hours:current.hours,current:true,source:current.source});}
 cycleFast=new Uint8Array(all.length);for(let k=0;k<all.length;k++){const v=cycleValues.get(all[k].time);if(v&&v.hours<8)cycleFast[k]=Math.round(v.hours);}
 const latest=cycleHistory.at(-1);
 const official=(officialCycle?.hours?` · 거래소 공식 현재 주기: ${officialCycle.hours}시간${officialCycle.note}`:'')+(otherCycles.length?` · 거래소별 현재 주기: ${otherCycles.map(o=>o.name+' '+o.hours+'시간').join(' / ')}`:'');
 const mismatch=officialCycle?.hours&&latest?.hours&&latest.hours!==officialCycle.hours?` · ⚠ 이력 관측(${latest.hours}시간)과 공식(${officialCycle.hours}시간)이 다름: 최근 주기가 바뀌었거나 거래소 선택을 확인하세요`:'';
 cycleCaption.textContent=`정산 주기(기록 간격 관측): ${latest?.hours?latest.hours+'시간':'확인 불가'}${official}${mismatch} · 최신 미정산 구간: ${current?current.hours+'시간 ('+(current.source==='official'?'공식 현재 주기':'최근 정산 간격 기준')+')':'주기 확인 대기'} · 전환 ${cycleTransitions.length}회 · 8h 파랑 / 4h 주황 / 1h 빨강 · 일봉 등은 봉 내 최소 간격 · 데이터 누락 시 실제 정책과 다를 수 있음`;updateCycleBadge();}
function cycleColor(h){return h===1?'#ef4444':h===4?'#f59e0b':h===8?'#3b82f6':'#a78bfa';}
function renderCycles(part){if(!settlementCycle)return;settlementCycle.setData(part.map(c=>{const p=cycleValues.get(c.time);return p?{time:c.time,value:p.hours,color:cycleColor(p.hours)}:{time:c.time};}));
 const map=new Map();for(const t of cycleTransitions){const i=lowerBound(all,t.time);const k=all[i]?.time===t.time?all[i]:all[i-1];if(k&&k.time>=part[0].time&&k.time<=part.at(-1).time)map.set(k.time,{time:k.time,position:'aboveBar',color:cycleColor(t.to),shape:'arrowDown',size:2,text:'⚡ 정산 '+t.from+'h → '+t.to+'h'});}
 cycleMarkers?.setMarkers(map.size<=150?[...map.values()]:[]);}

function resetScales(){
 for(const series of paneScaleSeries){
  resetCustomPriceRange(series);
  series.priceScale().applyOptions({autoScale:true,scaleMargins:{top:0.12,bottom:0.12}});
 }
}
function centeredRange(index,span=240){return {from:index-span/2,to:index+span/2};}

function findNearestBarIndex(t) {
  if (!all.length) return 0;
  const sec = Number(t);
  const intSec = duration[loadedMarket?.int ?? $('intervalSelect').value] || 300;
  const next = lowerBound(all, sec);
  if (next < all.length && all[next].time === sec) return next;
  const previous = Math.max(0, next - 1);
  if (next >= all.length || (sec >= all[previous].time && sec < TimeframeEngine.end(all[previous].time,loadedMarket?.int??$('intervalSelect').value))) return previous;
  return sec - all[previous].time <= all[next].time - sec ? previous : next;
}

function focusSignal(s, element, local=false) {
  if(!local&&loadedMarket&&globalThis.ChartWorkspace?.selectActive({ex:loadedMarket.ex,symbol:loadedMarket.symbol},{kind:'signal',signal:s}))return;
  chartDateFocus = null;
  // 신호 이동 시 급등락 하이라이트가 화면을 덮어쓰지 않도록 즉시 해제
  surgeHighlight.active = false;
  if (surgeCountdownBadge) surgeCountdownBadge.hidden = true;

  // 캔들 배열(all)에서 해당 신호 시각에 가장 부합하는 봉 인덱스 탐색
  const targetTime = Number(s.eventTime || s.time);
  const barIdx = findNearestBarIndex(targetTime);
  const matchedBar = all[barIdx];
  if (matchedBar) {
    // 차트 타임스케일에 존재하는 봉의 시간으로 매핑해야 노란선이 정확히 그려짐
    s.time = matchedBar.time;
  }

  selectedSignal = s;
  showLocationGuide(s.time);

  // 모든 신호 아이템 아웃라인 초기화 후 클릭된 요소 강조
  document.querySelectorAll('.signal-item').forEach(el => {
    el.style.outline = '';
    el.setAttribute('aria-current', 'false');
  });
  if (element) {
    element.style.outline = '2px solid #fbbf24';
    element.setAttribute('aria-current', 'true');
  }

  const old = chart.timeScale().getVisibleLogicalRange();
  const span = old ? Math.max(80, Math.min(300, old.to - old.from)) : 140;
  chartDateFocus={id:run,time:matchedBar?.time??targetTime,span};
  renderWindow(barIdx, true, span);
  chart.clearCrosshairPosition();

  const timeLabel = date(targetTime);
  const tfLabel = s.timeframe || $('intervalSelect').selectedOptions[0]?.text || '';
  const titleLabel = s.title || (s.rate !== undefined ? `펀딩비 ${s.rate.toFixed(6)}%` : '신호');

  $('chart-key').textContent = `선택 신호: [${tfLabel}] ${titleLabel} · 발생 시각: ${timeLabel} · 5초간 노란선 가이드`;
  status(`신호 날짜 이동 완료 ➔ ${timeLabel} ([${tfLabel}] ${titleLabel})`);
  schedule();
}

function fundingSignalsVisible(){
 if(!studyPanels)return true;
 const panel=studyPanels.panels.get('funding');return Boolean(panel?.active&&!panel.hidden);
}
function syncFundingSignalVisibility(){
 const visible=fundingSignalsVisible();if(visible===lastFundingSignalVisibility)return;
 lastFundingSignalVisibility=visible;renderSignalMarkers(all.slice(windowStart,windowEnd));
}
function setChartBacktest(value){chartBacktestResult=value?.market&&Array.isArray(value.signals)&&Array.isArray(value.trades)?value:null;renderSignalMarkers(all.slice(windowStart,windowEnd));schedule();}
function renderSignalMarkers(part){if(!part.length){markers.setMarkers([]);return;}
 const visible=fundingSignalsVisible()?signals.slice(lowerBound(signals,part[0].time),lowerBound(signals,part.at(-1).time+1)):[];
 const unique=new Map();for(const s of visible){const old=unique.get(s.time);if(!old||s.rate<old.rate)unique.set(s.time,s);}
 const markerList = [...unique.values()].map(s=>({time:s.time,position:'aboveBar',color:s.type==='EXTREME'?'#a855f7':'#ef4444',shape:'arrowDown',text:s.rate.toFixed(3)+'%'}));

 // 전략 신호 (RSI 반전 / 펀딩비+5분봉 BUY 등) 마커 통합
 if (typeof strategySignals !== 'undefined' && strategySignals.length) {
   const stratVisible = strategySignals.filter(s => s.time >= part[0].time && s.time <= part.at(-1).time);
   for (const st of stratVisible) {
     markerList.push({
       time: st.time,
       position: st.position || 'belowBar',
       color: st.color || '#10b981',
       shape: st.shape || 'arrowUp',
       text: st.text || '⚡BUY'
     });
   }
 }

 if(globalThis.BacktestOverlay?.matches(chartBacktestResult,loadedMarket))markerList.push(...globalThis.BacktestOverlay.markers(chartBacktestResult,part));
 markers.setMarkers(markerList.length<=400?markerList.sort((a,b)=>a.time-b.time):[]);
}
function renderWindow(center,focus=true,span=240,preservedRange=null){if(!all.length)return;changingWindow=true;clearTimeout(navTimer);windowStart=windowStartFor(center);windowEnd=Math.min(all.length,windowStart+WINDOW);const part=all.slice(windowStart,windowEnd),{warn,ext}=thresholds();
 candles.setData(part.map(({time,open,high,low,close})=>({time,open,high,low,close})));
 volume?.setData(part.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#22c55e80':'#ef444480'})));
 funding?.setData(part.map(c=>{const f=mapped.get(c.time);return f?{time:c.time,value:f.rate,color:f.rate<=ext?'#a855f7':f.rate<=warn?'#ef4444':'#3b82f6'}:{time:c.time};}));
 renderLiveFunding();
 if(fundingSessionActive(fundingSession)&&fundingSession.liveRows.length&&all.at(-1).time<fundingSession.liveRows.at(-1).time)void refreshFundingCandles(fundingSession);
 renderCycles(part);
 studyPanels?.render(part);
 renderSignalMarkers(part);
 $('historyPosition').max=Math.max(0,all.length-1);$('historyPosition').value=Math.max(0,Math.min(all.length-1,center));$('historyInfo').textContent=`${all.length.toLocaleString()}봉 · 화면 구간 ${date(part[0].time)} ~ ${date(part.at(-1).time)}`;
 if(focus){
  if(surgeHighlight.active && !selectedSignal && all.length){
   const sIdx = Math.max(0, lowerBound(all, surgeHighlight.startTime) - 6);
   const eIdx = Math.min(part.length - 1, all.length - 1 - windowStart + 6);
   resetScales();
   chart.timeScale().setVisibleLogicalRange({from: sIdx - windowStart, to: eIdx});
  } else {
   const ix=Math.max(0,Math.min(part.length-1,center-windowStart));resetScales();const rng=centeredRange(ix,Math.min(span,Math.max(20,all.length*1.2)));if(center>=all.length-1)latestOffset=rng.to-ix;chart.timeScale().setVisibleLogicalRange(rng);
  }
 }else if(preservedRange){chart.timeScale().setVisibleLogicalRange({from:preservedRange.from-windowStart,to:preservedRange.to-windowStart});}requestAnimationFrame(()=>{changingWindow=false;schedule();scheduleVisibleHistory();});}
let listOffset=0;function renderList(){listOffset=0;$('signalListContainer').replaceChildren();$('signalCountTag').textContent=signals.length+'개';appendList();}
function appendList(){const container=$('signalListContainer');container.querySelector('.more')?.remove();const end=Math.min(signals.length,listOffset+100);const fragment=document.createDocumentFragment();
 const tfText = $('intervalSelect').selectedOptions[0]?.text || '';
 for(;listOffset<end;listOffset++){
   const s=signals[signals.length-1-listOffset], el=document.createElement('div');
   el.className='signal-item '+s.type;
   s.timeframe = '정산 펀딩비 (' + tfText + ')';
   s.title = `펀딩비 ${s.rate.toFixed(6)}%`;
   el.innerHTML = `
     <div class="signal-info" style="width:100%;">
       <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
         <span style="background:#2563eb; color:#fff; font-size:10px; font-weight:800; padding:1px 6px; border-radius:4px;">⏱️ ${s.type==='EXTREME'?'극단 경고':'1차 경고'}</span>
         <span class="signal-rate ${s.type}">${s.rate.toFixed(4)}%</span>
       </div>
       <div style="font-size:11px; font-weight:700; color:#f1f5f9; margin-bottom:2px;">
         📅 ${date(s.eventTime || s.time)}
       </div>
       <div style="font-size:10px; color:#9ca3af;">
         봉 시각: ${date(s.time)} (정산 기준)
       </div>
     </div>
     <button type="button" class="btn-move" style="margin-left:8px; white-space:nowrap;">이동</button>
   `;
   el.onclick=()=>focusSignal(s,el);
   fragment.append(el);
 }
 container.append(fragment);
 if(listOffset<signals.length){const b=document.createElement('button');b.className='more';b.textContent='신호 100개 더 보기';b.onclick=appendList;container.append(b);}
 if(!signals.length)container.textContent='설정 조건에 해당하는 펀딩비 신호 없음';
}
chart.subscribeCrosshairMove(p=>{studyPanels?.updateLegend(p.time??null);if(selectedSignal)return;if(!p.time)return;const setKey=t=>{const el=$('chart-key');if(el.textContent!==t)el.textContent=t;};const c=p.seriesData.get(candles),v=volume?p.seriesData.get(volume):undefined,f=funding?p.seriesData.get(funding):undefined,cycle=settlementCycle?p.seriesData.get(settlementCycle):undefined,live=fundingLive?p.seriesData.get(fundingLive):undefined;setKey(`${date(Number(p.time))} · 종가 ${c?.close??'—'} · 거래량 ${v?.value??'—'} · 정산 펀딩비 ${f?.value!==undefined?f.value.toFixed(6)+'%':'기록 없음'} (봉 내 최저 실현율) · 관측 현재율 ${live?.value!==undefined?live.value.toFixed(6)+'%':'기록 없음'} (미정산) · 정산 간격 ${cycle?.value!==undefined?cycle.value+'시간':'기록 없음'}`);});
let navTimer;chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{schedule();if(r&&!changingWindow)scheduleVisibleHistory();});
new ResizeObserver(schedule).observe($('unified-chart'));
const pause=(ms,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(new DOMException('중지','AbortError'));const onAbort=()=>{clearTimeout(timer);reject(new DOMException('중지','AbortError'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',onAbort);resolve();},ms);signal.addEventListener('abort',onAbort,{once:true});});
function url(base,params){return base+'?'+new URLSearchParams(Object.entries(params).filter(([,v])=>v!==undefined));}
async function json(base,params,signal){return MarketAPI.json(base,params,signal);}
function candle(row){return MarketAPI.candle(row);}
function uniqueSorted(rows){const m=new Map();for(const r of rows)if(Number.isFinite(r.time))m.set(r.time,r);return [...m.values()].sort((a,b)=>a.time-b.time);}
function baseSymbol(s){return s.replace(/[-_]/g,'').replace(/USDT(?:SWAP)?$/,'');}
async function candlePage(ex,s,int,end,signal,recent=false){
 const b=baseSymbol(s),plan=TimeframeEngine.plan(ex,int),sourceSeconds=duration[plan.source];
 const limit=recent?Math.min(ex==='BITGET'?200:ex==='OKX'?300:1000,120*plan.factor):ex==='BITGET'?200:ex==='OKX'?300:ex==='MEXC'?2000:1000;
 let j,rows;
 switch(ex){
 case 'BINANCE':j=await json('https://fapi.binance.com/fapi/v1/klines',{symbol:b+'USDT',interval:plan.native,limit,endTime:end},signal);rows=j;break;
 case 'BYBIT':j=await json('https://api.bybit.com/v5/market/kline',{category:'linear',symbol:b+'USDT',interval:plan.native,limit,end},signal);rows=j.result.list;break;
 case 'BINGX':j=await json('https://open-api.bingx.com/openApi/swap/v3/quote/klines',{symbol:b+'-USDT',interval:plan.native,limit,endTime:end},signal);rows=j.data;break;
 case 'BITGET':j=await json('https://api.bitget.com/api/v2/mix/market/'+(recent?'candles':'history-candles'),{symbol:b+'USDT',productType:'USDT-FUTURES',granularity:plan.native,limit,endTime:recent?undefined:TimeframeEngine.requestEnd(end,plan.source)},signal);rows=j.data;break;
 case 'OKX':j=await json('https://www.okx.com/api/v5/market/'+(recent?'candles':'history-candles'),{instId:b+'-USDT-SWAP',bar:plan.native,limit,after:end},signal);rows=j.data.map(r=>[...r.slice(0,5),r[6]]);break;
 case 'MEXC':{const sec=Math.floor(end/1000);j=await json('https://api.mexc.com/api/v1/contract/kline/'+b+'_USDT',{interval:plan.native,start:Math.max(0,sec-sourceSeconds*(limit-1)),end:sec},signal);const d=j.data;
 rows=(d.time||[]).map((t,i)=>({time:t,open:d.open[i],high:d.high[i],low:d.low[i],close:d.close[i],volume:d.vol[i]}));break;}
 }
 if(!Array.isArray(rows))throw Error('캔들 응답 형식 오류');
 const normalized=rows.map(candle);if(normalized.some(c=>!c))throw Error(ex+' 캔들 값 또는 시각이 올바르지 않습니다.');
 return TimeframeEngine.aggregate(normalized,int,plan.source).map(bar=>({...bar,fetchedAt:Number(j.__marketFetchedAt??Date.now())}));
}
async function fundingPage(ex,s,cursor,page,signal){
 const request=FundingEngine.historyRequest(ex,s,cursor,page);
 const response=await json(request.url,request.params,signal);
 return FundingEngine.normalizeHistory(ex,response,s);
}
// 거래소가 공식 제공하는 "현재" 펀딩 정산 주기(시간). 실패해도 차트는 계속 동작합니다.
async function fetchOfficialCycle(ex,s,signal){const b=baseSymbol(s);let hours=null,note='';
 try{switch(ex){
 case 'BINANCE':{const j=await json('https://fapi.binance.com/fapi/v1/fundingInfo',{},signal);const r=Array.isArray(j)?j.find(x=>x.symbol===b+'USDT'):null;hours=r?Number(r.fundingIntervalHours):8;if(!r)note=' (조정 목록에 없음 = 기본 8시간)';break;}
 case 'BYBIT':{const j=await json('https://api.bybit.com/v5/market/instruments-info',{category:'linear',symbol:b+'USDT'},signal);hours=Number(j.result.list[0].fundingInterval)/60;break;}
 case 'OKX':{const j=await json('https://www.okx.com/api/v5/public/funding-rate',{instId:b+'-USDT-SWAP'},signal);hours=(Number(j.data[0].nextFundingTime)-Number(j.data[0].fundingTime))/3600000;break;}
 case 'BITGET':{const j=await json('https://api.bitget.com/api/v2/mix/market/current-fund-rate',{symbol:b+'USDT',productType:'USDT-FUTURES'},signal);hours=Number(j.data[0].fundingRateInterval);break;}
 case 'MEXC':{const j=await json('https://api.mexc.com/api/v1/contract/funding_rate/'+b+'_USDT',{},signal);hours=Number(j.data.collectCycle);break;}
 default:return null;}
 }catch(e){if(e.name==='AbortError')throw e;return null;}
 return Number.isFinite(hours)&&hours>0?{hours:Math.round(hours*100)/100,note}:null;}
let fundingSession = null;
const fundingCards = new Map();
const FUNDING_QUOTE_MS = 10000, CANDLE_REFRESH_MS=3000, FUNDING_REFRESH_MS = 60000;

function fundingSessionActive(session) {
  return Boolean(session) && fundingSession === session && session.id === run && !session.abort.signal.aborted;
}
function fundingError(error) {
  return error.name === 'TimeoutError' ? '15초 응답 제한 초과 · 네트워크 또는 거래소 접근 제한 확인 필요' : error.message || String(error);
}
function stopFundingUpdates() {
  if (!fundingSession) return;
  clearInterval(fundingSession.timer);
  clearInterval(fundingSession.quoteTimer);
  clearInterval(fundingSession.candleTimer);
  fundingSession.abort.abort();
  renderLiveFunding();
  $('fundingUpdateStatus').textContent = '자동 갱신 중지 · 다시 검색하면 재개';
}
function buildFundingCards() {
  for (const [ex, name] of FundingEngine.exchanges) {
    const card = document.createElement('div'); card.className = 'funding-card';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = name;
    button.title = name + ' 정산 기록 차트로 전환';
    button.onclick = () => {
      if (!fundingSession) return;
      $('symbolInput').value = fundingSession.symbol;
      $('exchangeSelect').value = ex; loadData();
    };
    const value = document.createElement('strong');
    const note = document.createElement('span');
    card.append(button, value, note); $('fundingExchangeGrid').append(card);
    fundingCards.set(ex, {card, value, note});
  }
}
function renderLiveFunding(full=true) {
  if (!fundingLive) return;
  const session = fundingSession, entry = session?.entries.get(session.ex);
  if(full)fundingLive.setData(FundingEngine.liveSeriesData(all.slice(windowStart, windowEnd), session?.liveRows ?? []));
  else {const first=all[windowStart]?.time,last=all[windowEnd-1]?.time;for(const row of (session?.liveRows??[]).slice(-2)){if(row.time>=first&&row.time<=last&&TimeframeEngine.indexAt(all,row.time,loadedMarket.int)>=0)fundingLive.update({time:row.time,value:row.rate},row.time<last);}}
  const stale = Boolean(entry?.error || session?.abort.signal.aborted);
  fundingLive.applyOptions({color: stale ? '#94a3b8' : '#fbbf24', title: stale ? '이전값' : '현재'});
  studyPanels?.updateFundingLegend();
  schedule();
}
function fundingLegend() {
  const session = fundingSession, entry = session?.entries.get(session.ex), quote = entry?.quote;
  if (!quote) return entry?.error ? '현재 조회 실패' : '현재 조회 중';
  const stale = entry.error || session.abort.signal.aborted;
  return `${stale ? '이전값' : '현재'} ${quote.rate > 0 ? '+' : ''}${quote.rate.toFixed(6)}% · 미정산`;
}
function renderFundingBoard() {
  const session = fundingSession;
  if (!session) return;
  const name = FundingEngine.exchanges.find(([ex]) => ex === session.ex)[1];
  const entry = session.entries.get(session.ex), quote = entry?.quote;
  const pct = value => (value > 0 ? '+' : '') + value.toFixed(6) + '%';
  let label = `${name} ${FundingEngine.contract(session.ex, session.symbol)} · 현재 표시율 `;
  label += quote ? pct(quote.rate) + (entry.error ? ' (이전 확인값·갱신 실패)' : '') : entry?.error ? '조회 실패' : '조회 중';
  if (quote) {label += quote.nextTime ? ` · 정산 예정 ${date(quote.nextTime)}` : ' · 정산 예정 시각 확인 불가'; label += ` · 확인 ${date(quote.timestamp ?? quote.fetchedAt)}`;}
  $('fundingSelected').textContent = label;
  const errors = [entry?.error && '현재값: ' + entry.error, session.historyError && '정산 이력: ' + session.historyError, session.candleError && '캔들: ' + session.candleError, session.chartError && '차트: ' + session.chartError].filter(Boolean);
  $('fundingApiError').textContent = errors.join(' · ');
  $('fundingApiError').hidden = errors.length === 0;
  const newest = session.latestRows.at(-1), collected = rates.at(-1);
  const settled = newest && (!collected || newest.time >= collected.time) ? newest : collected;
  $('fundingSettled').textContent = '최근 정산: ' + (settled ? pct(settled.rate) + ' · ' + date(settled.time) : session.historyError ? '조회 실패' : session.historyChecked ? '제공된 기록 없음' : '조회 중') + (session.historyError && settled ? ' · 최근 이력 갱신 실패' : '');
  const min = FundingEngine.minimum(rates);
  $('fundingMinimum').textContent = `수집 구간 최저: ${min ? pct(min.rate) + ' · ' + date(min.time) : '수집 중'} · ${rates.length.toLocaleString()}건` + (busy ? ' (수집 중)' : '') + (unmappedFunding.length ? ` · 캔들 미연결 ${unmappedFunding.length}건` : '');
  $('fundingMinimumBtn').disabled = !min || !all.length || unmappedFunding.some(row => row.time === min.time);
  let healthy = 0;
  for (const [ex, ui] of fundingCards) {
    const row = session.entries.get(ex), current = row?.quote;
    ui.card.classList.toggle('selected', ex === session.ex);
    ui.card.classList.toggle('stale', Boolean(row?.error));
    ui.value.textContent = current ? pct(current.rate) : row?.error ? '확인 불가' : '조회 중';
    ui.value.classList.toggle('negative', Boolean(current && current.rate < 0));
    ui.value.classList.toggle('positive', Boolean(current && current.rate > 0));
    ui.note.textContent = row?.error ? (current ? '이전 확인값 · ' : '') + row.error : current ? `조회 ${date(current.fetchedAt)}` : '공식 거래소 조회 중';
    ui.card.title = row?.error ?? (current ? `${current.symbol} · ${current.nextTime ? '정산 예정 ' + date(current.nextTime) : '정산 시각 확인 불가'}${current.hours ? ' · ' + current.hours + '시간 주기' : ''}` : '');
    if (current && !row.error) healthy++;
  }
  if (!session.abort.signal.aborted) $('fundingUpdateStatus').textContent = `현재값 ${healthy}/6곳 확인 · ${globalThis.ChartWorkspace?.isMulti()?'현재값 20초 / 캔들 약 9초':'현재값 10초 / 캔들 3초'} / 정산 이력 60초마다 요청${session.pending || session.quotePending.size ? ' · 갱신 중' : ''}`;
  studyPanels?.updateFundingLegend();
}
function startFundingUpdates(ex, symbol, interval, id) {
  stopFundingUpdates();
  const session = {ex, symbol, interval, id, abort: new AbortController(), entries: new Map(), quotePending: new Set(), liveRows: [], recentCandles: [], latestRows: [], historyChecked: false, historyError: null, candleError: null, pending: false, candlesPending: false};
  fundingSession = session;
  renderLiveFunding(); renderFundingBoard();
  void refreshFundingSession(session);
  session.quoteTimer = setInterval(() => {
    if (!document.hidden) void refreshFundingQuotes(session);
  }, FUNDING_QUOTE_MS);
  session.candleTimer=setInterval(()=>{if(!document.hidden)void refreshFundingCandles(session);},CANDLE_REFRESH_MS);
  session.timer = setInterval(() => {
    if (!document.hidden) void refreshFundingSession(session);
  }, FUNDING_REFRESH_MS);
}
function fundingRequestSignal(session) {
  return AbortSignal.any([session.abort.signal, AbortSignal.timeout(15000)]);
}
async function refreshFundingQuotes(session) {
  if (!fundingSessionActive(session)) return;
  if(globalThis.ChartWorkspace?.isMulti()&&session.lastQuotePoll&&Date.now()-session.lastQuotePoll<15000)return;
  session.lastQuotePoll=Date.now();
  await Promise.all((globalThis.ChartWorkspace?.embedded?FundingEngine.exchanges.filter(([ex])=>ex===session.ex):FundingEngine.exchanges).map(async ([ex]) => {
    if (session.quotePending.has(ex)) return;
    session.quotePending.add(ex);
    try {
      const request = FundingEngine.currentRequest(ex, session.symbol);
      const result = await json(request.url, request.params, fundingRequestSignal(session));
      const quote = FundingEngine.normalizeCurrent(ex, result, session.symbol, result.__marketFetchedAt ?? Date.now());
      if (!fundingSessionActive(session)) return;
      session.entries.set(ex, {quote, error: null});
      if (ex === session.ex) {
        session.liveRows = FundingEngine.observeCurrent(session.liveRows, quote, duration[session.interval],time=>TimeframeEngine.start(time,session.interval));
        if (quote.hours) officialCycle = {hours: quote.hours, note: ''};
        renderLiveFunding(false);
        updateCurrentCycleWindow();
        if (all.length && all.at(-1).time < session.liveRows.at(-1).time) void refreshFundingCandles(session);
      }
    } catch (error) {
      if (!fundingSessionActive(session)) return;
      session.entries.set(ex, {quote: session.entries.get(ex)?.quote ?? null, error: fundingError(error)});
      if (ex === session.ex) renderLiveFunding(false);
    } finally {
      session.quotePending.delete(ex);
      if (fundingSessionActive(session)) renderFundingBoard();
    }
  }));
}
function sameRates(a,b){return a.length===b.length&&a.every((row,i)=>row.time===b[i].time&&row.rate===b[i].rate);}
function renderFundingStudies(){
 const part=all.slice(windowStart,windowEnd);if(!part.length)return;const {warn,ext}=thresholds();
 funding?.setData(part.map(c=>{const f=mapped.get(c.time);return f?{time:c.time,value:f.rate,color:f.rate<=ext?'#a855f7':f.rate<=warn?'#ef4444':'#3b82f6'}:{time:c.time};}));
 renderCycles(part);renderSignalMarkers(part);schedule();
}
function updateCurrentCycleWindow(){
 if(!all.length)return;
 const part=all.slice(windowStart,windowEnd),period=currentCyclePeriod();if(!period)return;
 for(const c of part){if(TimeframeEngine.end(c.time,loadedMarket.int)<=period.start||c.time>=period.end)continue;
  cycleValues.set(c.time,{hours:period.hours,current:true,source:period.source});
  if(period.hours<8)cycleFast[lowerBound(all,c.time)]=Math.round(period.hours);
  settlementCycle?.update({time:c.time,value:period.hours,color:cycleColor(period.hours)},c.time<part.at(-1).time);
 }updateCycleBadge();schedule();
}
function refreshFundingChart(session, recentCandles = []) {
 if(!fundingSessionActive(session)||!all.length)return;
 if(changingWindow){requestAnimationFrame(()=>refreshFundingChart(session,recentCandles));return;}
 const view=captureChartView(),previous=all,oldEnd=windowEnd,oldLast=all[oldEnd-1]?.time;
 const merged=ChartData.mergeLive(all,recentCandles,duration[session.interval],Date.now()/1000,time=>TimeframeEngine.end(time,session.interval));all=merged.bars;
 if(!merged.changed.length&&studyPanels?.cacheBars===previous)studyPanels.cacheBars=all;
 const nextRates=FundingEngine.merge(rates,session.latestRows.filter(row=>row.time>=all[0].time));
 const rateChanged=!sameRates(rates,nextRates);rates=nextRates;
 if(rateChanged)rebuild();
 if(cycleFast.length!==all.length){const next=new Uint8Array(all.length);next.set(cycleFast.subarray(0,all.length));cycleFast=next;}
 // Keep the study cache current even while the user is looking at the past.
 // Returning to the latest bars can then render immediately, without waiting for another quote.
 if(merged.changed.length){
   if(studyPanels?.cache)studyPanels.ensureCache(previous,lowerBound(all,merged.changed[0].time));
   for(const c of merged.changed){const cycle=liveCycleValue(c);if(cycle)cycleValues.set(c.time,cycle);cycleFast[lowerBound(all,c.time)]=cycle&&cycle.hours<8?Math.round(cycle.hours):0;}
 }
 const visibleChanged=merged.changed.some(c=>c.time>=all[windowStart].time&&c.time<=oldLast);
 const tail=oldEnd===previous.length&&merged.changed.every(c=>c.time>=oldLast-duration[session.interval]*125&&(c.time>=oldLast||previous[lowerBound(previous,c.time)]?.time===c.time))&&all.length-windowStart<=WINDOW+200;
 if(merged.changed.length&&tail){
   // All pane updates occur synchronously in one browser task, before its next paint.
   windowEnd=all.length;
   const liveValues=new Map(session.liveRows.map(row=>[row.time,row.rate])),{warn,ext}=thresholds();
   for(const c of merged.changed.sort((a,b)=>a.time-b.time)){
     if(c.time<all[windowStart].time)continue;const historical=c.time<oldLast;
     candles.update({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close},historical);
     volume?.update({time:c.time,value:c.volume,color:c.close>=c.open?'#22c55e80':'#ef444480'},historical);
     const f=mapped.get(c.time);funding?.update(f?{time:c.time,value:f.rate,color:f.rate<=ext?'#a855f7':f.rate<=warn?'#ef4444':'#3b82f6'}:{time:c.time},historical);
     fundingLive?.update(liveValues.has(c.time)?{time:c.time,value:liveValues.get(c.time)}:{time:c.time},historical);
     const cycle=liveCycleValue(c);if(cycle)cycleValues.set(c.time,cycle);
     settlementCycle?.update(cycle?{time:c.time,value:cycle.hours,color:cycleColor(cycle.hours)}:{time:c.time},historical);
   }
   const from=lowerBound(all,merged.changed[0].time);
   studyPanels?.updateLive(merged.changed,previous,from,oldLast);
   if(cycleFast.length!==all.length){const next=new Uint8Array(all.length);next.set(cycleFast);cycleFast=next;}
   for(const c of merged.changed){const v=cycleValues.get(c.time);cycleFast[lowerBound(all,c.time)]=v&&v.hours<8?Math.round(v.hours):0;}
   const appended=all.length-previous.length;
   if(appended&&view?.followLatest){const scale=chart.timeScale(),range=scale.getVisibleLogicalRange();if(range)scale.setVisibleLogicalRange({from:range.from+appended,to:range.to+appended});}
   $('historyPosition').max=all.length-1;$('historyInfo').textContent=`${all.length.toLocaleString()}봉 · 화면 구간 ${date(all[windowStart].time)} ~ ${date(all.at(-1).time)}`;
 }else if(merged.changed.length&&visibleChanged){rebuild();restoreChartView(view,false);}
 if(rateChanged)renderFundingStudies();
 schedule();
}
async function refreshFundingCandles(session) {
  if (!fundingSessionActive(session) || !all.length || session.candlesPending) return;
  if(globalThis.ChartWorkspace?.isMulti()&&session.lastCandlePoll&&Date.now()-session.lastCandlePoll<8000)return;
  session.lastCandlePoll=Date.now();
  session.candlesPending = true;
  try {
    const rows = await candlePage(session.ex, session.symbol, session.interval, Date.now(), fundingRequestSignal(session), true);
    if (!fundingSessionActive(session)) return;
    session.recentCandles = uniqueSorted([...session.recentCandles, ...rows]).slice(-100);
    refreshFundingChart(session, rows);
    session.candleError = null; session.chartError = null;
  } catch (error) {
    if (fundingSessionActive(session)) session.candleError = fundingError(error);
  } finally {
    session.candlesPending = false;
    if (fundingSessionActive(session)) renderFundingBoard();
  }
}
async function refreshFundingSession(session) {
  if (!fundingSessionActive(session) || session.pending) return;
  session.pending = true;
  renderFundingBoard();
  try {
    await Promise.all([refreshFundingQuotes(session), refreshFundingCandles(session), (async () => {
      try {
        const rows = await fundingPage(session.ex, session.symbol, undefined, 1, fundingRequestSignal(session));
        if (!fundingSessionActive(session)) return;
        session.latestRows = rows; session.historyChecked = true; session.historyError = null;
        refreshFundingChart(session);
        session.chartError = null;
      } catch (error) {
        if (fundingSessionActive(session)) session.historyError = fundingError(error);
      }
      if (fundingSessionActive(session)) renderFundingBoard();
    })()]);
  } finally {
    session.pending = false;
    if (fundingSessionActive(session)) renderFundingBoard();
  }
}
function focusMinimumFunding() {
  const min = FundingEngine.minimum(rates);
  if (!min) return;
  const index = lowerBound(all, min.time + 1) - 1, bar = all[index];
  if (!bar || min.time >= TimeframeEngine.end(bar.time,fundingSession.interval)) return status('해당 정산 시각의 캔들 기록이 없어 이동할 수 없습니다.', true);
  focusSignal({time: bar.time, eventTime: min.time, rate: min.rate}, $('fundingMinimumBtn'));
}

function captureChartView(){
 if(chartDateFocus?.id===run)return {...chartDateFocus,followLatest:false};
 const scale=chart.timeScale(),range=scale.getVisibleLogicalRange();if(!range||!all.length)return null;
 const middle=windowStart+(range.from+range.to)/2,index=Math.max(0,Math.min(all.length-1,Math.round(middle)));
 const centerTime=scale.coordinateToTime?.(scale.width?.()/2);
 const time=Number.isFinite(centerTime)?Number(centerTime):all[index].time;
 const actual=Number.isFinite(centerTime)?Math.min(all.length-1,lowerBound(all,time)):index;
 return {time,offset:Number.isFinite(centerTime)?middle-Math.round(middle):middle-index,span:range.to-range.from,followLatest:windowEnd===all.length&&range.to>=all.length-1-windowStart+(latestOffset??5)-1};
}
async function settleChartView(id){
 await new Promise(resolve=>requestAnimationFrame(resolve));return id===run;
}
function restoreChartView(view,focus=true){
 if(!all.length)return;const index=!view||view.followLatest?all.length-1:Math.max(0,Math.min(all.length-1,lowerBound(all,view.time))),span=view?.span??240;
 const center=index+(view?.offset??0);
 renderWindow(index,focus,span,focus?null:{from:center-span/2,to:center+span/2});
}
async function commitHistoryRows(rows,id){
 if(id!==run||!rows.length)return false;
 while(changingWindow){if(!await settleChartView(id))return false;}
 const view=captureChartView(),before=all.length;
 all=ChartData.mergeHistory(all,rows);if(all.length===before)return false;
 rebuild();restoreChartView(view,false);await settleChartView(id);return id===run;
}
async function requestChartHistory(request){
 const market=loadedMarket,state=historyState;
 if(!market||state.id!==run)return;const key=String(request.end);
 if(state.pending.has(key)||state.exhausted.has(key))return;
 state.pending.add(key);$('historyLoading').hidden=false;$('historyLoading').textContent='해당 구간 불러오는 중…';
 const {ex,symbol,int,id}=market,signal=AbortSignal.any([navigationController.signal,AbortSignal.timeout(20000)]);
 try{
   const buffered=state.buffer.filter(page=>page[0].time<=request.to&&page.at(-1).time>=request.from)
     .flatMap(page=>page.filter(c=>c.time>=request.from&&c.time<=request.to&&c.time*1000<=request.end));
   const rows=buffered.length?uniqueSorted(buffered):await candlePage(ex,symbol,int,request.end,signal,request.direction==='newer');
   signal.throwIfAborted();if(id!==run)return;
   const useful=rows.filter(c=>c.time>=request.from&&c.time<=request.to&&c.time*1000<=request.end);
   if(!await commitHistoryRows(useful,id)){state.exhausted.add(key);if(!useful.length)status('이 구간의 추가 캔들 기록을 거래소가 제공하지 않습니다.');return;}
   // Fetch the corresponding settlements as well; prices do not wait for them.
   const cursor=ex==='BINANCE'?useful[0].time*1000:TimeframeEngine.end(useful.at(-1).time,int)*1000;
   try{const history=await fundingPage(ex,symbol,cursor,1,signal);signal.throwIfAborted();if(id!==run)return;
     const merged=FundingEngine.merge(rates,history.filter(r=>r.time>=TimeframeEngine.shift(useful[0].time,int,-1)&&r.time<TimeframeEngine.end(useful.at(-1).time,int)));
     if(!sameRates(rates,merged)){rates=merged;rebuild();renderFundingStudies();}
   }catch(error){if(error.name!=='AbortError'&&id===run)status('캔들 이동 완료 · 해당 구간 정산 이력 조회 실패: '+fundingError(error),true);}
 }catch(error){if(error.name!=='AbortError'&&id===run){status('과거 구간 조회 실패: '+fundingError(error),true);state.exhausted.add(key);setTimeout(()=>state.exhausted.delete(key),15000);}}
 finally{state.pending.delete(key);if(id===run){$('historyLoading').hidden=!state.pending.size;scheduleVisibleHistory();}}
}
function scheduleVisibleHistory(){
 clearTimeout(navTimer);navTimer=setTimeout(()=>{
   if(changingWindow||!all.length)return;const range=chart.timeScale().getVisibleLogicalRange();if(!range)return;
   const absolute={from:range.from+windowStart,to:range.to+windowStart},middle=(absolute.from+absolute.to)/2;
   if(((range.from<80&&windowStart>0)||(range.to>windowEnd-windowStart-80&&windowEnd<all.length))&&windowStartFor(middle)!==windowStart){renderWindow(middle,false,240,absolute);return;}
   for(const request of ChartData.historyRequests(all,absolute,duration[loadedMarket.int],Date.now()/1000,{start:t=>TimeframeEngine.start(t,loadedMarket.int),end:t=>TimeframeEngine.end(t,loadedMarket.int),shift:(t,n)=>TimeframeEngine.shift(t,loadedMarket.int,n)}))void requestChartHistory(request);
 },180);
}
async function jumpToChartDate(target,signal,interval=loadedMarket?.int){
 if(!duration[interval])throw Error('지원하지 않는 타임프레임입니다.');
 if(loadedMarket&&interval!==loadedMarket.int){await loadData({dateTarget:target,timeframe:interval,signal});return;}
 if(!loadedMarket)throw Error('먼저 코인과 거래소를 선택하세요.');
 const market=loadedMarket,{ex,symbol,int,id}=market;
 const requestSignal=AbortSignal.any([signal,navigationController.signal]);
 requestSignal.throwIfAborted();
 const span=Math.max(60,Math.min(180,chart.timeScale().getVisibleLogicalRange()?.to-chart.timeScale().getVisibleLogicalRange()?.from||180));
 let index=TimeframeEngine.indexAt(all,target,int);
 if(index>=0){chartDateFocus={id,time:target,span};selectedSignal=null;clearRuler();renderWindow(index,true,span);showLocationGuide(all[index].time,'date');status('날짜 이동 완료 · '+date(target));return;}
 const end=Math.min(Date.now(),Math.floor(TimeframeEngine.shift(target,int,Math.ceil(span/2)+10)*1000));
 const cursor=ex==='BINANCE'?Math.max(0,(target-3*86400)*1000):end;
 const [candlesResult,historyResult]=await Promise.allSettled([
   TimeframeEngine.dateWindow((edge,abort)=>candlePage(ex,symbol,int,edge,abort),target,int,span,requestSignal),
   fundingPage(ex,symbol,cursor,1,requestSignal)
 ]);
 requestSignal.throwIfAborted();if(id!==run||market!==loadedMarket)throw new DOMException('차트가 변경됐습니다.','AbortError');
 if(candlesResult.status==='rejected')throw candlesResult.reason;
 const rows=candlesResult.value;
 if(!rows.length)throw Error('해당 날짜의 '+$('intervalSelect').selectedOptions[0].text+' 기록을 거래소가 제공하지 않습니다. 상장일·보관 범위를 확인하세요.');
 chartDateFocus={id,time:target,span};all=uniqueSorted([...all,...rows]);
 if(historyResult.status==='fulfilled')rates=FundingEngine.merge(rates,historyResult.value.filter(row=>row.time>=rows[0].time&&row.time<TimeframeEngine.end(rows.at(-1).time,int)));
 rebuild();index=TimeframeEngine.indexAt(all,target,int);selectedSignal=null;clearRuler();renderWindow(index,true,span);showLocationGuide(all[index].time,'date');
 $('coverage').textContent='날짜 조회: '+date(target)+' · 주변 캔들 '+date(rows[0].time)+' ~ '+date(rows.at(-1).time)+' · 거래소가 제공하는 실제 기록. 정산 기록이 없는 구간은 공백입니다.'+(historyResult.status==='rejected'?' · 이 구간의 정산 기록 조회 실패: '+fundingError(historyResult.reason):'');
 status('날짜 이동 완료 · '+date(target));
}

async function loadData(options={}){const dateTarget=Number.isFinite(options.dateTarget)?options.dateTarget:null;if(options.timeframe&&duration[options.timeframe])$('intervalSelect').value=options.timeframe;try{thresholds();}catch(e){if(dateTarget!==null)throw e;return status(e.message,true);}const symbol=$('symbolInput').value.trim().toUpperCase();if(!/^[A-Z0-9_-]+$/.test(symbol)){if(dateTarget!==null)throw Error('유효한 심볼을 입력하세요.');return status('유효한 심볼을 입력하세요.',true);}
 chartDateFocus=null;clearLocationGuide();if(dateTarget===null)dateNavigation?.cancel();navigationController?.abort();navigationController=new AbortController();controller?.abort();controller=new AbortController();const signal=controller.signal,id=++run,ex=$('exchangeSelect').value,int=$('intervalSelect').value;loadedMarket={ex,symbol,int,id};globalThis.ChartWorkspace?.marketChanged(loadedMarket);historyState={id,buffer:[],pending:new Set(),exhausted:new Set()};$('historyLoading').hidden=true;chartSymbolLabel.textContent=FundingEngine.contract(ex,symbol);chartSymbolLabel.title=ex+' · '+chartSymbolLabel.textContent+' · '+$('intervalSelect').selectedOptions[0].text;busy=true;clearRuler();selectedSignal=null;for(const s of paneScaleSeries)resetCustomPriceRange(s);all=[];rates=[];signals=[];mapped.clear();strategySignals=[];if($('strategyCurrentCoinLabel'))$('strategyCurrentCoinLabel').textContent=`[${symbol}] 전략 신호`;if($('strategyCountTag'))$('strategyCountTag').textContent='0개';if($('strategyListContainer'))$('strategyListContainer').innerHTML=`<div style="color:#9ca3af;font-size:11px;text-align:center;padding:25px;line-height:1.6;"><span style="color:#60a5fa;font-weight:700;">[${symbol}]</span> 신호 데이터 분석 중...<br><span style="font-size:10px;color:#6b7280;">차트 로드 완료 후 전략 신호가 즉시 업데이트됩니다.</span></div>`;candles.setData([]);volume?.setData([]);funding?.setData([]);settlementCycle?.setData([]);cycleMarkers?.setMarkers([]);studyPanels?.clearData();cycleHistory=[];cycleTransitions=[];cycleValues.clear();cycleFast=new Uint8Array(0);officialCycle=null;otherCycles=[];unmappedFunding=[];cycleCaption.textContent='정산 주기: 이력 수집 중';cycleBadge.hidden=true;markers.setMarkers([]);renderList();
 $('coverage').textContent='선택 거래소 USDT 무기한 선물 · 제공 가능한 이력 끝까지 수집 · 과거 구간은 날짜로 이동(Alt+G) 또는 하단 슬라이더로 이동 · 전체 이력은 계속 수집';
 status(`${ex} ${symbol} · 과거 이력 수집 시작`);startFundingUpdates(ex,symbol,int,id);
 const context={ex,symbol,int,id,signal};
 if(dateTarget!==null){
  try{await jumpToChartDate(dateTarget,AbortSignal.any([signal,options.signal||signal]),int);}
  catch(error){if(id===run){busy=false;status('날짜 이동 실패: '+error.message,true);}throw error;}
  if(id!==run||signal.aborted)throw new DOMException('차트가 변경됐습니다.','AbortError');
  void collectMarketHistory(context).catch(error=>{if(id===run&&error.name!=='AbortError')status(error.message,true);});return;
 }
 return collectMarketHistory(context);
}
async function collectMarketHistory({ex,symbol,int,id,signal}){
 let candleEnd=Date.now(),chunks=[],count=0,candleNote='',fundNote='';historyState.buffer=chunks;
 try{for(;;){const rows=uniqueSorted(await candlePage(ex,symbol,int,candleEnd,signal)).filter(c=>c.time*1000<=candleEnd);if(id!==run)return;signal.throwIfAborted();if(!rows.length){candleNote='API 이력 끝';break;}chunks.push(rows);count+=rows.length;status(`${ex} ${symbol} · 캔들 ${count.toLocaleString()}봉 수집 중`);if(chunks.length===1){const view=chartDateFocus?.id===run?captureChartView():null;all=ChartData.mergeHistory(all,rows);rates=FundingEngine.merge(rates,(fundingSession?.latestRows??[]).filter(f=>f.time>=all[0].time));rebuild();if(view)restoreChartView(view,false);else renderWindow(all.length-1);}else if(!changingWindow){const range=chart.timeScale().getVisibleLogicalRange();if(range&&windowStart+range.from<80&&rows.at(-1).time>=all[0].time-duration[int])await commitHistoryRows(rows,id);}const next=rows[0].time*1000-1;if(next>=candleEnd){candleNote='API 페이지 진행 불가';break;}candleEnd=next;if(candleEnd<=0){candleNote='이력 끝';break;}if(globalThis.ChartWorkspace?.isMulti()){candleNote='최근 구간 · 과거 이동 시 추가 조회';break;}await pause(ex==='BINGX'?1150:350,signal);}
 }catch(e){candleNote=e.name==='AbortError'?'사용자 중지':e.message;}
 if(id!==run)return;const collectedView=captureChartView();all=ChartData.mergeHistory(all,chunks.flat());if(!all.length){busy=false;renderFundingBoard();return status(`${ex}: ${candleNote||'해당 심볼 데이터 없음'}`,true);}rebuild();restoreChartView(collectedView,false);if(!await settleChartView(id))return;
 if(!signal.aborted){let cursor=ex==='BINANCE'?all[0].time*1000:Date.now(),parts=[],previous=-1;
 try{for(let page=1;;page++){const rows=await fundingPage(ex,symbol,cursor,page,signal);if(id!==run)return;signal.throwIfAborted();if(!rows.length){fundNote='API 이력 끝';break;}const useful=rows.filter(f=>f.time>=all[0].time);parts.push(useful);if(globalThis.ChartWorkspace?.isMulti()){fundNote='최근 구간 · 과거 이동 시 추가 조회';break;}status(`${ex} · ${all.length.toLocaleString()}봉 / 펀딩비 ${parts.reduce((n,a)=>n+a.length,0).toLocaleString()}건 수집 중`);
 const edge=ex==='BINANCE'?rows.at(-1).time:rows[0].time;if(edge===previous){fundNote='API 페이지 반복: 제공 범위까지만 표시';break;}previous=edge;cursor=ex==='BINANCE'?edge*1000+1:edge*1000-1;if((ex==='BINANCE'&&cursor>=Date.now())||(ex!=='BINANCE'&&edge<=all[0].time)){fundNote='캔들 구간 수집 완료';break;}await pause(ex==='BINGX'?1150:350,signal);}
 }catch(e){fundNote=e.name==='AbortError'?'사용자 중지':e.message;}if(id!==run)return;rates=FundingEngine.merge(uniqueSorted(parts.flat()),rates);}
 if(id!==run)return;rates=FundingEngine.merge(rates,(fundingSession?.latestRows??[]).filter(f=>f.time>=all[0].time));try{const value=await fetchOfficialCycle(ex,symbol,signal);if(id!==run)return;officialCycle=value;}catch{}if(id!==run)return;try{const values=await fetchAllCycles(symbol,signal);if(id!==run)return;otherCycles=values;}catch{}if(id!==run)return;const fundingView=captureChartView();rebuild();restoreChartView(fundingView,false);busy=false;renderFundingBoard();
 calculateStrategySignals();
 if (typeof renderSignalMarkers === 'function') renderSignalMarkers(all.slice(windowStart, windowEnd));
 $('coverage').textContent=`캔들: ${date(all[0].time)} ~ ${date(all.at(-1).time)} (${candleNote}) · 펀딩비: ${rates.length?date(rates[0].time)+' ~ '+date(rates.at(-1).time):'확인된 기록 없음'} (${fundNote||'미수집'}) · 선택 거래소의 정산 기록(봉 내 최저율) · 노란선: 페이지에서 관측한 현재 미정산율 · 막대: 정산 기록 · 기록 없는 구간은 공백${unmappedFunding.length?' · 캔들 미연결 '+unmappedFunding.length+'건':''}. ${ex==='OKX'?'OKX 펀딩비 API는 최근 3개월 제공. ':''}${ex==='MEXC'?'거래량 단위: 계약 수. ':'거래량 단위: 기초자산. '}`;
 status(`${ex} ${symbol} · ${all.length.toLocaleString()}봉 / 펀딩비 ${rates.length.toLocaleString()}건`,!rates.length);
}
$('searchBtn').onclick=loadData;$('symbolInput').onkeydown=e=>{if(e.key==='Enter')loadData();};$('stopBtn').onclick=()=>{controller?.abort();status('과거 전체 수집 중지 · 실시간 갱신과 이동한 구간 조회는 계속됩니다.');};
$('oldestBtn').onclick=()=>{chartDateFocus=null;renderWindow(0);};$('latestBtn').onclick=()=>{chartDateFocus=null;renderWindow(all.length-1);};
let sliderTimer;$('historyPosition').oninput=()=>{chartDateFocus=null;clearTimeout(sliderTimer);sliderTimer=setTimeout(()=>renderWindow(+$('historyPosition').value),100);};
$('btnToggleLines').onclick=function(){showLines=!showLines;this.classList.toggle('active',showLines);schedule();};
for(const id of ['warnThresh','extThresh'])$(id).onchange=()=>{try{rebuild();renderWindow(+$('historyPosition').value);}catch(e){status(e.message,true);}};

// 지표 패널 매니저 (indicators.js) — 모든 함수/변수 정의가 끝난 뒤 생성
studyPanels=new StudyPanelManager();buildFundingCards();
rulerColors.bind({workspace:chartWorkspace,buttonAfter:rulerBtn,onChange:()=>{chartDrawings?.setRulerLocked(rulerColors.isLocked());schedule();},onStatus:status});
chartDrawings=bindChartDrawings({
 host:rulerHost,workspace:chartWorkspace,chart,rulerColors,rulerButton:rulerBtn,
 data:()=>all,market:()=>loadedMarket,windowStart:()=>windowStart,step:()=>duration[loadedMarket?.int]||60,
 layout:()=>getPaneLayout().map(p=>{const panel=studyPanels.panelForPane(chart.panes()[p.index]);return {...p,id:panel?.id,visible:Boolean(panel&&studyPanels.isVisible(panel))};}),
 schedule,status,formatTime:date,interaction:rulerInteraction,cursor:id=>chart.applyOptions({crosshair:{mode:['pointer','dot'].includes(id)?LC.CrosshairMode.Hidden:LC.CrosshairMode.Normal}}),beforeTool:()=>{if(rulerEnabled)toggleRuler(false);else clearRuler();},
 zoom:item=>{const [a,b]=item.points,from=DrawingEngine.timeLogical(all,Math.min(a.time,b.time),duration[loadedMarket.int])-windowStart,to=DrawingEngine.timeLogical(all,Math.max(a.time,b.time),duration[loadedMarket.int])-windowStart;if(to-from<2)return;moveChartRange({from,to});const pane=getPaneLayout().find(p=>studyPanels.panelForPane(chart.panes()[p.index])?.id===item.pane);if(pane&&a.price!==b.price){pane.series.priceScale().setVisibleRange({from:Math.min(a.price,b.price),to:Math.max(a.price,b.price)});}schedule();}
});
rulerBtn.onclick=()=>chartDrawings.setTool(chartDrawings.tool==='ruler'?'cross':'ruler');
dateNavigation=bindDateNavigation({marketKey:()=>(loadedMarket?.ex||$('exchangeSelect').value)+':'+(loadedMarket?.symbol||$('symbolInput').value),currentTimeframe:()=>loadedMarket?.int||$('intervalSelect').value,currentTime:()=>Math.min(Date.now()/1000,captureChartView()?.time??Date.now()/1000),jump:jumpToChartDate});
$('fundingRefreshBtn').onclick=()=>{if(fundingSession&&!fundingSession.abort.signal.aborted)void refreshFundingSession(fundingSession);else loadData();};
$('fundingMinimumBtn').onclick=focusMinimumFunding;
for(const id of ['exchangeSelect','intervalSelect'])$(id).onchange=event=>{const target=id==='intervalSelect'?chartDateFocus?.time:null;void loadData(Number.isFinite(target)?{dateTarget:target,timeframe:$('intervalSelect').value}:{}).catch(error=>{if(error.name!=='AbortError')status(error.message,true);});};
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&fundingSession)void refreshFundingSession(fundingSession);});
for(const p of studyPanels.active()){const s=studyPanels.primary(p);if(s&&p.stretch>0)s.getPane().setStretchFactor(p.stretch);}

// [전략 신호 관리: RSI 반전 & 펀딩비 극단+5분봉 RSI BUY 신호 & 5일 급등락 결합]
let strategySignals = [];
let currentStrategyFilter = 'all';

function buildHourlyCandles(bars) {
  if (!bars || !bars.length) return [];
  const hourly = [];
  let currentHour = -1;
  let cur = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const hTime = Math.floor(b.time / 3600) * 3600;
    if (hTime !== currentHour) {
      if (cur) hourly.push(cur);
      currentHour = hTime;
      cur = {
        time: hTime,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0
      };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = (cur.volume || 0) + (b.volume || 0);
    }
  }
  if (cur) hourly.push(cur);
  return hourly;
}

function calculateRSI(bars, period = 14) {
  if (!bars || bars.length <= period) return [];
  const rsiList = [];
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  let rs = avgL === 0 ? 100 : avgG / avgL;
  rsiList.push({ time: bars[period].time, rsi: 100 - (100 / (1 + rs)), index: period, bar: bars[period] });

  for (let i = period + 1; i < bars.length; i++) {
    const diff = bars[i].close - bars[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgG = (avgG * (period - 1) + gain) / period;
    avgL = (avgL * (period - 1) + loss) / period;
    rs = avgL === 0 ? 100 : avgG / avgL;
    rsiList.push({ time: bars[i].time, rsi: 100 - (100 / (1 + rs)), index: i, bar: bars[i] });
  }
  return rsiList;
}

function calculateStrategySignals() {
  strategySignals = [];
  if (!all.length) {
    renderStrategyList();
    return;
  }

  const symbol = loadedMarket?.symbol || $('symbolInput').value.trim().toUpperCase();
  const rsiOn = $('stratRsiToggle')?.checked ?? true;
  const fundingRsiOn = $('stratFundingRsiToggle')?.checked ?? true;
  const comboOn = $('stratComboToggle')?.checked ?? false;
  const fundingThresh = Number($('stratFundingThresh')?.value ?? -0.5);
  const currentTfText = $('intervalSelect').selectedOptions[0]?.text || $('intervalSelect').value;

  // 1) 1시간봉 RSI 모멘텀 반전 신호 (과매도 ≤30 탈출 30돌파 BUY / 과매수 ≥70 이탈 70돌파 SELL)
  const hourlyBars = buildHourlyCandles(all);
  const rsiBars = hourlyBars.length >= 20 ? hourlyBars : all;
  const rsiTfLabel = hourlyBars.length >= 20 ? '1시간봉' : currentTfText;
  const rsi1h = calculateRSI(rsiBars, 14);

  if (rsiOn && rsi1h.length > 2) {
    let wasOversold = false, wasOverbought = false;
    for (let i = 1; i < rsi1h.length; i++) {
      const prev = rsi1h[i - 1].rsi;
      const cur = rsi1h[i].rsi;
      const rBar = rsi1h[i].bar;
      const nearestIdx = findNearestBarIndex(rBar.time);
      const chartBar = all[nearestIdx] || rBar;

      if (cur <= 30) wasOversold = true;
      if (cur >= 70) wasOverbought = true;

      if (wasOversold && prev < 30 && cur >= 30) {
        strategySignals.push({
          symbol,
          category: 'rsi',
          time: chartBar.time,
          eventTime: rBar.time,
          timeframe: rsiTfLabel,
          badgeText: '⚡ 1h RSI BUY',
          type: 'RSI_BUY',
          title: '1시간봉 RSI 과매도 탈출 (30 상향 돌파 반등)',
          conditionDesc: `1시간봉 RSI ${prev.toFixed(1)} ➔ ${cur.toFixed(1)} (30선 골든크로스 반등 타점)`,
          color: '#10b981',
          position: 'belowBar',
          shape: 'arrowUp',
          text: '1h 30▲',
          price: chartBar.close
        });
        wasOversold = false;
      }
      if (wasOverbought && prev > 70 && cur <= 70) {
        strategySignals.push({
          symbol,
          category: 'rsi',
          time: chartBar.time,
          eventTime: rBar.time,
          timeframe: rsiTfLabel,
          badgeText: '🔻 1h RSI SELL',
          type: 'RSI_SELL',
          title: '1시간봉 RSI 과매수 이탈 (70 하향 돌파 반락)',
          conditionDesc: `1시간봉 RSI ${prev.toFixed(1)} ➔ ${cur.toFixed(1)} (70선 데드크로스 숏 타점)`,
          color: '#f97316',
          position: 'aboveBar',
          shape: 'arrowDown',
          text: '1h 70▼',
          price: chartBar.close
        });
        wasOverbought = false;
      }
    }
  }

  // 2) 펀딩비 극단 + RSI 과매도 후 30 돌파 BUY 신호 (숏 스퀴즈 롱 타점)
  const rsiNative = calculateRSI(all, 14);
  if (fundingRsiOn && mapped.size && rsiNative.length > 2) {
    for (const [fTime, fData] of mapped) {
      if (fData.rate <= fundingThresh) {
        const fIdx = lowerBound(all, fTime);
        let foundOversold = false;
        for (let k = fIdx; k < Math.min(all.length, fIdx + 40); k++) {
          const rObj = rsiNative.find(r => r.time === all[k].time);
          if (!rObj) continue;
          if (rObj.rsi <= 32) foundOversold = true;
          if (foundOversold && rObj.rsi >= 30) {
            if (!strategySignals.some(s => s.time === all[k].time && s.type === 'FUNDING_RSI_BUY')) {
              strategySignals.push({
                symbol,
                category: 'funding_rsi',
                time: all[k].time,
                eventTime: all[k].time,
                timeframe: currentTfText,
                badgeText: '⚡ 펀딩+RSI BUY',
                type: 'FUNDING_RSI_BUY',
                title: `펀딩비(${fData.rate.toFixed(3)}%) + RSI 30돌파 롱`,
                conditionDesc: `펀딩비 ${fData.rate.toFixed(3)}% (기준 ${fundingThresh}% 이하) + RSI 과매도 탈출 반등`,
                color: '#22c55e',
                position: 'belowBar',
                shape: 'arrowUp',
                text: '⚡BUY',
                price: all[k].close
              });
            }
            break;
          }
        }
      }
    }
  }

  // 3) 5일 급등락 + 지표 결합 필터 신호
  if (all.length >= 2) {
    const fiveDaysSec = 5 * 86400;
    const lastTime = all.at(-1).time;
    const fiveDaysStartIdx = lowerBound(all, lastTime - fiveDaysSec);
    const wBars = all.slice(fiveDaysStartIdx);
    if (wBars.length >= 2) {
      const startPrice = wBars[0].open;
      let minLow = Infinity, maxHigh = -Infinity;
      for (const b of wBars) {
        if (b.low < minLow) minLow = b.low;
        if (b.high > maxHigh) maxHigh = b.high;
      }
      const surgeGain = startPrice > 0 ? ((maxHigh - startPrice) / startPrice) * 100 : 0;
      const dropLoss = startPrice > 0 ? ((minLow - startPrice) / startPrice) * 100 : 0;
      const maxSwing = minLow > 0 ? ((maxHigh - minLow) / minLow) * 100 : 0;

      // 5일간 40% 이상 급등한 경우: 1시간봉 RSI 70 하향 돌파(고점 숏 타점) 결합
      if (surgeGain >= 40 || maxSwing >= 40) {
        const rsiSellSignals = strategySignals.filter(s => s.type === 'RSI_SELL' && s.time >= lastTime - fiveDaysSec);
        for (const sig of rsiSellSignals) {
          strategySignals.push({
            symbol,
            category: 'combo',
            time: sig.time,
            eventTime: sig.eventTime,
            timeframe: sig.timeframe,
            badgeText: '🚀 5일 급등 결합 SELL',
            type: 'COMBO_SELL',
            title: `5일 급등(+${surgeGain.toFixed(1)}%) + 1h RSI 70 하향 이탈`,
            conditionDesc: `5일간 +${surgeGain.toFixed(1)}% 급등한 종목에서 1시간봉 RSI 70선 하향 돌파(고점 숏 타점) 발생`,
            color: '#ef4444',
            position: 'aboveBar',
            shape: 'arrowDown',
            text: '🚀SELL',
            price: sig.price
          });
        }
      }

      // 5일간 40% 이상 급락한 경우: RSI 30 상향 돌파(저점 롱 반등) 결합
      if (dropLoss <= -40 || (startPrice > 0 && ((wBars.at(-1).close - startPrice) / startPrice) * 100 <= -40)) {
        const rsiBuySignals = strategySignals.filter(s => (s.type === 'RSI_BUY' || s.type === 'FUNDING_RSI_BUY') && s.time >= lastTime - fiveDaysSec);
        for (const sig of rsiBuySignals) {
          strategySignals.push({
            symbol,
            category: 'combo',
            time: sig.time,
            eventTime: sig.eventTime,
            timeframe: sig.timeframe,
            badgeText: '🚀 5일 급락 결합 BUY',
            type: 'COMBO_BUY',
            title: `5일 급락(${dropLoss.toFixed(1)}%) + RSI 30선 상향 반등`,
            conditionDesc: `5일간 ${dropLoss.toFixed(1)}% 급락한 종목에서 RSI 30선 상향 골든크로스(저점 반등 롱 타점) 발생`,
            color: '#06b6d4',
            position: 'belowBar',
            shape: 'arrowUp',
            text: '🚀BUY',
            price: sig.price
          });
        }
      }
    }
  }

  // [5일 급등락 + 지표 결합 필터] 토글 활성화 시 결합 신호만 유지
  if (comboOn) {
    strategySignals = strategySignals.filter(s => s.category === 'combo');
  }

  strategySignals.sort((a, b) => a.time - b.time);
  renderStrategyList();
}

function renderStrategyList() {
  const container = $('strategyListContainer');
  if (!container) return;
  container.innerHTML = '';

  const symbol = loadedMarket?.symbol || $('symbolInput').value.trim().toUpperCase();
  if ($('strategyCurrentCoinLabel')) {
    $('strategyCurrentCoinLabel').textContent = `[${symbol}] 전략 신호`;
  }

  // 타 코인 신호가 섞이지 않도록 현재 심볼 신호만 선별
  const coinSignals = strategySignals.filter(s => !s.symbol || s.symbol === symbol);

  // 탭 필터(전체 / ⚡펀딩+RSI / ⏱️1h RSI / 🚀5일 결합) 적용
  const filtered = coinSignals.filter(s => {
    if (currentStrategyFilter === 'all') return true;
    return s.category === currentStrategyFilter;
  });

  if ($('strategyCountTag')) {
    $('strategyCountTag').textContent = currentStrategyFilter === 'all'
      ? `${coinSignals.length}개`
      : `${filtered.length}개 / 전체 ${coinSignals.length}개`;
  }

  if (!filtered.length) {
    const filterLabels = {
      all: '전략',
      funding_rsi: '펀딩비 + RSI',
      rsi: '1시간봉 RSI',
      combo: '5일 급등락 결합'
    };
    const fName = filterLabels[currentStrategyFilter] || '조건 부합';
    container.innerHTML = `<div style="color:#9ca3af;font-size:11px;text-align:center;padding:25px;line-height:1.6;"><strong>[${symbol}]</strong>에서 조건에 부합하는 <span style="color:#93c5fd;">${fName}</span> 신호가 없습니다.</div>`;
    return;
  }

  const reversed = [...filtered].reverse().slice(0, 80);
  for (const s of reversed) {
    const el = document.createElement('div');
    el.className = 'signal-item ' + s.type;
    el.style.borderLeftColor = s.color;
    el.style.background = s.type.includes('BUY')
      ? 'rgba(34, 197, 94, 0.12)'
      : (s.type.includes('SELL') ? 'rgba(239, 68, 68, 0.12)' : 'rgba(249, 115, 22, 0.12)');
    const priceStr = (typeof ScannerEngine !== 'undefined') ? ScannerEngine.formatPrice(s.price) : s.price.toFixed(4);

    el.innerHTML = `
      <div class="signal-info" style="width:100%;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span style="background:#1e3a8a; color:#93c5fd; font-size:10px; font-weight:800; padding:2px 7px; border-radius:4px; border:1px solid #3b82f6;">⏱️ ${s.timeframe}</span>
          <span style="font-size:11px; font-weight:800; color:${s.color};">${s.badgeText}</span>
        </div>
        <div style="font-size:12px; font-weight:800; color:#f8fafc; margin-bottom:3px;">
          📅 ${date(s.eventTime || s.time)}
        </div>
        <div style="font-size:11px; color:#cbd5e1; font-weight:600; line-height:1.4;">
          ${s.title}
        </div>
        <div style="font-size:10px; color:#94a3af; margin-top:3px; line-height:1.4;">
          ${s.conditionDesc || ''} · <span style="color:#e2e8f0;">가격: <strong>$${priceStr}</strong></span>
        </div>
      </div>
      <button type="button" class="btn-move" style="margin-left:8px; white-space:nowrap;">이동</button>
    `;

    el.onclick = () => {
      focusSignal(s, el);
    };

    container.appendChild(el);
  }
}


// [사이드바 탭 전환 관리]
function setupSidebarTabs() {
  const tabs = document.querySelectorAll('.sidebar-tab-btn');
  const panels = document.querySelectorAll('.sidebar-panel');

  function switchTab(targetId) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === targetId));
    panels.forEach(p => p.classList.toggle('active', p.id === targetId));

    // 5일 급등락 / 펀딩비 순위 서브 스위처 버튼 상태 동기화
    document.querySelectorAll('.btn-scanner-switch').forEach(b => {
      const isTarget = b.dataset.target === targetId;
      b.classList.toggle('active', isTarget);
      b.style.background = isTarget ? '#2563eb' : '#374151';
      b.style.color = isTarget ? '#fff' : '#94a3b8';
    });

    if (targetId === 'tab-funding-rank' && !fundingRankList.length && !fundingRankController) {
      startFundingRankScan();
    }

    if ($('fundingCountBadge')) {
      $('fundingCountBadge').textContent = signals.length + '개';
    }
    if ($('signalCountTag')) {
      $('signalCountTag').textContent = signals.length + '개';
    }
  }

  tabs.forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  document.querySelectorAll('.btn-scanner-switch').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.target);
  });
}

// [5일 급등락 스캐너 제어]
let scannerController = null;
let scannedCoins = [];
let currentFilterDir = 'all';

function setupScanner() {
  const startBtn = $('scannerStartBtn');
  const threshInput = $('scannerThreshold');
  const daysInput = $('scannerDays');
  const statusText = $('scannerStatusText');
  const progressBar = $('scannerProgressBar');
  const progressFill = $('scannerProgressFill');
  const container = $('scannerListContainer');
  if (!startBtn) return;

  const dirBtns = document.querySelectorAll('.btn-filter-dir');
  dirBtns.forEach(btn => {
    btn.onclick = () => {
      dirBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilterDir = btn.dataset.dir;
      renderScannerResults();
    };
  });

  async function startScan() {
    scannerController?.abort();
    scannerController = new AbortController();
    const signal = scannerController.signal;

    const threshold = Number(threshInput?.value) || 40;
    const days = Number(daysInput?.value) || 5;

    startBtn.classList.add('scanning');
    startBtn.textContent = '⏹️ 스캔 중...';
    if (progressBar) progressBar.style.display = 'block';
    if (progressFill) progressFill.style.width = '0%';
    if (statusText) statusText.textContent = `바이낸스 선물 분석 중 (기준: 5일 ±${threshold}%)...`;
    scannedCoins = [];
    if (container) container.innerHTML = '<div class="scanner-empty-msg">코인 시세를 조회하고 있습니다... 잠시만 기다려주세요.</div>';

    try {
      await ScannerEngine.scanBinance({
        days,
        thresholdPct: threshold,
        maxCoins: 250,
        concurrency: 20,
        signal,
        onProgress: ({ processed, total, matchedCount }) => {
          const pct = Math.round((processed / total) * 100);
          if (progressFill) progressFill.style.width = pct + '%';
          if (statusText) statusText.textContent = `스캔 진행: ${processed}/${total}개 분석 (${matchedCount}개 조건 부합)`;
        },
        onMatch: coin => {
          scannedCoins.push(coin);
          renderScannerResults();
        }
      });

      if (statusText) statusText.textContent = `스캔 완료: 총 ${scannedCoins.length}개 코인 발견 (±${threshold}%)`;
    } catch (err) {
      if (err.name === 'AbortError') {
        if (statusText) statusText.textContent = '스캔이 취소되었습니다.';
      } else {
        if (statusText) statusText.textContent = '스캔 오류: ' + err.message;
      }
    } finally {
      startBtn.classList.remove('scanning');
      startBtn.textContent = '🔄 스캔 시작';
      setTimeout(() => { if (progressBar) progressBar.style.display = 'none'; }, 2000);
    }
  }

  startBtn.onclick = startScan;

  ['stratRsiToggle', 'stratFundingRsiToggle', 'stratComboToggle', 'stratFundingThresh'].forEach(id => {
    const el = $(id);
    if (el) {
      el.onchange = () => {
        calculateStrategySignals();
        renderSignalMarkers(all.slice(windowStart, windowEnd));
        schedule();
      };
    }
  });

  const stratFilterBtns = document.querySelectorAll('.btn-strat-filter');
  stratFilterBtns.forEach(btn => {
    btn.onclick = () => {
      stratFilterBtns.forEach(b => {
        b.classList.remove('active');
        b.style.background = '#374151';
        b.style.color = '#cbd5e1';
      });
      btn.classList.add('active');
      btn.style.background = '#2563eb';
      btn.style.color = '#ffffff';
      currentStrategyFilter = btn.dataset.filter || 'all';
      renderStrategyList();
    };
  });

  // 페이지 시작 시 1회 백그라운드 스캔 자동 시작
  setTimeout(() => {
    if (!globalThis.ChartWorkspace?.isMulti() && !scannedCoins.length && !scannerController) {
      startScan();
    }
  }, 1000);
}

function renderScannerResults() {
  const container = $('scannerListContainer');
  if (!container) return;

  const threshold = Number($('scannerThreshold')?.value) || 40;
  let filtered = scannedCoins.filter(c => {
    if (currentFilterDir === 'gainers') return c.changePct >= threshold;
    if (currentFilterDir === 'losers') return c.changePct <= -threshold;
    return Math.abs(c.changePct) >= threshold;
  });

  filtered.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  if (!filtered.length) {
    container.innerHTML = `<div class="scanner-empty-msg">설정된 조건(±${threshold}%)에 해당하는 코인이 없습니다.</div>`;
    return;
  }

  container.innerHTML = '';
  for (const coin of filtered) {
    const card = document.createElement('div');
    card.className = 'scanner-card';
    if (surgeHighlight.active && surgeHighlight.symbol === coin.symbol) {
      card.classList.add('selected');
    }

    const isGain = coin.changePct >= 0;
    const sign = isGain ? '+' : '';
    const badgeClass = isGain ? 'gain' : 'loss';
    const arrow = isGain ? '🚀' : '🔻';

    card.innerHTML = `
      <div class="scanner-card-header">
        <div class="scanner-symbol">
          ${arrow} <span class="base">${coin.baseSymbol}</span><span style="color:#9ca3af;font-size:11px;">/USDT</span>
        </div>
        <span class="scanner-badge ${badgeClass}">${sign}${coin.changePct.toFixed(2)}%</span>
      </div>
      <div class="scanner-prices-row">
        <span>5일 전: <span class="price-val">$${ScannerEngine.formatPrice(coin.startPrice)}</span></span>
        <span>현재가: <span class="price-val">$${ScannerEngine.formatPrice(coin.currentPrice)}</span></span>
      </div>
      <div class="scanner-details-row">
        <span>5일 진폭: $${ScannerEngine.formatPrice(coin.minLow)} ~ $${ScannerEngine.formatPrice(coin.maxHigh)} (+${coin.maxGain.toFixed(1)}%)</span>
        <span>거래대금: ${ScannerEngine.formatMoney(coin.quoteVolume)}</span>
      </div>
    `;

    card.onclick = () => {
      document.querySelectorAll('.scanner-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      loadDetectedMarket({symbol:coin.symbol},{kind:'surge',coin});
      status(`[${coin.symbol}] 5일간 ${sign}${coin.changePct.toFixed(2)}% ${isGain ? '상승' : '하락'} 구간 로드 완료 · 10초간 메인 차트에 가이드 표시`);
    };

    container.appendChild(card);
  }
}

// [거래소별 실시간 펀딩비 순위 랭킹 제어]
let fundingRankController = null;
let fundingRankList = [];
let fundingRankSort = 'negative'; // 'negative' (음수순), 'positive' (양수순), 'magnitude' (극단순)
let fundingRankExchange = 'ALL';
let fundingRankThreshFilter = 'all';
let fundingRankSearchQuery = '';

function setupFundingRank() {
  const refreshBtn = $('fundingRankRefreshBtn');
  const exSelect = $('fundingRankExchangeSelect');
  const searchInput = $('fundingRankSearchInput');

  if (exSelect) {
    exSelect.onchange = () => {
      fundingRankExchange = exSelect.value;
      renderFundingRankList();
    };
  }

  const sortBtns = document.querySelectorAll('.btn-funding-sort');
  sortBtns.forEach(btn => {
    btn.onclick = () => {
      sortBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fundingRankSort = btn.dataset.sort;
      renderFundingRankList();
    };
  });

  const threshBtns = document.querySelectorAll('.btn-funding-thresh');
  threshBtns.forEach(btn => {
    btn.onclick = () => {
      threshBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      fundingRankThreshFilter = btn.dataset.thresh;
      renderFundingRankList();
    };
  });

  if (searchInput) {
    searchInput.oninput = () => {
      fundingRankSearchQuery = searchInput.value.trim().toUpperCase();
      renderFundingRankList();
    };
  }

  if (refreshBtn) {
    refreshBtn.onclick = () => startFundingRankScan();
  }

  // 페이지 시작 시 2초 뒤 1회 백그라운드 펀딩비 수집
  setTimeout(() => {
    if (!globalThis.ChartWorkspace?.isMulti() && !fundingRankList.length && !fundingRankController) {
      startFundingRankScan();
    }
  }, 2000);
}

async function startFundingRankScan() {
  fundingRankController?.abort();
  fundingRankController = new AbortController();
  const signal = fundingRankController.signal;

  const refreshBtn = $('fundingRankRefreshBtn');
  const statusText = $('fundingRankStatusText');
  const progressBar = $('fundingRankProgressBar');
  const progressFill = $('fundingRankProgressFill');
  const container = $('fundingRankListContainer');

  if (refreshBtn) {
    refreshBtn.classList.add('scanning');
    refreshBtn.textContent = '⏹️ 수집 중...';
  }
  if (progressBar) progressBar.style.display = 'block';
  if (progressFill) progressFill.style.width = '0%';
  if (statusText) statusText.textContent = '거래소별 실시간 펀딩비 데이터를 조회하는 중...';
  if (!fundingRankList.length && container) {
    container.innerHTML = '<div class="scanner-empty-msg">바이낸스, 바이비트, 비트겟, 빙엑스, MEXC 등 실시간 펀딩비를 수집 중입니다...</div>';
  }

  try {
    const results = await ScannerEngine.scanAllFundingRates({
      signal,
      onProgress: ({ completedExchanges, totalExchanges, count, exchange }) => {
        const pct = Math.round((completedExchanges / totalExchanges) * 100);
        if (progressFill) progressFill.style.width = pct + '%';
        if (statusText) statusText.textContent = `${exchange} 완료 · 총 ${count.toLocaleString()}개 계약 수집 (${completedExchanges}/${totalExchanges})`;
      }
    });

    fundingRankList = results;
    renderFundingRankList();
    if (statusText) {
      statusText.textContent = `실시간 분석 완료: 총 ${fundingRankList.length.toLocaleString()}개 계약 펀딩비 순위 산출`;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      if (statusText) statusText.textContent = '펀딩비 수집이 중지되었습니다.';
    } else {
      if (statusText) statusText.textContent = '수집 오류: ' + err.message;
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('scanning');
      refreshBtn.textContent = '🔄 갱신';
    }
    setTimeout(() => { if (progressBar) progressBar.style.display = 'none'; }, 2000);
  }
}

function renderFundingRankList() {
  const container = $('fundingRankListContainer');
  if (!container) return;

  // 1. 거래소 필터
  let filtered = [...fundingRankList];
  if (fundingRankExchange !== 'ALL') {
    filtered = filtered.filter(item => item.exchange === fundingRankExchange);
  }

  // 2. 임계값 조건 필터
  if (fundingRankThreshFilter === 'neg_01') filtered = filtered.filter(c => c.rate <= -0.1);
  else if (fundingRankThreshFilter === 'neg_05') filtered = filtered.filter(c => c.rate <= -0.5);
  else if (fundingRankThreshFilter === 'pos_005') filtered = filtered.filter(c => c.rate >= 0.05);

  // 3. 심볼 검색 필터
  if (fundingRankSearchQuery) {
    filtered = filtered.filter(c => c.symbol.toUpperCase().includes(fundingRankSearchQuery) || c.baseSymbol.toUpperCase().includes(fundingRankSearchQuery));
  }

  // 4. 순위 정렬
  if (fundingRankSort === 'negative') {
    filtered.sort((a, b) => a.rate - b.rate);
  } else if (fundingRankSort === 'positive') {
    filtered.sort((a, b) => b.rate - a.rate);
  } else if (fundingRankSort === 'magnitude') {
    filtered.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
  }

  if (!filtered.length) {
    container.innerHTML = '<div class="scanner-empty-msg">선택한 조건에 부합하는 펀딩비 코인이 없습니다.</div>';
    return;
  }

  container.innerHTML = '';
  const nowSec = Math.floor(Date.now() / 1000);
  const displayLimit = Math.min(filtered.length, 150);

  for (let i = 0; i < displayLimit; i++) {
    const item = filtered[i];
    const card = document.createElement('div');
    card.className = 'funding-rank-card';
    if ($('symbolInput')?.value === item.baseSymbol && $('exchangeSelect')?.value === item.exchange) {
      card.classList.add('selected');
    }

    const rank = i + 1;
    let rankBadgeClass = '';
    if (rank === 1) rankBadgeClass = 'gold';
    else if (rank === 2) rankBadgeClass = 'silver';
    else if (rank === 3) rankBadgeClass = 'bronze';

    const isNeg = item.rate < 0;
    const isExtremeNeg = item.rate <= -0.5;
    const isPos = item.rate > 0;
    const rateSign = isPos ? '+' : '';
    const rateClass = isExtremeNeg ? 'extreme-neg' : (isNeg ? 'neg' : (isPos ? 'pos' : ''));

    const clampedRate = Math.max(-2, Math.min(2, item.rate));
    const meterPct = Math.min(50, Math.round((Math.abs(clampedRate) / 2) * 50));

    let timeLabel = '';
    if (item.nextTime) {
      const diff = item.nextTime - nowSec;
      if (diff > 0) {
        const h = Math.floor(diff / 3600);
        const m = Math.floor((diff % 3600) / 60);
        timeLabel = `⏱️ 정산까지 ${h > 0 ? h + '시간 ' : ''}${m}분`;
      } else {
        timeLabel = '⏱️ 정산 진행 중';
      }
    } else {
      timeLabel = `⏱️ ${item.intervalHours || 8}시간 주기`;
    }

    const priceFormatted = (typeof ScannerEngine !== 'undefined') ? ScannerEngine.formatPrice(item.markPrice) : item.markPrice.toFixed(4);

    card.innerHTML = `
      <div class="funding-rank-card-header">
        <div class="funding-rank-left">
          <span class="rank-num-badge ${rankBadgeClass}">#${rank}</span>
          <span class="ex-tag ${item.exchange}">${item.exchange}</span>
          <span class="funding-rank-symbol">${item.baseSymbol}<span style="color:#9ca3af;font-size:10px;">/USDT</span></span>
        </div>
        <div class="funding-rank-rate-box">
          <span class="funding-rank-rate-val ${rateClass}">${rateSign}${item.rate.toFixed(4)}%</span>
        </div>
      </div>
      <div class="funding-meter-wrap" title="펀딩비 규모 시각화 (-2.0% ~ +2.0%)">
        <div class="funding-meter-fill ${isNeg ? 'neg' : 'pos'}" style="width: ${meterPct}%;"></div>
      </div>
      <div class="funding-rank-footer">
        <span>현재가: <strong>$${priceFormatted}</strong></span>
        <span>${timeLabel}</span>
        <button type="button" class="btn-move" style="padding:2px 8px; font-size:10px; margin-left:4px;">차트 로드</button>
      </div>
    `;

    card.onclick = () => {
      document.querySelectorAll('.funding-rank-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');

      loadDetectedMarket({ex:item.exchange,symbol:item.symbol});
      status(`[${item.exchange} ${item.symbol}] 실시간 펀딩비 ${rateSign}${item.rate.toFixed(4)}% 차트 로드 완료`);
    };

    container.appendChild(card);
  }
}

function loadDetectedMarket(value,navigation){
 if(globalThis.ChartWorkspace?.selectActive(value,navigation))return;
 const fallback=loadedMarket||{ex:$('exchangeSelect').value,symbol:$('symbolInput').value,int:$('intervalSelect').value};
 void selectWorkspaceMarket({...fallback,...value},navigation);
}
async function selectWorkspaceMarket(m,navigation){
 $('exchangeSelect').value=m.ex;$('symbolInput').value=m.symbol;$('intervalSelect').value=m.int;
 try{
  if(navigation?.kind==='surge')triggerSurgeHighlight(navigation.coin);
  const target=navigation?.kind==='date'?Number(navigation.time):navigation?.kind==='signal'?Number(navigation.signal?.eventTime||navigation.signal?.time):null;
  const task=loadData(Number.isFinite(target)?{dateTarget:target,timeframe:m.int}:{}),id=run;
  await task;if(id!==run)return;
  if(Number.isFinite(target)&&navigation.kind==='signal')focusSignal({...navigation.signal},null,true);
 }catch(error){if(error.name!=='AbortError')status(error.message,true);}
}
const chartViewActions={};
for(const [action,id]of Object.entries({ruler:'btnRuler','ruler-settings':'rulerColorSettingsBtn',lines:'btnToggleLines',indicators:'btnIndicators'})){
 const button=$(id),handler=button.onclick;chartViewActions[action]=()=>handler.call(button);
 button.onclick=event=>{if(!globalThis.ChartWorkspace?.runOnActive(action))handler.call(button,event);};
}
function loadInputMarket(){
 if(globalThis.ChartWorkspace?.selectActive({ex:$('exchangeSelect').value,symbol:$('symbolInput').value.trim().toUpperCase()})){
  if(loadedMarket){$('exchangeSelect').value=loadedMarket.ex;$('symbolInput').value=loadedMarket.symbol;}return;
 }
 void loadData();
}
globalThis.ChartWorkspace?.bind({
 workspace:chartWorkspace,host:rulerHost,symbolButton:chartSymbolLabel,
 backtest:setChartBacktest,getMarket:()=>loadedMarket||{ex:$('exchangeSelect').value,symbol:$('symbolInput').value,int:$('intervalSelect').value},
 selectMarket:selectWorkspaceMarket,action:action=>chartViewActions[action]?.(),
 onSplit:()=>{if(all.length)controller?.abort();scannerController?.abort();fundingRankController?.abort();},
 dispose:()=>{controller?.abort();navigationController?.abort();stopFundingUpdates();clearLocationGuide();clearTimeout(surgeHighlight.timer);clearInterval(surgeHighlight.countdownInterval);},
 schedule,syncFullscreen:syncChartFullscreen,fullscreen:toggleChartFullscreen,jumpDate:()=>$('gotoDateBtn').click()
});
$('searchBtn').onclick=loadInputMarket;$('symbolInput').onkeydown=e=>{if(e.key==='Enter')loadInputMarket();};$('exchangeSelect').onchange=loadInputMarket;
if(!globalThis.ChartWorkspace?.embedded){setupSidebarTabs();setupScanner();setupFundingRank();globalThis.ChartDashboard?.bind({workspace:chartWorkspace,selectMarket:loadDetectedMarket,chartWorkspace:globalThis.ChartWorkspace,backtestData:globalThis.BacktestData?.create({candlePage,fundingPage}),onBacktestJump:async(m,time)=>{if(globalThis.ChartWorkspace?.selectActive(m,{kind:'date',time}))return;if(loadedMarket&&m.ex===loadedMarket.ex&&m.symbol===loadedMarket.symbol&&m.int===loadedMarket.int)await jumpToChartDate(time,new AbortController().signal,m.int);else await selectWorkspaceMarket(m,{kind:'date',time});}});}
loadData();