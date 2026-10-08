import { prepareProjectForStorage, prepareProjectForActivation } from '../../assets/js/modules/project-state.js';
import { productionGeoPackage } from '../../tests/helpers/production-geopackage.mjs';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';

// Only these documented identity-keyed collections have immaterial row order.
// Everything inside a row, including coordinates and property arrays, is exact.
function keyed(rows, key) {
  if (!Array.isArray(rows)) throw new Error('Missing exchange collection');
  const result = Object.create(null);
  for (const row of rows) {
    const id = key(row);
    if (Object.hasOwn(result, id)) throw new Error('Duplicate exchange identity: ' + id);
    result[id] = structuredClone(row);
  }
  return result;
}
export function exchangeContent(project) {
  const records = structuredClone(project.timelineRecords);
  for (const name of ['lifetimes', 'geometryBindings', 'parentRelations']) records[name] = keyed(records[name], row => row.id);
  return {
    territorialEntities: keyed(project.territorialEntities, row => row.id),
    timelineRecords: records,
    geometries: keyed(project.geometries, row => JSON.stringify([row.id, row.version])),
  };
}
export function exchangeDocument(project) {
  return {...structuredClone(project),...exchangeContent(project)};
}
export function activation(project) {
  try { prepareProjectForActivation(project); return 'OK'; }
  catch (error) { if (!error.code) throw error; return error.code; }
}
export function storageVerdict(project) {
  try { prepareProjectForStorage(project); return 'OK'; }
  catch (error) { if (!error.code) throw error; return error.code; }
}
export async function exchangeTrace(input, format, save, wholeDocument=false) {
  const project = format === 'gpkg'
    ? (await productionGeoPackage('read', input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength))).metadata.projectState
    : structuredClone(input);
  const read = prepareProjectForStorage(project);
  const {territorialEntities,...projectFields}=read;
  const serialized = JSON.stringify(createProjectSerializer({
    appVersion:read.version,baseDataset:read.baseDataset,distributionModes:read.distributionModel.sourceModes,
    terrainDataset:read.physicalSourceInfo.terrain.dataset,hydroDataset:read.physicalSourceInfo.hydro.dataset,
    now:()=>new Date(read.savedAt),readSnapshot:()=>({territorialEntities,projectFields,
      fullAutosave:read.baseDataset==='external-territorial-entities',terrainSourceInfo:read.physicalSourceInfo.terrain,
      hydroManifest:read.physicalSourceInfo.hydro}),
  }).buildProject());
  save('web.saved.json', serialized);
  const reopened = prepareProjectForStorage(JSON.parse(serialized));
  const packaged = await productionGeoPackage('write', new ArrayBuffer(0), reopened);
  save('web.saved.gpkg', new Uint8Array(packaged.buffer));
  const packageReopened = prepareProjectForStorage((await productionGeoPackage('read', packaged.buffer)).metadata.projectState);
  return { stages: [read, reopened, packageReopened].map(wholeDocument?exchangeDocument:exchangeContent), activation: activation(read) };
}
