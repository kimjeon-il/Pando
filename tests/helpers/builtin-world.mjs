import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {assembleBuiltinWorld,selectBuiltinCountries} from '../../assets/js/modules/builtin-world-loader.js';
import {deviceCurrentMonth} from '../../assets/js/modules/builtin-month-clock.js';

const root=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
let catalog;
const cache=new Map();
export function builtinProject(month,currentMonth=deviceCurrentMonth()){
 catalog ||= JSON.parse(fs.readFileSync(new URL('index.json',root)));
 const countries=selectBuiltinCountries(catalog,month,currentMonth).map(entry=>{
  if(!cache.has(entry.entityId))cache.set(entry.entityId,JSON.parse(gunzipSync(fs.readFileSync(new URL(entry.file,root)))));
  return cache.get(entry.entityId);
 });
 return assembleBuiltinWorld(catalog,countries,month,currentMonth);
}
export function withExplicitView(input){
 return {...input,view:{schemaVersion:1,id:'world:catalog',selections:input.currentSnapshot.entityRefs.map(entityId=>{
  const source=input.entities.find(row=>row.entityId===entityId);
  return {entityId,geometryVersionId:(source.geometryVersions.find(row=>row.datePrecision==='current')||source.geometryVersions.at(-1)).versionId};
 })}};
}
// Full interval projection is a test oracle only; product loading selects a scene.
export function contextProject(catalog,mode='dated'){
 const countries=catalog.countries.filter(row=>row.modes[mode].lifetimes.length),project=structuredClone(catalog.index.template);
 project.projectSetup={initialMonth:'2026-10',timelineRange:null,initialMapBounds:null,sourceMode:'builtin'};
 project.territorialEntities=countries.map(row=>{
  const identity=structuredClone(row.identity);
  identity.properties.metadata.historicalTimeline.geometryBindings=row.sourceBindings[mode];return identity;
 });
 project.timelineRecords={schemaVersion:2,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};
 for(const key of ['lifetimes','geometryBindings','parentRelations','propertyBindings'])project.timelineRecords[key]=countries.flatMap(row=>row.modes[mode][key]);
 project.geometries=[...new Map(countries.flatMap(row=>row.geometries).map(row=>[row.id+':'+row.version,row])).values()];
 return project;
}
