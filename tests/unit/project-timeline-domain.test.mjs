import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';

test('project domain resolves a month without changing stored project', () => {
  const project = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
  const before = structuredClone(project);
  const domain = createProjectDomain({ getSnapshot: () => project });
  const july = domain.resolveWorld('1914-07');
  assert.equal(july.byId.get('A').geometryRef.version, 2);
  assert.equal(july.byId.get('B').parentId, 'A');
  assert.deepEqual(project, before);
});
