import assert from 'node:assert/strict';
import test from 'node:test';

import { createGenericFeatureService } from '../../assets/js/modules/generic-feature-service.js';
import { createProjectCommandPipeline } from '../../assets/js/modules/project-command-pipeline.js';

function genericPoint(id, name) {
  return {
    type: 'Feature',
    id,
    properties: { name, role: 'generic', landBinding: 'none', color: '#8c68d8', notes: '', locked: false },
    geometry: { type: 'Point', coordinates: [0, 0] },
  };
}

test('domain services can use the command pipeline as their document mutation boundary', () => {
  const state = { genericFeatures: [], revision: 0 };
  const calls = [];
  const history = [];
  const pipeline = createProjectCommandPipeline({
    captureSnapshot: () => structuredClone(state),
    restoreSnapshot: snapshot => { state.genericFeatures = snapshot.genericFeatures; state.revision = snapshot.revision; },
    recordHistory: meta => { history.push(meta); calls.push('history'); },
    discardHistory: () => { history.pop(); calls.push('discard'); },
    validateProject: () => { calls.push('validate'); return true; },
    advanceRevision: () => { calls.push('revision'); return ++state.revision; },
    invalidateRender: dirty => calls.push({ render: dirty }),
    queueAutosave: () => calls.push('autosave'),
  });
  const service = createGenericFeatureService({
    documentStore: {
      readFeatures: () => state.genericFeatures,
      replaceFeatures: value => { state.genericFeatures = value; calls.push('mutate'); },
    },
    commandPipeline: pipeline,
    writeColor: (feature, color) => { feature.properties.color = color; },
  });

  const created = service.add(genericPoint('g-1', 'One'));
  assert.equal(created.id, 'g-1');
  assert.equal(state.revision, 1);
  assert.equal(history[0].type, 'generic-feature-create');
  assert.deepEqual(calls, [
    'history',
    'mutate',
    'validate',
    'revision',
    { render: { domain: 'generic', change: 'geometry' } },
    'autosave',
  ]);

  calls.length = 0;
  service.updateMetadata('g-1', 'name', 'Changed');
  assert.equal(service.get('g-1').properties.name, 'Changed');
  assert.equal(state.revision, 2);
  assert.deepEqual(calls, [
    'history',
    'validate',
    'revision',
    { render: { domain: 'generic', change: 'metadata' } },
    'autosave',
  ]);

  calls.length = 0;
  const noOp = service.updateMetadata('g-1', 'name', 'Changed');
  assert.equal(noOp.changed, false);
  assert.equal(state.revision, 2);
  assert.deepEqual(calls, []);
});

test('domain services reject bootstrap without the production command pipeline', () => {
  assert.throws(() => createGenericFeatureService({
    documentStore: {
      readFeatures: () => [],
      replaceFeatures: () => {},
    },
    writeColor: () => {},
  }), /commandPipeline with runMutation/);
});
