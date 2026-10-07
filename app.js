'use strict';
const $ = id => document.getElementById(id);
const LC = LightweightCharts;
const chart = LC.createChart($('unified-chart'), {
 autoSize:true, layout:{background:{type:'solid',color:'#111827'},textColor:'#9ca3af',panes:{separatorColor:'#374151',separatorHoverColor:'#4b5563'}},
 grid:{vertLines:{color:'#1f2937'},horzLines:{color:'#1f2937'}},
 crosshair:{mode:LC.CrosshairMode.Normal},rightPriceScale:{minimumWidth:100,borderColor:'#374151'},
 timeScale:{timeVisible:true,secondsVisible:false,rightOffset:3,tickMarkFormatter:t=>new Date(Number(t)*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})},localization:{locale:'ko-KR',timeFormatter:t=>new Date(Number(t)*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})}
});
const candles=chart.addSeries(LC.CandlestickSeries,{upColor:'#22c55e',downColor:'#ef4444',borderVisible:false,wickUpColor:'#22c55e',wickDownColor:'#ef4444',priceFormat:{type:'price',precision:8,minMove:0.00000001}},0);
const volume=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'volume'},lastValueVisible:false},1);
const funding=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'custom',minMove:0.000001,formatter:v=>v.toFixed(6)+'%'},lastValueVisible:false},2);
const settlementCycle=chart.addSeries(LC.HistogramSeries,{priceFormat:{type:'custom',minMove:1,formatter:v=>v+'시간'},lastValueVisible:false,priceLineVisible:false},3);
const cycleMarkers=LC.createSeriesMarkers(settlementCycle,[]);
chart.panes()[3].setStretchFactor(1.5);
const cycleCaption=document.createElement('div');cycleCaption.style.cssText='padding:4px 12px;font-size:12px;color:#cbd5e1';cycleCaption.textContent='정산 주기: 기록 대기 · 8h 파랑 / 4h 주황 / 1h 빨강';$('coverage').before(cycleCaption);
let cycleHistory=[],cycleTransitions=[],cycleValues=new Map();
chart.panes()[0].setStretchFactor(6);chart.panes()[1].setStretchFactor(1.5);chart.panes()[2].setStretchFactor(2.5);
funding.createPriceLine({price:0,color:'#6b7280',lineWidth:1,lineStyle:LC.LineStyle.Dotted,axisLabelVisible:false});
const markers=LC.createSeriesMarkers(candles,[]);
let all=[],rates=[],signals=[],mapped=new Map(),controller,run=0,windowStart=0,windowEnd=0,showLines=true,log=false,busy=false,selectedSignal=null,changingWindow=false;
let selectedGuideVisible=false, selectedGuideTimer, selectedCountdownTimer, selectedGuideDeadline=0;
const WINDOW=10000, duration={'15m':900,'1h':3600,'4h':14400,'1d':86400};
const overlay=document.createElement('canvas');overlay.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:4';$('unified-chart').append(overlay);
const guideCountdown=document.createElement('div');guideCountdown.hidden=true;guideCountdown.style.cssText='position:absolute;top:12px;pointer-events:none;z-index:6;padding:7px 12px;background:#fbbf24;color:#111827;border:2px solid #fffbeb;border-radius:8px;font-size:14px;font-weight:800;white-space:nowrap;box-shadow:0 2px 10px #000b;transform:translateX(-50%)';guideCountdown.setAttribute('role','timer');guideCountdown.setAttribute('aria-label','선택 신호 기준선 남은 시간');$('unified-chart').append(guideCountdown);
function updateGuideCountdown(){const seconds=Math.max(0,Math.ceil((selectedGuideDeadline-performance.now())/1000));const label='기준선 '+seconds+'초';if(guideCountdown.textContent!==label)guideCountdown.textContent=label;}
const ctx=overlay.getContext('2d');let frame=0;
const date=t=>new Date(t*1000).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
const status=(s,error=false)=>{$('status-msg').textContent=s;$('status-msg').classList.toggle('error',error);};
function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;draw();});}
function draw(){const w=$('unified-chart').clientWidth,h=$('unified-chart').clientHeight,dpr=devicePixelRatio||1;
 if(overlay.width!==Math.round(w*dpr)||overlay.height!==Math.round(h*dpr)){overlay.width=Math.round(w*dpr);overlay.height=Math.round(h*dpr);overlay.style.width=w+'px';overlay.style.height=h+'px';}
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);guideCountdown.hidden=true;drawRuler(w,h);placeChartNavigation();
 if(selectedSignal&&selectedGuideVisible){const x=chart.timeScale().timeToCoordinate(selectedSignal.time);if(x!==null&&x>=0&&x<=w-100){guideCountdown.hidden=false;guideCountdown.style.left=Math.max(65,Math.min(w-165,x))+'px';ctx.strokeStyle='#fbbf24';ctx.lineWidth=2;ctx.setLineDash([6,3]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h-28);ctx.stroke();ctx.lineWidth=1;}}
 if(!showLines)return;
 const range=chart.timeScale().getVisibleRange();if(!range)return;
 // At most one guide per screen pixel, only within the visible time interval.
 let last=-100;let i=lowerBound(signals,Number(range.from));
 for(;i<signals.length&&signals[i].time<=Number(range.to);i++){const s=signals[i],x=chart.timeScale().timeToCoordinate(s.time);if(x===null||x-last<2)continue;last=x;ctx.strokeStyle=s.type==='EXTREME'?'#a855f780':'#ef444480';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h-28);ctx.stroke();}
}


