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
 assert.equal(s.segments.length,6);assert.equal(s.groups[0].step,2);assert.equal(s.exits.length,1);
 assert.equal(s.segments[3].x1,182);assert.equal(s.exits[0].x,184);
});
test('DCA phase lines use each filled weighted average and only the last visible phase gets price explanations',()=>{
 const h=harness({trade:{exitTime:base+18*60,entries:[entry(0,.1,1),entry(6,.09,2),entry(12,.08,3)]}}),s=h.scene();
 assert.equal(s.segments.length,9);assert.equal(s.groups.length,1);assert.equal(s.groups[0].step,3);
 assert.deepEqual(s.segments.filter(x=>x.key==='avgPrice').map(x=>x.value),[.1,.09,.08]);assert.ok(s.groups[0].lines.every(x=>x.value<.09));
 h.state.to=base+8*60;const earlier=h.scene();assert.equal(earlier.groups[0].step,2);assert.equal(earlier.segments.length,6);
});
test('stop loss after all splits stays absent until the engine has actually activated it',()=>{
 const first={...entry(0),stopLoss:null},last=entry(6,.09,2),h=harness({trade:{exitTime:base+12*60,entries:[first,last]}}),s=h.scene();
 assert.equal(s.segments.filter(x=>x.key==='stopLoss').length,1);assert.equal(s.segments.find(x=>x.key==='stopLoss').x1,180);
});
test('same-candle entry and exit have a candle-sized visible segment that follows zoom rather than a fixed eight pixels',()=>{
 const h=harness({trade:{exitTime:base}}),a=h.scene().segments[0];assert.equal(a.x2-a.x1,4.5);
 h.state.spacing=20;const b=h.scene().segments[0];assert.equal(b.x2-b.x1,9);
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
