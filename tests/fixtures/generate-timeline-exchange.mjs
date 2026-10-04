import { mkdir, writeFile } from 'node:fs/promises';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { projectForStorage } from '../helpers/timeline-project.mjs';
import { productionGeoPackage } from '../helpers/production-geopackage.mjs';

export function exchangeProject(kind) {
  const snapshot = projectForStorage();
  const identity = (id, entityKind = 'general') => ({ type: 'Feature', id, geometry: null, properties: {
    schemaVersion: 5, entityKind, name: `${id} 영토`, notes: '원본 메타데이터 보존', style: { color: '#507090' }, locked: false,
    metadata: { capital: '서울', source: { provider: 'T2-2 exchange corpus', sourceId: id }, originalName: `${id} Territory` },
    sourceFolderId: 'exchange', sourceLibraryId: 'timeline-test', sourceGeometryVersion: 'source-1',
  } });
  snapshot.territorialEntities = [identity('A'), identity('B'), identity('C'), identity('R', 'regional')];
  const records = snapshot.projectFields.timelineRecords;
  const record = (id, entityId, validFrom = null, validTo = null) => ({ id, entityId, validFrom, validTo });
  records.lifetimes = snapshot.territorialEntities.map(entity => record('life:'+entity.id, entity.id));
  records.geometryBindings = snapshot.territorialEntities.map(entity => ({ ...record('shape:'+entity.id, entity.id), geometryRef: { id: 'shape', version: 1 } }));
  records.parentRelations = snapshot.territorialEntities.map(entity => ({ ...record('parent:'+entity.id, entity.id),
    parentId: entity.id === 'B' ? 'A' : '', coverageMode: entity.id === 'B' ? 'partition' : 'explicit' }));
  snapshot.projectFields.geometries[0].geojson = { type: 'MultiPolygon', coordinates: [
    [[[0,0],[10,0],[10,10],[0,10],[0,0]], [[2,2],[2,3],[3,3],[3,2],[2,2]]],
    [[[12,0],[13,0],[13,1],[12,0]]],
    [[[179,0],[-179,0],[-179,1],[179,0]]],
  ] };
  if (kind === 'complex') {
    records.geometryBindings = records.geometryBindings.filter(row => row.entityId !== 'A');
    records.geometryBindings.push({ ...record('A:old','A',null,'1914-06'), geometryRef: { id:'shape', version:1 } },
      { ...record('A:new','A','1914-07',null), geometryRef: { id:'shape', version:2 } });
    records.lifetimes = records.lifetimes.filter(row => row.entityId !== 'B');
    records.lifetimes.push(record('B:ancient','B','-0001','0001'), record('B:modern','B','1910-01-02','1920-03'));
    records.geometryBindings = records.geometryBindings.filter(row => row.entityId !== 'B');
    records.geometryBindings.push({ ...record('B:ancient-shape','B','-0001','0001'), geometryRef:{id:'shape',version:1} },
      { ...record('B:modern-shape','B','1910-01-02','1920-03'), geometryRef:{id:'shape',version:1} });
    records.parentRelations = records.parentRelations.filter(row => row.entityId !== 'B');
    records.parentRelations.push({ ...record('B:ancient-parent','B','-0001','0001'), parentId:'A',coverageMode:'partition' },
      { ...record('B:old-parent','B','1910-01-02','1915'),parentId:'A',coverageMode:'partition' },
      { ...record('B:new-parent','B','1916','1920-03'),parentId:'C',coverageMode:'explicit' });
  }
  return createProjectSerializer({ appVersion:'0.34.0',baseDataset:'timeline-exchange', distributionModes:['territorial','geometry'],
    terrainDataset:'terrain',hydroDataset:'hydro', readSnapshot:()=>snapshot,now:()=>new Date('2026-10-04T00:00:00Z') }).buildProject();
}

const destination = new URL('./timeline-exchange/', import.meta.url);
await mkdir(destination, { recursive: true });
for (const kind of ['static','complex']) {
  const project = exchangeProject(kind);
  await writeFile(new URL(`${kind}.json`, destination), JSON.stringify(project,null,2)+'\n');
  const file = await productionGeoPackage('write',new ArrayBuffer(0),project);
  await writeFile(new URL(`${kind}.gpkg`, destination),new Uint8Array(file.buffer));
  await writeFile(new URL(`${kind}.expected.json`, destination),JSON.stringify({ territorialEntities:project.territorialEntities,
    timelineRecords:project.timelineRecords, geometries:project.geometries },null,2)+'\n');
}