let rulerEnabled=false,rulerStart=null,rulerEnd=null,rulerLocked=false,shiftHeld=false,rulerTemporary=false,rulerDragging=false,rulerPointer=null;
const rulerBtn=$('btnRuler');rulerBtn.className='btn-toggle';rulerBtn.textContent='📏 줄자';rulerBtn.title='드래그로 측정 · Shift+드래그: 임시 줄자 · Esc 종료';rulerBtn.setAttribute('aria-pressed','false');
const rulerLabel=document.createElement('div');rulerLabel.hidden=true;rulerLabel.style.cssText='position:absolute;pointer-events:none;z-index:7;background:#2563eb;color:#fff;border:1px solid #93c5fd;padding:8px 12px;border-radius:4px;font-size:13px;font-weight:700;line-height:1.6;text-align:center;white-space:pre-line;box-shadow:0 2px 8px #0009;max-width:280px';$('unified-chart').append(rulerLabel);
function priceChange(start,end){if(!Number.isFinite(start)||!Number.isFinite(end)||start<=0)return null;return {difference:end-start,percent:(end-start)/start*100};}
function clearRuler(){rulerStart=null;rulerEnd=null;rulerLocked=false;rulerTemporary=false;rulerLabel.hidden=true;schedule();}
function rulerInteraction(){const active=rulerEnabled||shiftHeld||rulerDragging;chart.applyOptions({handleScroll:!active,handleScale:!active});$('unified-chart').style.cursor=active?'crosshair':'';}
function endRulerDrag(){if(rulerPointer!==null&&$('unified-chart').hasPointerCapture(rulerPointer))$('unified-chart').releasePointerCapture(rulerPointer);rulerDragging=false;rulerPointer=null;rulerInteraction();}
function toggleRuler(enabled){endRulerDrag();rulerEnabled=enabled;rulerBtn.classList.toggle('active',enabled);rulerBtn.setAttribute('aria-pressed',String(enabled));clearRuler();rulerInteraction();if(enabled)status('줄자: 가격 차트에서 누른 채 드래그하세요. Shift+드래그도 가능 · Esc 종료');}
rulerBtn.onclick=()=>toggleRuler(!rulerEnabled);
function typingTarget(t){return t instanceof Element&&Boolean(t.closest('input,textarea,select,[contenteditable="true"]'));}
document.addEventListener('keydown',e=>{if(typingTarget(e.target))return;if(e.key==='Shift'&&!shiftHeld){shiftHeld=true;rulerInteraction();}if(e.key==='Escape'){shiftHeld=false;toggleRuler(false);}});
document.addEventListener('keyup',e=>{if(e.key==='Shift'){shiftHeld=false;rulerInteraction();}});
window.addEventListener('blur',()=>{shiftHeld=false;if(rulerDragging){endRulerDrag();rulerLocked=true;}rulerInteraction();});
const rulerHost=$('unified-chart');
function pointerPrice(e,clamp=false){const box=rulerHost.getBoundingClientRect();let x=e.clientX-box.left,y=e.clientY-box.top;const width=chart.timeScale().width(),height=chart.panes()[0].getHeight();
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
 const x1=chart.timeScale().logicalToCoordinate(rulerStart.index-windowStart),x2=chart.timeScale().logicalToCoordinate(rulerEnd.index-windowStart),y1=candles.priceToCoordinate(rulerStart.price),y2=candles.priceToCoordinate(rulerEnd.price);
 if([x1,x2,y1,y2].some(v=>v===null))return;const change=priceChange(rulerStart.price,rulerEnd.price);if(!change)return;
 const color=change.percent>=0?'#3b82f6':'#ef4444';const ph=chart.panes()[0].getHeight();ctx.save();ctx.beginPath();ctx.rect(0,0,w-100,ph);ctx.clip();ctx.setLineDash([]);ctx.strokeStyle=color;ctx.fillStyle=change.percent>=0?'#3b82f633':'#ef444433';ctx.lineWidth=1.5;ctx.fillRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctx.strokeRect(Math.min(x1,x2),Math.min(y1,y2),Math.abs(x2-x1),Math.abs(y2-y1));ctx.beginPath();const mx=(x1+x2)/2,my=(y1+y2)/2;ctx.moveTo(x1,my);ctx.lineTo(x2,my);ctx.moveTo(mx,y1);ctx.lineTo(mx,y2);ctx.stroke();for(const [ax,ay,dx,dy] of [[x2,my,-Math.sign(x2-x1)*6,0],[mx,y2,0,-Math.sign(y2-y1)*6]]){ctx.beginPath();ctx.moveTo(ax+dx+(dy?4:0),ay+dy+(dx?4:0));ctx.lineTo(ax,ay);ctx.lineTo(ax+dx-(dy?4:0),ay+dy-(dx?4:0));ctx.stroke();}
 for(const [x,y] of [[x1,y1],[x2,y2]]){ctx.beginPath();ctx.fillStyle=color;ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();}ctx.restore();

 const details=measureDetails(rulerStart,rulerEnd),sign=change.percent>=0?'+':'';rulerLabel.textContent=`${change.difference>=0?'+':''}${change.difference.toPrecision(6)} (${sign}${change.percent.toFixed(2)}%)\n${details.bars}봉 · ${details.period}\n거래량 ${new Intl.NumberFormat('ko-KR',{notation:'compact',maximumFractionDigits:2}).format(details.volume)}`;
 rulerLabel.style.background=color;rulerLabel.style.borderColor=color;rulerLabel.style.left=Math.max(8,Math.min(w-370,(x1+x2)/2-100))+'px';rulerLabel.style.top=Math.max(8,Math.min(ph-85,Math.min(y1,y2)-85))+'px';rulerLabel.hidden=false;
 ctx.save();ctx.setLineDash([]);ctx.font='bold 11px sans-serif';ctx.textAlign='left';for(const [price,y] of [[rulerStart.price,y1],[rulerEnd.price,y2]]){if(y<0||y>ph)continue;ctx.fillStyle=color;ctx.fillRect(w-100,y-9,100,18);ctx.fillStyle='#fff';ctx.fillText(price.toPrecision(7),w-96,y+4);}ctx.restore();

}


