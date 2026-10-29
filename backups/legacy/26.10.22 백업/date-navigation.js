'use strict';
function bindDateNavigation({currentTime, jump}) {
  const dialog=document.getElementById('dateNavigationDialog'), form=document.getElementById('dateNavigationForm');
  const day=document.getElementById('dateNavigationDate'), clock=document.getElementById('dateNavigationTime');
  const message=document.getElementById('dateNavigationMessage'), submit=document.getElementById('dateNavigationSubmit');
  const calendar=document.getElementById('dateCalendarDays'), label=document.getElementById('dateCalendarMonth');
  let month, task=null, taskNumber=0;
  const today=()=>TimeframeEngine.kstFields(Date.now()/1000).date;
  function renderCalendar() {
    const year=month.getUTCFullYear(), number=month.getUTCMonth();
    label.textContent=year+'년 '+(number+1)+'월'; calendar.replaceChildren();
    const offset=(month.getUTCDay()+6)%7, count=new Date(Date.UTC(year,number+1,0)).getUTCDate();
    for (let i=0;i<offset;i++) calendar.append(document.createElement('span'));
    for (let date=1;date<=count;date++) {
      const value=year+'-'+String(number+1).padStart(2,'0')+'-'+String(date).padStart(2,'0');
      const button=document.createElement('button'); button.type='button'; button.textContent=String(date);
      button.className='date-calendar-day'; button.setAttribute('aria-label',value);
      button.setAttribute('aria-pressed',String(day.value===value));
      button.disabled=value>today() || value<'2009-01-01';
      button.onclick=()=>{day.value=value; message.textContent=''; renderCalendar();}; calendar.append(button);
    }
    document.getElementById('dateCalendarNext').disabled=new Date(Date.UTC(year,number+1,1)).toISOString().slice(0,10)>today();
    document.getElementById('dateCalendarPrevious').disabled=year===2009 && number===0;
  }
  function setMonth() {const parts=day.value.split('-').map(Number); if(parts.length===3 && parts.every(Number.isFinite)) {month=new Date(Date.UTC(parts[0],parts[1]-1,1));renderCalendar();}}
  function open() {
    if(dialog.open)return;
    const value=TimeframeEngine.kstFields(currentTime()); day.value=value.date; clock.value=value.time;
    day.max=today(); message.textContent=''; setMonth(); dialog.showModal(); day.focus();
  }
  function cancel() {taskNumber++;task?.abort();task=null;submit.disabled=false;submit.textContent='가기';}
  dialog.addEventListener('close',cancel);
  day.addEventListener('change',setMonth);
  document.getElementById('gotoDateBtn').onclick=open;
  document.getElementById('dateNavigationClose').onclick=()=>dialog.close();
  document.getElementById('dateNavigationCancel').onclick=()=>dialog.close();
  for (const [id,delta] of [['dateCalendarPrevious',-1],['dateCalendarNext',1]]) document.getElementById(id).onclick=()=>{month=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+delta,1));renderCalendar();};
  document.addEventListener('keydown',event=>{
    if(event.altKey && !event.ctrlKey && !event.metaKey && event.code==='KeyG' && !event.repeat && !document.querySelector('dialog[open]')) {event.preventDefault();open();}
  });
  form.onsubmit=async event=>{
    event.preventDefault(); let target;
    try {target=TimeframeEngine.parseKst(day.value,clock.value);if(target>Date.now()/1000)throw Error('현재 시각 이후로는 이동할 수 없습니다.');}
    catch(error){message.textContent=error.message;return;}
    task?.abort();task=new AbortController();const number=++taskNumber;
    submit.disabled=true;submit.textContent='조회 중…';message.textContent='선택한 날짜의 기록을 확인하고 있습니다.';
    try {await jump(target,task.signal);if(number===taskNumber && dialog.open)dialog.close();}
    catch(error){if(number===taskNumber && error.name!=='AbortError')message.textContent=error.message;}
    finally {if(number===taskNumber){submit.disabled=false;submit.textContent='가기';task=null;}}
  };
  return {open, cancel:()=>{cancel();if(dialog.open)dialog.close();}};
}
