import '../../assets/js/workers/canvas-scene-composition-core.js';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMapInteractionStyle, resolveInteractionEntries, interactionRoleStyle } from '../../assets/js/modules/map-interaction-style.js';
import { mapInteractionEntries } from '../../assets/js/modules/interaction-roles.js';
import { normalizeObjectRef } from '../../assets/js/modules/object-selection-controller.js';
import { createEditDisplayPreparation } from '../../assets/js/modules/edit-display-preparation.js';
import { createSelectionDomain } from '../../assets/js/modules/selection-domain.js';
import { createSelectionPass } from '../../assets/js/modules/selection-pass.js';

test('all object domains share role priority and style, including zero fill and disabled outlines', () => {
  for (const theme of ['light', 'dark']) for (const fillStrength of [0, 0.35, 1]) {
    const style = resolveMapInteractionStyle({ theme, fillStrength, selectionColor: '#123456', outlineVisible: false });
    for (const domain of ['territorial', 'generic', 'distribution', 'hydro', 'label']) {
      const key = `${domain}:test:one`;
      const entries = resolveInteractionEntries([{ key, role: 'hover' }, { key, role: 'primary' }, { key, role: 'edit-target' }]);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].role, 'edit-target');
      assert.equal(interactionRoleStyle(style, entries[0].role).color, '#123456');
      assert.equal(interactionRoleStyle(style, entries[0].role).width, 0);
      assert.equal(interactionRoleStyle(style, 'candidate').fillAlpha, 0);
      assert.equal(interactionRoleStyle(style, 'hover').width, 1.5);
      if (!fillStrength) for (const role of entries[0].roles) assert.equal(interactionRoleStyle(style, role).fillAlpha, 0);
    }
  }
});

test('tool role overrides selection without altering canonical selection or geometry', () => {
  const ref = normalizeObjectRef({ domain: 'territorial', type: 'country', id: 'RUS' });
  const snapshot = { selection: { primaryKey: ref.key, items: [ref] }, hover: ref };
  const before = JSON.stringify(snapshot);
  const entries = mapInteractionEntries(snapshot, { tool: 'country-coast', coastEditCountryId: 'RUS' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, 'edit-target');
  assert.deepEqual(new Set(entries[0].roles), new Set(['primary', 'hover', 'edit-target']));
  assert.equal(JSON.stringify(snapshot), before);
});

test('ownership order is stable under input reordering and prioritizes stronger roles before ancestry', () => {
  const entries = [{ key: 'b', role: 'primary', depth: 1, ancestorKeys: ['parent'] }, { key: 'a', role: 'primary', depth: 1, ancestorKeys: ['parent'] },
    { key: 'parent', role: 'primary', depth: 0 }, { key: 'child', role: 'edit-target', depth: 2 }];
  const keys = rows => resolveInteractionEntries(rows).map(row => row.key);
  assert.deepEqual(keys(entries), ['child', 'parent', 'a', 'b']);
  assert.deepEqual(keys([...entries].reverse()), keys(entries));
});

test('worker ownership removes shared boundaries between unrelated objects without changing originals', async () => {
  const polygon = coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } });
  const left = polygon([[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]);
  const right = polygon([[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]);
  const before = JSON.stringify([left, right]);
  const result = await createEditDisplayPreparation().prepare({ kind: 'highlight', feature: right, occluderFeatures: [left] }, [], []);
  for (const line of result.feature.geometry.coordinates) for (let i = 1; i < line.length; i++) {
    assert.ok(!(line[i - 1][0] === 2 && line[i][0] === 2));
  }
  assert.equal(JSON.stringify([left, right]), before);
});

test('late leave from another hover source cannot clear the current row, while reset clears all', () => {
  const domain = createSelectionDomain();
  const a = normalizeObjectRef({ domain: 'territorial', type: 'country', id: 'DEU' });
  const b = normalizeObjectRef({ domain: 'territorial', type: 'country', id: 'AUT' });
  domain.setHover(a, { source: 'map' });
  domain.setHover(b, { source: 'list' });
  domain.setHover(null, { source: 'map' });
  assert.equal(domain.snapshot().hover.key, b.key);
  domain.setHover(null, { source: 'list', expectedKey: a.key });
  assert.equal(domain.snapshot().hover.key, b.key);
  domain.resetProject(2);
  assert.equal(domain.snapshot().hover, null);
});

test('a pending owned boundary does not poison its ready geometry cache', () => {
  const pass = createSelectionPass();
  const item = { key: 'generic:feature:a', geometryRevision: 'owned:pending', geometry: { type: 'Feature', geometry: null } };
  pass.updateData({ generic: { secondary: [item] } });
  assert.equal(pass.stats().segmentCount, 0);
  pass.updateData({ generic: { secondary: [{ ...item, geometryRevision: 'owned', geometry: {
    type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
  } }] } });
  assert.ok(pass.stats().segmentCount > 0);
  assert.equal(pass.stats().channels.secondary.rebuildCount, 2);
});

