import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const browserSource = readFileSync(new URL('../browser/p3-remote-preview.spec.mjs', import.meta.url), 'utf8');
const predicateSource = browserSource.slice(browserSource.indexOf('function p3PresentationFailures('),
  browserSource.indexOf('\nasync function readP3Presentation('));
const presentationFailures = runInNewContext('(' + predicateSource + ')');
const failures = (state, renderer = 'webgl2') => Array.from(presentationFailures(state, renderer));

function displayedMap() {
  // The initial editor map starts at generation zero. These are actual display
  // acknowledgements, not the bootstrap/loading state of the DOM.
  return { frameId: 142, countryFeatureCount: 207, render: {
    renderer: 'webgl2', readiness: 'ready', canonicalMeshReady: true,
    canonicalPromotionError: '', surfaceQuality: 'canonical',
    surfaceDraw: { quality: 'canonical', landSource: 'physical-canonical', countryIndexCount: 4542978 },
    projectGeneration: 0, countriesPublishedGeneration: 0,
    projectRenderBlocked: false, webglContextLost: false,
    requestedRevision: 1, displayedRevision: 1,
    committedGeometryRevision: 0, displayedGeometryRevision: 0, pendingCountryCount: 0,
    countries: 258, countryBaseIndexCount: 4542978, countryVisibleCount: 258, baseSceneDrawCount: 16,
    canvasStyleRevision: 0, canvasDisplayedStyleRevision: 0,
  } };
}

test('P3 accepts a presented initial editor generation and a current replacement generation', () => {
  const state = displayedMap();
  assert.deepEqual(failures(state), []);
  state.render.projectGeneration = 3;
  state.render.countriesPublishedGeneration = 3;
  assert.deepEqual(failures(state), []);
});

test('P3 rejects unpublished, stale and invalid country generations even with visible triangles', () => {
  for (const [generation, published] of [[0, -1], [1, 0], [1, 2], [-1, -1], [0.5, 0.5], [NaN, NaN]]) {
    const state = displayedMap();
    state.render.projectGeneration = generation;
    state.render.countriesPublishedGeneration = published;
    assert.ok(failures(state).some(message => message.includes('publication')), `${generation}/${published}`);
  }
});

test('P3 rejects an incomplete or unacknowledged frame despite a matching generation', () => {
  for (const patch of [
    { projectRenderBlocked: true }, { canonicalMeshReady: false }, { pendingCountryCount: 1 },
    { displayedRevision: 0 }, { displayedGeometryRevision: -1 },
    { countryBaseIndexCount: 0 }, { countryVisibleCount: 0 }, { baseSceneDrawCount: 0 },
  ]) {
    const state = displayedMap();
    Object.assign(state.render, patch);
    assert.ok(failures(state).length > 0, JSON.stringify(patch));
  }
  const state = displayedMap(); state.frameId = 0;
  assert.ok(failures(state).length > 0);
});

test('P3 Canvas generation zero still requires current nonempty bitmap evidence', () => {
  const state = displayedMap();
  state.render.renderer = 'canvas-worker';
  state.pixels = { colors: 24, opaque: 4096, width: 780, height: 1688 };
  assert.deepEqual(failures(state, 'canvas'), []);
  state.render.canvasDisplayedStyleRevision = -1;
  assert.ok(failures(state, 'canvas').some(message => message.includes('style')));
  state.render.canvasDisplayedStyleRevision = 0;
  state.pixels.colors = 1;
  assert.ok(failures(state, 'canvas').some(message => message.includes('empty')));
});
