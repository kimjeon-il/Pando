import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSelectionModules, createSelectionRuntime, settle } from './helpers/territory-selection-runtime.mjs';

const api = await loadSelectionModules();
const riverFeatures = [{ type: 'Feature', id: 'fixture-river',
  properties: { pandolab_id: 'fixture-river', category: 'river' },
  geometry: { type: 'LineString', coordinates: [[5, -1], [5, 11]] } }];
const bands = [0, 2, 4].map(y => [[0, y], [10, y], [10, y + 2], [0, y + 2]]);

async function start(t, drafts) {
  const h = createSelectionRuntime(api, { riverFeatures });
  t.after(() => h.workflow.clear());
  h.workflow.start('annex', { targetCountryId: 'target', sourceCountryIds: ['donor'] });
  assert.equal(await h.workflow.advance(), true);
  for (const coordinates of drafts) {
    assert.equal(await h.workflow.selectMethod('polygon'), true);
    h.setDraft(coordinates);
    assert.equal(h.workflow.finishDraft(), true);
    await settle(h);
    assert.equal(h.workflow.addPart(), true);
    await settle(h);
  }
  assert.equal(await h.workflow.selectMethod('components'), true);
  assert.equal(h.workflow.toggleRiverBoundaries(true), true);
  await settle(h);
  assert.equal(h.workflow.activeSession().riverPartitionStatus, 'ready');
  assert.ok(h.components.territoryComponentItems().some(item => item.usesRiverBoundary));
  return h;
}

const candidateState = h => {
  const current = h.workflow.activeSession();
  return structuredClone({
    workingSourceGeometry: current.workingSourceGeometry,
    remainingGeometry: current.remainingGeometry,
    componentFeatures: current.componentFeatures,
    candidates: current.riverPartitionCandidates,
    donorResults: current.riverPartitionDonorResults,
    items: h.components.territoryComponentItems(),
  });
};

for (const [name, drafts, removedIndex] of [
  ['middle', bands, 1],
  ['last', bands.slice(0, 1), 0],
]) {
  test(`removing the ${name} archived part rebuilds active river candidates from the remaining region`, async t => {
    const h = await start(t, drafts);
    const expected = await start(t, drafts.filter((_, index) => index !== removedIndex));
    const current = h.workflow.activeSession();
    const document = structuredClone(h.features);
    const parts = structuredClone(current.parts);
    const staleKey = h.components.territoryComponentItems()[0].key;
    assert.equal(h.workflow.removePart(parts[removedIndex].id), true);
    assert.equal(h.workflow.toggleComponent(staleKey), false, 'old candidates must be invalid immediately');
    assert.deepEqual(h.components.territoryComponentItems(), []);
    await settle(h);

    assert.deepEqual(candidateState(h), candidateState(expected));
    assert.deepEqual(current.parts, parts.filter((_, index) => index !== removedIndex));
    assert.deepEqual(current.selectedComponentKeys, []);
    assert.equal(current.currentGeometry, null);
    assert.equal(h.workflow.previewReady(), false);
    assert.deepEqual(h.features, document);
    // A candidate from the rebuilt production result is selectable and validates.
    const candidate = h.components.territoryComponentItems().find(item => item.usesRiverBoundary);
    assert.ok(candidate);
    assert.equal(h.workflow.toggleComponent(candidate.key), true);
    await settle(h);
    assert.equal(h.workflow.previewReady(), true);
    assert.equal(h.workflow.canAddPart(), true);
    assert.deepEqual(h.features, document);
  });
}

test('removing an archived part invalidates a selected river component before rebuilding', async t => {
  const h = await start(t, bands);
  const expected = await start(t, [bands[0], bands[2]]);
  const current = h.workflow.activeSession();
  const selected = h.components.territoryComponentItems().find(item => item.usesRiverBoundary);
  assert.equal(h.workflow.toggleComponent(selected.key), true);
  await settle(h);
  assert.equal(h.workflow.previewReady(), true);
  assert.equal(h.workflow.removePart(current.parts[1].id), true);
  assert.deepEqual(current.selectedComponentKeys, []);
  assert.equal(current.currentGeometry, null);
  assert.equal(h.workflow.previewReady(), false);
  await settle(h);
  assert.deepEqual(candidateState(h), candidateState(expected));
});

async function waitFor(check) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'deferred production operation should start');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

for (const action of ['clear', 'method change']) {
  test(`a removal rebuild cannot publish a late river result after ${action}`, async t => {
    const h = await start(t, bands);
    const current = h.workflow.activeSession();
    const compute = h.ports.domainControllers.gisDomain.computeRiverPartition;
    let release;
    let started = false;
    const gate = new Promise(resolve => { release = resolve; });
    t.after(release);
    h.ports.domainControllers.gisDomain.computeRiverPartition = async payload => {
      started = true;
      const result = await compute(payload);
      await gate;
      return result;
    };
    assert.equal(h.workflow.removePart(current.parts[1].id), true);
    await waitFor(() => started);
    if (action === 'clear') h.workflow.clear();
    else assert.equal(await h.workflow.selectMethod('polygon'), true);
    release();
    await settle(h);
    if (action === 'clear') assert.equal(h.workflow.activeSession(), null);
    else {
      assert.equal(current.activeMethod, 'polygon');
      assert.equal(current.activePhase, 'drawing');
      assert.equal(current.useRiverBoundaries, false);
      assert.equal(current.riverPartitionStatus, 'idle');
      assert.deepEqual(current.riverPartitionCandidates, []);
      assert.deepEqual(h.components.territoryComponentItems(), []);
    }
    assert.equal(h.state.geometryPreview.session, null);
    assert.deepEqual(h.errors, []);
  });
}

