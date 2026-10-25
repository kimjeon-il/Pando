import { normalizeTemporalInterval, parseTemporal, temporalIntervalsOverlap, sharedCalculationCore } from "../../../../../shared/frontend/js/modules/temporal.js";
import {createGeometryVersionStore} from "../../../../../shared/frontend/js/modules/geometry-version-store.js";

export const TERRITORIAL_LIBRARY_SCHEMA_VERSION = 2;
export const LIBRARY_ENTITY_TYPES = Object.freeze({ GENERAL: 'general', REGIONAL: 'regional' });
export function assertTerritorialIndexEntity(entry,entity){
  const keys=['schemaVersion','entityId','lineageId','entityKind','names','alternateNames','lifetime','parentEntityId','instantiation','metadata'];
  const comparable=value=>Array.isArray(value)?value.map(comparable):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,comparable(value[key])])):value;
  const source=Object.fromEntries(keys.map(key=>[key,entity[key]]));
  const indexed=Object.fromEntries(keys.map(key=>[key,entry?.[key]]));
  source.geometryVersions=entity.geometryVersions.map(({geometry,...version})=>version);
  indexed.geometryVersions=entry?.geometryVersions;
  if(JSON.stringify(comparable(source))!==JSON.stringify(comparable(indexed)))throw new Error('Territorial index/source metadata mismatch');
}
export function historicalSourceAvailability(entity,referenceDate) {
  return sharedCalculationCore.timelineSourceAvailability(entity.lifetime,entity.geometryVersions,referenceDate);
}
const text = value => String(value ?? '').trim();

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function interval(raw) {
  if (!raw || !Object.hasOwn(raw, 'validFrom') || !Object.hasOwn(raw, 'validTo')) throw new Error('Territorial interval requires both endpoints');
  for(const value of [raw.validFrom,raw.validTo]) if(value!==null) {
    if(typeof value!=='string')throw new Error('Territorial endpoints must be strings or null');
    parseTemporal(value,{nullable:false});
  }
  const { validFrom, validTo } = normalizeTemporalInterval(raw.validFrom, raw.validTo);
  return { validFrom, validTo };
}

function names(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length
    || Object.values(raw).some(value => typeof value !== 'string' || !value.trim())) throw new Error('Invalid territorial names');
  return structuredClone(raw);
}

function relations(raw) {
  if (!Array.isArray(raw)) throw new Error('Missing lineage relations');
  const seen = new Set();
  for (const relation of raw) {
    const key = JSON.stringify([relation.type, relation.from, relation.to]);
    if (relation.type !== 'successor' || !relation.from || !relation.to || relation.from === relation.to || seen.has(key)) throw new Error('Invalid lineage relation');
    seen.add(key);
  }
  return structuredClone(raw);
}

export function normalizeTerritorialLineage(raw) {
  if (raw?.schemaVersion !== 2 || !/^[a-z0-9][a-z0-9_-]*$/.test(raw.lineageId)
    || Object.hasOwn(raw,'entities') || !Array.isArray(raw.entityRefs) || !raw.entityRefs.length
    || raw.entityRefs.some(id=>!/^[a-z]+:[A-Za-z0-9_-]+$/.test(id))) throw new Error('Invalid lineage schema/identity');
  if (new Set(raw.entityRefs).size !== raw.entityRefs.length) throw new Error('Duplicate lineage entity');
  return freeze({schemaVersion: 2, lineageId: raw.lineageId, names: names(raw.names), entityRefs:[...raw.entityRefs], relations: relations(raw.relations)});
}