test('common role contracts reject tool colors and keep boundary preparation out of render callbacks', async () => {
  const read = name => readFile(new URL(`../../assets/js/${name}`, import.meta.url), 'utf8');
  const [packets, rendering, pass, worker] = await Promise.all([
    read('modules/app-interaction-packets.js'), read('modules/rendering-domain.js'),
    read('modules/selection-pass.js'), read('workers/canvas-render-worker.js'),
  ]);
  assert.doesNotMatch(packets, /getComputedStyle|gpuInteractionColor/);
  assert.match(packets, /interactionRoleStyle/);
  assert.doesNotMatch(rendering, /buildTerritorialInternalBoundarySegments|mixWithWhite/);
  assert.doesNotMatch(rendering, /if \(pendingChanged[^\n]+syncGpuRenderScene/);
  assert.match(rendering, /lastInteractionFillOwner/);
  assert.match(pass, /innerCutout: resolvedStyle.width/);
  assert.ok(pass.indexOf("drawChannel('primary', frameContext, 'casing')") < pass.indexOf("candidate: drawChannel('candidate'"));
  assert.match(worker, /type: 'frame',\s+styleRevision/);
});

test('ID-based boundary requests use synchronized geometry and reject missing owners', async () => {
  const feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] } };
  const preparation = createEditDisplayPreparation();
  const sources = new Map([['country:RUS', feature], ['territorial:child', feature]]);
  const request = { kind: 'highlight', featureKey: 'territorial:child', occluders: [{ key: 'country:RUS' }] };
  const result = await preparation.prepare(request, [], [], async () => {}, key => sources.get(key));
  assert.deepEqual(result.feature.geometry.coordinates, []);
  sources.delete('country:RUS');
  await assert.rejects(preparation.prepare(request, [], [], async () => {}, key => sources.get(key)), /원본/);
});

test('tool receivers, donors and nested parents keep their semantic roles independent of selection order', () => {
  const units = [{ id: 'parent', properties: { unitType: 'subunit', sovereignId: 'RUS' } }, { id: 'child', properties: { unitType: 'subunit', parentId: 'parent', sovereignId: 'RUS' } }];
  const refs = units.map(unit => normalizeObjectRef({ domain: 'territorial', type: 'subunit', id: unit.id }));
  const snapshot = { selection: { items: refs, primaryKey: refs[1].key } };
  const rows = mapInteractionEntries(snapshot, { tool: 'merge-territorial-unit', territorialUnitMergeSourceId: 'parent', territorialUnitMergeTargetIds: ['child'], territorialUnits: units });
  assert.equal(rows[0].ref.id, 'parent'); assert.equal(rows[0].role, 'edit-target');
  assert.equal(rows[1].role, 'primary'); assert.ok(rows[1].roles.includes('selected-provider'));
  assert.equal(rows[1].depth, 2);
});

test('country creation sources use the same secondary selection emphasis as annex donors', () => {
  const snapshot = { selection: { items: [], primaryKey: null }, hover: null };
  const session = (kind, sourceHighlightRole) => ({ tool: kind === 'annex' ? 'annex-territory' : 'new-country', kind, sourceCountryIds: ['DEU', 'POL'], sourceHighlightRole });
  for (const [kind, role] of [['new-country', 'selected-provider'], ['annex', 'selected-provider']]) {
    const rows = mapInteractionEntries(snapshot, { tool: session(kind, role).tool, territorySelectionSession: session(kind, role) });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.role === 'selected-provider'));
    assert.ok(rows.every(row => row.priority === 3));
  }
  const style = resolveMapInteractionStyle({ theme: 'light', fillStrength: 0.35 });
  const selected = interactionRoleStyle(style, 'selected-provider');
  assert.ok(selected.fillAlpha > 0);
  assert.ok(selected.width > interactionRoleStyle(style, 'reference').width);
});

test('Canvas metadata updates share immutable coordinate reconstruction', () => {
  const packet = { ringCoordinates: new Float64Array([0, 0, 1, 0, 1, 1, 0, 0]), ringOffsets: [0, 4], polygonOffsets: [0, 1] };
  const before = globalThis.PandoLabCanvasSceneComposition.geometryFor(packet);
  const after = globalThis.PandoLabCanvasSceneComposition.geometryFor({ ...packet, style: { color: '#123456' } });
  assert.equal(after, before);
  assert.notEqual(globalThis.PandoLabCanvasSceneComposition.geometryFor({ ...packet, ringCoordinates: packet.ringCoordinates.slice() }), before);
});
