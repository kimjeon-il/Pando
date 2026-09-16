import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createObjectCommands } from '../../assets/js/modules/app-object-commands.js';
import { FOUNDATION_OWNER_PORTS } from '../../assets/js/modules/app-capability-ports.js';
import { capabilityPortsForFixture } from './helpers/capability-port-fixture.mjs';

function harness(refs, { builtin = false } = {}) {
  const nodes = new Map(['objectVisibilityBtn', 'objectVisibilityIcon', 'editorObjectStatus'].map(id => [id, {
    attrs: {}, dataset: {}, classList: { toggle() {} },
    setAttribute(key, value) { this.attrs[key] = value; },
  }]));
  const feature = { id: refs[0]?.id, properties: { pandolab_id: refs[0]?.id, category: refs[0]?.type, locked: true } };
  const state = {
    layerVisibility: { countries: false, rivers: false, lakes: false, subunits: false, regions: false, languages: false, labels: false, genericFeatures: false },
    itemVisibility: {}, physicalSettings: { hiddenHydroIds: {}, hydroLayers: { rivers_hydro: false, lakes_natural_earth: false } },
    countryOverrides: {}, territorialUnits: [], genericFeatures: [feature], labels: [feature],
  };
  const effects = { saved: 0, palette: 0, hydro: 0, base: 0, labels: 0, selection: 0 };
  const commands = createObjectCommands();
  const ports = {
    state, $: id => nodes.get(id), normalizeObjectRef: ref => ref,
    TERRITORIAL_UNIT_TYPES: { COUNTRY: 'country', SUBUNIT: 'subunit', REGION: 'region' },
    DISTRIBUTION_TYPE_GROUPS: { language: 'languages' }, distributionVisibilityRevision: 0,
    bumpVisibilityRevision: () => { ports.distributionVisibilityRevision += 1; },
    selectionDomain: { snapshot: () => ({ selection: { items: refs } }), primary: () => refs[0] },
    countryFeatureById: () => feature, territorialUnitById: () => feature, territorialChildren: () => [],
    distributionLayerById: () => feature,
    hydroFeatureById: () => feature, hydroEditById: () => builtin ? null : feature,
    isLayerItemVisible: (group, id) => state.itemVisibility[group]?.[id] !== false,
    markLayerTreeDirty() {},
    gpuMapRenderer: { invalidateCountryPalette() { effects.palette++; }, invalidateHydroVisibility() { effects.hydro++; } },
    renderingDomain: {
      invalidateBaseScene() { effects.base++; }, invalidateLabels() { effects.labels++; }, invalidateSelection() { effects.selection++; },
    },
    projectDomain: { queuePresentationAutosave() { effects.saved++; }, recordHistory() { assert.fail('visibility must stay presentation-only'); } },
  };
  commands.connect(capabilityPortsForFixture(FOUNDATION_OWNER_PORTS.objectCommands, ports));
  return { commands, state, effects, nodes, ports };
}

test('per-object visibility keeps every layer master and selection intact', () => {
  for (const [domain, type, group] of [
    ['territorial', 'country', 'countries'], ['territorial', 'subunit', 'subunits'], ['territorial', 'region', 'regions'],
    ['hydro', 'river', 'hydro'], ['hydro', 'lake', 'hydro'], ['distribution', 'language', 'languages'],
    ['label', 'label', 'labels'], ['generic', 'feature', 'genericFeatures'],
  ]) {
    const refs = [{ domain, type, id: 'a' }];
    const { commands, state, effects, nodes } = harness(refs);
    const masters = structuredClone(state.layerVisibility);
    commands.batchSetVisibility();
    assert.equal(state.itemVisibility[group].a, false);
    assert.equal(state.itemVisibility[group].b, undefined);
    assert.equal(nodes.get('objectVisibilityIcon').attrs.href, '#icon-eye-off');
    assert.equal(nodes.get('objectVisibilityBtn').attrs['aria-label'], '객체 표시');
    assert.match(nodes.get('editorObjectStatus').textContent, /숨김/);
    commands.batchSetVisibility();
    assert.equal(state.itemVisibility[group].a, undefined);
    assert.equal(nodes.get('objectVisibilityBtn').attrs['aria-label'], '객체 숨기기');
    assert.deepEqual(state.layerVisibility, masters);
    assert.equal(refs.length, 1);
    assert.equal(effects.saved, 2);
    assert.equal(effects.labels, 2);
    assert.equal(effects.selection, 2);
  }
});

test('built-in river and lake visibility uses existing stable hidden IDs, not source switches', () => {
  for (const type of ['river', 'lake']) {
    const { commands, state, effects, nodes } = harness([{ domain: 'hydro', type, id: 'builtin-a' }], { builtin: true });
    const sources = structuredClone(state.physicalSettings.hydroLayers);
    commands.batchSetVisibility(false);
    assert.equal(state.physicalSettings.hiddenHydroIds['builtin-a'], true);
    assert.equal(nodes.get('objectVisibilityBtn').disabled, false);
    commands.batchSetVisibility(true);
    assert.deepEqual(state.physicalSettings.hiddenHydroIds, {});
    assert.deepEqual(state.physicalSettings.hydroLayers, sources);
    assert.deepEqual(state.itemVisibility, {});
    assert.equal(effects.hydro, 2);
  }
});

test('mixed selection and no-op/replacement guards use the same command', () => {
  const refs = [{ domain: 'generic', type: 'feature', id: 'a' }, { domain: 'label', type: 'label', id: 'a' }];
  const { commands, state, effects, nodes } = harness(refs);
  state.itemVisibility.labels = { a: false };
  commands.syncObjectActionsMenu();
  assert.equal(nodes.get('objectVisibilityBtn').attrs['aria-pressed'], 'mixed');
  commands.batchSetVisibility();
  assert.equal(state.itemVisibility.labels.a, undefined);
  assert.equal(effects.saved, 1);
  commands.batchSetVisibility(true);
  assert.equal(effects.saved, 1);
  state.projectReplacing = true;
  commands.batchSetVisibility(false);
  assert.equal(effects.saved, 1);
});
