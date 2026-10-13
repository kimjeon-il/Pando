import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeCoreDocument } from '../helpers/core-session.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/portability/${name}.json`, import.meta.url), 'utf8'));
const labelId = '22000000-0000-4000-8000-000000000001';
const genericId = '22000000-0000-4000-8000-000000000002';
const ref = (domain, type, id) => ({ domain, type, id });
const A = ref('territorial', 'entity', 'A'), B = ref('territorial', 'entity', 'B');
const G = ref('generic', 'feature', genericId);
const capital = ref('label', 'capital', labelId), city = ref('label', 'city', labelId);
const place = ref('placeBuiltin', 'city', 'builtin:place:fixture:1');
const hydro = ref('hydroBuiltin', 'river', 'builtin-hydro');
const key = value => `${value.domain}:${value.type}:${encodeURIComponent(value.id)}`;

// The ABI has explicit native domains and no Web project-generation counter.
// All fields in its declared selection DTO are checked against the frozen Web.
function expectedSelection(web) {
  const convert = value => value && ref(value.id === place.id ? 'placeBuiltin'
    : value.id === hydro.id ? 'hydroBuiltin' : value.domain, value.type,
  value.id === 'L' ? labelId : value.id === 'G' ? genericId : value.id);
  return { selectionRevision: web.revision, hoverRevision: web.hoverRevision,
    items: web.selection.items.map(convert),
    primary: convert(web.selection.items.find(item => item.key === web.selection.primaryKey) || null),
    hover: convert(web.hover) };
}

test('actual Worker selection follows all 30 original Web ordered-reference, hover and anchor transitions', async () => {
  const client = createNodeCoreDocument(), expected = fixture('web-selection-contract');
  const apply = async payload => (await client.selectionApply(payload)).selection;
  const actions = [
    () => client.selectionSnapshot(),
    () => apply({ action: 'replace', ref: A, scope: 'countries' }),
    () => apply({ action: 'replace', ref: A, scope: 'countries' }),
    () => apply({ action: 'toggle', ref: B, scope: 'countries' }),
    () => apply({ action: 'remove', ref: B }),
    () => apply({ action: 'selectRange', ref: G, orderedRefs: [A,B,G], scope: 'countries' }),
    () => apply({ action: 'selectRange', ref: A, orderedRefs: [A,B,G], scope: 'countries', additive: true }),
    () => apply({ action: 'setMany', refs: [A,B,A] }),
    () => apply({ action: 'setMany', refs: [capital,city,place,hydro], primary: capital }),
    () => apply({ action: 'prune', validKeys: [key(place),key(hydro)] }),
    () => apply({ action: 'setHover', ref: hydro, source: 'map' }),
    () => apply({ action: 'setHover', ref: null, source: 'layer' }),
    () => apply({ action: 'setHover', ref: hydro, source: 'layer' }),
    () => apply({ action: 'setHover', ref: null, source: 'map' }),
    () => apply({ action: 'setHover', ref: null, source: 'layer', expectedKey: 'old-key' }),
    () => apply({ action: 'setHover', ref: null, source: 'layer', expectedKey: key(hydro) }),
    async () => { await apply({ action: 'replace', ref: ref('territorial','entity','missing') });
      return apply({ action: 'setHover', ref: ref('label','city','missing') }); },
    () => apply({ action: 'remove', key: key(place) }),
    () => apply({ action: 'clear' }),
    () => apply({ action: 'clear' }),
    () => apply({ action: 'selectRange', ref: B, orderedRefs: [A,B,G], scope: 'countries' }),
    () => apply({ action: 'replace', ref: capital }),
    () => apply({ action: 'replace', ref: city }),
    () => apply({ action: 'setHover', ref: place, source: 'map' }),
    () => apply({ action: 'resetProject' }),
    () => apply({ action: 'toggle', ref: A, scope: 'empty-reset' }),
    () => apply({ action: 'toggle', ref: A, scope: 'empty-reset' }),
    () => apply({ action: 'clear' }),
    () => apply({ action: 'resetProject' }),
    () => apply({ action: 'selectRange', ref: B, orderedRefs: [A,B], scope: 'empty-reset' }),
  ];
  assert.equal(actions.length, expected.length);
  try {
    await client.load(JSON.stringify(fixture('web-document-seed')));
    await client.selectionCatalogLoad('placeBuiltin',[place]);
    await client.selectionCatalogLoad('hydroBuiltin',[{...hydro,sourceIds:[]}]);
    const documentState = client.state();
    for (const [index, action] of actions.entries()) {
      assert.deepEqual(await action(), expectedSelection(expected[index].snapshot), expected[index].operation);
      assert.deepEqual(client.state(), documentState, 'Selection cannot change document dirty/history/revision.');
    }
  } finally { client.dispose(); }
});

