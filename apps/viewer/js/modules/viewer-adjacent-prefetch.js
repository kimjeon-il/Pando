import {deviceCurrentMonth} from '../../../../shared/frontend/js/modules/builtin-month-clock.js';
import {compareTemporal,parseTemporal,shiftTemporalMonth} from '../../../../shared/frontend/js/modules/temporal.js';

// Match the timeline's annual December/current-month policy. C++ owns
// calendar arithmetic, including year boundaries and extended years.
export function adjacentViewerYears(month,{mode='year',now=new Date(),firstYear=1801}={}){
  const selected=parseTemporal(month,{nullable:false});
  if(selected.precision!=='month')throw new TypeError('Adjacent prefetch requires a month.');
  const today=parseTemporal(deviceCurrentMonth(now),{nullable:false});
  const targets=[];
  for(const offset of [-12,12]){
    let date=parseTemporal(shiftTemporalMonth(selected.canonical,offset),{nullable:false});
    if(mode==='year')date=date.year===today.year?today
      :parseTemporal(shiftTemporalMonth(date.canonical,12-date.month),{nullable:false});
    if(date.year<firstYear||compareTemporal(date,today)>0||date.canonical===selected.canonical
      ||targets.includes(date.canonical))continue;
    targets.push(date.canonical);
  }
  return targets;
}

// Viewer-only optional prefetch. No admission, history, camera or document
// mutations are permitted in prepareSource. A real request invalidates the
// ticket synchronously, and every data step yields back to browser idle.
export function createViewerAdjacentPrefetch({
  prepareSource,requestIdle,cancelIdle,now=()=>new Date(),isEligible=()=>true,onError=()=>{},
}={}){
  if(typeof prepareSource!=='function'||typeof requestIdle!=='function'
    ||typeof cancelIdle!=='function'||typeof isEligible!=='function')
    throw new TypeError('Read-only prefetch requires source, idle and eligibility ports.');
  let generation=0,disposed=false,pendingIdle=null;
  const current=ticket=>!disposed&&ticket===generation&&isEligible();
  function interrupt(){
    generation++;
    if(!pendingIdle)return;
    const job=pendingIdle;pendingIdle=null;
    cancelIdle(job.id);job.resolve();
  }
  function yieldIdle(ticket){
    if(!current(ticket))return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const job={id:null,resolve};
      pendingIdle=job;
      try{job.id=requestIdle(()=>{if(pendingIdle===job)pendingIdle=null;resolve();});}
      catch(error){if(pendingIdle===job)pendingIdle=null;reject(error);}
    });
  }
  function afterPresented(month,{mode='year'}={}){
    interrupt();
    if(!current(generation))return;
    const ticket=generation,targets=adjacentViewerYears(month,{mode,now:now()});
    void (async()=>{
      for(const target of targets){
        await yieldIdle(ticket);
        if(!current(ticket))return;
        try{await prepareSource(target,{
          isCurrent:()=>current(ticket),background:true,waitForIdle:()=>yieldIdle(ticket),
        });}
        catch(error){
          if(!current(ticket)||error?.name==='AbortError'||error?.cancelled)return;
          try{onError(error,target);}catch(diagnostic){
            console.error('[PL-VIEWER-PREFETCH-DIAGNOSTIC]',diagnostic);
          }
        }
      }
    })().catch(error=>{
      if(!current(ticket)||error?.name==='AbortError'||error?.cancelled)return;
      try{onError(error,'schedule');}catch(diagnostic){
        console.error('[PL-VIEWER-PREFETCH-DIAGNOSTIC]',diagnostic);
      }
    });
  }
  return Object.freeze({afterPresented,interrupt,dispose(){
    if(disposed)return;
    disposed=true;interrupt();
  }});
}