let navigationPane=3;
const chartNavigation=document.createElement('div');chartNavigation.dataset.chartNav='true';chartNavigation.setAttribute('role','toolbar');chartNavigation.setAttribute('aria-label','차트 확대 및 좌우 이동');chartNavigation.style.cssText='position:absolute;z-index:9;display:flex;gap:4px;transform:translateX(-50%);padding:3px;border-radius:6px;background:#111827dd;box-shadow:0 1px 8px #0006;pointer-events:auto';
$('unified-chart').append(chartNavigation);
function moveChartRange(range){if(!all.length)return;const absolute={from:range.from+windowStart,to:range.to+windowStart},middle=(absolute.from+absolute.to)/2;
 if(absolute.from<windowStart||absolute.to>=windowEnd)renderWindow(Math.max(0,Math.min(all.length-1,middle)),false,240,absolute);else chart.timeScale().setVisibleLogicalRange(range);
 $('historyPosition').value=Math.max(0,Math.min(all.length-1,Math.round(middle)));schedule();}
function navigationRange(range,action){const span=Math.max(8,range.to-range.from),center=(range.from+range.to)/2;if(action==='left'||action==='right'){const shift=span*.25*(action==='left'?-1:1);return {from:range.from+shift,to:range.to+shift};}
 const width=Math.max(8,Math.min(Math.max(10000,all.length*1.5),span*(action==='in'?.8:1.25)));return {from:center-width/2,to:center+width/2};}
