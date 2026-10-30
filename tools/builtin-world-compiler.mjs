import { createHash } from 'node:crypto';
import { normalizeTemporalInterval, parseTemporal } from "../shared/frontend/js/modules/temporal.js";
import { normalizeCountryCollection } from "../shared/frontend/js/modules/country-feature.js";
import { classifyBuiltinCountries, builtinSubunitSourceId } from "../shared/frontend/js/modules/builtin-subunits.js";
import { BUILTIN_TERRITORY_MERGES } from "../shared/frontend/js/modules/builtin-territory-policy.js";
import { createTerritorialFeature, normalizeTerritorialIdentities, TERRITORIAL_IDENTITY_FIELDS } from "../shared/frontend/js/modules/territorial-units.js";
import { createGeometryVersionStore } from "../shared/frontend/js/modules/geometry-version-store.js";
import { normalizeTimelineRecords } from "../shared/frontend/js/modules/timeline-records.js";
import { createProjectSerializer } from "../apps/editor/frontend/js/modules/project-serializer.js";
import { DISTRIBUTION_MODES } from "../shared/frontend/js/modules/distribution-model.js";
import {territorialNameData} from '../apps/editor/frontend/js/modules/territorial-library.js';
import { adjustHistoricalTerritories, historicalWorldClipper,createHistoricalTerritoryCache } from './historical-world-territories.mjs';