export function normalizeTerritorialLibraryIndex(raw) {
  if(raw?.schemaVersion!==2 || !Array.isArray(raw.entities) || !Array.isArray(raw.lineages) || !Array.isArray(raw.snapshots))throw new Error('Invalid territorial index schema');
  const ids=new Set();
  for(const entity of raw.entities){
    if(entity.schemaVersion!==2 || !/^[a-z]+:[A-Za-z0-9_-]+$/.test(entity.entityId) || ids.has(entity.entityId) || !Object.values(LIBRARY_ENTITY_TYPES).includes(entity.entityKind)
      || entity.file!==`${entity.entityId.replace(':','-')}.json.gz` || !/^[a-f0-9]{64}$/.test(entity.sha256) || !(entity.compressedBytes>0 && entity.decodedBytes>0)
      || !entity.geometryVersions?.length || entity.geometryVersionCount!==entity.geometryVersions.length || !Array.isArray(entity.bbox) || entity.bbox.length!==4 || entity.bbox.some(v=>!Number.isFinite(v)))throw new Error('Invalid territorial index entry');
    names(entity.names);
    if (['canonicalName','displayNames','libraryId'].some(key=>Object.hasOwn(entity,key))) throw new Error('Retired index names/identity');
    ids.add(entity.entityId);interval(entity.lifetime);
    if(entity.validFrom!==entity.lifetime.validFrom || entity.validTo!==entity.lifetime.validTo)throw new Error('Inconsistent indexed lifetime');
    const versionIds = new Set();
    for(const v of entity.geometryVersions){if(Object.hasOwn(v,'geometry') || Object.hasOwn(v,'id') || !v.versionId || versionIds.has(v.versionId))throw new Error('Invalid indexed geometry version');versionIds.add(v.versionId);interval(v);}
    for(let i=0;i<entity.geometryVersions.length;i++)for(let j=i+1;j<entity.geometryVersions.length;j++)if(temporalIntervalsOverlap(entity.geometryVersions[i],entity.geometryVersions[j]))throw new Error('Overlapping indexed geometry versions');
  }
  const byId=new Map(raw.entities.map(e=>[e.entityId,e]));
  const lineageIds = new Set(), membership = new Set();
  for (const lineage of raw.lineages) {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(lineage.lineageId) || lineageIds.has(lineage.lineageId) || !Array.isArray(lineage.entityRefs) || !lineage.entityRefs.length) throw new Error('Invalid indexed lineage');
    lineageIds.add(lineage.lineageId); names(lineage.names); relations(lineage.relations);
    for (const id of lineage.entityRefs) {
      if (!ids.has(id) || membership.has(id) || byId.get(id).lineageId !== lineage.lineageId) throw new Error('Invalid lineage membership');
      membership.add(id);
    }
    for (const relation of lineage.relations) if (!ids.has(relation.from) || !ids.has(relation.to)) throw new Error('Missing lineage relation endpoint');
  }
  if (membership.size !== ids.size) throw new Error('Missing lineage membership');
  for(const entity of raw.entities){let parent=entity.parentEntityId;const seen=new Set([entity.entityId]);while(parent){if(!ids.has(parent)||seen.has(parent))throw new Error('Invalid catalog parent');seen.add(parent);parent=byId.get(parent).parentEntityId;}}
  const snapshots=new Set();
  for(const s of raw.snapshots){parseTemporal(s.referenceDate,{nullable:false});if(s.schemaVersion!==1 || !s.id || snapshots.has(s.id) || !Array.isArray(s.entityRefs) || new Set(s.entityRefs).size!==s.entityRefs.length || s.entityRefs.some(id=>!ids.has(id)))throw new Error('Invalid territorial snapshot');snapshots.add(s.id);}
  for(const view of raw.views || []){
    if(view.schemaVersion!==1 || !view.id || Object.hasOwn(view,'referenceDate') || !Array.isArray(view.selections)
      || new Set(view.selections.map(row=>row.entityId)).size!==view.selections.length
      || view.selections.some(row=>!byId.get(row.entityId)?.geometryVersions.some(v=>v.versionId===row.geometryVersionId)))throw new Error('Invalid territorial view');
  }
  return freeze(structuredClone(raw));
}