function navigateChart(action){if(!all.length)return;
 if(action==='reset'){resetScales();const span=Math.min(180,Math.max(20,all.length*1.2)),end=all.length-1;moveChartRange({from:end-span+5-windowStart,to:end+5-windowStart});}
 else {const range=chart.timeScale().getVisibleLogicalRange();if(range)moveChartRange(navigationRange(range,action));}}
for(const [action,label,title] of [['out','−','축소'],['in','+','확대'],['left','‹','이전 구간으로 이동'],['right','›','다음 구간으로 이동'],['reset','↺','최근 차트로 이동 및 화면 초기화']]){
 const button=document.createElement('button');button.type='button';button.textContent=label;button.title=title;button.setAttribute('aria-label',title);button.style.cssText='width:30px;height:28px;padding:0;background:#263244;border:1px solid #475569;color:#e2e8f0;border-radius:4px;font-size:20px;line-height:24px';
 button.onclick=e=>{e.stopPropagation();navigateChart(action);};button.onmouseenter=()=>button.style.background='#475569';button.onmouseleave=()=>button.style.background='#263244';chartNavigation.append(button);
}
chartNavigation.addEventListener('pointerdown',e=>e.stopPropagation());chartNavigation.addEventListener('dblclick',e=>e.stopPropagation());
function placeChartNavigation(){const panes=chart.panes();if(!panes.length)return;navigationPane=Math.min(navigationPane,panes.length-1);let bottom=0;for(let i=0;i<=navigationPane;i++)bottom+=panes[i].getHeight()+ (i?1:0);chartNavigation.style.left=chart.timeScale().width()/2+'px';chartNavigation.style.top=Math.max(4,bottom-38)+'px';}
$('unified-chart').addEventListener('mousemove',e=>{if(rulerDragging)return;const y=e.clientY-$('unified-chart').getBoundingClientRect().top;let bottom=0;for(const [i,pane] of chart.panes().entries()){bottom+=pane.getHeight()+(i?1:0);if(y<bottom){navigationPane=i;placeChartNavigation();break;}}});
new ResizeObserver(placeChartNavigation).observe($('unified-chart'));

function lowerBound(a,t){let l=0,r=a.length;while(l<r){const m=(l+r)>>>1;if(a[m].time<t)l=m+1;else r=m;}return l;}
function thresholds(){const warn=Number($('warnThresh').value),ext=Number($('extThresh').value);if(!$('warnThresh').value||!$('extThresh').value||!Number.isFinite(warn)||!Number.isFinite(ext)||ext>warn)throw Error('극단 경고는 1차 경고 이하의 숫자로 입력하세요.');return {warn,ext};}
function rebuild(){const {warn,ext}=thresholds();mapped=new Map();signals=[];
 // Merge in O(candles + funding records); keep missing data as missing, never fabricated zero.
 let i=0;for(const f of rates){while(i+1<all.length&&all[i+1].time<=f.time)i++;const c=all[i];if(!c||f.time<c.time||f.time>=c.time+duration[$('intervalSelect').value])continue;
 const old=mapped.get(c.time);if(!old||f.rate<old.rate)mapped.set(c.time,{time:c.time,rate:f.rate,events:(old?.events||0)+1});else old.events++;
 const type=f.rate<=ext?'EXTREME':f.rate<=warn?'WARN':null;if(type)signals.push({time:c.time,eventTime:f.time,rate:f.rate,type});}
 rebuildCycles();renderList();}

