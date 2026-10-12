import { productionGeoPackage } from '../../tests/helpers/production-geopackage.mjs';
import { createNodeCoreProject } from '../../tests/helpers/core-project.mjs';
import { startupDocument } from '../../tests/helpers/core-startup.mjs';

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
export async function activation(project) {
  let owner;
  try { owner=await createNodeCoreProject(project);return 'OK'; }
  catch (error) { if (!error.code) throw error; return error.code; }
  finally { owner?.dispose(); }
}
export async function storageVerdict(project) {
  const owner=await createNodeCoreProject(startupDocument());
  try { await owner.client.validateImport(JSON.stringify(project));return 'OK'; }
  catch (error) { if (!error.code) throw error; return error.code; }
  finally { owner.dispose(); }
}
export async function exchangeTrace(input, format, save, wholeDocument=false) {
  const project = format === 'gpkg'
    ? (await productionGeoPackage('read', input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength))).metadata.projectState
    : structuredClone(input);
  const owner=await createNodeCoreProject(project);
  try {
    const read=await owner.client.validateImport(JSON.stringify(project));
    const { storageJson: serialized,spatialState }=await owner.client.exportSnapshot({ version: read.version,savedAt: read.savedAt,format: 'pandolab-project-state' });
    await save('web.saved.json',serialized);
    const reopened=await owner.client.validateImport(serialized);
    const packaged=await productionGeoPackage('write',new ArrayBuffer(0),reopened,spatialState);
    await save('web.saved.gpkg',new Uint8Array(packaged.buffer));
    const packageReopened=await owner.client.validateImport(JSON.stringify((await productionGeoPackage('read',packaged.buffer)).metadata.projectState));
    return { stages: [read,reopened,packageReopened].map(wholeDocument ? exchangeDocument:exchangeContent),activation: 'OK' };
  } finally { owner.dispose(); }
}
