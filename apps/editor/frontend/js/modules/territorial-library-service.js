import {instantiateLibraryEntity, territorialEntityExistsAt, selectGeometryVersion,historicalSourceAvailability,normalizeTerritorialLibraryIndex} from './territorial-library.js';
import {compareTemporal, parseTemporal} from "../../../../../shared/frontend/js/modules/temporal.js";

const compareIdentity = (left, right) => left < right ? -1 : left > right ? 1 : 0;

// UI/candidate boundary only; direct dated service and model APIs retain their cursor semantics.
function normalizeReferenceDate(raw) {
  const date = parseTemporal(raw);
  if (!date) return null;
  return date.canonical + (date.precision === 'year' ? '-01-01' : date.precision === 'month' ? '-01' : '');
}

// These optional metadata fields are not date-validated by the catalog schema.
// Only malformed candidate dates are recoverable here; selector errors propagate.
function optionalMetadataDate(entity, field) {
  const source = entity.metadata?.[field];
  if (source == null) return null;
  const diagnostic = `${entity.entityId}: invalid metadata.${field}`;
  if (typeof source !== 'string') {
    console.warn(diagnostic, new TypeError('Optional metadata dates must be strings'));
    return null;
  }
  try {
    return parseTemporal(source) ? source : null;
  } catch (error) {
    if (error.code !== 'PL-TEMPORAL-001') throw error;
    console.warn(diagnostic, error);
    return null;
  }
}

export function createTerritorialLibraryService({loader, today = () => {
  const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}}) {
  if (!loader || !['loadIndex','loadEntity','peek'].every(key=>typeof loader[key] === 'function')) throw new Error('Territorial loader is required');
  let catalog = null;
  let pending = null;
  async function load() {
    if(catalog) return catalog;
    if(!pending) pending=loader.loadIndex().then(index=>{
      if(index.schemaVersion!==2)throw new Error('Territorial index schema mismatch');
      const ids=new Set();
      for(const e of index.entities){if(!e.entityId || ids.has(e.entityId))throw new Error('Duplicate catalog identity');ids.add(e.entityId);}
      catalog=index;return index;
    }).catch(error=>{pending=null;throw error;});
    return pending;
  }
  const list=()=>catalog?.entities || [];
  const get=id=>list().find(e=>e.entityId===String(id)) || null;
  function matchingGroups(query) {
    const needle = String(query).trim().toLocaleLowerCase('ko');
    const matches = values=>values.some(name=>name.toLocaleLowerCase('ko').includes(needle));
    return (catalog?.lineages || []).map(lineage=>{
      const groupMatches = !needle || matches(Object.values(lineage.names));
      const entities = lineage.entityRefs.map(get).filter(entity=>groupMatches
        || matches([...Object.values(entity.names),...entity.alternateNames]));
      return {lineageId:lineage.lineageId, names:lineage.names, entities};
    }).filter(group=>group.entities.length);
  }
  function search({query = '', referenceDate = null} = {}) {
    const dated = parseTemporal(referenceDate) !== null;
    return matchingGroups(query).map(group=>({...group, entities:group.entities
      .map(entity=>({...entity,
        sourceAvailability:dated?historicalSourceAvailability(entity,referenceDate):null,
        selectedVersionId:dated ? selectGeometryVersion(entity,referenceDate)?.versionId || null : null})),
    })).filter(group=>group.entities.length);
  }
  function events({query = ''} = {}) {
    const found = new Map();
    for (const {entities} of matchingGroups(query)) for (const entity of entities) {
      const name = entity.names.ko || entity.names.en || Object.values(entity.names)[0];
      const sources = [
        ['lifetime.validFrom',entity.lifetime.validFrom,'기록 시작'],
        ['lifetime.validTo',entity.lifetime.validTo,'기록 마지막 시점'],
        ['metadata.dissolutionDate',optionalMetadataDate(entity,'dissolutionDate'),'해체'],
      ];
      for (const [field,date,label] of sources) if (date !== null) {
        const id = `${entity.entityId}:${field}:${date}`;
        found.set(id,{id, entityId:entity.entityId, date, name:`${name} · ${label}`});
      }
    }
    return [...found.values()].sort((a,b)=>compareTemporal(a.date,b.date) || compareIdentity(a.id,b.id));
  }
  function resolveSelection(entityId, referenceDate = null) {
    const entity = get(entityId);
    if (!entity) return null;
    if (parseTemporal(referenceDate)) {
      // UI callers normalize first. Direct callers keep their supplied cursor and precision.
      const version = selectGeometryVersion(entity, referenceDate);
      return version ? {entityId:entity.entityId, geometryVersionId:version.versionId, referenceDate,
        mode:'date', basis:'input', sourceDate:referenceDate} : null;
    }
    const representativeId=entity.metadata?.representativeGeometryVersionId;
    if(representativeId){
      const version=entity.geometryVersions.find(row=>row.versionId===representativeId);
      if(!version)throw new Error(`Missing representative geometry: ${entity.entityId}`);
      return {entityId:entity.entityId,geometryVersionId:version.versionId,referenceDate:null,
        mode:'representative',basis:'version',sourceDate:null};
    }
    return null;
  }
  function entityRefsWithChildren(rootIds, depth='none', referenceDate=today()) {
    const selected=new Set(rootIds.map(String));
    if(depth==='none')return [...selected];
    let frontier=[...selected];
    while(frontier.length){const parents=new Set(frontier);frontier=[];
      for(const e of list()) if(parents.has(e.parentEntityId) && !selected.has(e.entityId)
        && (referenceDate===null ? resolveSelection(e.entityId)!==null : territorialEntityExistsAt(e,referenceDate))){selected.add(e.entityId);frontier.push(e.entityId);}
      if(depth==='level1')break;
    }
    return [...selected];
  }
  async function instantiateDescriptors(rootIds, referenceDate, depth='none') {
    const cursor=parseTemporal(referenceDate) ? referenceDate : null;
    await load();
    const entities=await Promise.all(entityRefsWithChildren(rootIds,depth,cursor).map(id=>loader.loadEntity(id)));
    return entities.map(e=>{
      const representative=cursor===null ? resolveSelection(e.entityId) : null;
      if(cursor===null && !representative)throw new Error(`A representative geometry version is required: ${e.entityId}`);
      return instantiateLibraryEntity(e,cursor,representative?.geometryVersionId);
    });
  }
  function replaceCatalog(index){catalog=normalizeTerritorialLibraryIndex(index);pending=null;}
  return Object.freeze({load,get,list,loadEntity:loader.loadEntity, getLoadedEntity:loader.peek,entityRefsWithChildren,instantiateDescriptors,replaceCatalog,
    snapshots:()=>catalog?.snapshots || [],getSnapshot:id=>catalog?.snapshots.find(s=>s.id===id) || null,
    today,normalizeReferenceDate,resolveSelection,search,events,
    sourceAvailability:(id,date)=>historicalSourceAvailability(get(id),date),
  });
}
