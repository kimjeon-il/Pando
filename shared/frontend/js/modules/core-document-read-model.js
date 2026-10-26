import { timelineObjectKey } from './timeline-records.js';
import { createGeometryVersionStore } from './geometry-version-store.js';
import { projectTimelineIdentity } from './timeline-resolver.js';

const fields = Object.freeze({ territorial: 'territorialEntities', label: 'labels', hydro: 'hydroEdits',
  generic: 'genericFeatures', distributionLayer: 'distributionLayers', distributionEntry: 'distributionEntries' });
const refKey = ref => JSON.stringify([ref.id, ref.version]);
const headerFields=new Set(['format','schemaVersion','version','savedAt','baseDataset','landObjectModel','territorialModel',
  'distributionModel','projectSetup','documentId','physicalSourceInfo','sourceInfo']);
const invalid = message => { throw Object.assign(new Error(message), { code: 'PL-CORE-RESPONSE' }); };
const sameCoordinates = (left,right) => Array.isArray(left) && Array.isArray(right)
  ? left.length===right.length && left.every((value,index) => sameCoordinates(value,right[index]))
  : Object.is(left,right);
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Immutable presentation/storage projection; only accepted C++ deltas publish. */
export function createCoreDocumentReadModel(initialProject) {
  const { geometries: initialGeometries, ...initialProperties } = initialProject;
  const initial = structuredClone(initialProperties);
  let geometries = createGeometryVersionStore(initialGeometries);
  // Storage and render lookup share the same immutable geometry allocations.
  // The lookup is rebuilt only when the C++ geometry archive delta changes.
  let project = freeze({ ...initial, geometries: geometries.snapshot() });
  let provenance = null;
  let world = null;
  let territorialViews = Object.freeze([]);
  let hydroViews = Object.freeze([]);
  function acceptLoadedProject(value) {
    if (!value || !Array.isArray(value.geometries)) invalid('A complete accepted C++ storage snapshot is required after document load.');
    for (const field of Object.values(fields)) if (!Array.isArray(value[field]))
      invalid(`Required accepted C++ loaded domain is missing: ${field}`);
    // The geometry registry validates, copies and freezes each untrusted shape.
    // Cloning the entire archive first duplicated every coordinate allocation.
    const { geometries: geometryRows, ...properties } = value;
    const candidate=structuredClone(properties);
    const nextGeometries=createGeometryVersionStore(geometryRows,{reuse:geometries});
    const next=freeze({ ...candidate,geometries: nextGeometries.snapshot() });
    project=next;
    geometries=nextGeometries;
    provenance=null;
    world=null;
    territorialViews=Object.freeze([]);hydroViews=Object.freeze([]);
    return project;
  }
  function list(domain) {
    const field = fields[domain];
    if (!field) invalid(`Unsupported C++ document domain: ${String(domain)}`);
    if(domain==='hydro' && world)return hydroViews;
    return project[field];
  }
  function get(ref) {
    if (!ref || typeof ref.id !== 'string') invalid('An explicit C++ document object reference is required.');
    return list(ref.domain).find(row => row.id === ref.id) || null;
  }
  function worldAgainst(world,expectedEpoch,sourceProject,sourceGeometries,detached = false) {
    if (!world || !Array.isArray(world.entities) || typeof world.month !== 'string')
      invalid('A source-pinned C++ world response is required.');
    if (detached ? Object.hasOwn(world,'sourceEpoch') : !Number.isSafeInteger(world.sourceEpoch) || !Number.isSafeInteger(expectedEpoch))
      invalid('A detached import world must be distinct from an epoch-pinned active read model.');
    if (!detached && world.sourceEpoch !== expectedEpoch) throw Object.assign(new Error('The C++ world belongs to another document operation epoch.'),
      { code: 'PL-CORE-STALE', name: 'AbortError', cancelled: true });
    const identities = new Map([...sourceProject.territorialEntities.map(identity=>[timelineObjectKey({domain:'territorial',id:identity.id}),identity]),...sourceProject.hydroEdits.map(identity=>[timelineObjectKey({domain:'hydro',id:identity.id}),identity])]), byId = new Map();
    const rows = world.entities.map(row => {
      const identity = identities.get(timelineObjectKey(row.objectRef)), geometry = sourceGeometries.get(row.geometryRef);
      if (!identity || !geometry || byId.has(timelineObjectKey(row.objectRef)) || !Array.isArray(row.ancestors))
        invalid(`The C++ world contains an unknown/duplicate identity or geometry: ${row.objectRef.id}`);
      for (const field of ['parentId','coverageMode','validFrom','validTo','rootId'])
        if (!Object.hasOwn(row, field)) invalid(`Required C++ world field is missing: ${field}`);
      if (!row.properties || typeof row.properties !== 'object') invalid('C++ temporal property projection is required.');
      const temporalIdentity=projectTimelineIdentity(identity,row.properties);
      const effectiveIdentity=row.objectRef.domain==='hydro'?freeze({...temporalIdentity,properties:{...temporalIdentity.properties,...row.rendering}}):temporalIdentity;
      const projected = freeze({ ...structuredClone(row), id:row.objectRef.id, identity:effectiveIdentity, geometry });
      byId.set(timelineObjectKey(row.objectRef), projected);
      return projected;
    });
    return Object.freeze({ month: world.month,...(detached ? {} : { sourceEpoch: world.sourceEpoch }), entities: Object.freeze(rows),
      byId: Object.freeze({ get: id => byId.get(timelineObjectKey({domain:'territorial',id})), getObject: ref => byId.get(timelineObjectKey(ref)) }) });
  }
  const projectWorld=(value,expectedEpoch) => worldAgainst(value,expectedEpoch,project,geometries);
  const detachedImportProjection=value => {
    const importedWorld=worldAgainst(value,null,project,geometries,true);
    return Object.freeze({ project,world: importedWorld,territorialViews: viewsForWorld(importedWorld) });
  };
  function viewsForWorld(nextWorld,domain='territorial') {
    const oldViews=domain==='hydro'?hydroViews:territorialViews;
    const previous=new Map((world?.entities || []).filter(row=>row.objectRef.domain===domain).map((row,index) => [row.id,{ row,view: oldViews[index] }]));
    const nextViews=Object.freeze(nextWorld.entities.filter(row=>row.objectRef.domain===domain).map(row => {
      const prior=previous.get(row.id);
      if (prior && (prior.row.identity===row.identity || (prior.row.identity.id===row.identity.id && JSON.stringify(prior.row.identity.properties)===JSON.stringify(row.identity.properties))) && prior.row.geometry===row.geometry
        && ['parentId','coverageMode','validFrom','validTo'].every(field => prior.row[field]===row[field])) return prior.view;
      if(domain==='hydro')return freeze({...row.identity,geometry:row.geometry});
      return freeze({ ...row.identity,geometry: row.geometry,properties: { ...row.identity.properties,
        parentId: row.parentId,coverageMode: row.coverageMode,validFrom: row.validFrom,validTo: row.validTo } });
    }));
    return nextViews.length===oldViews.length&&nextViews.every((row,i)=>row===oldViews[i])?oldViews:nextViews;
  }
  function acceptWorld(value,expectedEpoch) {
    const nextWorld=projectWorld(value,expectedEpoch);
    const nextViews=viewsForWorld(nextWorld);
    const nextHydroViews=viewsForWorld(nextWorld,'hydro');
    world=nextWorld;
    territorialViews=nextViews;hydroViews=nextHydroViews;
    return nextWorld;
  }
  function rebaseWorld(epoch) {
    if (!world) invalid('A current C++ world must be admitted before rebasing an unchanged timeline.');
    const entities=world.entities.map(({ objectRef,geometryRef,rendering,parentId,coverageMode,validFrom,validTo,rootId,ancestors,properties }) => ({
      objectRef,geometryRef,rendering,parentId,coverageMode,validFrom,validTo,rootId,ancestors,properties,
    }));
    return acceptWorld({ month: world.month,sourceEpoch: epoch,entities },epoch);
  }
  function acceptTransition(result,operation) {
    if (['core.document-candidate-projection','core.document-prepare'].includes(operation)) return project;
    if (['core.document-load','core.document-load-baseline','core.document-initialize','core.document-replacement-rollback'].includes(operation)) acceptLoadedProject(result.project);
    if (result?.delta) apply(result.delta);
    if (result?.world) acceptWorld(result.world,result.state.epoch);
    else if (result?.state && world && result.state.epoch!==world.sourceEpoch) {
      if (result.delta && result.delta.timelineRecords!==null)
        invalid('A changed C++ timeline requires its authoritative resolved world acknowledgement.');
      rebaseWorld(result.state.epoch);
    }
    return project;
  }
  function candidateForDelta(delta) {
    for (const field of ['objects','geometries','removedGeometryRefs'])
      if (!Array.isArray(delta[field])) invalid(`Required C++ delta collection is missing: ${field}`);
    for (const field of ['timelineRecords','presentation','provenance','header'])
      if (!Object.hasOwn(delta, field)) invalid(`Required C++ delta field is missing: ${field}`);
    if (!delta.orders || typeof delta.orders !== 'object') invalid('Authoritative C++ domain orders are required.');
    const candidate = { ...project };
    const grouped = new Map();
    for (const row of delta.objects) {
      const field = fields[row.ref.domain];
      if (!field || typeof row.ref.id !== 'string') invalid('Unsupported C++ object delta identity.');
      if (!grouped.has(field)) grouped.set(field, []);
      grouped.get(field).push(row);
    }
    for (const [field, rows] of grouped) {
      const changed = new Set(rows.map(row => row.ref.id));
      if (changed.size !== rows.length) invalid('Duplicate C++ object delta identity.');
      const values = project[field].filter(value => !changed.has(value.id));
      for (const row of rows.filter(row => row.value !== null).sort((a, b) => a.index - b.index)) {
        if (!Number.isInteger(row.index) || row.index < 0 || row.index > values.length || row.value.id !== row.ref.id)
          invalid('Authoritative C++ object delta vector index/value is required.');
        values.splice(row.index, 0, freeze(structuredClone(row.value)));
      }
      candidate[field] = Object.freeze(values);
    }
    for (const [domain, field] of Object.entries(fields)) {
      const order = delta.orders[domain], values = candidate[field];
      if (!Array.isArray(order) || order.length !== values.length || new Set(order).size !== order.length)
        invalid(`Invalid authoritative C++ domain order: ${domain}`);
      const byId = new Map(values.map(value => [value.id, value]));
      if (order.some(id => typeof id !== 'string' || !byId.has(id))) invalid(`Unknown C++ domain order identity: ${domain}`);
      if (order.some((id, index) => values[index].id !== id)) candidate[field] = Object.freeze(order.map(id => byId.get(id)));
    }
    let nextGeometries = geometries;
    if (delta.geometries.length || delta.removedGeometryRefs.length) {
      const removed = new Set(delta.removedGeometryRefs.map(refKey));
      const admitted=new Set();
      for (const entry of delta.geometries) {
        const key=refKey(entry);
        if (admitted.has(key)) invalid('Duplicate C++ geometry delta version.');
        admitted.add(key);
        const existing=geometries.get({ id: entry.id,version: entry.version });
        if (existing && (existing.type!==entry.geojson?.type
          || !sameCoordinates(existing.coordinates,entry.geojson.coordinates)))
          invalid('A C++ geometry delta cannot replace the coordinates of an existing immutable version.');
      }
      // Canonical archive admission can expose an already-stored reference.
      // Upsert its identical version while retaining the geometry allocation.
      const entries = project.geometries.filter(row => !removed.has(refKey(row)) && !admitted.has(refKey(row))).concat(delta.geometries);
      nextGeometries = createGeometryVersionStore(entries, { reuse: geometries });
      candidate.geometries = nextGeometries.snapshot();
    }
    if (delta.timelineRecords !== null) candidate.timelineRecords = freeze(structuredClone(delta.timelineRecords));
    if (delta.presentation !== null) Object.assign(candidate, freeze(structuredClone(delta.presentation)));
    if (delta.header!==null) {
      const { set,removedKeys }=delta.header;
      if (!set || typeof set!=='object' || Array.isArray(set) || !Array.isArray(removedKeys)
        || new Set(removedKeys).size!==removedKeys.length || [...Object.keys(set),...removedKeys].some(key => !headerFields.has(key))
        || removedKeys.some(key => Object.hasOwn(set,key))) invalid('A disjoint authoritative C++ root-field patch is required.');
      for (const key of removedKeys) delete candidate[key];
      Object.assign(candidate,freeze(structuredClone(set)));
    }
    const nextProvenance = delta.provenance === null ? provenance : freeze(structuredClone(delta.provenance));
    return { project: freeze(candidate),geometries: nextGeometries,provenance: nextProvenance };
  }
  function apply(delta) {
    const next=candidateForDelta(delta);
    project=next.project;
    geometries=next.geometries;
    provenance=next.provenance;
    return project;
  }
  function candidateProjection({ delta,world: candidateWorld,temporalImpact },expectedEpoch) {
    const next=candidateForDelta(delta),nextWorld=worldAgainst(candidateWorld,expectedEpoch,next.project,next.geometries);
    return Object.freeze({ project: next.project,world: nextWorld,territorialViews: viewsForWorld(nextWorld),temporalImpact: freeze(temporalImpact),delta: freeze(delta) });
  }
  return Object.freeze({ snapshot: () => project, get, list, geometry: ref => geometries.get(ref), provenance: () => provenance,
    acceptLoadedProject,apply,projectWorld,acceptWorld,acceptTransition,candidateProjection,detachedImportProjection,world: () => world,territorialViews: () => territorialViews });
}
