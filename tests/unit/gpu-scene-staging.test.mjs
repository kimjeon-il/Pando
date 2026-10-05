import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGpuBaseScene, commitGpuStrokeDomains } from '../../assets/js/modules/gpu-scene-preparation.js';
import { drawGpuBaseScene } from '../../assets/js/modules/gpu-base-scene-pass.js';

const packet = (key, revision, domain = 'boundaries', objectKey = '') => ({
  key, domain, objectKey, sourceKey: `stroke:${key}:${revision}:high:flat`, geometryRevision: revision,
  startsEnds: new Float32Array([revision, 0, revision + 1, 1]), byteLength: 16,
  style: { alpha: 1, width: 2 },
});
function harness() {
  const presentedStrokeDomains = new Map(), resources = new Set(), uploaded = [], released = [];
  const strokeRenderer = {
    hasPreparedResource: value => resources.has(value.key), hasResource: key => resources.has(key),
    ensureResource: value => { uploaded.push(value); return { resource: null, reason: 'upload-pending' }; },
    releaseResource: key => { resources.delete(key); released.push(key); },
  };
  const prepare = strokes => prepareGpuBaseScene({ scene: { polygons: [], strokes },
    frame: { projectGeneration: 7 }, presentedStrokeDomains }, { strokeRenderer });
  const ready = (...rows) => rows.forEach(row => resources.add(`scene-stroke:7:${row.sourceKey}`));
  const accept = result => commitGpuStrokeDomains({ frameId: 1, projectGeneration: 7,
    overlayRenderedKeys: result.overlayItems.map(row => row.packet.key), overlayMissingKeys: [],
    strokeDomainReplacements: result.strokeDomainReplacements }, { frameId: 1, projectGeneration: 7 }, presentedStrokeDomains, strokeRenderer);
  return { prepare, ready, accept, presentedStrokeDomains, resources, uploaded, released };
}
test('a stroke domain retains A while every replacement resource in B is prepared', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2), extra = packet('new-line', 2);
  h.ready(a); h.accept(h.prepare([a]));
  const waiting = h.prepare([b, extra]);
  assert.deepEqual(waiting.overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(waiting.strokeDomainReplacements, []);
  assert.equal(waiting.deferredOverlayKeys.has('line'), true);
  assert.equal(waiting.failedOverlayKeys.size, 0, 'pending uploads are not failures');
  h.ready(b);
  assert.deepEqual(h.prepare([b, extra]).overlayItems.map(row => row.packet), [a], 'partial readiness cannot promote a domain');
  h.ready(extra);
  const prepared = h.prepare([b, extra]);
  assert.deepEqual(prepared.overlayItems.map(row => row.packet), [b, extra]);
  assert.equal(h.presentedStrokeDomains.get('boundaries')[0].packet, a, 'preparation is not presentation');
  h.accept(prepared);
  assert.deepEqual(h.presentedStrokeDomains.get('boundaries').map(row => row.packet), [b, extra]);
  assert.deepEqual(h.released, [`scene-stroke:7:${a.sourceKey}`]);
});
test('failed and stale presentation cannot release A or promote a prepared B', () => {
  const h = harness(), a = packet('a', 1), b = packet('a', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const prepared = h.prepare([b]);
  const result = { frameId: 1, projectGeneration: 7, overlayRenderedKeys: [], overlayMissingKeys: ['a'],
    strokeDomainReplacements: prepared.strokeDomainReplacements };
  const renderer = { releaseResource: () => assert.fail('failed presentation released A') };
  assert.equal(commitGpuStrokeDomains(result, { frameId: 1, projectGeneration: 7 }, h.presentedStrokeDomains, renderer), false);
  assert.equal(commitGpuStrokeDomains({ ...result, overlayRenderedKeys: ['a'], overlayMissingKeys: [] },
    { frameId: 2, projectGeneration: 7 }, h.presentedStrokeDomains, renderer), false);
  assert.equal(h.presentedStrokeDomains.get('boundaries')[0].packet, a);
});
test('an aggregate visibility scope change rejects the old boundary archive while replacement uploads wait', () => {
  const h = harness(), a = { ...packet('a', 1), continuityOwnerIds: ['A', 'B'] }; h.ready(a); h.accept(h.prepare([a]));
  const b = { ...packet('a', 2), continuityOwnerIds: ['A'] };
  assert.deepEqual(h.prepare([b]).overlayItems, [], 'deleted or hidden B cannot survive in an aggregate resource');
});
test('adding a visible object preserves the still-valid old aggregate during its replacement upload', () => {
  const h = harness(), a = { ...packet('a', 1), continuityOwnerIds: ['A', 'B'] }; h.ready(a); h.accept(h.prepare([a]));
  const b = { ...packet('a', 2), continuityOwnerIds: ['A', 'B', 'C'] };
  assert.deepEqual(h.prepare([b]).overlayItems.map(row => row.packet), [a]);
});
test('same-key revisions get independent GPU resource identities', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2);
  h.prepare([a]); h.prepare([b]);
  assert.equal(new Set(h.uploaded.map(row => row.key)).size, 2);
});
test('deleting a distribution sibling sharing an objectKey removes that exact visual while another upload waits', () => {
  const h = harness(), one = packet('entry:one:line', 1, 'distribution', 'layer:one'), two = packet('entry:two:line', 1, 'distribution', 'layer:one');
  h.ready(one, two); h.accept(h.prepare([one, two]));
  const next = packet('entry:one:line', 2, 'distribution', 'layer:one');
  assert.deepEqual(h.prepare([next]).overlayItems.map(row => row.packet), [one]);
  assert.equal(h.prepare([next]).canPreserveStrokeScene, false, 'the old whole-scene texture still contains the deleted sibling');
});
test('a superseded ready B cannot replace the current desired C or an A return', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2), c = packet('line', 3);
  h.ready(a); h.accept(h.prepare([a])); h.prepare([b]); h.ready(b);
  assert.deepEqual(h.prepare([c]).overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(h.prepare([a]).overlayItems.map(row => row.packet), [a]);
});
test('independent domains can promote while another retains its old strokes', () => {
  const h = harness(), a = packet('a', 1), other = packet('other', 1, 'other');
  h.ready(a, other); h.accept(h.prepare([a, other]));
  const b = packet('a', 2), next = packet('other', 2, 'other'); h.ready(next);
  const result = h.prepare([b, next]);
  assert.deepEqual(result.overlayItems.map(row => row.packet), [a, next]);
});
test('empty domains, removed objects and disabled strokes do not leave old geometry', () => {
  const h = harness(), a = packet('a', 1, 'boundaries', 'object:a'), other = packet('other', 1, 'boundaries', 'object:other');
  h.ready(a, other); h.accept(h.prepare([a, other]));
  assert.deepEqual(h.prepare([packet('a', 2, 'boundaries', 'object:a')]).overlayItems.map(row => row.packet), [a]);
  assert.deepEqual(h.prepare([{ ...a, style: { alpha: 0, width: 2 } }]).overlayItems, []);
  assert.deepEqual(h.prepare([]).overlayItems, []);
});
test('a new project generation cannot display or reuse the previous project resource', () => {
  const h = harness(), a = packet('a', 1); h.ready(a); h.accept(h.prepare([a]));
  const result = prepareGpuBaseScene({ scene: { strokes: [a] }, frame: { projectGeneration: 8 },
    presentedStrokeDomains: new Map() }, { strokeRenderer: {
    hasPreparedResource: row => h.resources.has(row.key), ensureResource: () => ({ resource: null, reason: 'upload-pending' }),
  } });
  assert.deepEqual(result.overlayItems, []);
});
test('a failed prepared B draw redraws eligible A before publication and cannot promote B', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const prepared = h.prepare([b]), drawn = [];
  const gl = new Proxy({}, { get: (_target, key) => /^[A-Z_]+$/.test(key) ? key : () => {} });
  const result = drawGpuBaseScene({ gl, frame: { frameId: 1, projectGeneration: 7 }, countries: {}, prepared }, {
    drawHydro() {}, drawCountryBoundaryStrokes() {}, strokeRenderer: { ...h,
      hasResource: key => h.resources.has(key),
      drawBatches: rows => { const row = rows[0]; drawn.push(row.geometryRevision);
        return row.geometryRevision === 2 ? { renderedKeys: [], missingKeys: [row.key], failures: [{ key: row.key, reason: 'GPU draw failed' }] }
          : { renderedKeys: [row.key], missingKeys: [], failures: [] }; },
    },
  });
  assert.deepEqual(drawn, [2, 1], 'retry is one same-frame redraw of the previously presented domain');
  assert.deepEqual(result.overlayMissingKeys, []);
  assert.deepEqual(result.strokeDomainReplacements, []);
  assert.deepEqual(result.recoveredStrokeDomains, ['boundaries']);
  assert.equal(result.strokePresentationFailed, false);
  assert.equal(prepared.canPreserveStrokeScene, true);
  assert.equal(commitGpuStrokeDomains(result, { frameId: 1, projectGeneration: 7 }, h.presentedStrokeDomains,
    { releaseResource: () => assert.fail('failed B must not release A') }), false);
});
test('failure of both B and eligible A is a failed presentation with no promotion', () => {
  const h = harness(), a = packet('line', 1), b = packet('line', 2); h.ready(a); h.accept(h.prepare([a])); h.ready(b);
  const gl = new Proxy({}, { get: (_target, key) => /^[A-Z_]+$/.test(key) ? key : () => {} });
  const result = drawGpuBaseScene({ gl, frame: { frameId: 1, projectGeneration: 7 }, countries: {}, prepared: h.prepare([b]) }, {
    drawHydro() {}, drawCountryBoundaryStrokes() {}, strokeRenderer: {
      hasResource: () => true, drawBatches: rows => ({ renderedKeys: [], missingKeys: rows.map(row => row.key) }),
    },
  });
  assert.equal(result.strokePresentationFailed, true);
  assert.deepEqual(result.strokeDomainReplacements, []);
});
