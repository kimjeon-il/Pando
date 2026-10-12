import assert from 'node:assert/strict';
import test from 'node:test';

import { createPersistenceService } from '../../assets/js/modules/persistence-service.js';
import { createBrowserProjectStorage } from '../../assets/js/modules/browser-project-storage.js';
import { createProjectDomain } from '../../assets/js/modules/project-domain.js';

const receipt = (project, checkpoint = null) => ({ project, checkpoint });
function barrier() {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  return { wait, release };
}

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
    recovery: [],
    async writeRecovery(record) { this.recovery.push(structuredClone(record)); },
    ...overrides.storage,
  };
  const service = createPersistenceService({
    storage,
    scheduler: {
      scheduleIdle(key, task, delay) { tasks.set(key, { task, delay }); },
      cancel(key) { tasks.delete(key); },
    },
    canPersist: () => true,
    buildAutosave: () => receipt({ format: 'autosave' }),
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

test('queued autosaves share a build and clear waits for an active write without restoring cancelled data', async () => {
  let release;
  let builds = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const current = harness({
    storage: { async writeProject(value) { await gate; this.project = value; } },
    service: { buildAutosave: () => receipt({ format: 'autosave', build: ++builds }) },
  });
  const first = current.service.persist();
  await Promise.resolve();
  const queued = current.service.persist();
  assert.equal(current.service.persist(), queued);
  const clearing = current.service.clear();
  release();
  await Promise.all([first, queued, clearing]);
  assert.equal(builds, 1);
  assert.equal(current.storage.project, null);
  await current.service.persist();
  assert.equal(builds, 2);
});

test('restore compares both stores and promotes the newer valid savedAt', async () => {
  for (const [dbDate, localDate, expected] of [
    ['2026-09-20T00:00:00Z', '2026-09-21T00:00:00Z', 'localstorage'],
    ['2026-09-22T00:00:00Z', '2026-09-21T00:00:00Z', 'indexeddb'],
  ]) {
    const { service, storage } = harness();
    storage.project = { name: 'db', savedAt: dbDate };
    storage.fallback = { name: 'local', savedAt: localDate };
    const result = await service.restore();
    assert.equal(result.source, expected);
    assert.equal(result.project.name, expected === 'indexeddb' ? 'db' : 'local');
    assert.equal(storage.fallback, null);
  }
});

test('unload flush and new-project entrypoints do not build or replace while recovery is unresolved', async () => {
  const { service, storage } = harness();
  storage.project = { name: 'db' }; storage.fallback = { name: 'local' };
  await service.restore();
  let builds = 0;
  let replacements = 0;
  const domain = createProjectDomain({ persistence: service,
    serializer: { buildAutosave: () => { builds++; return { name: 'default' }; } },
    replaceSnapshot: () => { replacements++; return true; } });
  await domain.flushAutosave();
  await assert.rejects(domain.createEmpty(), /저장본/);
  assert.equal(builds, 0);
  assert.equal(replacements, 0);
  assert.equal(storage.project.name, 'db');
});

test('browser storage distinguishes malformed falsey data from a missing record', async () => {
  for (const value of [0, false, '']) {
    const storage = createBrowserProjectStorage({ indexedDB: { open() {
      const transaction = { objectStore: () => ({ get: () => ({ result: value }) }) };
      const request = { result: { transaction: () => {
        globalThis.queueMicrotask(() => transaction.oncomplete()); return transaction;
      } } };
      globalThis.queueMicrotask(() => request.onsuccess()); return request;
    } }, databaseName: 'test', storeName: 'test', projectKey: 'project' });
    assert.equal(await storage.readProject(), value);
  }
});

test('unordered different saves pause persist, flush and clear until recovery is archived', async () => {
  for (const savedAt of [undefined, 'invalid', '2026-09-21T00:00:00Z']) {
    const { service, storage, tasks } = harness();
    storage.project = { name: 'db', savedAt };
    storage.fallback = { name: 'local', savedAt };
    const original = structuredClone(storage.project);
    const result = await service.restore();
    assert.equal(result.project, null);
    assert.equal(service.getRecovery().candidates.length, 2);
    service.queueProject();
    assert.equal(tasks.has('autosave'), false);
    await service.persist(receipt({ name: 'overwrite' }));
    await service.persist(receipt({ name: 'flush' }));
    await assert.rejects(service.clear(), /저장본/);
    assert.deepEqual(storage.project, original);
    const resolved = await service.resolveRecovery('localstorage');
    assert.equal(resolved.project.name, 'local');
    assert.equal(storage.recovery[0].candidates[0].project.name, 'db');
    assert.equal(service.getRecovery(), null);
    await service.persist(receipt({ name: 'edited' }));
    assert.equal(storage.project.name, 'edited');
  }
});

test('archive failure and failed project application keep both candidates and writes paused', async () => {
  const { service, storage } = harness({ storage: {
    async writeRecovery() { throw new Error('archive unavailable'); },
  } });
  storage.project = { name: 'db' };
  storage.fallback = { name: 'local' };
  await service.restore();
  await assert.rejects(service.resolveRecovery('localstorage'), /archive unavailable/);
  await service.persist(receipt({ name: 'edited' }));
  assert.equal(storage.project.name, 'db');
  storage.writeRecovery = async record => storage.recovery.push(record);
  await assert.rejects(service.resolveRecovery('localstorage', async () => { throw new Error('apply failed'); }), /apply failed/);
  assert.equal(service.getRecovery().candidates.length, 2);
  assert.equal(storage.fallback.name, 'local');
});

test('identical content with reordered keys does not require choosing a save', async () => {
  const { service, storage } = harness();
  storage.project = { name: 'same', nested: { a: 1, b: 2 } };
  storage.fallback = { nested: { b: 2, a: 1 }, name: 'same' };
  assert.equal((await service.restore()).project.name, 'same');
  assert.equal(service.getRecovery(), null);
});

test('startup recovery acknowledgement cannot resume writes when both target writes fail', async () => {
  const { service, storage } = harness({ storage: {
    async writeProject() { throw new Error('db write failed'); },
    writeFallback() { throw new Error('local write failed'); },
  } });
  storage.project = { name: 'db' };
  storage.fallback = { name: 'local' };
  await service.restore();
  const chosen = await service.resolveRecovery('localstorage', undefined, { deferApplication: true });
  assert.equal(chosen.project.name, 'local');
  assert.equal(service.getRecovery().selectedSource, 'localstorage');
  await assert.rejects(service.completeRecovery(), /local write failed/);
  assert.equal(service.getRecovery().selectedSource, 'localstorage');
  assert.equal(storage.project.name, 'db');
  assert.equal(storage.fallback.name, 'local');
});

test('unreadable storage pauses writes and fallback promotion failure retains the fallback', async () => {
  const unreadable = harness({ storage: { readFallback() { throw new Error('denied'); } } });
  unreadable.storage.project = { name: 'db' };
  const result = await unreadable.service.restore();
  assert.equal(result.project, null);
  await unreadable.service.persist(receipt({ name: 'edited' }));
  assert.equal(unreadable.storage.project.name, 'db');
  assert.equal(unreadable.service.getRecovery().kind, 'read-error');

  const promotion = harness({ storage: { async writeProject() { throw new Error('write denied'); } } });
  promotion.storage.fallback = { name: 'local' };
  assert.equal((await promotion.service.restore()).project.name, 'local');
  assert.equal(promotion.storage.fallback.name, 'local');
});

test('fallback absence is distinct from access and parse failure', () => {
  const makeStorage = getItem => createBrowserProjectStorage({ localStorage: { getItem }, projectKey: 'project' });
  assert.equal(makeStorage(() => null).readFallback(), null);
  assert.throws(() => makeStorage(() => '').readFallback(), SyntaxError);
  assert.throws(() => makeStorage(() => { throw new Error('denied'); }).readFallback(), /denied/);
});

test('nested savedAt differences are real content and invalid calendar dates cannot rank saves', async () => {
  const nested = harness();
  nested.storage.project = { metadata: { savedAt: 'first' } };
  nested.storage.fallback = { metadata: { savedAt: 'second' } };
  await nested.service.restore();
  assert.equal(nested.service.getRecovery().kind, 'conflict');

  const invalidDate = harness();
  invalidDate.storage.project = { name: 'db', savedAt: '2026-02-30T00:00:00Z' };
  invalidDate.storage.fallback = { name: 'local', savedAt: '2026-02-28T00:00:00Z' };
  assert.equal((await invalidDate.service.restore()).project, null);
});

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

test('async snapshot receipt writes only the project body and waits for checkpoint acknowledgement', async () => {
  const requested = barrier(), snapshot = barrier(), acknowledged = barrier(), saved = barrier();
  const value = receipt({ format: 'autosave', revision: 3 }, { coreEpoch: 7 });
  let observed;
  const current = harness({ service: {
    buildAutosave: async () => { requested.release(); return snapshot.wait; },
    onSaved: async (_date, result) => { observed = result; acknowledged.release(); await saved.wait; },
  } });
  const pending = current.service.persist();
  await requested.wait;
  try { assert.equal(current.storage.project, null); }
  finally { snapshot.release(value); }
  await acknowledged.wait;
  try {
    assert.deepEqual(current.storage.project, value.project);
    assert.deepEqual(observed, value);
    assert.equal(current.events.some(row => row[0] === 'autosave' && row[1] === 'saved'), false);
  } finally { saved.release(); await pending; }
  assert.equal(current.events.some(row => row[0] === 'autosave' && row[1] === 'saved'), true);
});

test('cancelled snapshot completion cannot write or mark a replaced project saved', async () => {
  const requested = barrier(), snapshot = barrier();
  const current = harness({ service: {
    buildAutosave: async () => { requested.release(); return snapshot.wait; },
  } });
  const pending = current.service.persist();
  await requested.wait;
  current.service.cancelPending();
  snapshot.release(receipt({ format: 'old-project' }, { coreEpoch: 3 }));
  await pending;
  assert.equal(current.storage.project, null);
  assert.deepEqual(current.events, []);
});

test('late device completion cannot delete another fallback or publish saved status after cancellation', async () => {
  const writing = barrier(), finish = barrier();
  const current = harness({ storage: {
    async writeProject(project) { writing.release(); await finish.wait; this.project = project; },
  } });
  current.storage.fallback = { format: 'retained-fallback' };
  const pending = current.service.persist();
  await writing.wait;
  current.service.cancelPending();
  finish.release();
  await pending;
  assert.deepEqual(current.storage.fallback, { format: 'retained-fallback' });
  assert.equal(current.events.some(row => row[0] === 'saved'), false);
  assert.equal(current.events.some(row => row[0] === 'autosave' && row[1] === 'saved'), false);
});

test('checkpoint rejection after a successful device write never retries through fallback', async () => {
  const error = Object.assign(new Error('checkpoint acknowledgement failed'), { code: 'PL-CORE-RESPONSE' });
  let fallbacks = 0;
  const current = harness({ storage: { writeFallback() { fallbacks++; } }, service: {
    onSaved: async () => { throw error; },
  } });
  await assert.rejects(current.service.persist(), candidate => candidate === error);
  assert.deepEqual(current.storage.project, { format: 'autosave' });
  assert.equal(fallbacks, 0);
  assert.equal(current.events.some(row => row[0] === 'autosave' && row[1] === 'saved'), false);
});

test('stale checkpoint acknowledgement leaves the next document autosave state untouched', async () => {
  const current = harness({ service: { onSaved: async () => false } });
  await current.service.persist();
  assert.deepEqual(current.storage.project, { format: 'autosave' });
  assert.equal(current.events.some(row => row[0] === 'autosave' && row[1] === 'saved'), false);
});

test('retired project-only autosave result fails visibly before any device write', async () => {
  const current = harness({ service: { buildAutosave: async () => ({ format: 'autosave' }) } });
  await assert.rejects(current.service.persist(), /snapshot receipt/i);
  assert.equal(current.storage.project, null);
});

test('fallback uses the same body and checkpoint receipt after the IndexedDB write fails', async () => {
  const value = receipt({ format: 'autosave', revision: 2 }, { coreEpoch: 6 });
  let acknowledgement;
  const current = harness({ storage: {
    async writeProject() { throw new Error('IndexedDB unavailable'); },
  }, service: {
    buildAutosave: async () => value,
    onSaved: async (_date, result) => { acknowledgement = result; },
  } });
  await current.service.persist();
  assert.deepEqual(current.storage.fallback, value.project);
  assert.deepEqual(acknowledgement, value);
  assert.deepEqual(current.events.at(-1), ['autosave', 'saved', { fallback: '브라우저 로컬 저장소' }]);
});

test('cancelled acknowledgement errors retain diagnostics without publishing failure to the new project', async () => {
  const acknowledging = barrier(), finish = barrier();
  const error = new Error('late acknowledgement failed');
  const current = harness({ service: {
    onSaved: async () => { acknowledging.release(); await finish.wait; throw error; },
  } });
  const pending = current.service.persist();
  await acknowledging.wait;
  current.service.cancelPending();
  finish.release();
  await assert.rejects(pending, candidate => candidate === error);
  assert.equal(current.events.some(row => row[0] === 'failure'), false);
  assert.equal(current.events.some(row => row[0] === 'autosave' && row[1] === 'error'), false);
});
