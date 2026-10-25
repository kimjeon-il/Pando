import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryAssembly } from "../../apps/editor/frontend/js/modules/app-history-assembly.js";
import { readFileSync } from 'node:fs';

function fixture(t) {
  const previousWindow = globalThis.window;
  globalThis.window = { indexedDB: {}, localStorage: {} };
  t.after(() => { globalThis.window = previousWindow; });
  const calls = [];
  let cursor = '2026-10';
  let options;
  const owner = createHistoryAssembly();
  owner.connect({
    projectState: { state: { projection: 'flat', view: { flatZoom: 1 } } },
    domains: {
      commandOwner: { state: () => ({ timelineCursor: cursor }) },
      projectDomain: { buildAutosave: () => { throw new Error('The full project must not be exported for a view'); },
        state: () => ({}) },
    },
    territorialModel: { entityStore: { setTimelineCursor: async month => {
      if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12)
        throw new TypeError('Invalid canonical month');
      cursor = month; calls.push(month); return true;
    } } },
    projectServices: {
      createBrowserProjectStorage: () => ({}),
      createPersistenceService: value => { options = value; return {}; },
    },
    platform: { deepClone: structuredClone },
    platformConfigurationA: {},
    platformConfigurationB: {},
  });
  owner.initializeBrowserProjectStorage();
  return { owner, calls, options, cursor: () => cursor };
}

test('view record includes current Core session month but not a document snapshot', t => {
  const { options } = fixture(t);
  assert.deepEqual(options.readView(), {
    projection: 'flat', view: { flatZoom: 1 }, lastViewedMonth: '2026-10',
  });
});

test('restored month is published only through the accepted C++ session owner', async t => {
  const f = fixture(t);
  assert.equal(await f.owner.applyAutosavedTimeline({ lastViewedMonth: '1989-06' }), true);
  assert.equal(f.cursor(), '1989-06');
  assert.deepEqual(f.calls, ['1989-06']);
  assert.equal(await f.owner.applyAutosavedTimeline({ lastViewedMonth: '1989-06' }), false);
  assert.equal(await f.owner.applyAutosavedTimeline({}), false);
  assert.deepEqual(f.calls, ['1989-06']);
});

test('invalid stale month cannot abort a valid document restore', async t => {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const f = fixture(t);
  assert.equal(await f.owner.applyAutosavedTimeline({ lastViewedMonth: 'invalid-date' }), false);
  assert.equal(f.cursor(), '2026-10');
  assert.equal(warnings.length, 1);
});

test('the startup composition exposes the persisted cursor restoration capability', () => {
  const source = readFileSync(new URL("../../apps/editor/frontend/js/modules/app-capability-ports-lifecycle-ui.js", import.meta.url), 'utf8');
  assert.match(source, /\["applyAutosavedTimeline","historyAssembly","applyAutosavedTimeline"\]/);
});
