import {normalizeTerritorialLibraryEntity} from '../apps/editor/frontend/js/modules/territorial-library.js';
import {normalizeTimelineRecords} from '../shared/frontend/js/modules/timeline-records.js';

/** Project library-owned geometryVersions to the common runtime contract.
 * Assignments contain immutable resources, never an independent date range.
 * The shared C++ validator/resolver remains the sole temporal authority.
 */
export function compilePhysicalWaterCatalog(sources,assignments) {
  const resources=new Map(),geometries=new Map(),identities=[];
  const records={schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
  const key=(id,version)=>JSON.stringify([id,version]);
  for(const row of assignments){
    const id=key(row.entityId,row.versionId);
    if(resources.has(id))throw new Error('Duplicate water version asset assignment: '+id);
    if(!row.asset||!row.land||!row.geometryRef)throw new Error('Missing water asset reference: '+id);
    for(const ref of row.replaces||[])if(ref.domain!=='hydroBuiltin'||!ref.id||ref.id===row.entityId)throw new Error('Invalid replaced builtin water ObjectRef');
    resources.set(id,row);
  }
  for(const raw of sources){
    const entity=normalizeTerritorialLibraryEntity(raw);
    if(entity.entityKind!=='lake')throw new Error('Physical polygon catalog requires lake objects');
    const objectRef={domain:'hydroBuiltin',id:entity.entityId};
    identities.push({objectRef,entityKind:entity.entityKind,name:entity.names.ko||entity.names.en,layerId:'lakes_base',source:entity.sourceInfo.title,sourceId:entity.sourceInfo.sourceId||entity.entityId});
    records.lifetimes.push({id:'life:'+entity.entityId,objectRef,...entity.lifetime});
    for(const version of entity.geometryVersions){
      const id=key(entity.entityId,version.versionId),resource=resources.get(id);
      if(!resource)throw new Error('Missing water version asset: '+id);
      resources.delete(id);
      const {geometryRef,asset,land,replaces=[]}=resource;
      const entry={geometryRef,asset,land,...replaces.length?{replaces}:{}},ref=JSON.stringify(geometryRef);
      if(geometries.has(ref)&&JSON.stringify(geometries.get(ref))!==JSON.stringify(entry))throw new Error('Conflicting geometry asset identity: '+ref);
      geometries.set(ref,entry);
      records.geometryBindings.push({id:entity.entityId+':'+version.versionId,objectRef,validFrom:version.validFrom,validTo:version.validTo,geometryRef});
    }
  }
  if(resources.size)throw new Error('Asset assignment has no library geometry version');
  const timelineRecords=normalizeTimelineRecords(records,{entities:identities.map(({objectRef,entityKind})=>({objectRef,entityKind})),geometryExists:ref=>geometries.has(JSON.stringify(ref))});
  return {identities,timelineRecords,geometries:[...geometries.values()]};
}
