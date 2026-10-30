import {parseTemporal} from './temporal.js';
export const deviceCurrentMonth=(now=new Date())=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

// Owns builtin query mode only. It never schedules changes to a user document.
export function createBuiltinMonthClock({applyMonth,now=()=>new Date(),window=null,document=null,onCommitted=()=>{},onError=()=>{}}){
 if(typeof applyMonth!=='function')throw new TypeError('Builtin month application is required');
 let automatic=true,committed=null,pendingMonth=null,pendingResult=null,request=0,disposed=false,timer;
 async function change(month){
  if(parseTemporal(month,{nullable:false}).precision!=='month')throw new Error('A query month is required');
  const ticket=++request,isCurrent=()=>!disposed&&ticket===request;pendingMonth=month;
  let presented=false;
  const commit=()=>{if(!isCurrent()||presented)return false;presented=true;committed=month;onCommitted(month);return true;};
  let applied;
  try{applied=applyMonth(month,{isCurrent,commit});}catch(error){applied=Promise.reject(error);}
  const result=Promise.resolve(applied).then(accepted=>{
   if(!isCurrent()||accepted===false)return false;
   if(!presented)commit();return true;
  }).catch(error=>{if(!isCurrent()||error.cancelled)return false;throw error;})
   .finally(()=>{if(isCurrent()){pendingMonth=null;pendingResult=null;}});
  if(isCurrent())pendingResult=result;
  return result;
 }
 async function refresh(){if(!automatic||disposed)return false;const month=deviceCurrentMonth(now());return month===pendingMonth?pendingResult:month===committed?false:change(month);}
 function schedule(){
  if(!window||disposed)return;
  window.clearTimeout(timer);const date=now(),next=new Date(date.getFullYear(),date.getMonth(),date.getDate()+1);
  timer=window.setTimeout(()=>{refresh().catch(onError);schedule();},Math.max(1,Math.min(next-date,24*60*60*1000)));
 }
 const wake=()=>{if(!document||document.visibilityState!=='hidden')refresh().catch(onError);schedule();};
 window?.addEventListener('focus',wake);document?.addEventListener('visibilitychange',wake);schedule();
 return Object.freeze({month:()=>committed,isAutomatic:()=>automatic,
  followNow:()=>{automatic=true;return change(deviceCurrentMonth(now()));},
  selectMonth:month=>{automatic=false;return change(month);},refresh,
  suspend:()=>{const previous=automatic,ticket=++request;automatic=false;pendingMonth=null;pendingResult=null;
   return ()=>{if(disposed||ticket!==request)return false;automatic=previous;return true;};},
  dispose:()=>{disposed=true;request++;pendingResult=null;window?.clearTimeout(timer);window?.removeEventListener('focus',wake);document?.removeEventListener('visibilitychange',wake);}});
}