test('actual Worker whole-project history clears selected objects and builtins while preserving current Web hover', async () => {
  const client = createNodeCoreDocument(), expected = fixture('web-history-selection-contract');
  const actions = [
    async () => { await client.selectionApply({ action: 'replace', ref: A });
      return client.selectionApply({ action: 'setHover', ref: hydro, source: 'map' }); },
    () => client.execute({ commandId: 'territorial.field', targets: [{ domain: 'territorial', id: 'A' }],
      payload: { id: 'A', field: 'name', value: 'Beta' } }),
    () => client.undo(),
    () => client.selectionApply({ action: 'setMany', refs: [place,hydro], primary: place }),
    () => client.redo(),
    async () => { await client.selectionApply({ action: 'replace', ref: place }); return client.redo(); },
    () => client.undo(),
  ];
  try {
    await client.load(JSON.stringify(fixture('web-document-seed')));
    await client.selectionCatalogLoad('placeBuiltin',[place]);
    await client.selectionCatalogLoad('hydroBuiltin',[{...hydro,sourceIds:[]}]);
    for (const [index, action] of actions.entries()) {
      await action();
      const row = expected[index];
      assert.deepEqual(await client.selectionSnapshot(), expectedSelection(row.selection), row.operation);
      const state = client.state();
      assert.equal(state.stateRevision, row.stateRevision, row.operation);
      assert.equal(state.dirty, row.documentDirty, row.operation);
      assert.equal(state.canUndo, row.undo, row.operation);
      assert.equal(state.canRedo, row.redo, row.operation);
    }
  } finally { client.dispose(); }
});

test('actual Worker exports pure file/autosave context and rejects a late file-save checkpoint', async () => {
  const client = createNodeCoreDocument(), initial = fixture('web-document-seed');
  try {
    await client.load(JSON.stringify(initial));
    const before = client.state();
    let fileReceipt;
    for (const format of ['pandolab-project-state','pandolab-autosave-full']) {
      const context = { format, version: '0.35.0', savedAt: '2026-10-13T00:00:00.000Z' };
      const receipt = await client.exportSnapshot(context);
      assert.deepEqual(JSON.parse(receipt.storageJson), { ...initial, ...context });
      assert.deepEqual(receipt.state, before);
      assert.deepEqual(client.state(), before);
      assert.deepEqual(JSON.parse(await client.storageSnapshot()), initial);
      if (format === 'pandolab-project-state') fileReceipt = receipt;
    }
    await client.execute({ commandId: 'territorial.field', targets: [{ domain: 'territorial', id: 'A' }],
      payload: { id: 'A', field: 'name', value: 'Changed after file export' } });
    const changed = client.state();
    await assert.rejects(client.markSaved(fileReceipt.state.epoch), { code: 'STALE_REVISION' });
    assert.deepEqual(client.state(), changed);
    assert.equal(client.state().dirty, true);
    assert.equal((await client.markSaved(changed.epoch)).dirty, false);
  } finally { client.dispose(); }
});
