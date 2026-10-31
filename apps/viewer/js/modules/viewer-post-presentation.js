/**
 * Viewer-only optional work after an accepted map frame. Neither this owner nor
 * its observers may mutate the canonical Core document or map-ready signal.
 */
export function createViewerPostPresentation({hydrate,refresh,afterMap=[],onError=()=>{}}={}) {
  if(typeof hydrate!=='function'||typeof refresh!=='function'||typeof onError!=='function'
    ||!Array.isArray(afterMap)||afterMap.some(task=>typeof task!=='function'))
    throw new TypeError('Viewer post-presentation requires hydration, refresh and optional tasks.');
  let revision=0,disposed=false;
  const report=(error,stage,current)=>{
    if(!current()||error?.cancelled||error?.name==='AbortError')return;
    try{onError(error,stage);}catch(diagnosticError){
      console.error('[PL-VIEWER-POST-DIAGNOSTIC]',diagnosticError);
    }
  };
  function schedule(isCurrent) {
    if(typeof isCurrent!=='function')throw new TypeError('A current project check is required.');
    const request=++revision;
    const current=()=>{
      if(disposed||request!==revision)return false;
      try{return isCurrent()!==false;}catch(_){return false;}
    };
    // Yield from the map-open path. Each optional action is independent: a
    // failed terrain/search/surface task must not block subsequent actions.
    void Promise.resolve().then(async()=>{
      if(!current())return;
      for(let i=0;i<afterMap.length;i++){
        if(!current())return;
        try{Promise.resolve(afterMap[i]()).catch(error=>report(error,'auxiliary',current));}
        catch(error){report(error,'auxiliary',current);}
      }
      if(!current())return;
      try{await hydrate(current);}
      catch(error){report(error,'hydrate',current);return;}
      if(!current())return;
      try{await refresh();}
      catch(error){report(error,'search',current);}
    }).catch(error=>report(error,'lifecycle',current));
  }
  return Object.freeze({
    schedule,
    invalidate(){revision++;},
    dispose(){if(disposed)return;disposed=true;revision++;},
  });
}
