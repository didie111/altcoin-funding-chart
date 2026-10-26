'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),M=require('../dashboard-model.js');
const source={exchange:'BITGET',title:'Delisting of BTCUSDT Perpetual Contract',url:'https://www.bitget.com/support/articles/123',publishedAt:1000,symbols:['BTC'],scope:'futures'};
test('news accepts only HTTPS official exchange destinations',()=>{
 assert.ok(M.notice(source));for(const url of ['javascript:alert(1)','https://www.bitget.com.evil.test/support/articles/123','https://user:secret@www.bitget.com/support/articles/123','http://www.bitget.com/support/articles/123'])assert.equal(M.notice({...source,url}),null);
 assert.equal(M.notice({...source,exchange:'UNKNOWN'}),null);
});
test('deduplication keeps verified symbols and publication dates when feed metadata is incomplete',()=>{
 const values=M.mergeNotices([source],[{...source,symbols:[],publishedAt:null,checkedAt:5000}]);
 assert.equal(values.length,1);assert.equal(values[0].publishedAt,1000);assert.deepEqual(values[0].symbols,['BTC']);assert.equal(values[0].checkedAt,5000);
});
test('combined exchange, market and symbol filters never mix spot and perpetual notices',()=>{
 const values=M.mergeNotices([source,{...source,url:source.url+'4',title:'ETH spot delisting',symbols:['ETH'],scope:'spot'}]);
 assert.equal(M.filterNotices(values,{exchange:'BITGET',scope:'futures',query:'btc'}).length,1);
 assert.equal(M.filterNotices(values,{exchange:'BYBIT'}).length,0);
 assert.equal(M.filterNotices(values,{scope:'spot',query:'btc'}).length,0);
});
test('archived notices are not truncated at 240 and publication dates filter by Korean calendar day',()=>{
 const values=M.mergeNotices(Array.from({length:400},(_,i)=>({...source,url:source.url+'/'+i,publishedAt:Date.parse('2026-09-01T15:00:00Z')+i*1000})));
 assert.equal(values.length,400);assert.equal(M.filterNotices(values,{start:'2026-09-02',end:'2026-09-02'}).length,400);assert.equal(M.filterNotices(values,{end:'2026-09-01'}).length,0);
});
test('backtest preferences restore numeric fields with bounded dimensions and sane defaults',()=>{
 assert.equal(M.settings({capital:Infinity}).capital,10000);assert.equal(M.settings({height:90000}).height,280);
 const value=M.validateSettings({start:'2022-01-01',end:'2022-12-31',capital:'25000',orderSize:'25',commission:'0.03',slippage:'2'});
 assert.equal(value.capital,25000);assert.equal(value.commission,.03);assert.equal(value.slippage,2);
});
test('backtest settings reject reversed dates and invalid money/order values',()=>{
 const value={...M.settings(),start:'2022-01-01',end:'2022-12-31'};
 assert.throws(()=>M.validateSettings({...value,start:'2023-01-01'}));assert.throws(()=>M.validateSettings({...value,capital:-1}));assert.throws(()=>M.validateSettings({...value,orderSize:101}));assert.throws(()=>M.validateSettings({...value,commission:11}));
});
test('the checked-in fallback contains only verified official notices and all six exchanges',()=>{
 const data=require('../data/delistings.json');assert.equal(M.mergeNotices(data.items).length,data.items.length);assert.equal(new Set(data.items.map(n=>n.exchange)).size,6);
 assert.ok(data.items.every(n=>n.checkedAt>0&&n.title&&n.url));
});
test('following a selected chart resolves its current coin and frame instead of the saved custom target',()=>{
 const custom={ex:'BYBIT',symbol:'TUSDT',int:'1m'},first={ex:'BYBIT',symbol:'TREEUSDT',int:'3m'},second={ex:'BINGX',symbol:'SNT-USDT',int:'1h'};
 assert.deepEqual(M.backtestTarget({follow:true,custom},first),first);
 assert.deepEqual(M.backtestTarget({follow:true,custom},second),{...second,symbol:'SNTUSDT'});
 for(const int of Object.keys(M.labels))assert.equal(M.backtestTarget({follow:false,custom:{...custom,int}},first).int,int);
 assert.equal(M.backtestTarget({follow:false,custom},first).symbol,'TUSDT');
 assert.throws(()=>M.backtestTarget({follow:false,custom:{...custom,symbol:'<BTC>'}},first));
});
test('fixed-minute additions keep the selected main timeframe and progress identifies the auxiliary minute data',()=>{
 const m={ex:'BYBIT',symbol:'TREEUSDT',int:'3m'};
 assert.deepEqual(M.backtestPlan(m,'single',{splitTrigger:'rsi_cross_up_1m'}),{intervals:['3m'],requireMinuteData:true});
 assert.deepEqual(M.backtestPlan(m,'single',{splitTrigger:'rsi_cross_up'}),{intervals:['3m'],requireMinuteData:false});
 assert.match(M.backtestProgress(m,'single',{phase:'candles',timeframe:'1m',count:2000,pages:2}),/TREEUSDT · 기준 3분 \/ 보조 1분봉/);
 assert.match(M.backtestProgress(m,'single',{phase:'candles',timeframe:'3m',count:2000,pages:2}),/3분 기준 캔들/);
 assert.deepEqual(M.backtestPlan(m,'compare',{}).intervals,Object.keys(M.labels));
});
test('a stale coin, exchange or missing main timeframe is rejected before worker calculation',()=>{
 const m={ex:'BYBIT',symbol:'SNTUSDT',int:'3m'},data={exchange:m.ex,symbol:m.symbol,timeframeCandles:{'1m':[{}],'3m':[{}]}};
 M.validateBacktestDataset(data,m);
 for(const changed of [{symbol:'TUSDT'},{exchange:'BINANCE'},{timeframeCandles:{'1m':[{}]}}])assert.throws(()=>M.validateBacktestDataset({...data,...changed},m));
 assert.doesNotThrow(()=>M.validateBacktestDataset({...data,timeframeCandles:{'1m':[{}]}},m,'compare'));
});
