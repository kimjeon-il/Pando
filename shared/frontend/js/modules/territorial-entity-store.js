import { resourceKey, resourceUpdate } from './resource-update-policy.js';
import { geometryRevisionKey } from './geometry-versions.js';
import { geometryReferenceFor } from './geometry-version-store.js';
// A fast path is allowed only for *verified* presentation-only differences.
// The full Core and renderer path stays authoritative for any uncertainty.
function sameValue(left,right,budget){
  if(Object.is(left,right))return true;
  if(--budget.remaining<0)return false;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'
    ||Array.isArray(left)!==Array.isArray(right))return false;
  const keys=Object.keys(left),other=Object.keys(right);
  if(keys.length!==other.length||keys.some(key=>!Object.hasOwn(right,key)))return false;
  return keys.every(key=>sameValue(left[key],right[key],budget));
}
function sameGeometry(left,right,budget){
  // Only the canonical geometry registry proves deep immutability when both
  // features retain the exact same object. A shallow Object.freeze is unsafe.
  if(left===right)return left==null||!!geometryReferenceFor(left);
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  const a=geometryReferenceFor(left),b=geometryReferenceFor(right);
  // Identical coordinates with a changed canonical version are not a
  // presentation-only transition. Likewise never cross the provenance gate.
  if(!!a!==!!b||(a&&(a.id!==b.id||a.version!==b.version)))return false;
  return sameValue(left,right,budget);
}
const presentationField=(owner,key)=>owner===''&&key==='name'
  ||owner==='style'&&key==='color'
  ||owner==='metadata'&&key==='flagDataUrl';
function sameOtherProperties(left,right,owner='',budget){
  if(Object.is(left,right))return true;
  if(--budget.remaining<0)return false;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'
    ||Array.isArray(left)!==Array.isArray(right))return false;
  const keys=new Set([...Object.keys(left),...Object.keys(right)]);
  for(const key of keys){
    if(presentationField(owner,key))continue;
    if(!Object.hasOwn(left,key)||!Object.hasOwn(right,key)
      ||!sameOtherProperties(left[key],right[key],owner?owner+'.'+key:key,budget))return false;
  }
  return true;
}

/**
 * No ID, order, hierarchy, geometry content, geometry version or unrelated
 * property may change. The returned IDs affect paint/labels only; both
 * queries and Core admission retain their existing authoritative contracts.
 */
export function classifyTerritorialPropertyOnly(previous,next){
  if(!Array.isArray(previous)||!Array.isArray(next)||previous.length!==next.length)return null;
  const paintChangedIds=[],labelChangedIds=[];
  // Avoid doubling the full-country coordinate scan on a large historical
  // replacement. The existing exact GPU digest remains the fallback.
  const budget={remaining:50000};
  let changedRows=0;
  for(let index=0;index<previous.length;index++){
    const before=previous[index],after=next[index];
    if(!before||!after||before.id!==after.id||before.id==null)return null;
    if(before===after)continue;
    if(++changedRows>12)return null;
    const beforeKeys=Object.keys(before).filter(key=>key!=='geometry'&&key!=='properties');
    const afterKeys=Object.keys(after).filter(key=>key!=='geometry'&&key!=='properties');
    if(beforeKeys.length!==afterKeys.length
      ||beforeKeys.some(key=>!Object.hasOwn(after,key)||!sameValue(before[key],after[key],budget))
      ||!sameGeometry(before.geometry,after.geometry,budget)
      ||!sameOtherProperties(before.properties,after.properties,'',budget))return null;
    const left=before.properties||{},right=after.properties||{};
    if(!Object.is(left.style?.color,right.style?.color))paintChangedIds.push(String(after.id));
    if(!Object.is(left.name,right.name)
      ||!Object.is(left.metadata?.flagDataUrl,right.metadata?.flagDataUrl))
      labelChangedIds.push(String(after.id));
  }
  return Object.freeze({paintChangedIds:Object.freeze(paintChangedIds),
    labelChangedIds:Object.freeze(labelChangedIds)});
}

/** Empty detached startup input; C++ admits it before editable data is loaded. */
export function createEmptyTerritorialState() {
  const geometries=Object.freeze([]);
  return { territorialEntities: [],timelineRecords: { schemaVersion: 3,lifetimes: [],geometryBindings: [],parentRelations: [],propertyBindings: [] },
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
      const presentationOnly=classifyTerritorialPropertyOnly(prior,next);
      const rootGeometryChanged=presentationOnly===null
        ?resourceUpdate(dependencies(prior), dependencies(next)).prepare:false;
      onEntitiesReplaced(next,{changedIds,previous:prior,rootGeometryChanged,
        propertyOnly:presentationOnly!==null,
        paintChangedIds:presentationOnly?.paintChangedIds||[],
        labelChangedIds:presentationOnly?.labelChangedIds||[]});
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
