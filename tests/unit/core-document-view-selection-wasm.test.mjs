import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';

const input = JSON.parse(readFileSync(new URL('../fixtures/timeline-exchange/complex.json', import.meta.url), 'utf8'));
const B = { domain: 'territorial', type: 'entity', id: 'B' };
const empty = { selectionRevision: 0, hoverRevision: 0, items: [], primary: null, hover: null };

test('current-view admission and cursor pruning are published atomically by the actual document Worker', async () => {
  const client = createNodeCoreDocument();
  try {
    await client.load(JSON.stringify(input));
    const inactive = await client.setTimelineCursor('1930-01');
    assert.equal(inactive.world.entities.some(row => row.objectRef.id === 'B'), false,
      'B has no active lifetime in this view.');
    assert.deepEqual(await client.selectionApply({ action: 'replace', ref: B }), { selection: empty, countNoOp: true });
    assert.deepEqual(await client.selectionApply({ action: 'setHover', ref: B, source: 'map' }),
      { selection: empty, countNoOp: true });

    const active = await client.setTimelineCursor('1914-07');
    assert.equal(active.world.entities.some(row => row.objectRef.id === 'B'), true);
    await client.selectionApply({ action: 'replace', ref: B });
    await client.selectionApply({ action: 'setHover', ref: B, source: 'map' });
    assert.deepEqual(await client.selectionSnapshot(), {
      selectionRevision: 1, hoverRevision: 1, items: [B], primary: B, hover: B,
    });

    const cursor = await client.setTimelineCursor('1930-01');
    const expected = { ...empty, selectionRevision: 2, hoverRevision: 2 };
    assert.deepEqual(cursor.selection, expected, 'Cursor ack must contain final selection+hover before the UI publishes this view.');
    assert.deepEqual(await client.selectionSnapshot(), expected);
    assert.equal(client.state().stateRevision, 0);
    assert.equal(client.state().dirty, false);
    assert.equal(client.state().canUndo, false);
  } finally { client.dispose(); }
});
