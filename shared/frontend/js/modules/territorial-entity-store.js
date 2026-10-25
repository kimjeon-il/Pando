import { resourceKey, resourceUpdate } from './resource-update-policy.js';
import { geometryRevisionKey } from './geometry-versions.js';
/** Empty detached startup input; C++ admits it before editable data is loaded. */
export function createEmptyTerritorialState() {
  const geometries=Object.freeze([]);
  return { territorialEntities: [],timelineRecords: { schemaVersion: 2,lifetimes: [],geometryBindings: [],parentRelations: [],propertyBindings: [] },
    geometries: Object.freeze({ snapshot: () => geometries,get: () => null }) };
}

/** Read-only current-world projection of the sole C++ document session. */
export function createTerritorialEntityStore({ documentModel,commandOwner,onEntitiesReplaced = () => {} } = {}) {
  for (const method of ['territorialViews','list','world','projectWorld'])
    if (typeof documentModel?.[method]!=='function') throw new TypeError(`The accepted C++ territorial projection is required: ${method}.`);
  for (const method of ['state','subscribeTransitions','resolveWorld','setTimelineCursor'])
    if (typeof commandOwner?.[method]!=='function') throw new TypeError(`The same C++ document owner is required: ${method}.`);
  let previous=documentModel.territorialViews();
  const dependencies = rows => ({ source: 'territorial-root-geometry',
    content: resourceKey(rows.filter(feature => feature.properties.entityKind === 'general' && !feature.properties.parentId)
      .map(feature => [feature.id, geometryRevisionKey(feature.geometry)])), preparation: 'roots-v1', context: null, presentation: 'roots' });
  const unsubscribe=commandOwner.subscribeTransitions(() => {
    const next=documentModel.territorialViews();
    const before=new Map(previous.map(row => [row.id,row])),after=new Map(next.map(row => [row.id,row]));
    const changedIds=new Set([...before.keys(),...after.keys()].filter(id => before.get(id)!==after.get(id)));
    const prior=previous;
    previous=next;
    if (changedIds.size) {
      const rootGeometryChanged = resourceUpdate(dependencies(prior), dependencies(next)).prepare;
      onEntitiesReplaced(next,{ changedIds,previous: prior,rootGeometryChanged });
    }
  });
  const entity=id => documentModel.territorialViews().find(row => row.id===String(id ?? '').trim()) || null;
  async function resolveWorld(month,options) {
    const world=await commandOwner.resolveWorld(month,options);
    return documentModel.projectWorld(world,commandOwner.state().epoch);
  }
  async function setTimelineCursor(month,options = {}) {
    if (typeof options.canPublish==='function' && !options.canPublish())
      throw Object.assign(new Error('편집을 확정하거나 취소한 뒤 시간대를 이동하세요.'),{ code: 'TIMELINE_DRAFT_ACTIVE' });
    const before=commandOwner.state().timelineCursor;
    const result=await commandOwner.setTimelineCursor(month,options);
    return result.state.timelineCursor!==before;
  }
  function hasField(id,field) {
    const properties=entity(id)?.properties;
    if (!properties) return false;
    return Object.hasOwn(field==='color' ? properties.style : ['capital','flagDataUrl'].includes(field)
      ? properties.metadata : properties,field==='color' ? 'color' : field);
  }
  return Object.freeze({ snapshot: documentModel.territorialViews,identities: () => documentModel.list('territorial'),
    hasField,isLocked: id => entity(id)?.properties.locked===true,resolveWorld,setTimelineCursor,dispose: unsubscribe });
}