function observedCycles(records){const periods=[];const allowed=[1,2,4,8,12,24];for(let i=1;i<records.length;i++){const seconds=records[i].time-records[i-1].time;const hours=allowed.find(h=>Math.abs(seconds-h*3600)<=60);periods.push({start:records[i-1].time,end:records[i].time,hours:hours??null});}
 // An isolated larger gap surrounded by a shorter cadence can be missing records.
 for(let i=0;i<periods.length;i++){const p=periods[i],before=periods[i-1],after=periods[i+1];if(before&&after&&before.hours===after.hours&&before.hours&&p.hours>before.hours){p.hours=null;p.gap=true;}}
 return periods;}
function rebuildCycles(){cycleHistory=observedCycles(rates);cycleTransitions=[];cycleValues=new Map();let previous=null;
 for(const p of cycleHistory){if(p.hours===null){previous=null;continue;}if(previous!==null&&previous!==p.hours)cycleTransitions.push({time:p.end,from:previous,to:p.hours});previous=p.hours;}
 // Intersect actual settlement-to-settlement periods with candle intervals, linear scan.
 let i=0;const seconds=duration[$('intervalSelect').value];for(const c of all){while(i<cycleHistory.length&&cycleHistory[i].end<=c.time)i++;let value=null,unknown=false;for(let j=i;j<cycleHistory.length&&cycleHistory[j].start<c.time+seconds;j++){const p=cycleHistory[j];if(p.end<=c.time)continue;if(p.hours===null)unknown=true;else value=value===null?p.hours:Math.min(value,p.hours);}
 if(value!==null)cycleValues.set(c.time,{hours:value,mixed:unknown});}
 const latest=cycleHistory.at(-1);cycleCaption.textContent=`정산 주기(기록 간격 관측): ${latest?.hours?latest.hours+'시간':'확인 불가'} · 전환 ${cycleTransitions.length}회 · 8h 파랑 / 4h 주황 / 1h 빨강 · 일봉 등은 봉 내 최소 간격 · 데이터 누락 시 실제 정책과 다를 수 있음`;}
function cycleColor(h){return h===1?'#ef4444':h===4?'#f59e0b':h===8?'#3b82f6':'#a78bfa';}
function renderCycles(part){settlementCycle.setData(part.map(c=>{const p=cycleValues.get(c.time);return p?{time:c.time,value:p.hours,color:cycleColor(p.hours)}:{time:c.time};}));
 const map=new Map();for(const t of cycleTransitions){const i=lowerBound(all,t.time);const k=all[i]?.time===t.time?all[i]:all[i-1];if(k&&k.time>=part[0].time&&k.time<=part.at(-1).time)map.set(k.time,{time:k.time,position:'aboveBar',color:cycleColor(t.to),shape:'arrowDown',text:t.from+'h → '+t.to+'h'});}
 cycleMarkers.setMarkers(map.size<=150?[...map.values()]:[]);}

