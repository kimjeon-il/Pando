import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createNodeSelection } from '../helpers/core-selection.mjs';

test('public selection projection retains all 30 original literal-ID snapshots and notification metrics through actual C++', async () => {
  const owner = await createNodeSelection();
  const d = owner.domain,ref = (domain,type,id) => ({ domain,type,id });
  const A=ref('territorial','entity','A'),B=ref('territorial','entity','B'),G=ref('generic','feature','G');
  const capital=ref('label','capital','L'),city=ref('label','city','L'),place=ref('label','city','builtin:place:fixture:1'),hydro=ref('hydro','river','builtin-hydro');
  const actions=[() => {},() => d.replace(A,{ scope: 'countries' }),() => d.replace(A,{ scope: 'countries' }),
    () => d.toggle(B,{ scope: 'countries' }),() => d.remove(B),() => d.selectRange(G,[A,B,G],{ scope: 'countries' }),
    () => d.selectRange(A,[A,B,G],{ scope: 'countries',additive: true }),() => d.setMany([A,B,A]),
    () => d.setMany([capital,city,place,hydro],{ primary: capital }),
    () => d.prune(new Set(d.snapshot().selection.items.filter(row => row.id !== 'L').map(row => row.key))),
    () => d.setHover(hydro,{ source: 'map' }),() => d.setHover(null,{ source: 'layer' }),
    () => d.setHover(hydro,{ source: 'layer' }),() => d.setHover(null,{ source: 'map' }),
    () => d.setHover(null,{ source: 'layer',expectedKey: 'old-key' }),
    () => d.setHover(null,{ source: 'layer',expectedKey: d.snapshot().hover.key }),
    async () => { await d.replace(ref('territorial','entity','missing'));await d.setHover(ref('label','city','missing')); },
    () => d.remove(d.snapshot().selection.items[0].key),() => d.clear(),() => d.clear(),
    () => d.selectRange(B,[A,B,G],{ scope: 'countries' }),() => d.replace(capital),() => d.replace(city),
    () => d.setHover(place,{ source: 'map' }),() => { owner.setGeneration(2);return d.resetProject(2); },
    () => d.toggle(A,{ scope: 'empty-reset' }),() => d.toggle(A,{ scope: 'empty-reset' }),() => d.clear(),
    () => { owner.setGeneration(3);return d.resetProject(3); },() => d.selectRange(B,[A,B],{ scope: 'empty-reset' })];
  const expected=JSON.parse(readFileSync(new URL('../fixtures/portability/web-selection-contract.json',import.meta.url),'utf8'));
  const state=owner.client.state();
  try {
    for (const [index,action] of actions.entries()) {
      await action();assert.deepEqual(d.snapshot(),expected[index].snapshot,expected[index].operation);
      assert.deepEqual(d.stats(),expected[index].stats,expected[index].operation);
      assert.deepEqual(owner.client.state(),state,'selection never mutates document/history/dirty');
    }
  } finally { owner.dispose(); }
});

test('invalid non-null public hover cannot clear an accepted hover', async () => {
  const owner=await createNodeSelection({ genericIds: [],labelIds: [],distributionIds: [] });
  try {
    await owner.domain.setHover({ domain: 'territorial',type: 'entity',id: 'A' });
    const before=owner.domain.snapshot();
    await owner.domain.setHover({ displayName: 'invalid' });
    assert.deepEqual(owner.domain.snapshot(),before);
  } finally { owner.dispose(); }
});
