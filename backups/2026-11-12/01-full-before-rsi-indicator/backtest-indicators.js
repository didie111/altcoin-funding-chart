(function(root,factory){'use strict';if(typeof module==='object'&&module.exports)module.exports=factory();else root.BacktestIndicators=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 // 백테스팅 설정창의 "지표 선택" 목록. ready=true 인 지표만 실제 백테스트가 가능합니다.
 // 새 지표를 완성하면 ready를 true로 바꾸고 전용 설정 창을 연결합니다. (지표는 한 번에 1개만 선택, 합치지 않음)
 const DEFAULT='funding_rsi';
 const list=[
  {id:'funding_rsi',name:'음펀비 + RSI',category:'기본',ready:true},
  {id:'rsi',name:'RSI',category:'모멘텀',ready:false},
  {id:'bollinger',name:'볼린저 밴드',category:'변동성',ready:false},
  {id:'ma_cross',name:'이동평균 교차',category:'추세',ready:false},
  {id:'stoch_rsi',name:'스토캐스틱 RSI',category:'모멘텀',ready:false},
  {id:'atr',name:'ATR 변동성',category:'변동성',ready:false},
  {id:'volume_spike',name:'거래량 급증',category:'거래량',ready:false},
  {id:'pivot_support',name:'피벗 지지선',category:'가격 구조',ready:false},
  {id:'ichimoku',name:'일목균형표',category:'추세',ready:false},
  {id:'obv',name:'OBV',category:'거래량',ready:false},
  {id:'open_interest',name:'미결제약정 변화',category:'파생',ready:false},
  {id:'long_short',name:'롱숏 비율',category:'파생',ready:false}
 ];
 const find=id=>list.find(item=>item.id===id)||null;
 // 저장된 값이 없거나, 준비되지 않은 지표이면 기본 지표로 되돌립니다.
 const resolve=id=>{const item=find(id);return item&&item.ready?item.id:DEFAULT;};
 return {DEFAULT,list,find,resolve};
});
