import { startupDocument } from '../../tests/helpers/core-startup.mjs';
import { TERRITORIAL_SCHEMA_VERSION } from "../../shared/frontend/js/modules/territorial-units.js";

export const BASE_DATASET = 'Natural Earth 5.1.1 · Admin 0 Countries · 1:10m · de facto';
export const SOURCE_MONTH = '2026-10';
const rectangle = (west, south, east, north) => ({ type: 'Polygon', coordinates: [
  [[west, south], [west, north], [east, north], [east, south], [west, south]],
] });

/** Synthetic coordinates only; never part of the geographic publication corpus. */
export function tinyFixture() {
  const rows = [
    ['shell-country-a', '시험 국가 A', '#d46c56', '', [-4, 6, 0, 10]],
    ['shell-country-b', '시험 국가 B', '#529ada', '', [0, 6, 4, 10]],
    ['shell-child-a', '시험 하위 객체', '#d79a63', 'shell-country-a', [-3, 7, -1, 9]],
  ];
  const features = rows.map(([id, name, color, parentId, bounds]) => ({
    type: 'Feature', id, properties: { schemaVersion: TERRITORIAL_SCHEMA_VERSION, name, style: { color }, entityKind: 'general', parentId,
      coverageMode: 'explicit', locked: false }, geometry: rectangle(...bounds),
  }));
  const project = startupDocument(features);
  project.baseDataset = BASE_DATASET;
  project.timelineRecords.schemaVersion = 2;
  project.timelineRecords.propertyBindings = [];

  const template=structuredClone(project);template.territorialEntities=[];template.geometries=[];
  template.timelineRecords={schemaVersion:2,lifetimes:[],geometryBindings:[],parentRelations:[],propertyBindings:[]};delete template.projectSetup;
  const builtinCountries=project.territorialEntities.map(identity=>{
    const records=Object.fromEntries(Object.entries(project.timelineRecords).map(([key,value])=>[key,Array.isArray(value)?value.filter(row=>row.entityId===identity.id):value]));
    const refs=new Set(records.geometryBindings.map(row=>row.geometryRef.id));
    return {schemaVersion:2,entityId:identity.id,identity,timelineRecords:records,sourceBindings:[],geometries:project.geometries.filter(row=>refs.has(row.id))};
  });
  const builtinIndex={schema:'pandolab-builtin-world',schemaVersion:2,template,entities:builtinCountries.map(row=>({entityId:row.entityId,
    coverage:[{validFrom:null,validTo:null}]}))};
  return {project,builtinIndex,builtinCountries,countries:{type:'FeatureCollection',features},entityCount:features.length,
    coordinateCount:features.reduce((count,row)=>count+row.geometry.coordinates[0].length,0)};
}
