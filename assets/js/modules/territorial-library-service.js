import {instantiateLibraryEntity, territorialEntityExistsAt, selectGeometryVersion} from './territorial-library.js';
import {compareTemporal, parseTemporal} from './temporal.js';

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
      // Unknown lifetimes are excluded only from dated browsing, never imports or representatives.
      .filter(entity=>!dated || ((entity.lifetime.validFrom !== null || entity.lifetime.validTo !== null)
        && territorialEntityExistsAt(entity,referenceDate)))
      .map(entity=>({...entity, selectedVersionId:dated ? selectGeometryVersion(entity,referenceDate)?.versionId || null : null})),
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
    function candidate(sourceDate, basis, expectedVersionId = null) {
      const date = normalizeReferenceDate(sourceDate);
      const version = selectGeometryVersion(entity, date);
      if (!version || (expectedVersionId !== null && version.versionId !== expectedVersionId)) return null;
      return {entityId:entity.entityId, geometryVersionId:version.versionId, referenceDate:date,
        mode:'representative', basis, sourceDate};
    }
    const metadataDate = optionalMetadataDate(entity, 'referenceDate');
    if (metadataDate) {
      const selection = candidate(metadataDate, 'metadata');
      if (selection) return selection;
    }
    const snapshots = (catalog?.snapshots || []).filter(snapshot=>snapshot.entityRefs.includes(entity.entityId))
      .sort((a,b)=>compareTemporal(b.referenceDate,a.referenceDate) || compareIdentity(a.id,b.id));
    for (const snapshot of snapshots) {
      const selection = candidate(snapshot.referenceDate, 'snapshot');
      if (selection) return selection;
    }
    const versions = entity.geometryVersions.filter(version=>version.validFrom !== null)
      .sort((a,b)=>compareTemporal(b.validFrom,a.validFrom) || compareIdentity(a.versionId,b.versionId));
    for (const version of versions) {
      const selection = candidate(version.validFrom, 'version-start', version.versionId);
      if (selection) return selection;
    }
    return null;
  }
  function entityRefsWithChildren(rootIds, depth='none', referenceDate=today()) {
    const selected=new Set(rootIds.map(String));
    if(depth==='none')return [...selected];
    let frontier=[...selected];
    while(frontier.length){const parents=new Set(frontier);frontier=[];
      for(const e of list()) if(parents.has(e.parentEntityId) && !selected.has(e.entityId) && territorialEntityExistsAt(e,referenceDate)){selected.add(e.entityId);frontier.push(e.entityId);}
      if(depth==='level1')break;
    }
    return [...selected];
  }
  async function instantiateDescriptors(rootIds, referenceDate, depth='none') {
    if(!referenceDate)throw new Error('A reference date is required');
    parseTemporal(referenceDate,{nullable:false});
    await load();
    const entities=await Promise.all(entityRefsWithChildren(rootIds,depth,referenceDate).map(id=>loader.loadEntity(id)));
    return entities.map(e=>instantiateLibraryEntity(e,referenceDate));
  }
  return Object.freeze({load,get,list,loadEntity:loader.loadEntity, getLoadedEntity:loader.peek,entityRefsWithChildren,instantiateDescriptors,
    snapshots:()=>catalog?.snapshots || [],getSnapshot:id=>catalog?.snapshots.find(s=>s.id===id) || null,
    today,normalizeReferenceDate,resolveSelection,search,events,
  });
}
