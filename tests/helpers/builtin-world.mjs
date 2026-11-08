import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {assembleBuiltinWorld,selectBuiltinCountries} from "../../src/data/builtin-world-loader.js";
import {createStoredAssetLoader} from "../../src/data/stored-asset-loader.js";
import {temporalContains,temporalMonthEnd} from "../../src/document/temporal.js";
import {readBuiltinCountryStoredBytes} from "../../tools/data/builtin-country-bytes.mjs";

const root=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
let catalog;
const cache=new Map();
const scopedCountries=new Map();
let scopedAssets;
export function builtinProject(month){
 catalog ||= JSON.parse(fs.readFileSync(new URL('index.json',root)));
 // Test the actual product contract: a project includes every country and
 // the original validity intervals, even when inactive at the first month.
 const countries=catalog.entities.map(entry=>{
  if(!cache.has(entry.entityId))cache.set(entry.entityId,JSON.parse(gunzipSync(readBuiltinCountryStoredBytes(entry,file=>fs.readFileSync(new URL(file,root))))));
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
   const bytes=readBuiltinCountryStoredBytes(entry,file=>fs.readFileSync(new URL(file,root)));
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
 const loadedIds=new Set(countries.map(row=>row.entityId));
 const scopedCatalog={...catalog,entities:catalog.entities.filter(entry=>loadedIds.has(entry.entityId))};
 return assembleBuiltinWorld(scopedCatalog,countries,month);
}
export function withExplicitView(input){
 return {...input,view:{schemaVersion:1,id:'world:catalog',selections:input.currentSnapshot.entityRefs.map(entityId=>{
  const source=input.entities.find(row=>row.entityId===entityId);
  return {entityId,geometryVersionId:source.geometryVersions.at(-1).versionId};
 })}};
}
// The historical context oracle now follows the same full-history assembler
// as production. No parallel world-construction implementation is necessary.
export function contextProject(catalog){
 return assembleBuiltinWorld(catalog.index,catalog.countries,'2026-10');
}