export function normalizeTerritorialLibraryEntity(raw) {
  if (raw?.schemaVersion !== TERRITORIAL_LIBRARY_SCHEMA_VERSION) throw new Error('Territorial entity schemaVersion mismatch');
  const entityId = text(raw.entityId);
  if (!/^[a-z]+:[A-Za-z0-9_-]+$/.test(entityId) || !Object.values(LIBRARY_ENTITY_TYPES).includes(raw.entityKind)) throw new Error('Invalid territorial entity identity/kind');
  if (['isHistorical', 'isCurrent', 'libraryId', 'startDate', 'endDate', 'canonicalName', 'displayNames'].some(key => Object.hasOwn(raw, key))) throw new Error('Retired territorial entity fields');
  const lifetime = interval(raw.lifetime);
  if (!Array.isArray(raw.geometryVersions) || !raw.geometryVersions.length) throw new Error(`${entityId}: missing geometry versions`);
  const ids = new Set();
  const geometryVersions = raw.geometryVersions.map(version => {
    if (Object.hasOwn(version, 'id')) throw new Error('Retired geometry version ID');
    const id = text(version.versionId);
    if (!id || ids.has(id)) throw new Error(`${entityId}: duplicate/empty geometry version ID`);
    ids.add(id);
    if (!['Polygon', 'MultiPolygon'].includes(version.geometry?.type) || !Array.isArray(version.geometry.coordinates) || !version.geometry.coordinates.length) throw new Error(`${entityId}: expected Polygon/MultiPolygon`);
    // Use the existing archive's structural validator. This isolated registry
    // validates a snapshot; its reference never becomes a project GeometryRef.
    const validated=createGeometryVersionStore([{id,version:1,geojson:version.geometry}]);
    return { ...structuredClone(version), geometry:validated.get({id,version:1}), versionId:id, ...interval(version) };
  });
  for (let i = 0; i < geometryVersions.length; i++) {
    for (let j = i + 1; j < geometryVersions.length; j++) {
      if (temporalIntervalsOverlap(geometryVersions[i], geometryVersions[j])) throw new Error(`${entityId}: overlapping geometry versions`);
    }
  }
  const instantiation = structuredClone(raw.instantiation || { mode: 'independent', countryUpdates: {} });
  if(raw.metadata?.representativeGeometryVersionId && !ids.has(raw.metadata.representativeGeometryVersionId))throw new Error('Missing representative geometry version');
  if (!['independent', 'territory-replacement'].includes(instantiation.mode)) throw new Error('Invalid territorial instantiation mode');
  return freeze({
    schemaVersion: TERRITORIAL_LIBRARY_SCHEMA_VERSION, entityId, entityKind: raw.entityKind,
    ...(raw.lineageId ? {lineageId:raw.lineageId} : {}),
    names: names(raw.names), alternateNames: [...new Set((raw.alternateNames || []).map(text).filter(Boolean))],
    lifetime, parentEntityId: text(raw.parentEntityId), geometryVersions, instantiation,
    metadata: structuredClone(raw.metadata || {}), sourceInfo: structuredClone(raw.sourceInfo || {}),
  });
}

// P5-4: the historical library has a separate reference date from the map
// timeline. Its inclusive end-of-year/month version calculations are C++ owned.
for (const name of ['timelineVersionExistsAt', 'timelineSelectGeometryVersion']) {
  if (typeof sharedCalculationCore[name] !== 'function') {
    throw Object.assign(new Error('Required shared C++ library calculation is missing: ' + name),
      { code: 'PL-CORE-WASM-CAPABILITY' });
  }
}

export function territorialEntityExistsAt(entity, referenceDate) {
  const point = parseTemporal(referenceDate, { nullable: false });
  return sharedCalculationCore.timelineVersionExistsAt(entity.lifetime, point.canonical);
}

export function selectGeometryVersion(entity, referenceDate = null) {
  const index = sharedCalculationCore.timelineSelectGeometryVersion(
    entity.lifetime, entity.geometryVersions, referenceDate);
  return index < 0 ? null : entity.geometryVersions[index];
}

export function instantiateLibraryEntity(entity, referenceDate, geometryVersionId = null) {
  const version = geometryVersionId && referenceDate===null
    ? entity.geometryVersions.find(row=>row.versionId===geometryVersionId) : selectGeometryVersion(entity, referenceDate);
  if (!version) throw new Error('선택한 시점에 사용할 경계 버전이 없습니다.');
  return {
    entityId: entity.entityId, geometryVersionId: version.versionId, entityKind: entity.entityKind,
    name: entity.names.ko || entity.names.en || Object.values(entity.names)[0], parentEntityId: entity.parentEntityId,
    geometry: structuredClone(version.geometry), validFrom: null, validTo: null,
    metadata: {...structuredClone(entity.metadata), ...(version.historicalProvenance ? {historicalProvenance:structuredClone(version.historicalProvenance)} : {}), sourceInfo: structuredClone(entity.sourceInfo), sourceLifetime:structuredClone(entity.lifetime), sourceGeometryValidity:{validFrom:version.validFrom,validTo:version.validTo}, sourceReferenceDate:referenceDate, geometryCertainty: version.certainty},
    instantiation: structuredClone(version.instantiation || entity.instantiation),
  };
}
