'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../research/2026-10-30-funding-strategy/evaluate.cjs'),C=require('../research/2026-10-30-funding-strategy/collect.cjs');
test('research grid uses causal funding, hard stops, fixed total budgets and disjoint frozen validation dates',()=>{
 assert.equal(R.grid.length,1296);assert.equal(new Set(R.grid.map(p=>p.id)).size,1296);
 for(const p of R.grid){const c=R.config(p),weights=C.E.getStepWeights(c.splitCount,c.dcaMethod);assert.equal(c.fundingIntervalBasis,'known');assert.equal(c.minFundingRate,-.5);assert.equal(c.fundingIntervalHours,1);assert.equal(c.oneEntryPerFunding,true);assert.equal(c.stopLossMode,'immediate');assert.ok(c.stopLossPct>0);assert.equal(c.firstEntryAmount*weights.reduce((a,b)=>a+b,0),1000);assert.equal(c.entryCooldownBars*C.T.seconds[c.timeframe],p.cooldownMinutes*60);assert.equal(c.maxHoldBars*C.T.seconds[c.timeframe],43200);}
 assert.ok(C.plan.validationStart-C.plan.trainingEnd>C.plan.maxHoldSeconds);assert.equal(C.plan.heldOutSymbols.length,28);assert.equal(C.symbols.length,153);
});
test('pooled payoff is average winning return divided by average losing return, distinct from profit factor',()=>{
 const rows=[{symbol:'A',trades:3,wins:2,losses:1,grossProfit:60,grossLoss:20,netPnl:40,winReturns:6,lossReturns:2,sumReturns:4,maxDrawdownPct:2,worstTradePct:-2},{symbol:'B',trades:2,wins:1,losses:1,grossProfit:100,grossLoss:10,netPnl:90,winReturns:10,lossReturns:1,sumReturns:9,maxDrawdownPct:3,worstTradePct:-1}],s=R.aggregate(rows);
 assert.equal(s.totalTrades,5);assert.equal(s.winRatePct,60);assert.equal(s.profitFactor,160/30);assert.equal(s.riskRewardRatio,(16/3)/(3/2));assert.equal(s.worstAssetDrawdownPct,3);assert.equal(s.largestProfitAsset,'B');assert.equal(s.profitFactorExcludingBestAsset,3);
});
test('one winning trade or a loss-free result cannot qualify as a robust best strategy',()=>{
 assert.equal(R.eligibleForRanking({...R.aggregate([{trades:1,wins:1,losses:0,grossProfit:10,grossLoss:0,netPnl:10,winReturns:1,sumReturns:1}])}),false);
 assert.equal(R.eligibleForRanking({totalTrades:100,tradedAssets:10,lossTrades:10,dataGapExits:1,skippedCapital:0,profitFactor:2,riskRewardRatio:2}),false);
 assert.equal(R.eligibleForRanking({totalTrades:100,tradedAssets:10,lossTrades:10,dataGapExits:0,skippedCapital:0,profitFactor:2,riskRewardRatio:2}),true);
});
test('cost stress and funding attribution retain the entry rule while changing only declared costs/payments',()=>{
 const p=R.grid[0],base=R.config(p),stress=R.config(p,{cost:'stress'}),no=R.config(p,{cost:'no-funding'});assert.equal(base.feePct,.05);assert.equal(stress.feePct,.1);assert.equal(stress.slippagePct,.1);assert.equal(no.includeFundingPayment,false);assert.equal(no.minFundingRate,base.minFundingRate);assert.equal(no.fundingIntervalHours,base.fundingIntervalHours);
});
test('uncertainty intervals expose small samples and coin bootstraps are deterministic',()=>{
 const tiny=R.wilson(1,1),large=R.wilson(80,100);assert.ok(tiny[0]<25);assert.ok(large[0]>70);assert.ok(large[1]<90);assert.deepEqual(R.wilson(0,0),[null,null]);
 const rows=[{symbol:'A',trades:10,wins:6,losses:4,grossProfit:20,grossLoss:10,netPnl:10,winReturns:20,lossReturns:10,sumReturns:10},{symbol:'B',trades:10,wins:5,losses:5,grossProfit:10,grossLoss:20,netPnl:-10,winReturns:10,lossReturns:20,sumReturns:-10}];assert.deepEqual(R.bootstrap(rows,100),R.bootstrap(rows,100));assert.ok(R.bootstrap(rows,100).profitFactor95[0]<1);
});
