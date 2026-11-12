'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),O=require('../backtest-overlay.js'),T=require('../timeframes.js');
// Geometry fixtures only. No generated candles or trade prices enter the app.
const base=Date.UTC(2026,8,1)/1000,market={ex:'BITGET',symbol:'BULLAUSDT',int:'1m'};
const entry=(minute,price=.1,step=1)=>({time:base+minute*60,step,avgPrice:price,takeProfit:price*1.02,stopLoss:price*.97});
function harness(options={}){
 const interval=options.interval||'1m',bars=options.bars||Array.from({length:30},(_,i)=>({time:T.shift(base,interval,i)}));
 const state={from:bars[0].time,to:bars.at(-1).time,spacing:10,offset:120,y:p=>100-p*10,...options.state};
 const scale={getVisibleRange:()=>({from:state.from,to:state.to}),options:()=>({barSpacing:state.spacing}),timeToCoordinate:time=>options.project?options.project(time,state):state.offset+(time-base)/T.seconds[interval]*state.spacing};
 const series={priceToCoordinate:p=>state.y(p),priceFormatter:()=>({format:p=>p.toFixed(8)})},chart={timeScale:()=>scale};
 const trade={id:1,entryTime:base,exitTime:base+6*60,exitPrice:.102,exitReason:'TAKE_PROFIT',entries:[entry(0)],...options.trade};
 const result={market:{...market,int:interval},trades:[trade],signals:[],...options.result};
 return {state,chart,series,bars,result,options:{chart,series,bars,width:500,height:200},scene(){return O.geometry(result,this.options);}};
}
function canvas(){
 const fills=[],strokes=[];let path=[],depth=0;
 const ctx={save(){depth++;},restore(){depth--;},beginPath(){path=[];},rect(){},clip(){},setLineDash(){},moveTo(x,y){path.push([x,y]);},lineTo(x,y){path.push([x,y]);},stroke(){strokes.push(path);},arc(){},fill(){},fillRect(){},measureText:text=>({width:text.length*6}),fillText:(text,x,y)=>fills.push({text,x,y})};
 return {ctx,fills,strokes,depth:()=>depth};
}
test('short trade labels stay connected to that trade instead of being shifted 120 pixels to its left',()=>{
 const h=harness(),scene=h.scene(),labels=O.labelLayout(scene.groups,{width:500,height:200,measure:t=>t.length*6,format:v=>v.toFixed(8)});
 assert.equal(labels.length,3);assert.ok(labels.every(l=>l.x>scene.segments[0].x2));
 for(const a of labels)for(const b of labels)if(a!==b)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
 assert.deepEqual(labels.map(l=>l.key).sort(),['avgPrice','stopLoss','takeProfit'].sort());
 assert.ok(labels.every(l=>l.anchorX===scene.segments[0].x2));
});
test('data-window replacement and prepended price history keep the same native time anchors',()=>{
 const h=harness({project:time=>120+(time-base)/60*10}),before=h.scene();
 h.options.bars=[...Array.from({length:2000},(_,i)=>({time:base+(i-2000)*60})),...h.bars];h.options.windowStart=1900;
 assert.deepEqual(h.scene(),before);assert.equal(before.segments[0].x1,120);
});
test('a trade spanning unloaded earlier prices is clipped to visible dates before projecting',()=>{
 const h=harness({trade:{entryTime:base-86400,entries:[entry(-1440)]},project:time=>time<base?null:50+(time-base)/60*10});
 assert.equal(h.scene().segments.length,3);assert.equal(h.scene().segments[0].x1,50);
});
test('lines and labels outside the visible dates never turn into backwards strokes at the left edge',()=>{
 const h=harness({state:{from:base+10*60,to:base+20*60},trade:{exitTime:base+6*60}});assert.deepEqual(h.scene().segments,[]);assert.deepEqual(h.scene().groups,[]);
 const future=harness({trade:{entryTime:base+40*60,exitTime:base+45*60,entries:[entry(40)]}});assert.equal(future.scene().segments.length,0);
});
test('a real fill inside the final displayed candle is visible, including fixed-minute DCA on a higher timeframe',()=>{
 const h=harness({interval:'1h',state:{from:base,to:base+3600,spacing:60},trade:{entryTime:base+3600,exitTime:base+64*60,entries:[entry(60),entry(62,.099,2)]}}),s=h.scene();
 assert.equal(s.segments.length,6);assert.deepEqual(s.groups.map(g=>g.step),[1,2]);assert.ok(s.segments[0].x2-s.segments[0].x1>=200);assert.equal(s.exits.length,1);
 assert.equal(s.segments[3].x1,182);assert.equal(s.exits[0].x,184);
});
test('visible DCA phases identify their own average, with TP/SL labels on the latest visible phase',()=>{
 const h=harness({trade:{exitTime:base+18*60,entries:[entry(0,.1,1),entry(6,.09,2),entry(12,.08,3)]}}),s=h.scene();
 assert.equal(s.segments.length,9);assert.deepEqual(s.groups.map(g=>g.step),[1,2,3]);
 assert.deepEqual(s.segments.filter(x=>x.key==='avgPrice').map(x=>x.value),[.1,.09,.08]);assert.ok(s.groups.at(-1).lines.every(x=>x.value<.09));
 assert.ok(s.groups.slice(0,-1).every(g=>g.lines.length===1&&g.lines[0].label===g.step+'차 평단'));
 const labels=O.labelLayout(s.groups,{width:500,height:200,measure:t=>t.length*5,format:v=>v.toFixed(4)});
 assert.ok(labels.some(l=>l.text.includes('2차 평단 0.0900')&&l.anchorX===(s.segments.find(x=>x.key==='avgPrice'&&x.step===2).x1+s.segments.find(x=>x.key==='avgPrice'&&x.step===2).x2)/2));
 h.state.to=base+8*60;const earlier=h.scene();assert.equal(earlier.groups.at(-1).step,2);assert.equal(earlier.segments.length,6);
});
test('stop loss after all splits stays absent until the engine has actually activated it',()=>{
 const first={...entry(0),stopLoss:null},last=entry(6,.09,2),h=harness({trade:{exitTime:base+12*60,entries:[first,last]}}),s=h.scene();
 assert.equal(s.segments.filter(x=>x.key==='stopLoss').length,1);assert.equal(s.segments.find(x=>x.key==='stopLoss').x1,180);
});
test('same-candle exits have a cosmetic tail without changing the exit point or overlapping the next trade',()=>{
 const h=harness({trade:{exitTime:base}}),trade=h.result.trades[0];
 h.result.trades.push({...trade,id:2,entryTime:base+120,exitTime:base+300,entries:[entry(2)]});
 const s=h.scene(),a=s.segments[0];assert.equal(a.x2,a.x1);assert.equal(s.exits[0].x,a.x2);
 assert.equal(a.tailEnd,137);
 h.state.spacing=20;const b=h.scene().segments[0];assert.equal(b.tailEnd,157);assert.equal(b.x2,a.x2);
 h.options.display={tails:false};assert.equal(h.scene().segments[0].tailEnd,a.x2);
});
test('a legacy drop entry uses its stored strategy and previous fill to place a signal separate from the next-open fill',()=>{
 const h=harness({trade:{entries:[{...entry(1),price:100},{...entry(3,.09,2),price:95}]},result:{config:{timeframe:'1m',entryTrigger:'rsi_cross_up',rsiOversold:28,splitTrigger:'step_pct',splitStepPct:9}},state:{y:p=>150-p}});
 const trace=O.entryTrace(h.result,h.result.trades[0],1);assert.equal(trace.barTime,base+120);assert.equal(trace.referencePrice,91);assert.equal(trace.low,undefined);
 const scene=h.scene(),dca=scene.entries.find(e=>e.key==='step_pct');
 assert.deepEqual(dca.signal,{x:140,y:59});assert.deepEqual(dca.fill,{x:150,y:55});
 h.options.display={step_pct:false,avgPrice:false,exit:false};
 const filtered=h.scene();assert.deepEqual(filtered.entries.map(e=>e.key),['initial']);assert.ok(filtered.segments.every(s=>s.key!=='avgPrice'));assert.deepEqual(filtered.exits,[]);
 assert.equal(h.result.trades[0].entries[1].price,95);
});
test('a fixed 1m DCA keeps the measured close and exact execution timestamp inside an hourly display',()=>{
 const h=harness({interval:'1h',state:{from:base,to:base+3600,spacing:60,y:p=>150-p},trade:{entryTime:base+3600,exitTime:base+65*60,entries:[
  {...entry(60),price:100},{...entry(64,.09,2),price:97,signal:{kind:'rsi_cross_up_1m',timeframe:'1m',time:base+64*60,barTime:base+63*60,close:98,rsi:32,threshold:30,previousRsi:28}}
 ]},result:{config:{timeframe:'1h',entryTrigger:'rsi_cross_up',splitTrigger:'rsi_cross_up_1m'}}});
 const dca=h.scene().entries.find(e=>e.key==='rsi_cross_up_1m');assert.deepEqual(dca.signal,{x:183,y:52});assert.deepEqual(dca.fill,{x:184,y:53});
 h.options.display={rsi_cross_up:false};assert.ok(h.scene().entries.some(e=>e.key==='rsi_cross_up_1m'));
});
test('missing price gaps and unprojectable timestamps do not snap trades onto a different candle',()=>{
 const bars=[{time:base},{time:base+600}],h=harness({bars,trade:{entryTime:base+120,exitTime:base+180,entries:[entry(2)]}});assert.equal(h.scene().segments.length,0);
 const absent=harness({project:()=>null});assert.equal(absent.scene().segments.length,0);
});
test('offscreen or invalid prices stay offscreen while valid lines retain their exact price coordinate',()=>{
 const h=harness({state:{y:p=>p>.101?-10:p<.099?NaN:130}}),s=h.scene();assert.equal(s.segments.length,1);assert.equal(s.segments[0].key,'avgPrice');assert.equal(s.segments[0].y,130);
});
test('calendar month interpolation uses its true month length',()=>{
 const h=harness({interval:'1M',state:{spacing:100},trade:{entryTime:base+15*86400,exitTime:base+20*86400,entries:[{...entry(0),time:base+15*86400}]}});
 assert.equal(h.scene().segments[0].x1,170);assert.ok(Math.abs(h.scene().exits[0].x-(120+200/3))<1e-8);
});
test('a spanning trade reaches the final visible candle even when the next history candle is outside the native render window',()=>{
 const h=harness({state:{from:base,to:base+120},project:time=>time>=base+180?null:120+(time-base)/60*10});
 const scene=h.scene();assert.equal(scene.segments.length,3);assert.equal(scene.segments[0].x1,120);assert.ok(scene.segments[0].x2>=150);
});
test('small panes and edge trades keep explanations inside the actual pane without text collisions',()=>{
 for(const [width,height,offset]of [[220,120,-30],[320,160,250],[100,70,20],[500,200,0]]){
  const h=harness({state:{offset}}),scene=h.scene(),labels=O.labelLayout(scene.groups,{width,height,measure:t=>t.length*5,format:String});
  for(const a of labels){assert.ok(a.x>=0&&a.x+a.width<=width&&a.y>=0&&a.y+a.height<=height);for(const b of labels)if(a!==b)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);}
 }
});
test('the native renderer reads current scale coordinates on every chart paint without a separate animation frame',()=>{
 const h=harness(),c=canvas();let updates=0,mediaCalls=0;const p=O.create(()=>({result:h.result,market,bars:h.bars})),views=p.paneViews();
 p.attached({chart:h.chart,series:h.series,requestUpdate:()=>updates++});assert.equal(updates,1);assert.equal(p.paneViews(),views);
 const renderer=views[0].renderer(),target={useMediaCoordinateSpace:callback=>{mediaCalls++;callback({context:c.ctx,mediaSize:{width:500,height:200}});}};
 renderer.draw(target);h.state.y=()=>140;h.state.offset=150;p.updateAllViews();renderer.draw(target);
 assert.equal(mediaCalls,2);assert.ok(c.strokes.some(path=>path[0]?.[0]===150&&path[0]?.[1]===140));assert.equal(c.depth(),0);
 p.invalidate();assert.equal(updates,2);p.detached();renderer.draw(target);assert.equal(mediaCalls,2);
});
test('native series attachment keeps four chart instances isolated and clears or mismatched markets draw nothing',()=>{
 const instances=Array.from({length:4},(_,i)=>{const h=harness({state:{offset:i*20}}),c=canvas();let state={result:h.result,market,bars:h.bars};const p=O.create(()=>state);
  p.attached({chart:h.chart,series:h.series,requestUpdate(){}});return {c,p,set:value=>state=value};});
 const paint=item=>item.p.paneViews()[0].renderer().draw({useMediaCoordinateSpace:callback=>callback({context:item.c.ctx,mediaSize:{width:500,height:200}})});
 instances[1].set({result:null,market,bars:[]});instances[2].set({result:harness().result,market:{...market,symbol:'BTCUSDT'},bars:[]});instances.forEach(paint);
 assert.equal(instances[1].c.fills.length,0);assert.equal(instances[2].c.fills.length,0);assert.ok(instances[0].c.fills.length>0);assert.ok(instances[3].c.fills.length>0);
});
test('the display uses the candle series price formatter and restores its canvas state if formatting fails',()=>{
 const h=harness(),c=canvas();h.series.priceFormatter=()=>({format:v=>'price:'+v});O.draw(c.ctx,h.result,h.options);assert.ok(c.fills.some(f=>f.text.includes('TP 익절 price:0.102')));assert.equal(c.depth(),0);
 h.series.priceFormatter=()=>{throw Error('format failed');};assert.throws(()=>O.draw(c.ctx,h.result,h.options),/format failed/);assert.equal(c.depth(),0);
});
test('dense zoomed-out history has bounded work and prioritizes the most recent visible trades',()=>{
 const trades=Array.from({length:200},(_,i)=>({id:i+1,entryTime:base+i*60,exitTime:base+i*60+30,exitPrice:.102,entries:[entry(i)]})),h=harness({bars:Array.from({length:200},(_,i)=>({time:base+i*60})),state:{spacing:5,offset:0},result:{market,trades,signals:[]}});h.options.width=1200;
 const s=h.scene();assert.equal(s.groups.length,80);assert.equal(s.groups[0].tradeId,121);assert.equal(s.groups.at(-1).tradeId,200);assert.equal(s.segments.length,240);
 const labels=O.labelLayout(s.groups,{width:1200,height:200,measure:t=>t.length*5,format:String});assert.ok(labels.length<=48);assert.equal(labels[0].tradeId,200);
});
test('applying and clearing results invalidate the native series overlay without a second canvas paint',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../app.js'),'utf8');let invalidations=0,markers=0,scheduled=0;
 const ctx={chartBacktestResult:null,backtestLines:{invalidate:()=>invalidations++},all:[],windowStart:0,windowEnd:0,renderSignalMarkers:()=>markers++,schedule:()=>scheduled++};vm.createContext(ctx);
 vm.runInContext(source.slice(source.indexOf('function setChartBacktest('),source.indexOf('function renderSignalMarkers(')),ctx);
 const r=harness().result;ctx.setChartBacktest(r);assert.equal(ctx.chartBacktestResult,r);ctx.setChartBacktest(null);assert.equal(ctx.chartBacktestResult,null);
 assert.equal(invalidations,2);assert.equal(markers,2);assert.equal(scheduled,2);assert.doesNotMatch(source,/BacktestOverlay\.draw\(ctx/);
});

