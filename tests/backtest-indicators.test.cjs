'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),I=require('../backtest-indicators.js'),E=require('../backtest-engine.js');
test('기본 지표는 음펀비 + RSI 이고 준비된 지표만 선택됩니다',()=>{
 assert.equal(I.DEFAULT,'funding_rsi');
 assert.deepEqual(I.list.filter(i=>i.ready).map(i=>i.id),['funding_rsi']);
 assert.equal(I.list[0].id,'funding_rsi');
});
test('저장값이 없거나 준비 안 된 지표면 기본 지표로 되돌립니다',()=>{
 assert.equal(I.resolve(undefined),'funding_rsi');
 assert.equal(I.resolve('rsi'),'funding_rsi');
 assert.equal(I.resolve('없는지표'),'funding_rsi');
 assert.equal(I.resolve('funding_rsi'),'funding_rsi');
});
test('지표 id는 중복되지 않고 이름과 분류가 있습니다',()=>{
 assert.equal(new Set(I.list.map(i=>i.id)).size,I.list.length);
 for(const i of I.list){assert.ok(i.name&&i.category);}
 assert.equal(I.find('macd'),null);
});
test('저장 설정에 indicator 키가 섞여도 설정 정규화가 깨지지 않습니다',()=>{
 assert.doesNotThrow(()=>E.normalizeConfig({indicator:'funding_rsi',follow:true}));
});
