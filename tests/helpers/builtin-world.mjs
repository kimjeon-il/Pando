import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {assembleBuiltinWorld,selectBuiltinCountries} from "../../shared/frontend/js/modules/builtin-world-loader.js";
import {createStoredAssetLoader} from '../../shared/frontend/js/modules/stored-asset-loader.js';
import {temporalContains,temporalMonthEnd} from '../../shared/frontend/js/modules/temporal.js';

const root=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
let catalog;
const cache=new Map();
const scopedCountries=new Map();
let scopedAssets;
export function builtinProject(month){
 catalog ||= JSON.parse(fs.readFileSync(new URL('index.json',root)));
 const countries=selectBuiltinCountries(catalog,month).map(entry=>{
  if(!cache.has(entry.entityId))cache.set(entry.entityId,JSON.parse(gunzipSync(fs.readFileSync(new URL(entry.file,root)))));
  return cache.get(entry.entityId);
 });
 return assembleBuiltinWorld(catalog,countries,month);
}

/** Explicit local fixture scope; the complete-world API above stays unchanged. */
export async function scopedBuiltinProject(month,entityIds){
 catalog ||= JSON.parse(fs.readFileSync(new URL('index.json',root)));
 if(!Array.isArray(entityIds)||!entityIds.length||new Set(entityIds).size!==entityIds.length
  ||entityIds.some(id=>typeof id!=='string'||!catalog.entities.some(row=>row.entityId===id)))
  throw new TypeError('An explicit unique builtin country scope is required');
 scopedAssets ||= createStoredAssetLoader({
  dataRevision:JSON.parse(fs.readFileSync(new URL('../../config/library-data.json',import.meta.url))).revision,
  cacheStorage:null,resolveUrl:spec=>new URL(spec.file,root).href,
 });
 const active=new Map(selectBuiltinCountries(catalog,month).map(entry=>[entry.entityId,entry]));
 const required=new Set(entityIds),countries=[],date=temporalMonthEnd(month);
 for(const id of required){
  const entry=active.get(id);
  // Retain inactive requested descriptors in the scoped catalog; the actual
  // selector, rather than an omitted input, determines their absence.
  if(!entry)continue;
  if(!scopedCountries.has(entry.file))scopedCountries.set(entry.file,(async()=>{
   const bytes=fs.readFileSync(new URL(entry.file,root));
   const {value}=await scopedAssets.decodeStoredAsset(bytes,entry,'builtin-world',id,id,
    buffer=>JSON.parse(new TextDecoder().decode(buffer)));
   if(value.entityId!==id||value.identity?.id!==id||value.schemaVersion!==2)
    throw new Error('Builtin country identity mismatch');
   return value;
  })().catch(error=>{scopedCountries.delete(entry.file);throw error;}));
  const country=await scopedCountries.get(entry.file);countries.push(country);
  for(const relation of country.timelineRecords.parentRelations){
   if(!temporalContains(relation,date)||!relation.parentId)continue;
   if(!active.has(relation.parentId))throw new Error('Missing active builtin parent: '+relation.parentId);
   required.add(relation.parentId);
  }
 }
 const scopedCatalog={...catalog,entities:catalog.entities.filter(entry=>required.has(entry.entityId))};
 return assembleBuiltinWorld(scopedCatalog,countries,month);
}
export function withExplicitView(input){
 return {...input,view:{schemaVersion:1,id:'world:catalog',selections:input.currentSnapshot.entityRefs.map(entityId=>{
  const source=input.entities.find(row=>row.entityId===entityId);
  return {entityId,geometryVersionId:source.geometryVersions.at(-1).versionId};
 })}};
}
// Full interval projection is a test oracle only; product loading selects a scene.
export function contextProject(catalog){
 const countries=catalog.countries.filter(row=>row.timelineRecords.lifetimes.length),project=structuredClone(catalog.index.template);
 project.projectSetup={initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
 project.territorialEntities=countries.map(row=>{
  const identity=structuredClone(row.identity);
  identity.properties.metadata.historicalTimeline.geometryBindings=row.sourceBindings;return identity;
 });
 project.timelineRecords={schemaVersion:3,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
 for(const key of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])project.timelineRecords[key]=countries.flatMap(row=>row.timelineRecords[key]);
 project.geometries=[...new Map(countries.flatMap(row=>row.geometries).map(row=>[row.id+':'+row.version,row])).values()];
 return project;
}

