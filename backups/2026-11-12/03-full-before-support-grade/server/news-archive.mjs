import {newsSources,newsPageUrl,parseNewsPage} from './delisting-news.mjs';

const exchanges=Object.keys(newsSources),scopes=['all','futures','spot','alpha','margin','other'];
const day=86400000,latestTtl=15*60000,errorTtl=2*60000;
const idOf=n=>n.exchange+':'+new URL(n.url).pathname.replace(/\/$/,'');
const cursorOf=n=>btoa(JSON.stringify([n.publishedAt||0,n.id]));
const fromRow=r=>({id:r.id,exchange:r.exchange,title:r.title,url:r.url,publishedAt:r.published_at,checkedAt:r.checked_at,dateOnly:!!r.date_only,scope:r.scope,symbols:JSON.parse(r.symbols),change:!!r.changed,effectiveAt:r.effective_at});
function dateBoundary(value){
 if(!value)return null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value).toISOString().slice(0,10)!==value)throw Error('날짜를 확인해 주세요.');
 return Date.parse(value+'T00:00:00+09:00');
}
export function newsQuery(url){
 const p=url.searchParams,allowed=['exchange','scope','q','start','end','cursor','limit','mode'];
 for(const key of p.keys())if(!allowed.includes(key)||p.getAll(key).length>1)throw Error('지원하지 않는 조회 조건입니다.');
 const exchange=p.get('exchange')||'ALL',scope=p.get('scope')||'all',q=(p.get('q')||'').trim(),mode=p.get('mode')||'latest',limit=Number(p.get('limit')||30);
 if(!['ALL',...exchanges].includes(exchange)||!scopes.includes(scope)||!['latest','archive','older'].includes(mode)||q.length>80||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('조회 조건을 확인해 주세요.');
 const start=dateBoundary(p.get('start')),end=dateBoundary(p.get('end'));
 if(start!==null&&end!==null&&start>end)throw Error('시작일이 종료일보다 늦습니다.');
 let cursor=null;
 if(p.get('cursor')){
  try{if(p.get('cursor').length>1800)throw Error();cursor=JSON.parse(atob(p.get('cursor')));if(!Array.isArray(cursor)||cursor.length!==2||!Number.isSafeInteger(cursor[0])||cursor[0]<0||typeof cursor[1]!=='string'||cursor[1].length>1000)throw Error();}catch{throw Error('목록 위치가 올바르지 않습니다.');}
 }
 return {exchange,scope,q,mode,limit,start,end:end===null?null:end+day,cursor};
}

// All storage statements use bounded, parameterized queries. Schema is migration-owned.
export function createNewsStore(db){
 const stmt=(sql,values=[])=>db.prepare(sql).bind(...values);
 const upsert=(n,now)=>stmt(`INSERT INTO news_notices(id,exchange,title,url,published_at,checked_at,date_only,scope,symbols,changed,effective_at,first_seen,last_seen)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url,
 published_at=COALESCE(excluded.published_at,news_notices.published_at),checked_at=MAX(excluded.checked_at,news_notices.checked_at),
 date_only=CASE WHEN excluded.published_at IS NULL THEN news_notices.date_only ELSE excluded.date_only END,
 scope=excluded.scope,symbols=CASE WHEN excluded.symbols='[]' THEN news_notices.symbols ELSE excluded.symbols END,
 changed=excluded.changed,effective_at=CASE WHEN excluded.changed=1 THEN excluded.effective_at ELSE COALESCE(excluded.effective_at,news_notices.effective_at) END,last_seen=excluded.last_seen`,
 [idOf(n),n.exchange,n.title,n.url,n.publishedAt||null,n.checkedAt||now,n.dateOnly?1:0,n.scope,JSON.stringify(n.symbols||[]),n.change?1:0,n.effectiveAt||null,now,now]);
 return {
  async seed(items,now){
   if(await stmt("SELECT key FROM news_jobs WHERE key='seed-v1'").first())return;
   await db.batch([...items.map(n=>upsert(n,now)),stmt("INSERT OR IGNORE INTO news_jobs(key,status,retry_at,lease_until) VALUES('seed-v1','ok',0,0)")]);
  },
  async state(){
   const [jobs,history,coverage]=await Promise.all([stmt("SELECT * FROM news_jobs WHERE key IN ('BINANCE:1','BYBIT:1','BINGX:1','BITGET:1','MEXC:1','OKX:1') OR key IN (SELECT exchange||':'||next_page FROM news_history)").all(),stmt('SELECT * FROM news_history').all(),stmt('SELECT exchange,COUNT(*) AS count,MIN(published_at) AS oldest_at,MAX(published_at) AS newest_at FROM news_notices GROUP BY exchange').all()]);
   return {jobs:Object.fromEntries(jobs.results.map(r=>[r.key,r])),history:Object.fromEntries(history.results.map(r=>[r.exchange,r])),coverage:coverage.results};
  },
  async claim(key,now){
   const result=await stmt(`INSERT INTO news_jobs(key,status,retry_at,lease_until) VALUES(?,'pending',0,?)
    ON CONFLICT(key) DO UPDATE SET lease_until=excluded.lease_until WHERE news_jobs.retry_at<=? AND news_jobs.lease_until<=?`,[key,now+20000,now,now]).run();
   return result.meta.changes===1;
  },
  async seen(exchange,page,fingerprint){return !!await stmt('SELECT key FROM news_jobs WHERE fingerprint=? AND key LIKE ? AND key<>? LIMIT 1',[fingerprint,exchange+':%',exchange+':'+page]).first();},
  async success(exchange,page,result,fingerprint,now){
   const complete=result.rawCount===0||result.hasNext===false||(result.total!==null&&page*20>=result.total&&['BINANCE','BYBIT'].includes(exchange));
   const statements=result.items.map(n=>upsert(n,now));
   statements.push(stmt("UPDATE news_jobs SET status='ok',checked_at=?,retry_at=?,lease_until=0,fingerprint=?,message=NULL WHERE key=?",[now,now+(page===1?latestTtl:day),fingerprint,exchange+':'+page]));
   if(page===1)statements.push(stmt("INSERT OR IGNORE INTO news_history(exchange,next_page,status,checked_at) VALUES(?,2,?,?)",[exchange,complete?'complete':'pending',now]));
   else statements.push(stmt("INSERT INTO news_history(exchange,next_page,status,checked_at) VALUES(?,?,?,?) ON CONFLICT(exchange) DO UPDATE SET next_page=excluded.next_page,status=excluded.status,checked_at=excluded.checked_at,message=NULL",[exchange,page+1,complete?'complete':'pending',now]));
   await db.batch(statements);
  },
  async failure(exchange,page,now,message,retryAt,blocked=false){
   const statements=[stmt("UPDATE news_jobs SET status='error',retry_at=?,lease_until=0,message=? WHERE key=?",[retryAt,message,exchange+':'+page])];
   if(page>1)statements.push(stmt("INSERT INTO news_history(exchange,next_page,status,checked_at,message) VALUES(?,?,?,?,?) ON CONFLICT(exchange) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,message=excluded.message",[exchange,page,blocked?'blocked':'error',now,message]));
   await db.batch(statements);
  },
  async query(filter){
   const where=[],values=[];
   if(filter.exchange!=='ALL'){where.push('exchange=?');values.push(filter.exchange);}
   if(filter.scope!=='all'){where.push('scope=?');values.push(filter.scope);}
   if(filter.start!==null){where.push('published_at>=?');values.push(filter.start);}
   if(filter.end!==null){where.push('published_at<?');values.push(filter.end);}
   if(filter.q){where.push("(title LIKE ? ESCAPE '\\' OR symbols LIKE ? ESCAPE '\\')");const q='%'+filter.q.replace(/[\\%_]/g,'\\$&')+'%';values.push(q,q);}
   const base=where.length?' WHERE '+where.join(' AND '):'';
   const total=await stmt('SELECT COUNT(*) AS count FROM news_notices'+base,values).first();
   if(filter.cursor){where.push('(COALESCE(published_at,0)<? OR (COALESCE(published_at,0)=? AND id<?))');values.push(filter.cursor[0],filter.cursor[0],filter.cursor[1]);}
   const page=await stmt('SELECT * FROM news_notices'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY COALESCE(published_at,0) DESC,id DESC LIMIT ?',[...values,filter.limit+1]).all();
   const hasMore=page.results.length>filter.limit,items=page.results.slice(0,filter.limit).map(fromRow);
   return {items,pagination:{limit:filter.limit,total:total.count,hasMore,nextCursor:hasMore?cursorOf(items.at(-1)):null}};
  }
 };
}

export function createNewsArchive({store,seed=[],fetch:fetcher=(...a)=>globalThis.fetch(...a),now=Date.now,timeout=5500}={}){
 async function collect(exchange,page,signal){
  if(!await store.claim(exchange+':'+page,now()))return;
  let retryAt=now()+errorTtl;
  try{
   signal.throwIfAborted();
   const response=await fetcher(newsPageUrl(exchange,page),{signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),headers:{Accept:'application/json,text/html','Accept-Language':'en-US,en;q=0.8'},redirect:'follow',credentials:'omit'});
   if(!response.ok){const value=response.headers.get('retry-after');if(value){const until=/^\d+$/.test(value)?now()+Number(value)*1000:Date.parse(value);if(Number.isFinite(until))retryAt=Math.max(retryAt,until);}throw Error(response.status===429?'요청 제한 · 잠시 후 다시 확인':'공식 출처 연결 지연');}
   const body=await response.text();if(body.length>3*1024*1024)throw Error('공식 목록 응답 크기 초과');
   const result=parseNewsPage(exchange,body,now());
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(result.keys.join('|')));
   const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   if(page>1&&result.keys.length){
    if(await store.seen(exchange,page,fingerprint)){
     await store.failure(exchange,page,now(),'공식 출처가 이전 페이지와 같은 목록을 반환했습니다. 원문에서 확인해 주세요.',now()+day,true);return;
    }
   }
   await store.success(exchange,page,result,fingerprint,now());
  }catch(error){
   const message=/^(공식 |요청 제한)/.test(error.message)?error.message:'공식 출처 갱신 지연 · 보관 공지를 유지합니다.';
   await store.failure(exchange,page,now(),signal.aborted?'조회 취소 · 다시 확인할 수 있습니다.':message,retryAt);
   signal.throwIfAborted();
  }
 }
 async function handle(request){
  const url=new URL(request.url),origin=request.headers.get('origin');
  let allowed=!origin||origin===url.origin||origin==='https://didie111.github.io';
  try{allowed ||= ['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);}catch{}
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':allowed&&origin?origin:'https://didie111.github.io','Access-Control-Allow-Methods':'GET, OPTIONS','Vary':'Origin'};
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
  if(!allowed)return reply({message:'허용되지 않은 요청 출처입니다.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return reply({message:'조회 요청만 지원합니다.'},405);
  let filter;try{filter=newsQuery(url);}catch(error){return reply({message:error.message},400);}
  if(!store)return reply({message:'공지 보관함 연결을 확인하고 있습니다.'},503);
  try{
   await store.seed(seed,now());
   const selected=filter.exchange==='ALL'?exchanges:[filter.exchange];
   if(filter.mode==='latest')await Promise.all(selected.map(ex=>collect(ex,1,request.signal)));
   if(filter.mode==='older'){
    let state=await store.state();
    // Start a source with its first real page; a seed snapshot is not page 1.
    await Promise.all(selected.filter(ex=>!state.jobs[ex+':1']?.checked_at).map(ex=>collect(ex,1,request.signal)));
    state=await store.state();
    await Promise.all(selected.filter(ex=>state.jobs[ex+':1']?.checked_at&&state.history[ex]?.status!=='complete'&&state.history[ex]?.status!=='blocked').map(ex=>collect(ex,state.history[ex]?.next_page||2,request.signal)));
   }
   const [page,state]=await Promise.all([store.query(filter),store.state()]);
   const sources=Object.fromEntries(exchanges.map(ex=>{const s=state.jobs[ex+':1'];return [ex,{status:s?.status==='ok'?'ok':s?.status==='error'?'error':'pending',checkedAt:s?.checked_at||null,retryAt:s?.retry_at||null,message:s?.message||null}];}));
   const history=Object.fromEntries(exchanges.map(ex=>{const h=state.history[ex],job=state.jobs[ex+':'+(h?.next_page||2)];return [ex,{status:h?.status||'pending',nextPage:h?.next_page||2,message:h?.message||null,retryAt:job?.retry_at||null}];}));
   return reply({...page,sources,history,archive:{durable:true,total:state.coverage.reduce((s,c)=>s+c.count,0),coverage:state.coverage},checkedAt:now()});
  }catch(error){if(request.signal.aborted)throw error;return reply({message:'공지 보관함 조회가 지연되고 있습니다. 이전 목록을 유지합니다.'},503);}
 }
 return {handle};
}