function resetScales(){for(const series of [candles,volume,funding,settlementCycle])series.priceScale().applyOptions({autoScale:true,scaleMargins:{top:0.12,bottom:0.12}});$('btnAutoFit').classList.add('active');}
function centeredRange(index,span=240){return {from:index-span/2,to:index+span/2};}
function focusSignal(s,element){selectedSignal=s;selectedGuideVisible=true;clearTimeout(selectedGuideTimer);clearInterval(selectedCountdownTimer);selectedGuideDeadline=performance.now()+5000;updateGuideCountdown();selectedCountdownTimer=setInterval(updateGuideCountdown,100);selectedGuideTimer=setTimeout(()=>{selectedGuideVisible=false;clearInterval(selectedCountdownTimer);guideCountdown.hidden=true;schedule();},5000);for(const el of $('signalListContainer').querySelectorAll('.signal-item')){el.style.outline='';el.setAttribute('aria-current','false');}element.style.outline='2px solid #fbbf24';element.setAttribute('aria-current','true');
 const old=chart.timeScale().getVisibleLogicalRange();const span=old?Math.max(80,Math.min(600,old.to-old.from)):240;
 renderWindow(lowerBound(all,s.time),true,span);
 chart.clearCrosshairPosition();
 $('chart-key').textContent=`선택 신호: ${date(s.eventTime)} · ${s.rate.toFixed(6)}% · 노란선: 해당 ${$('intervalSelect').selectedOptions[0].text} 캔들 (${date(s.time)})`;
 status(`신호 이동 완료 · ${date(s.eventTime)} · ${s.rate.toFixed(6)}%`);schedule();}
function renderWindow(center,focus=true,span=240,preservedRange=null){if(!all.length)return;changingWindow=true;clearTimeout(navTimer);windowStart=Math.max(0,Math.min(all.length-WINDOW,Math.floor(center-WINDOW/2)));windowEnd=Math.min(all.length,windowStart+WINDOW);const part=all.slice(windowStart,windowEnd),{warn,ext}=thresholds();
 candles.setData(part.map(({time,open,high,low,close})=>({time,open,high,low,close})));
 volume.setData(part.map(c=>({time:c.time,value:c.volume,color:c.close>=c.open?'#22c55e80':'#ef444480'})));
 funding.setData(part.map(c=>{const f=mapped.get(c.time);return f?{time:c.time,value:f.rate,color:f.rate<=ext?'#a855f7':f.rate<=warn?'#ef4444':'#3b82f6'}:{time:c.time};}));
 renderCycles(part);
 const visible=signals.slice(lowerBound(signals,part[0].time),lowerBound(signals,part.at(-1).time+1));
 // Dense signal histories use guides/sidebar instead of thousands of label objects.
 const unique=new Map();for(const s of visible){const old=unique.get(s.time);if(!old||s.rate<old.rate)unique.set(s.time,s);}
 markers.setMarkers(unique.size<=300?[...unique.values()].map(s=>({time:s.time,position:'aboveBar',color:s.type==='EXTREME'?'#a855f7':'#ef4444',shape:'arrowDown',text:s.rate.toFixed(3)+'%'})):[]);
 $('historyPosition').max=Math.max(0,all.length-1);$('historyPosition').value=Math.max(0,Math.min(all.length-1,center));
 $('historyInfo').textContent=`${all.length.toLocaleString()}봉 · 화면 구간 ${date(part[0].time)} ~ ${date(part.at(-1).time)}`;
 if(focus){const ix=Math.max(0,Math.min(part.length-1,center-windowStart));resetScales();chart.timeScale().setVisibleLogicalRange(centeredRange(ix,Math.min(span,Math.max(20,all.length*1.2))));}else if(preservedRange){chart.timeScale().setVisibleLogicalRange({from:preservedRange.from-windowStart,to:preservedRange.to-windowStart});}requestAnimationFrame(()=>{changingWindow=false;schedule();});}