const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};
const date = ([year, month, day]) => `${year < 0 ? '-' : year > 9999 ? '+' : ''}${String(Math.abs(year)).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
function shiftDay(key, direction) {
  let [year, month, day] = key;
  if (direction > 0) {
    const end = parseTemporal(date([year, month, 1]).slice(0, -3)).endKey[2];
    if (++day > end) { day = 1; if (++month > 12) { month = 1; year = year === -1 ? 1 : year + 1; } }
  } else if (--day < 1) {
    if (--month < 1) { month = 12; year = year === 1 ? -1 : year - 1; }
    day = parseTemporal(date([year, month, 1]).slice(0, -3)).endKey[2];
  }
  return [year, month, day];
}
function bounds(interval) {
  const value = normalizeTemporalInterval(interval.validFrom, interval.validTo);
  return { start: value.start?.startKey ?? null, end: value.end?.endKey ?? null };
}
function intersection(a, b) {
  const start = !a.start ? b.start : !b.start ? a.start : compare(a.start, b.start) > 0 ? a.start : b.start;
  const end = !a.end ? b.end : !b.end ? a.end : compare(a.end, b.end) < 0 ? a.end : b.end;
  return start && end && compare(start, end) > 0 ? null : { start, end };
}
function covers(interval, start) {
  if (start === null) return interval.start === null;
  return (!interval.start || compare(interval.start, start) <= 0) && (!interval.end || compare(interval.end, start) >= 0);
}
function append(rows, row, sameValue) {
  const previous = rows.at(-1);
  if (previous && previous.objectRef.domain===row.objectRef.domain && previous.objectRef.id===row.objectRef.id && previous.validTo !== null && row.validFrom !== null
      && date(shiftDay(parseTemporal(previous.validTo).endKey, 1)) === row.validFrom && sameValue(previous, row)) {
    previous.validTo = row.validTo;
  } else rows.push(row);
}
const identity = feature => ({ type: 'Feature', id: feature.id, geometry: null,
  properties: Object.fromEntries(TERRITORIAL_IDENTITY_FIELDS.map(key => [key, structuredClone(feature.properties[key])])) });
const withoutGeometry = ({ geometry, ...value }) => structuredClone(value);

function applyNameBaseline(identity,entity) {
  const properties=identity.properties;
  if(Object.hasOwn(entity,'nameVersions')) {
    properties.name='';delete properties.metadata.nameDetails;
    properties.metadata.nameSource={baseName:'',nameExplicit:true};
  }else{
    const naming=territorialNameData(entity);
    properties.name=naming.name;properties.metadata.nameDetails=naming.names;
  }
}

export function compileBuiltinWorldNameBindings(entity,id) {
  return territorialNameData(entity).versions.flatMap((version,i)=>{
    const period=intersection(bounds(version),bounds(entity.lifetime));
    if(!period)return [];
    const naming=territorialNameData({lifetime:{validFrom:null,validTo:null},nameVersions:[{...version,validFrom:null,validTo:null}]});
    return [{id:`historical-world:names:${id}:${i}`,objectRef:{domain:'territorial',id},
      validFrom:period.start&&date(period.start),validTo:period.end&&date(period.end),property:'name',value:{name:naming.name,nameExplicit:true,names:naming.names}}];
  });
}

export function replaceBuiltinWorldCountryNames(country,entity) {
  const result=structuredClone(country);
  applyNameBaseline(result.identity,entity);
  result.timelineRecords.propertyBindings=[...result.timelineRecords.propertyBindings.filter(row=>row.property!=='name'),
    ...compileBuiltinWorldNameBindings(entity,result.entityId)];
  return result;
}

/** Build an ordinary editable project; library inputs and raw intervals stay immutable. */
export function compileBuiltinWorldCatalog({ entities, view, currentWorld, policy, clipper = historicalWorldClipper, availableSourceIds = null }) {
  entities=entities.filter(entity=>['general','regional'].includes(entity.entityKind));
  if(view?.schemaVersion!==1 || !Array.isArray(view.selections) || Object.hasOwn(view,'referenceDate'))throw new Error('Invalid world view');
  if (!policy || policy.schemaVersion !== 1) throw new Error('Missing historical world policy');
  const selection=new Map(view.selections.map(row=>[row.entityId,row.geometryVersionId]));
  if(selection.size!==view.selections.length)throw new Error('Duplicate world selection');
  const bySource = new Map(entities.map(entity => [entity.entityId, entity]));
  if (bySource.size !== entities.length) throw new Error('Duplicate source entity');
  const currentIds = new Set(selection.keys());
  for (const id of currentIds) if (!bySource.has(id)) throw new Error(`Missing current source: ${id}`);
  const classified = classifyBuiltinCountries(normalizeCountryCollection(currentWorld), { availableSourceIds });
  const definitions = new Map(), sourceToProject = new Map(), sourceIdentities = [];
  for (const feature of [...classified.countries.features, ...classified.subunits]) {
    const sourceFeature = builtinSubunitSourceId(feature) || feature.id;
    const sourceFeatureIds = [sourceFeature, ...BUILTIN_TERRITORY_MERGES.filter(row => row.controller === sourceFeature).map(row => row.sourceId)].sort();
    const sources = entities.filter(entity => currentIds.has(entity.entityId) && sourceFeatureIds.includes(entity.sourceInfo?.featureId));
    if (!sources.length) throw new Error(`Missing current identity: ${feature.id}`);
    for (const source of sources) sourceToProject.set(source.entityId, feature.id);
    const info = { projectEntityId: feature.id, sourceEntityIds: sources.map(source => source.entityId).sort(), sourceFeatureIds };
    sourceIdentities.push(info);
    const primary = sources.find(source => source.sourceInfo.featureId === sourceFeature);
    const lifetime = bounds(primary.lifetime);
    const version = primary.geometryVersions.find(row=>row.versionId===selection.get(primary.entityId));
    if(!version)throw new Error(`Missing selected geometry: ${primary.entityId}`);
    const normalized = identity(feature);
    applyNameBaseline(normalized,primary);
    normalized.properties.metadata.historicalTimeline = { entityId: primary.entityId, sourceEntityIds: info.sourceEntityIds,
      lifetime: structuredClone(primary.lifetime), geometryVersions: primary.geometryVersions.map(withoutGeometry), geometryBindings: [] };
    const windows=primary.geometryVersions.map(row=>{
      const interval=intersection(lifetime,bounds(row));
      return interval && {...interval,versionId:row.versionId,
        geometry:row.versionId===version.versionId?feature.geometry:row.geometry,
        parentId:feature.properties.parentId,coverageMode:feature.properties.coverageMode,
        currentSnapshot:row.versionId===version.versionId};
    }).filter(Boolean);
    definitions.set(feature.id,{identity:normalized,currentSnapshot:true,info,windows,nameSource:primary});
  }
  for (const entity of entities) {
    const lifetime = bounds(entity.lifetime);
    // Validate all input windows/geometry, including sources outside the snapshot.
    for (const version of entity.geometryVersions) {
      bounds(version);
      if (!version.geometry) throw new Error(`Missing source geometry: ${version.versionId}`);
    }
    if (currentIds.has(entity.entityId)) continue;
    const first = entity.geometryVersions[0];
    if (!first) throw new Error(`Missing source geometry: ${entity.entityId}`);
    const feature = createTerritorialFeature({ id: entity.entityId, entityKind: entity.entityKind,
      name: '', geometry: first.geometry,
      color: entity.metadata?.defaultColor || '',
      notes: entity.metadata?.notes || '', metadata: { ...structuredClone(entity.metadata),
        ...(entity.entityKind === 'general' && !entity.parentEntityId && entity.metadata?.defaultFlagDataUrl
          ? { flagDataUrl: entity.metadata.defaultFlagDataUrl } : {}),
        historicalTimeline: { entityId: entity.entityId, lifetime: structuredClone(entity.lifetime),
          sourceInfo: structuredClone(entity.sourceInfo), geometryVersions: entity.geometryVersions.map(withoutGeometry), geometryBindings: [] } },
      sourceEntityId: entity.entityId });
    applyNameBaseline(feature,entity);
    const windows = entity.geometryVersions.map(version => {
      const available = bounds(version);
      const interval = available && intersection(lifetime, available);
      return interval && { ...interval, geometry: version.geometry, versionId: version.versionId,
        parentId: sourceToProject.get(entity.parentEntityId) || entity.parentEntityId,
        coverageMode: entity.instantiation.coverageMode || 'explicit' };
    }).filter(Boolean);
    definitions.set(entity.entityId, { identity: identity(feature), currentSnapshot: false, windows,nameSource:entity });
    sourceIdentities.push({ projectEntityId: entity.entityId, sourceEntityIds: [entity.entityId], sourceFeatureIds: [] });
  }
  const archive = createGeometryVersionStore(), byGeometry = new Map();
  const adjustments = [];
  const refByObject=new WeakMap();
  const geometryRef = geometry => {
    if(refByObject.has(geometry))return refByObject.get(geometry);
    const bytes = JSON.stringify(geometry), hash = createHash('sha256').update(bytes).digest('hex');
    if (!byGeometry.has(hash)) { const ref = { id: `historical-world:${hash}`, version: 1 }; archive.insert(ref, geometry); byGeometry.set(hash, ref); }
    const ref=byGeometry.get(hash);refByObject.set(geometry,ref);return ref;
  };
  const ordered = [...definitions].sort(([a], [b]) => a.localeCompare(b, 'en'));
  const events=new Map();
  for(const definition of definitions.values())for(const window of definition.windows){
    if(window.start)events.set(date(window.start),window.start);
    if(window.end){const next=shiftDay(window.end,1);events.set(date(next),next);}
  }
  for(const rule of policy.replacements){const interval=bounds(rule);
    if(interval.start)events.set(date(interval.start),interval.start);
    if(interval.end){const next=shiftDay(interval.end,1);events.set(date(next),next);}
  }
  const cuts=[...events.values()].sort(compare);
  const rowsByEntity=new Map(),sourceBindings=new Map();
  const territoryCache=createHistoricalTerritoryCache(clipper);
  for (let index = 0; index <= cuts.length; index++) {
    const start = index === 0 ? null : cuts[index - 1], end = index === cuts.length ? null : shiftDay(cuts[index], -1);
    let candidates = [];
    for (const [id, definition] of ordered) {
      let active = definition.windows.filter(window=>covers(window,start));
      if (active.length > 1) throw new Error(`Overlapping geometry intervals: ${id}`);
      if (active.length) candidates.push({ ...active[0], entityId: id, currentSnapshot: active[0].currentSnapshot ?? definition.currentSnapshot,
        validFrom: start && date(start), validTo: end && date(end) });
    }
    // A parent gap hides descendants transitively; cycles are a source error.
    const all = new Map(candidates.map(row => [row.entityId, row]));
    const activeParent = (row, seen = new Set()) => {
      if (seen.has(row.entityId)) throw new Error(`Cyclic parent: ${row.entityId}`);
      if (!row.parentId) return true;
      seen.add(row.entityId);
      const parent = all.get(row.parentId);
      return !!parent && activeParent(parent, seen);
    };
    candidates = candidates.filter(row => activeParent(row));
    const mappedPolicy = { ...policy, replacements: policy.replacements.map(rule => ({ ...rule,
      targetEntityId: sourceToProject.get(rule.targetEntityId) || rule.targetEntityId,
      priorityEntityId: sourceToProject.get(rule.priorityEntityId) || rule.priorityEntityId,
    })) };
    const adjusted = adjustHistoricalTerritories(candidates, mappedPolicy, clipper,territoryCache);
    candidates = adjusted.candidates;
    const surviving=new Map(candidates.map(row=>[row.entityId,row]));
    const hasParent=row=>!row.parentId || (surviving.has(row.parentId)&&hasParent(surviving.get(row.parentId)));
    candidates=candidates.filter(hasParent);
    adjustments.push(...adjusted.adjustments.map(row => ({ ...row, validFrom: start && date(start), validTo: end && date(end) })));
    for (const candidate of candidates) {
      const ref = geometryRef(candidate.geometry);
      let rows = rowsByEntity.get(candidate.entityId);
      if (!rows) rowsByEntity.set(candidate.entityId, rows = { availability: [], geometryBindings: [], parentRelations: [] });
      const base = { objectRef: {domain:"territorial",id:candidate.entityId}, validFrom: start && date(start), validTo: end && date(end) };
      append(rows.availability, { ...base }, () => true);
      append(rows.geometryBindings, { ...base, geometryRef: ref }, (a, b) => a.geometryRef.id === b.geometryRef.id);
      append(rows.parentRelations, { ...base, parentId: candidate.parentId, coverageMode: candidate.coverageMode }, (a, b) => a.parentId === b.parentId && a.coverageMode === b.coverageMode);
      if(!sourceBindings.has(candidate.entityId))sourceBindings.set(candidate.entityId,[]);
      append(sourceBindings.get(candidate.entityId),{...base,geometryRef:ref,sourceVersionId:candidate.versionId},
        (a,b)=>a.geometryRef.id===b.geometryRef.id&&a.sourceVersionId===b.sourceVersionId);

    }
  }
  const identities = normalizeTerritorialIdentities(ordered.filter(([id]) => rowsByEntity.has(id)).map(([, value]) => value.identity));
  const records = { schemaVersion: 3, lifetimes: [], geometryBindings: [], parentRelations: [], propertyBindings: [] };
  for (const [id] of ordered) {
    const rows = rowsByEntity.get(id); if (!rows) continue;
    records.lifetimes.push({ id: `historical-world:lifetimes:${id}:0`, objectRef: {domain:"territorial",id},
      ...structuredClone(definitions.get(id).identity.properties.metadata.historicalTimeline.lifetime) });
    for (const name of ['geometryBindings', 'parentRelations']) rows[name].forEach((row, i) => records[name].push({ id: `historical-world:${name}:${id}:${i}`, ...row }));
    records.propertyBindings.push(...compileBuiltinWorldNameBindings(definitions.get(id).nameSource,id));
  }
  const normalized = normalizeTimelineRecords(records, { entities: identities.map(row => ({ objectRef: {domain:"territorial",id:row.id}, entityKind: row.properties.entityKind })), geometryExists: ref => archive.get(ref) !== null });
  const availability=new Map([...rowsByEntity].map(([id,rows])=>[id,rows.availability]));
  const snapshot={documentId:'6dcead54-3bc5-4ca2-a4f5-455305bba911',physicalSourceInfo:{},territorialEntities:[],fullAutosave:true,projectFields:{
    timelineRecords:{schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]},geometries:[],sourceInfo:null,
    labels:[],genericFeatures:[],hydroEdits:[],distributionLayers:[],distributionEntries:[],labelSettings:{},
    distributionSettings:{renderMode:'overlap',activeLayerId:'',boundaryVisible:true},
    projectSetup:{initialMonth:'1970-01',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'},
    layerPresentation:{schemaVersion:5,styles:{},objectStyles:{},objectOrder:[]}}};
  const template=createProjectSerializer({appVersion:'builtin-world-v1',distributionModes:Object.values(DISTRIBUTION_MODES),
    now:()=>new Date(0),readSnapshot:()=>snapshot}).buildProject();
  delete template.projectSetup;
  const countries=[];
  const allGeometry=archive.snapshot();
  for(const [id,definition] of ordered){
    const timelineRecords=Object.fromEntries(Object.entries(normalized).map(([key,value])=>[key,
      Array.isArray(value)?value.filter(row=>row.objectRef.domain==="territorial"&&row.objectRef.id===id):value]));
    if(!timelineRecords.lifetimes.length)continue;
    const refs=new Set(timelineRecords.geometryBindings.map(row=>JSON.stringify(row.geometryRef)));
    const geometries=allGeometry.filter(row=>refs.has(JSON.stringify({id:row.id,version:row.version})));
    countries.push({schemaVersion:2,entityId:id,identity:definition.identity,timelineRecords,geometries,
      sourceBindings:sourceBindings.get(id)||[]});
  }
  const index={schema:'pandolab-builtin-world',schemaVersion:2,template,
    entities:countries.map(country=>({entityId:country.entityId,
      coverage:availability.get(country.entityId)?.map(({validFrom,validTo})=>({validFrom,validTo}))||[]})),sourceIdentities};
  return {index,countries,coverageReport:{schemaVersion:2,adjustments:coalesceCoverageAdjustments(adjustments),
    entities:countries.map(country=>({entityId:country.entityId,
      lifetime:structuredClone(country.identity.properties.metadata.historicalTimeline.lifetime),
      availability:index.entities.find(row=>row.entityId===country.entityId).coverage}))}};
}

// Unrelated countries can introduce extra temporal cuts. Keep evidence in the
// same maximal intervals whether a component is compiled alone or in a world.
export function coalesceCoverageAdjustments(adjustments) {
  const groups=new Map();
  for(const row of adjustments){
    const {validFrom,validTo,...value}=row,key=JSON.stringify(value);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({...value,validFrom,validTo});
  }
  return [...groups].sort(([a],[b])=>a.localeCompare(b,'en')).flatMap(([,values])=>{
    values.sort((a,b)=>a.validFrom===null?-1:b.validFrom===null?1:compare(parseTemporal(a.validFrom).startKey,parseTemporal(b.validFrom).startKey));
    const rows=[];
    for(const row of values){
      const previous=rows.at(-1);
      if(previous && previous.validTo !== null && row.validFrom !== null
        && date(shiftDay(parseTemporal(previous.validTo).endKey,1)) === row.validFrom) previous.validTo=row.validTo;
      else rows.push(row);
    }
    return rows;
  });
}
