// Only fixed official public feeds; never proxy a caller-supplied URL.
export const newsSources = Object.freeze({
 BINANCE:'https://www.binance.com/bapi/apex/v1/public/apex/cms/article/list/query?type=1&pageNo=1&pageSize=20&catalogId=161',
 BYBIT:'https://api.bybit.com/v5/announcements/index?locale=en-US&type=delistings&limit=20',
 BINGX:'https://bingx.com/en/support/categories/360002065274',
 BITGET:'https://www.bitget.com/support/sections/12508313443290',
 MEXC:'https://www.mexc.fm/announcements/delistings',
 OKX:'https://www.okx.com/api/v5/support/announcements?annType=announcements-delistings&limit=20'
});
const siteHosts={BINANCE:['www.binance.com'],BYBIT:['announcements.bybit.com'],BINGX:['bingx.com','www.bingx.com'],BITGET:['www.bitget.com'],MEXC:['www.mexc.com','www.mexc.fm'],OKX:['www.okx.com']};
export function plain(value){return String(value||'').replace(/<[^>]*>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();}
export function classify(title){return /alpha/i.test(title)?'alpha':/margin|loan|collateral/i.test(title)?'margin':/perpetual|futures|contract/i.test(title)?'futures':/spot|token\(s\)|will delist [A-Z]/i.test(title)?'spot':'other';}
export function symbolsIn(title){
 if(/USDC|COIN-M|USD1-M|stock futures|X-Perp/i.test(title))return [];
 const pairs=[...title.matchAll(/\b([A-Z0-9]{1,28})\/?USDT\b/g)].map(m=>m[1]);if(pairs.length)return [...new Set(pairs)];
 const list=title.match(/(?:will delist|to delist|delist[s]?|remove)\s+([A-Z0-9][A-Z0-9,，\s]+?)(?=\s+(?:on|spot|from|and related)|\s*\(|$)/i)?.[1];
 return list?[...new Set((list.match(/\b[A-Z0-9]{2,28}\b/g)||[]).filter(s=>!['USDT','USD','UTC'].includes(s)))].slice(0,25):[];
}
function clean(exchange,row,checkedAt){
 const title=plain(row.title);if(!/delist|removal|will remove|상장폐지|거래 지원 종료/i.test(title)||/API|endpoint|withdrawal address/i.test(title))return null;
 let url;try{url=new URL(row.url);if(url.protocol!=='https:'||url.username||url.password||!siteHosts[exchange].includes(url.hostname))return null;}catch{return null;}
 url.hash='';const publishedAt=Number(row.publishedAt);
 return {exchange,dateOnly:row.dateOnly===true,title:title.slice(0,350),url:url.href,publishedAt:publishedAt>0&&Number.isFinite(publishedAt)?publishedAt:null,checkedAt,symbols:symbolsIn(title),scope:classify(title),change:/postpone|delay|suspend delisting|cancel.*delist/i.test(title)};
}
export function newsPageUrl(exchange,page=1){
 if(!Object.hasOwn(newsSources,exchange)||!Number.isSafeInteger(page)||page<1||page>10000)throw Error('잘못된 공지 페이지입니다.');
 const url=new URL(newsSources[exchange]);
 if(exchange==='BINANCE')url.searchParams.set('pageNo',String(page));
 else if(exchange==='BYBIT')url.searchParams.set('page',String(page));
 else if(exchange==='BITGET'&&page>1)url.pathname+='/'+page;
 else if(exchange==='OKX')return 'https://www.okx.com/help/section/announcements-delistings'+(page>1?'/page/'+page:'');
 else if(page>1)url.searchParams.set('page',String(page));
 return url.href;
}
export function parseNewsPage(exchange,body,checkedAt=Date.now()){
 let rows=[],total=null,hasNext=null;
 if(exchange==='BINANCE'){
  const data=JSON.parse(body);if(data.code!=='000000')throw Error('공식 공지 API 응답 확인 필요');
  const catalogs=data.data?.catalogs;if(!Array.isArray(catalogs))throw Error('공식 공지 목록 형식 확인 필요');
  rows=catalogs.flatMap(c=>c.articles||[]).map(a=>({title:a.title,url:'https://www.binance.com/en/support/announcement/detail/'+a.code,publishedAt:a.releaseDate}));
  if(Number.isFinite(Number(catalogs[0]?.total)))total=Number(catalogs[0].total);
 }else if(exchange==='BYBIT'){
  const data=JSON.parse(body);if(data.retCode!==0||!Array.isArray(data.result?.list))throw Error('공식 공지 API 응답 확인 필요');
  rows=data.result.list.map(a=>({title:a.title,url:a.url,publishedAt:a.publishTime||a.dateTimestamp}));
  if(Number.isFinite(Number(data.result.total)))total=Number(data.result.total);
 }else if(exchange==='OKX'&&body.trim().startsWith('{')){
  const data=JSON.parse(body);if(data.code!=='0'||!Array.isArray(data.data))throw Error('공식 공지 API 응답 확인 필요');
  rows=data.data.flatMap(d=>d.details||[]).map(a=>({title:a.title,url:a.url,publishedAt:a.businessPTime||a.pTime}));
 }else{
  const path=exchange==='BITGET'?/\/support\/articles\/\d+/:exchange==='MEXC'?/\/announcements\/article\/[a-z0-9-]+/:exchange==='OKX'?/\/help\/(?!section\/)[a-z0-9-]+/:/\/en\/support\/articles\/\d+/;
  const origin=exchange==='BITGET'?'https://www.bitget.com':exchange==='MEXC'?'https://www.mexc.com':exchange==='OKX'?'https://www.okx.com':'https://bingx.com';
  const anchors=[...body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  for(let i=0;i<anchors.length;i++){
   const match=anchors[i];if(!path.test(match[1]))continue;
   const end=match.index+match[0].length,following=body.slice(end,Math.min(end+600,anchors[i+1]?.index??body.length));
   const inside=plain(match[2]),after=plain(following),iso=(match[2]+following).match(/datetime=["']([^"']+)["']/i)?.[1];
   // Read publication labels beside the link, never a scheduled date in its headline.
   const date=after.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
   const english=(after+' '+(inside.match(/Published on (.+)$/i)?.[1]||'')).match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
   const publication=iso?Date.parse(iso):date?Date.parse(date+'T00:00:00Z'):english?Date.parse(english[0]+' 00:00:00 UTC'):null;
   rows.push({title:inside.replace(/\s*Published on .+$/i,''),url:new URL(match[1],origin).href,publishedAt:publication,dateOnly:!iso&&Boolean(publication)});
  }
  if(!rows.length){
   if(/no (?:articles|results|announcements) found/i.test(plain(body)))hasNext=false;
   else throw Error('공식 목록을 읽지 못했습니다. 보관 공지를 표시합니다.');
  }
  const showing=plain(body).match(/Showing\s+([\d,]+)[–-]([\d,]+)\s+of\s+([\d,]+)/i);
  if(showing){total=Number(showing[3].replace(/,/g,''));hasNext=Number(showing[2].replace(/,/g,''))<total;}
 }
 const unique=new Map();for(const row of rows){const item=clean(exchange,row,checkedAt);if(item&&!unique.has(item.url))unique.set(item.url,item);}
 return {items:[...unique.values()],rawCount:rows.length,total,hasNext,keys:[...new Set(rows.map(r=>r.url))].sort()};
}
export function parseNews(exchange,body,checkedAt=Date.now()){
 const result=parseNewsPage(exchange,body,checkedAt);
 if(!result.items.length)throw Error('공식 목록을 읽지 못했습니다. 보관 공지를 표시합니다.');
 return result.items.slice(0,25);
}
function allowedOrigin(origin,input){try{return !origin||origin===input.origin||origin==='https://didie111.github.io'||['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);}catch{return false;}}
export function createDelistingNews({fetch:fetcher=(...args)=>globalThis.fetch(...args),now=Date.now,timeout=5500}={}){
 const cache=new Map();
 async function one(exchange,signal){
  const prior=cache.get(exchange);if(prior?.expires>now())return prior.value;
  const combined=AbortSignal.any([signal,AbortSignal.timeout(timeout)]);let value;
  try{
   const response=await fetcher(newsSources[exchange],{signal:combined,headers:{Accept:'application/json,text/html','Accept-Language':'en-US,en;q=0.8'},redirect:'follow',credentials:'omit'});
   if(!response.ok)throw Error('공식 출처 HTTP '+response.status);const body=await response.text();if(body.length>3*1024*1024)throw Error('공식 목록 응답 크기 초과');
   const items=parseNews(exchange,body,now());value={items,status:'ok',checkedAt:now()};
  }catch(error){signal.throwIfAborted();value={items:prior?.value.items||[],status:'error',checkedAt:prior?.value.checkedAt||null,message:'공식 출처 갱신 지연'};}
  signal.throwIfAborted();cache.set(exchange,{value,expires:now()+(value.status==='ok'?900000:120000)});return value;
 }
 async function handle(request){
  const input=new URL(request.url),origin=request.headers.get('origin'),headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=120','Access-Control-Allow-Origin':origin&&allowedOrigin(origin,input)?origin:'https://didie111.github.io','Access-Control-Allow-Methods':'GET, OPTIONS','Vary':'Origin'};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowedOrigin(origin,input))return reply({message:'허용되지 않은 요청 출처입니다.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return reply({message:'조회 요청만 지원합니다.'},405);
  if([...input.searchParams].length)return reply({message:'조회 매개변수는 지원하지 않습니다.'},400);
  const entries=await Promise.all(Object.keys(newsSources).map(async exchange=>[exchange,await one(exchange,request.signal)]));
  return reply({items:entries.flatMap(([,value])=>value.items),sources:Object.fromEntries(entries.map(([exchange,{items,...state}])=>[exchange,state])),checkedAt:now()});
 }
 return {handle};
}
export const delistingNews=createDelistingNews();
