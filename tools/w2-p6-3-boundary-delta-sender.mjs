/**
 * P6-3 test-only main-thread bridge. The authoritative full message still
 * originates in gpu-map-renderer and is never mutated or serialized here.
 * A reference can be transmitted only when its original, recursively frozen,
 * Core-admitted geometry object is the *same pointer* as in an acknowledged
 * Worker baseline. Geometry ID/version alone is never enough.
 */
export function createBoundaryDeltaSender({
  sendNative,
  geometryReferenceFor,
  onSample = () => {},
} = {}) {
  if (typeof sendNative !== 'function' || typeof geometryReferenceFor !== 'function')
    throw new TypeError('P6-3 requires a native sender and the canonical immutable geometry registry.');
  let accepted = null, pending = null, serial = 0;
  const status = () => ({
    baseline: !!accepted, pending: !!pending,
    baselineToken: accepted?.token || null, senderSequence: serial,
  });
  const current = message => !!message && Number.isInteger(message.requestId)
    && Number.isInteger(message.projectGeneration)
    && Number.isInteger(message.geometryRevision)
    && Array.isArray(message.features);
  const record = (event, extra={}) => onSample({event,...extra});

  function send(message, transfer) {
    if(!current(message) || !['replace','patch'].includes(message.type))
      return sendNative(message, transfer);
    ++serial;
    const next = {source:message, generation:message.projectGeneration, requestId:message.requestId,
      revision:message.geometryRevision, sequence:serial, mode:'full', resent:false};
    let sent=message;
    // Only a COMPLETE replace has an authoritative membership/order list.
    // A patch is preserved verbatim and makes the main's base unknown.
    if(message.type==='patch'){
      accepted=null;
    } else if(accepted && !pending && message.features.length &&
      new Set(message.features.map(row=>String(row.id))).size===message.features.length){
      let reused=0;
      const rows=message.features.map(feature=>{
        const old=accepted.features.get(String(feature.id));
        const geometry=feature?.geometry;
        const reference=geometry && geometryReferenceFor(geometry);
        if(!old || old.geometry!==geometry || !reference
          || !Object.isFrozen(geometry) || !Object.isFrozen(geometry.coordinates))
          return {mode:'full',feature};
        reused++;
        return {mode:'reuse',id:String(feature.id),
          // Both the entity kind and its parent are sent on every request.
          properties:{entityKind:feature.properties?.entityKind,
            parentId:feature.properties?.parentId},
          ...(Object.hasOwn(feature,'boundaryRootId')
            ?{boundaryRootId:feature.boundaryRootId}:{})};
      });
      if(reused>0){
        sent={...message,type:'p6-delta-v1',baseToken:accepted.token,features:rows};
        next.mode='delta';next.reused=reused;next.newGeometries=rows.length-reused;
      }
    }
    pending=next;
    record('send',{generation:next.generation,requestId:next.requestId,
      mode:next.mode,reused:next.reused||0,features:message.features.length});
    try{return sendNative(sent,transfer);}
    catch(error){pending=null;accepted=null;throw error;}
  }

  function receive(message) {
    if(!message || typeof message!=='object')return false;
    if(message.type==='p6-resync-required'){
      if(!pending || pending.resent || message.requestId!==pending.requestId
        || message.projectGeneration!==pending.generation
        || message.geometryRevision!==pending.revision)return true;
      const needed=pending;
      needed.resent=true;
      accepted=null;
      record('resync',{requestId:needed.requestId,reason:message.reason||'unknown'});
      try{sendNative(needed.source);}
      catch(error){pending=null;throw error;}
      return true;
    }
    if(message.type==='error'){
      if(pending?.requestId===message.requestId && pending.generation===message.projectGeneration){
        pending=null;accepted=null;
      }
      return false; // let the original renderer surface the failure/rollback
    }
    if(message.type!=='prepared'||!message.p6BaseToken)return false;
    const matching=pending && pending.requestId===message.requestId
      && pending.generation===message.projectGeneration
      && pending.revision===message.geometryRevision
      && message.quality===pending.source.quality;
    if(!matching){
      // A superseded result cannot authorize reuse for the new project.
      record('ignored-stale-ack',{generation:message.projectGeneration,requestId:message.requestId});
      return false;
    }
    if(pending.source.type==='replace'){
      accepted={token:message.p6BaseToken,
        features:new Map(pending.source.features.map(feature=>[String(feature.id),feature]))};
    }else accepted=null;
    record('ack',{generation:pending.generation,requestId:pending.requestId,
      mode:pending.mode,features:pending.source.features.length});
    pending=null;
    return false;
  }

  function invalidate(reason='reset') {
    accepted=null;pending=null;record('invalidate',{reason});
  }
  return Object.freeze({send,receive,status,invalidate});
}