let listOffset=0;function renderList(){listOffset=0;$('signalListContainer').replaceChildren();$('signalCountTag').textContent=signals.length+'개';appendList();}
function appendList(){const container=$('signalListContainer');container.querySelector('.more')?.remove();const end=Math.min(signals.length,listOffset+100);const fragment=document.createDocumentFragment();for(;listOffset<end;listOffset++){const s=signals[signals.length-1-listOffset],el=document.createElement('div');el.className='signal-item '+s.type;const text=document.createElement('div');text.textContent=`${date(s.eventTime)} · ${s.rate.toFixed(6)}%`;el.append(text);el.onclick=()=>focusSignal(s,el);fragment.append(el);}container.append(fragment);if(listOffset<signals.length){const b=document.createElement('button');b.className='more';b.textContent='신호 100개 더 보기';b.onclick=appendList;container.append(b);}if(!signals.length)container.textContent='설정 조건에 해당하는 펀딩비 신호 없음';}
chart.subscribeCrosshairMove(p=>{if(selectedSignal)return;if(!p.time)return;const c=p.seriesData.get(candles),v=p.seriesData.get(volume),f=p.seriesData.get(funding),cycle=p.seriesData.get(settlementCycle);$('chart-key').textContent=`${date(Number(p.time))} · 종가 ${c?.close??'—'} · 거래량 ${v?.value??'—'} · 펀딩비 ${f?.value!==undefined?f.value.toFixed(6)+'%':'기록 없음'} (봉 내 최저 실현율) · 정산 간격 ${cycle?.value!==undefined?cycle.value+'시간':'기록 없음'}`;});
let navTimer;chart.timeScale().subscribeVisibleLogicalRangeChange(r=>{schedule();if(!r||busy||changingWindow)return;clearTimeout(navTimer);navTimer=setTimeout(()=>{const absolute={from:r.from+windowStart,to:r.to+windowStart};const middle=(absolute.from+absolute.to)/2;if((r.from<20&&windowStart>0)||(r.to>windowEnd-windowStart-20&&windowEnd<all.length))renderWindow(middle,false,240,absolute);},180);});
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
async function loadData(){try{thresholds();}catch(e){return status(e.message,true);}const symbol=$('symbolInput').value.trim().toUpperCase();if(!/^[A-Z0-9_-]+$/.test(symbol))return status('유효한 심볼을 입력하세요.',true);
 controller?.abort();controller=new AbortController();const signal=controller.signal,id=++run,ex=$('exchangeSelect').value,int=$('intervalSelect').value;busy=true;clearRuler();selectedSignal=null;all=[];rates=[];signals=[];mapped.clear();candles.setData([]);volume.setData([]);funding.setData([]);settlementCycle.setData([]);cycleMarkers.setMarkers([]);cycleHistory=[];cycleTransitions=[];cycleValues.clear();cycleCaption.textContent='정산 주기: 이력 수집 중';markers.setMarkers([]);renderList();
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
 if(id!==run)return;rebuild();renderWindow(all.length-1);busy=false;
 $('coverage').textContent=`캔들: ${date(all[0].time)} ~ ${date(all.at(-1).time)} (${candleNote}) · 펀딩비: ${rates.length?date(rates[0].time)+' ~ '+date(rates.at(-1).time):'확인된 기록 없음'} (${fundNote||'미수집'}) · 봉 내 최저 실현 펀딩비 표시; 기록 없는 구간은 공백. ${ex==='OKX'?'OKX 펀딩비 API는 최근 3개월 제공. ':''}${ex==='MEXC'?'거래량 단위: 계약 수. ':'거래량 단위: 기초자산. '}`;
 status(`${ex} ${symbol} · ${all.length.toLocaleString()}봉 / 펀딩비 ${rates.length.toLocaleString()}건`,!rates.length);
}
$('searchBtn').onclick=loadData;$('symbolInput').onkeydown=e=>{if(e.key==='Enter')loadData();};$('stopBtn').onclick=()=>controller?.abort();
$('oldestBtn').onclick=()=>renderWindow(0);$('latestBtn').onclick=()=>renderWindow(all.length-1);
let sliderTimer;$('historyPosition').oninput=()=>{clearTimeout(sliderTimer);sliderTimer=setTimeout(()=>renderWindow(+$('historyPosition').value),100);};
$('btnToggleLines').onclick=function(){showLines=!showLines;this.classList.toggle('active',showLines);schedule();};
$('btnLogScale').onclick=function(){log=!log;candles.priceScale().applyOptions({mode:log?LC.PriceScaleMode.Logarithmic:LC.PriceScaleMode.Normal});this.classList.toggle('active',log);};
$('btnAutoFit').onclick=()=>{resetScales();chart.timeScale().fitContent();schedule();};
for(const id of ['warnThresh','extThresh'])$(id).onchange=()=>{try{rebuild();renderWindow(+$('historyPosition').value);}catch(e){status(e.message,true);}};
loadData();
