import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { originalHydroCreate } from '../helpers/web-hydro-create-oracle.mjs';
import { createNodeCoreProject } from '../helpers/core-project.mjs';

const seed = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
const inputs = [
  { type: 'Feature', id: '33000000-0000-4000-8000-000000000031', geometry: { type: 'LineString', coordinates: [[1,2],[3,4]] },
    properties: { category: 'lake', name: '  River\r\n ', notes: '  raw notes  ', visible: false, color: '#ABCDEF', unknown: { nested: [null,0,'kept'] } } },
  { type: 'Feature', id: '33000000-0000-4000-8000-000000000032', geometry: { type: 'Polygon', coordinates: [[[1,2],[3,2],[3,4],[1,2]]] },
    properties: { category: 'river', name: 42, notes: null, visible: true, editorColor: ' #A0B1C2 ', color: 17, unknown: ['array',{ x: true }] } },
];

for (const input of inputs) test(`raw ${input.geometry.type} hydro creation preserves original missing fields, opaque properties and storage`, async t => {
  const expected = originalHydroCreate(input, seed);
  assert.deepEqual(expected.saved, expected.normalized);
  assert.equal(Object.hasOwn(expected.normalized.properties, 'locked'), false);
  assert.equal(Object.hasOwn(expected.normalized.properties, 'source'), false);
  assert.equal(Object.hasOwn(expected.normalized.properties, 'visible'), false);
  assert.deepEqual(expected.normalized.properties.unknown, input.properties.unknown);
  assert.deepEqual(expected.normalized.properties.color, input.properties.color);
  const owner = await createNodeCoreProject(seed); t.after(() => owner.dispose());
  const before = owner.documentModel.snapshot();
  const result = await owner.project.executeCommand({ commandId: 'hydro.edit', targets: [{ domain: 'hydro',id: input.id }],
    payload: { domain: 'hydro', id: input.id, value: input, create: true } });
  assert.equal(result.ok, true, JSON.stringify(result.error));
  assert.deepEqual(owner.documentModel.get({ domain: 'hydro',id: input.id }), expected.normalized);
  const exported = await owner.client.exportSnapshot({ format: 'pandolab-project-state', version: seed.version, savedAt: seed.savedAt });
  assert.deepEqual(JSON.parse(exported.storageJson).hydroEdits.find(row => row.id === input.id), expected.saved);
  assert.equal(await owner.project.undo(), true);
  assert.deepEqual(owner.documentModel.snapshot(), before);
  assert.equal(await owner.project.redo(), true);
  assert.deepEqual(owner.documentModel.get({ domain: 'hydro',id: input.id }), expected.normalized);
});