test('다이버전스로 진입한 거래는 두 저점을 잇는 선 좌표를 장면에 담는다',()=>{
 const h=harness({trade:{entries:[{...entry(0),price:.1,signal:{kind:'div_wick',barTime:base,time:base+60,timeframe:'1m',close:.1,pivotTime:base+5*60,previousPivotTime:base+2*60,low:.09,previousLow:.095}}]}}),scene=h.scene(),e=scene.entries.find(v=>v.div);
 assert.ok(e,'장면에 다이버전스 선이 없습니다');
 assert.equal(e.div.wick,true);
 assert.ok([e.div.x1,e.div.y1,e.div.x2,e.div.y2].every(Number.isFinite));
 assert.ok(e.div.x2>e.div.x1);
 const plain=harness().scene();assert.equal(plain.entries.every(v=>!v.div),true);
 const c=canvas();O.draw(c.ctx,h.result,h.options);
 assert.ok(c.fills.some(f=>f.text==='저점1')&&c.fills.some(f=>f.text==='저점2'),'저점 표시 글자가 그려지지 않았습니다');
 assert.equal(c.depth(),0);
});

test('박스권 복귀 지지는 지지 구간·박스를 장면에 담고 진입 라벨에 등급을 붙인다',()=>{
 const sig={kind:'div_regular',barTime:base,time:base+60,timeframe:'1m',close:.1,pivotTime:base+5*60,previousPivotTime:base+2*60,low:.09,previousLow:.095,supportGrade:'box',supportZoneLow:.0875,supportZoneHigh:.0925,supportBoxLow:.086,supportBoxHigh:.094,supportBoxFrom:base,supportBoxTo:base+3*60};
 const h=harness({trade:{entries:[{...entry(0),price:.1,signal:sig}]}}),scene=h.scene(),e=scene.entries.find(v=>v.div);
 assert.ok(e&&e.div.zone&&e.div.box,'지지 구간·박스가 장면에 없습니다');
 assert.ok(e.div.zone.y2>e.div.zone.y1&&e.div.box.y2>e.div.box.y1&&e.div.box.x2>e.div.box.x1);
 assert.match(e.label,/박스권 복귀/);
 const c=canvas();O.draw(c.ctx,h.result,h.options);
 assert.ok(c.fills.some(f=>f.text==='지지 구간')&&c.fills.some(f=>f.text==='박스권'));
 assert.equal(c.depth(),0);
 const normal=harness({trade:{entries:[{...entry(0),price:.1,signal:{...sig,supportGrade:'normal',supportBoxLow:undefined,supportBoxHigh:undefined,supportBoxFrom:undefined,supportBoxTo:undefined}}]}}).scene().entries.find(v=>v.div);
 assert.ok(normal.div.zone&&!normal.div.box);assert.match(normal.label,/일반 지지/);
});
