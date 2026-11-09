import {parseTemporal} from "./temporal.js";
import {deviceCurrentMonth} from "./calendar-month.js";

// UI intent and optional default-project auto-follow. All actual date changes
// are submitted to the same C++ document cursor by applyMonth; this controller
// never resolves countries, owns a second timeline or identifies map content.
export function createProjectMonthClock({
  applyMonth,now=()=>new Date(),window=null,document=null,
  canFollow=()=>true,initialAutomatic=true,onFollowChange=()=>{},
  onCommitted=()=>{},onError=()=>{},coalesceRequests=true,
}={}){
  if(typeof applyMonth!=='function')throw new TypeError('A common project timeline operation is required');
  if(typeof canFollow!=='function'||typeof onFollowChange!=='function'
    ||typeof initialAutomatic!=='boolean'||typeof coalesceRequests!=='boolean')
    throw new TypeError('Invalid project timeline follow policy');
  let automatic=initialAutomatic,committed=null,pendingMonth=null,pendingResult=null;
  let request=0,disposed=false,timer;
  const isMonth=value=>parseTemporal(value,{nullable:false}).precision==='month';
  async function change(month,mode){
    if(!isMonth(month))throw new TypeError('A query month is required');
    const ticket=++request,isCurrent=()=>!disposed&&ticket===request;
    pendingMonth=month;
    let presented=false;
    const commit=()=>{
      if(!isCurrent()||presented)return false;
      presented=true;committed=month;onCommitted(month,{mode});return true;
    };
    let applied;
    try{
      applied=coalesceRequests
        ?Promise.resolve().then(()=>isCurrent()?applyMonth(month,{isCurrent,commit,mode}):false)
        :applyMonth(month,{isCurrent,commit,mode});
    }catch(error){applied=Promise.reject(error);}
    const result=Promise.resolve(applied).then(accepted=>{
      if(!isCurrent()||accepted===false)return false;
      if(!presented)commit();
      return true;
    }).catch(error=>{
      if(!isCurrent()||error?.cancelled||error?.name==='AbortError')return false;
      throw error;
    }).finally(()=>{if(isCurrent()){pendingMonth=null;pendingResult=null;}});
    if(isCurrent())pendingResult=result;
    return result;
  }
  const setFollow=(value,mode)=>{
    if(automatic===value)return;
    automatic=value;
    onFollowChange(value,{mode});
  };
  function refresh(){
    if(!automatic||disposed||!canFollow())return Promise.resolve(false);
    const month=deviceCurrentMonth(now());
    return month===pendingMonth?pendingResult||Promise.resolve(false)
      :month===committed?Promise.resolve(false):change(month,'follow');
  }
  function schedule(){
    if(!window||disposed)return;
    window.clearTimeout(timer);
    const date=now(),next=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
    timer=window.setTimeout(()=>{
      refresh().catch(onError);schedule();
    },Math.max(1,Math.min(next-date,24*60*60*1000)));
  }
  const wake=()=>{if(!document||document.visibilityState!=='hidden')refresh().catch(onError);schedule();};
  window?.addEventListener('focus',wake);
  document?.addEventListener('visibilitychange',wake);
  schedule();
  return Object.freeze({
    month:()=>committed,
    isAutomatic:()=>automatic,
    initialize:()=>change(deviceCurrentMonth(now()),'startup'),
    followNow:()=>{setFollow(true,'follow');return change(deviceCurrentMonth(now()),'follow');},
    selectMonth:month=>{setFollow(false,'manual');return change(month,'manual');},
    refresh,
    cancelPending:()=>{request++;pendingMonth=null;pendingResult=null;},
    dispose:()=>{
      disposed=true;request++;pendingResult=null;
      window?.clearTimeout(timer);
      window?.removeEventListener('focus',wake);
      document?.removeEventListener('visibilitychange',wake);
    },
  });
}
