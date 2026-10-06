import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSerializer } from '../../assets/js/modules/project-serializer.js';
import { assertCurrentProjectSchema } from '../../assets/js/modules/project-state.js';
import { timelineStorageCases } from '../fixtures/timeline-storage-cases.mjs';

import { projectForStorage } from '../helpers/timeline-project.mjs';
const serializer = source => createProjectSerializer({ appVersion: '0.34.0', baseDataset: 'base',
  distributionModes: ['territorial', 'geometry'], terrainDataset: 'terrain', hydroDataset: 'hydro',
  readSnapshot: () => source, now: () => new Date('2026-10-04T00:00:00Z') });

test('production serializer stores records and every version instead of a current Feature shape', () => {
  const source = projectForStorage();
  const before = structuredClone(source);
  const project = serializer(source).buildProject();
  assert.equal(project.schemaVersion, 10);
  assert.equal(project.territorialEntities[0].geometry, null);
  assert.deepEqual(project.timelineRecords, source.projectFields.timelineRecords);
  const versions = entries => new Map(entries.map(entry => [JSON.stringify([entry.id, entry.version]), entry.geojson]));
  assert.deepEqual(versions(project.geometries), versions(source.projectFields.geometries));
  for (const key of ['parentId', 'coverageMode', 'validFrom', 'validTo'])
    assert.equal(Object.hasOwn(project.territorialEntities[0].properties, key), false);
  assertCurrentProjectSchema(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(source, before);
});

for (const row of timelineStorageCases()) test(`production project codec: ${row.name === 'unknown snapshot schema' ? 'old project schema rejected' : row.name}`, () => {
  const service = serializer(projectForStorage(row));
  if (row.expected === 'OK') {
    const project = service.buildProject();
    assertCurrentProjectSchema(JSON.parse(JSON.stringify(project)));
    assert.equal(project.geometries.length, row.input.geometries.length);
  } else {
    // Storage-envelope faults belong to the checkpoint boundary, not project fields.
    if (row.name === 'unknown snapshot schema') {
      assert.throws(() => assertCurrentProjectSchema({ ...service.buildProject(), schemaVersion: row.input.schemaVersion }));
    } else if (!row.input.geometries) {
      assert.throws(() => service.buildProject());
    } else if (row.name !== 'unknown snapshot field') {
      assert.throws(() => service.buildProject());
    } else {
      assert.throws(() => assertCurrentProjectSchema({ ...service.buildProject(), cursor: '1914-07' }));
    }
  }
});
