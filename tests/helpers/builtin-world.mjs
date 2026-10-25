import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {assembleBuiltinWorld,selectBuiltinCountries} from "../../shared/frontend/js/modules/builtin-world-loader.js";

const root=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
let catalog;
const cache=new Map();
export function builtinProject(month){
 catalog ||= JSON.parse(fs.readFileSync(new URL('index.json',root)));
 const countries=selectBuiltinCountries(catalog,month).map(entry=>{
  if(!cache.has(entry.entityId))cache.set(entry.entityId,JSON.parse(gunzipSync(fs.readFileSync(new URL(entry.file,root)))));
  return cache.get(entry.entityId);
 });
 return assembleBuiltinWorld(catalog,countries,month);
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
 project.timelineRecords={schemaVersion:2,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
 for(const key of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])project.timelineRecords[key]=countries.flatMap(row=>row.timelineRecords[key]);
 project.geometries=[...new Map(countries.flatMap(row=>row.geometries).map(row=>[row.id+':'+row.version,row])).values()];
 return project;
}
