import { createWorkerRpcClient } from './worker-rpc.js';
import { createLatestWorkerJobScheduler, createWorkerCancellationError } from './worker-job-scheduler.js';
import { isBuiltinPlaceId, normalizePlace, PLACE_LIMITS } from './place-contract.js';
import { resourceKey, resourceUpdate } from './resource-update-policy.js';
const EMPTY = Object.freeze({ revision: 0, signature: 'empty', records: Object.freeze([]) });

/** Canonical owner of the builtin label snapshot and Worker lifecycle. */
export function createPlaceRuntime({ manifestUrl = new URL('../../data/places/manifest.json', import.meta.url).href, createWorker = null, rpc = null, onSnapshot = () => {}, onError = () => {}, onSettled = () => {}, getProtectedIds = () => [],getPresentation=()=>null,admitReferences } = {}) {
  if (typeof manifestUrl !== 'string' || !manifestUrl) throw new TypeError('Place manifest URL must be a nonempty string');
  if(typeof admitReferences!=='function')throw new TypeError('Place publication requires its accepted identity admission boundary.');
  let snapshot=EMPTY, revision=0, moving=false, closed=false, desired=null, requestedDependencies=null, snapshotDependencies=null, referenceSequence=0;
  const retained=new Map();
  let publication=Promise.resolve();
  // A Worker can finish the next request while the previous C++ admission is
  // pending. Commit its identity catalog and resource snapshot as one ordered
  // publication, so a later search cannot overwrite a newly retained result.
  function publishAccepted(action) {
    const operation=publication.then(action);
    publication=operation.catch(()=>{});
    return operation;
  }
  const client=rpc || createWorkerRpcClient({ createWorker, defaultTimeoutMs: 15_000 });
  const scheduler=createLatestWorkerJobScheduler({
    execute: entry => client.request(entry.jobKey === 'viewport' ? 'place.viewport' : 'place.search', { ...entry.payload, manifestUrl }, { signal: entry.metadata.controller.signal }).then(message => message.result),
    cancelRunning: entry => entry.metadata.controller.abort(),
    isCurrent: entry => !closed && (entry.jobKey !== 'viewport' || (!moving && entry.targetRevision === revision)),
  });
  function rememberInto(cache,record) {
    if (!record || !isBuiltinPlaceId(record.id)) return;
    cache.delete(record.id); cache.set(record.id,record);
    const protectedIds=new Set(getProtectedIds());
    while (cache.size > PLACE_LIMITS.retainedRecords) {
      const oldest=[...cache.keys()].find(id => !protectedIds.has(id));
      // Selection can be arbitrarily large; the primary is first in protectedIds.
      cache.delete(oldest || [...cache.keys()].find(id => id !== protectedIds.values().next().value));
    }
  }
  const remember=record=>rememberInto(retained,record);
  function references(records=snapshot.records,cache=retained) {
    return [...new Map([...cache.values(),...records].map(record=>[record.id,
      Object.freeze({domain:'placeBuiltin',type:record.kind,id:record.id})])).values()];
  }
  async function prepare(view) {
    desired=view; if (closed || moving) return false;
    const requested={source:manifestUrl,content:'place-source',preparation:resourceKey(view),context:null,presentation:'viewport-query'};
    if (!resourceUpdate(requestedDependencies,requested).prepare) return false;
    requestedDependencies=requested;
    const current=++revision;
    try {
      const job=scheduler.enqueue({ jobKey: 'viewport', targetRevision: current, payload: { view }, metadata: { controller: new AbortController() } });
      const result=await job.promise;
      if (closed || moving || current !== revision) return false;
      if (!Array.isArray(result.records) || result.records.length > PLACE_LIMITS.candidates) throw new RangeError('Place snapshot candidate budget exceeded');
      const records=Object.freeze(result.records.map(normalizePlace));
      const next={source:manifestUrl,content:resourceKey(records),preparation:'place-normalization-v1',context:null,
        presentation:resourceKey(result.signature || 'records')};
      return await publishAccepted(async()=>{
        if(closed || moving || current!==revision)return false;
        const change=resourceUpdate(snapshotDependencies,next);
        if(!change.present)return false;
        if(change.input)await admitReferences(()=>references(records));
        if(closed || moving || current!==revision) {
          if(!closed)await admitReferences(()=>references());
          return false;
        }
        snapshot=Object.freeze({ ...result, revision: current, records:change.input?records:snapshot.records });
        snapshotDependencies=next;
        onSnapshot(snapshot); return true;
      });
    } catch (error) {
      if(current===revision)requestedDependencies=null;
      if(!closed && current===revision && !error.cancelled && error.name!=='AbortError' && error.code!=='PL-CORE-STALE')onError(error);
      return false;
    }
  }
  function cancelViewport() { requestedDependencies=null; revision++; scheduler.cancelKey('viewport'); }
  return Object.freeze({
    prepare,
    cancelViewport,
    beginInteraction() { moving=true; cancelViewport(); scheduler.cancelKey('search'); },
    settle(view=desired) { const wasMoving=moving; moving=false; const task=view ? prepare(view) : Promise.resolve(false); if (wasMoving) onSettled(); return task; },
    snapshot: () => snapshot,
    selectionReferences: () => references(),
    resolve: id => retained.get(String(id)) || snapshot.records.find(record => record.id === String(id)) || null,
    retain: remember,
    async search(query, { scope = 'display', mapDate = null, signal = null } = {}) {
      if (!['display', 'reference'].includes(scope)) throw new TypeError('Unknown place search scope.');
      const reference = scope === 'reference';
      if (closed || (moving && !reference)) throw createWorkerCancellationError('지도 이동 중에는 지명 조회를 보류합니다.', 'interaction');
      signal?.throwIfAborted();
      const job=scheduler.enqueue({ jobKey: reference ? `reference:${++referenceSequence}` : 'search', signal,
        payload: { query, scope, mapDate, presentation:reference ? null : getPresentation() }, metadata: { controller: new AbortController() } });
      const result=await job.promise;
      if (result.records.length > PLACE_LIMITS.searchResults) throw new RangeError('Place search result budget exceeded');
      const records=result.records.map(normalizePlace);
      if (reference) {
        signal?.throwIfAborted();
        if (closed) throw createWorkerCancellationError();
        return { ...result, records };
      }
      return publishAccepted(async()=>{
        if(closed || moving)throw createWorkerCancellationError('지도 이동 중에는 지명 조회를 보류합니다.','interaction');
        const candidate=new Map(retained);
        records.forEach(record=>rememberInto(candidate,record));
        await admitReferences(()=>references(snapshot.records,candidate));
        if(closed || moving) {
          if(!closed)await admitReferences(()=>references());
          throw createWorkerCancellationError('지도 이동 중에는 지명 조회를 보류합니다.','interaction');
        }
        retained.clear();for(const [id,record]of candidate)retained.set(id,record);
        return { ...result, records };
      });
    },
    cancelSearch: () => scheduler.cancelKey('search'),
    isSearchOpen: () => !closed && !moving,
    stats: () => ({ ...scheduler.stats(), snapshotRecords: snapshot.records.length, retainedRecords: retained.size, moving }),
    dispose() { if (closed) return; closed=true; revision++; scheduler.close(); client.stop(); retained.clear(); snapshot=EMPTY; },
  });
}
