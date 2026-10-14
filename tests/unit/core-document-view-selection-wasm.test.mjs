import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { loadWebOracle } from '../helpers/web-oracle.mjs';

const { createEmptyTerritorialState, createTerritorialEntityStore } = await loadWebOracle('assets/js/modules/territorial-entity-store.js');
const { createTerritorialEntityRepository } = await loadWebOracle('assets/js/modules/territorial-entity-repository.js');
const { createSelectionDomain } = await loadWebOracle('assets/js/modules/selection-domain.js');
const input = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
const B = { domain: 'territorial', type: 'entity', id: 'B' };
const empty = { selectionRevision: 0, hoverRevision: 0, items: [], primary: null, hover: null };
const abi = web => ({ selectionRevision: web.revision, hoverRevision: web.hoverRevision,
  items: web.selection.items.map(({ domain,type,id }) => ({ domain,type,id })),
  primary: web.selection.items.find(item => item.key === web.selection.primaryKey)
    ? B : null, hover: web.hover ? B : null });

test('original Web current-view admission and cursor pruning are preserved atomically by the actual document Worker', async () => {
  const state = createEmptyTerritorialState(), store = createTerritorialEntityStore({ getState: () => state });
  store.restoreProject(input);
  const repository = createTerritorialEntityRepository({ entityStore: store });
  const selection = createSelectionDomain({ refExists: ref => !!repository.get(ref.id) });
  const client = createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(input));
    store.setTimelineCursor('1930-01');
    await client.setTimelineCursor('1930-01');
    assert.equal(repository.get('B'), null, 'The stored identity is inactive in this view.');
    selection.replace(B);
    assert.deepEqual(abi(selection.snapshot()), empty);
    assert.deepEqual(await client.selectionApply({ action: 'replace', ref: B }), { selection: empty, countNoOp: true });
    selection.setHover(B,{ source: 'map' });
    assert.deepEqual(await client.selectionApply({ action: 'setHover', ref: B, source: 'map' }),
      { selection: abi(selection.snapshot()), countNoOp: true });

    store.setTimelineCursor('1914-07'); selection.prune();
    await client.setTimelineCursor('1914-07');
    selection.replace(B); selection.setHover(B,{ source: 'map' });
    await client.selectionApply({ action: 'replace', ref: B });
    await client.selectionApply({ action: 'setHover', ref: B, source: 'map' });
    assert.deepEqual(await client.selectionSnapshot(), abi(selection.snapshot()));

    store.setTimelineCursor('1930-01'); selection.prune();
    const cursor = await client.setTimelineCursor('1930-01');
    const expected = abi(selection.snapshot());
    assert.deepEqual(expected, { ...empty, selectionRevision: 2, hoverRevision: 2 });
    assert.deepEqual(cursor.selection, expected, 'Cursor ack must contain final selection+hover before the UI publishes this view.');
    assert.deepEqual(await client.selectionSnapshot(), expected);
    assert.equal(client.state().stateRevision, 0);
    assert.equal(client.state().dirty, false);
    assert.equal(client.state().canUndo, false);
  } finally { selection.dispose(); client.dispose(); }
});
