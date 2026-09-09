import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { commitSelectionFallbackCoverage } from '../../assets/js/modules/selection-fallback-coverage.js';
import { createSelectionPass } from '../../assets/js/modules/selection-pass.js';
import { createMapRenderCoordinator, MAP_RENDER_DIRTY } from '../../assets/js/modules/map-render-coordinator.js';

function fixture() {
  const nodes = [];
  const add = (key, channel) => nodes.push({
    getAttribute: name => name === 'data-selection-channel' ? channel : key,
    remove() { nodes.splice(nodes.indexOf(this), 1); },
  });
  add('country:historical-country:soviet-union', 'primary');
  add('country:historical-country:soviet-union', 'primary');
  add('country:FRA', 'secondary');
  add('country:DEU', 'hover');
  return { nodes, root: { querySelectorAll: () => [...nodes] } };
}

test('library country upload completion retires both SVG strokes without touching other selections', () => {
  const { nodes, root } = fixture();
  const result = { succeeded: true, channels: { primary: { renderedKeys: ['country:historical-country:soviet-union'] } } };
  assert.equal(commitSelectionFallbackCoverage([root], result), 2);
  assert.equal(nodes.length, 2);
  assert.equal(commitSelectionFallbackCoverage([root], result), 0);
});

test('pending, failed, empty and other-channel coverage retain fallback outlines', () => {
  for (const result of [null, { channels: {} }, { channels: { primary: { renderedKeys: [] } } },
    { succeeded: false, channels: { primary: { renderedKeys: ['country:historical-country:soviet-union'] } } },
    { contextLost: true }, { channels: { hover: { renderedKeys: ['country:historical-country:soviet-union'] } } }]) {
    const { root, nodes } = fixture();
    assert.equal(commitSelectionFallbackCoverage([root], result), 0);
    assert.equal(nodes.length, 4);
  }
});

test('view commit consumes coverage before reprojecting, without rebuilding selection packets', () => {
  const source = readFileSync(new URL('../../assets/js/modules/rendering-domain.js', import.meta.url), 'utf8');
  const branch = source.slice(source.indexOf('if (!gpuFrameFailed) {'), source.indexOf('const selectionLayer = selection.selectionLayer;', source.indexOf('if (!gpuFrameFailed) {')));
  assert.ok(branch.indexOf('commitSelectionFallbackCoverage') < branch.indexOf('renderSparseSelectionFallbackView'));
  assert.doesNotMatch(branch, /updateData|renderGpuInteraction/);
});

test('prepared library-country GPU resource transitions from upload pending to covered on interaction-only frame', () => {
  const id = 'historical-country:soviet-union';
  const key = `country:${id}`;
  const preparedGeometry = { marker: 'worker-prepared' };
  let ready = false, draws = 0;
  const pass = createSelectionPass();
  pass.initialize({ gl: {}, version: 2, capabilities: {} }, { strokeRenderer: {
    isAvailable: () => true,
    stats: () => ({}),
    drawBatches: batches => {
      draws += 1;
      assert.equal(batches[0].preparedGeometry, preparedGeometry);
      assert.deepEqual(batches[0].ownerIds, [id]);
      return { succeeded: ready, renderedKeys: ready ? [batches[0].key] : [], drawCallCount: ready ? 1 : 0 };
    },
  } });
  pass.setCountryBoundaryResources({ revision: 'new-country', visibleIds: [id], overriddenIds: [id],
    strokeResources: { override: { ownerIds: [id], packet: { key: 'country-boundary:override', preparedGeometry } } } });
  pass.updateData({ country: { primaryId: id }, countryBoundaryRevision: 'new-country' });
  const { root, nodes } = fixture();
  const initial = pass.draw({}, {}, { frameContext: { frameId: 1 } });
  assert.equal(commitSelectionFallbackCoverage([root], initial), 0);
  ready = true;
  const frames = [], events = [];
  const coordinator = createMapRenderCoordinator({ requestFrame: callback => frames.push(callback), prepareView: () => ({ frameId: 2 }),
    renderers: {
      gpuInteraction: frame => { events.push('gpu'); return { selection: pass.draw({}, {}, { frameContext: frame }) }; },
      selectionView: (frame, result) => { events.push('svg'); assert.deepEqual(result.selection.channels.primary.renderedKeys, [key]); commitSelectionFallbackCoverage([root], result.selection); },
      selectionData: () => assert.fail('must not rebuild selection data'),
      countries: () => assert.fail('must not rebuild world geometry'),
    },
  });
  coordinator.invalidate(MAP_RENDER_DIRTY.GPU_INTERACTION, 'interaction-resource-ready');
  frames.shift()();
  assert.deepEqual(events, ['gpu', 'svg']);
  assert.equal(draws, 2);
  assert.equal(nodes.length, 2);
});