for (const drafts of [bands, bands.slice(0, 1)]) {
  test(`Back and Advance restart a suspended river rebuild with ${drafts.length} original parts`, async t => {
    const h = await start(t, drafts);
    const removedIndex = drafts.length === 1 ? 0 : 1;
    const expected = await start(t, drafts.filter((_, index) => index !== removedIndex));
    const current = h.workflow.activeSession();
    const compute = h.ports.domainControllers.gisDomain.computeRiverPartition;
    let release;
    let started = false;
    const gate = new Promise(resolve => { release = resolve; });
    t.after(release);
    h.ports.domainControllers.gisDomain.computeRiverPartition = async payload => {
      started = true;
      const result = await compute(payload);
      await gate;
      return result;
    };
    assert.equal(h.workflow.removePart(current.parts[removedIndex].id), true);
    await waitFor(() => started);
    assert.equal(h.workflow.back(), true);
    assert.equal(current.stage, 'setup');
    release();
    // Let the already-started real river operation return while setup owns the workflow.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(await h.workflow.advance(), true);
    await settle(h);
    assert.equal(current.stage, 'selection');
    assert.equal(current.activePhase, 'components');
    assert.equal(current.useRiverBoundaries, true);
    assert.deepEqual(candidateState(h), candidateState(expected));
  });
}

test('Back before the final removal timer starts still restores the full component source on Advance', async t => {
  const h = await start(t, bands.slice(0, 1));
  const expected = await start(t, []);
  const current = h.workflow.activeSession();
  assert.equal(h.workflow.removePart(current.parts[0].id), true);
  assert.equal(h.workflow.back(), true);
  assert.equal(current.stage, 'setup');
  assert.equal(await h.workflow.advance(), true);
  await settle(h);
  assert.deepEqual(candidateState(h), candidateState(expected));
});

test('removing the last archived river component restores the original cached partition and releases its snapshot', async t => {
  const h = await start(t, []);
  const expected = candidateState(h);
  const current = h.workflow.activeSession();
  const item = h.components.territoryComponentItems().find(candidate => candidate.usesRiverBoundary);
  h.workflow.toggleComponent(item.key);
  await settle(h);
  assert.equal(h.workflow.addPart(), true);
  await settle(h);
  assert.equal(current.parts.length, 1);
  assert.equal(current.componentSnapshots.length, 1);
  assert.equal(await h.workflow.selectMethod('components'), true);
  h.workflow.toggleRiverBoundaries(true);
  await settle(h);
  assert.equal(h.workflow.removePart(current.parts[0].id), true);
  await settle(h);
  assert.deepEqual(candidateState(h), expected);
  assert.deepEqual(current.parts, []);
  assert.deepEqual(current.componentSnapshots, []);
  assert.equal(h.workflow.previewReady(), false);
});

test('removing a middle river component from a fully archived donor preserves the other parts and their shared snapshot', async t => {
  const h = await start(t, []);
  const expected = await start(t, []);
  const current = h.workflow.activeSession();
  const items = h.components.territoryComponentItems();
  assert.equal(items.length, 3);
  for (const item of items) h.workflow.toggleComponent(item.key);
  await settle(h);
  assert.equal(h.workflow.addPart(), true);
  await settle(h);
  const parts = structuredClone(current.parts);
  const snapshots = structuredClone(current.componentSnapshots);
  assert.equal(parts.length, 3);
  assert.equal(current.remainingGeometry, null);
  assert.equal(await h.workflow.selectMethod('components'), true);
  h.workflow.toggleRiverBoundaries(true);
  await settle(h);
  assert.deepEqual(h.components.territoryComponentItems(), []);

  for (const item of expected.components.territoryComponentItems().filter((_, index) => index !== 1)) {
    expected.workflow.toggleComponent(item.key);
  }
  await settle(expected);
  assert.equal(expected.workflow.addPart(), true);
  await settle(expected);
  assert.equal(await expected.workflow.selectMethod('components'), true);
  expected.workflow.toggleRiverBoundaries(true);
  await settle(expected);

  assert.equal(h.workflow.removePart(parts[1].id), true);
  await settle(h);
  assert.deepEqual(candidateState(h), candidateState(expected));
  assert.deepEqual(current.parts, [parts[0], parts[2]]);
  assert.deepEqual(current.componentSnapshots, snapshots);
  assert.equal(h.workflow.previewReady(), false);
});
