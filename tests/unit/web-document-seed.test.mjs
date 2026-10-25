import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assertCurrentProjectSchema, prepareProjectForStorage } from "../../shared/frontend/js/modules/project-state.js";

test('the complete small document seed exercises every current storage domain and exact annotations', () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/portability/web-document-seed.json', import.meta.url), 'utf8'));
  const before = structuredClone(project);
  assert.equal(assertCurrentProjectSchema(project), project);
  for (const collection of ['territorialEntities', 'geometries', 'labels', 'hydroEdits', 'genericFeatures', 'distributionLayers', 'distributionEntries'])
    assert.ok(project[collection].length > 0, collection);
  const prepared = prepareProjectForStorage(project);
  assert.deepEqual(prepared, before);
  assert.deepEqual(project, before);
});
