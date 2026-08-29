import assert from 'node:assert/strict';
import test from 'node:test';

import { createPersistenceService } from '../../assets/js/modules/persistence-service.js';

function harness(overrides = {}) {
  const tasks = new Map();
  const events = [];
  const storage = {
    project: null,
    view: null,
    fallback: null,
    async readProject() { return this.project; },
    async readView() { return this.view; },
    async writeProject(value) { this.project = value; },
    async writeView(value) { this.view = value; },
    async deleteRecords() { this.project = null; this.view = null; },
    readFallback() { return this.fallback; },
    writeFallback(value) { this.fallback = value; },
    removeFallback() { this.fallback = null; },
    ...overrides.storage,
  };
  const service = createPersistenceService({
    storage,
    scheduler: {
      scheduleIdle(key, task, delay) { tasks.set(key, { task, delay }); },
      cancel(key) { tasks.delete(key); },
    },
    canPersist: () => true,
    buildAutosave: () => ({ format: 'autosave' }),
    readView: () => ({ projection: 'flat', view: { flatZoom: 2 } }),
    validateProject: value => {
      if (value.invalid) throw new Error('invalid');
      return value;
    },
    onDirty: scope => events.push(['dirty', scope]),
    onAutosaveState: (state, options) => events.push(['autosave', state, options]),
    onSaved: value => events.push(['saved', value.toISOString()]),
    onFailure: () => events.push(['failure']),
    onWarning: () => {},
    now: () => new Date('2026-08-29T00:00:00Z'),
    ...overrides.service,
  });
  return { service, storage, tasks, events };
}

test('document and presentation queues share persistence but report distinct dirty scopes', async () => {
  const { service, storage, tasks, events } = harness();
  service.queuePresentation(25);
  assert.deepEqual(events.slice(0, 2), [['dirty', 'presentation'], ['autosave', 'queued', undefined]]);
  assert.equal(tasks.get('autosave').delay, 25);
  await tasks.get('autosave').task();
  assert.deepEqual(storage.project, { format: 'autosave' });
  assert.equal(events.some(event => event[0] === 'saved'), true);
  assert.equal(events.some(event => event[0] === 'autosave' && event[1] === 'saved'), true);
});

test('view preferences use their own scheduled record and do not report project dirty state', async () => {
  const { service, storage, tasks, events } = harness();
  service.queueView(10);
  await tasks.get('view-autosave').task();
  assert.deepEqual(storage.view, {
    projection: 'flat', view: { flatZoom: 2 }, savedAt: '2026-08-29T00:00:00.000Z',
  });
  assert.deepEqual(events, []);
});

test('restore keeps project and view separate and promotes a valid fallback', async () => {
  const current = harness();
  current.storage.project = { format: 'project' };
  current.storage.view = { projection: 'globe', view: { globeZoom: 3 } };
  assert.deepEqual(await current.service.restore(), {
    project: { format: 'project' }, source: 'indexeddb', view: current.storage.view,
  });

  const fallback = harness();
  fallback.storage.project = { invalid: true };
  fallback.storage.fallback = { format: 'fallback' };
  fallback.storage.view = { projection: 'flat' };
  const restored = await fallback.service.restore();
  assert.deepEqual(restored, { project: { format: 'fallback' }, source: 'localstorage', view: { projection: 'flat' } });
  assert.deepEqual(fallback.storage.project, { format: 'fallback' });
  assert.equal(fallback.storage.fallback, null);
});
