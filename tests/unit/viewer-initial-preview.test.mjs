import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewerInitialPreview as createPreview} from '../../apps/viewer/js/modules/viewer-initial-preview.js';
class Element {
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  removeAttribute(key) { this.attributes.delete(key); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  hasAttribute(key) { return this.attributes.has(key); }
}
const geometry = Object.freeze({type: 'MultiPolygon', coordinates: Object.freeze([])});
const palette = {ocean: '#ffffff', defaultLand: '#cccccc'};
function frame(width = 640, height = 480, name = 'globe') {
  const seen = [];
  return {viewRevision: name, projectionRevision: 0, cssViewport: [width, height], seen,
    projectPath(value) { seen.push(value); return value.type === 'Sphere' ? `${name}-ocean` : `${name}-land`; }};
}
function fixture({load = async () => ({geometry}), active = true} = {}) {
  const element = new Element(), ocean = new Element(), land = new Element(), errors = [];
  let loads = 0, initial = active;
  element.querySelector = selector => selector === '.viewer-initial-preview-ocean' ? ocean : land;
  const preview = createPreview({element, loadLand: () => { loads++; return load(); },
    isInitial: () => initial, onError: error => errors.push(error)});
  return {preview, element, ocean, land, errors, loads: () => loads, complete: () => { initial = false; }};
}
test('preview reuses the exact land and canonical frame projection without country metadata', async () => {
  const f = fixture(), view = frame(); f.preview.render(view, palette); await f.preview.start();
  assert.equal(f.element.hasAttribute('hidden'), false);
  assert.equal(f.element.getAttribute('viewBox'), '0 0 640 480');
  assert.equal(f.ocean.getAttribute('d'), 'globe-ocean'); assert.equal(f.land.getAttribute('d'), 'globe-land');
  assert.equal(view.seen[1], geometry); assert.equal(f.land.getAttribute('fill'), palette.defaultLand);
  assert.equal(f.ocean.getAttribute('fill'), palette.ocean); assert.deepEqual(f.errors, []);
});
test('loading is shared once and does not need a frame to finish', async () => {
  const f = fixture(); await Promise.all([f.preview.start(), f.preview.start()]);
  assert.equal(f.loads(), 1); assert.equal(f.element.hasAttribute('hidden'), true);
  f.preview.render(frame(), palette); assert.equal(f.element.hasAttribute('hidden'), false);
});
test('land completion uses the latest viewport, camera path and theme', async () => {
  let resolve; const f = fixture({load: () => new Promise(done => { resolve = done; })});
  const started = f.preview.start(); await Promise.resolve();
  const first = frame(); f.preview.render(first, palette);
  const latest = frame(390, 844, 'flat-wrap'); const dark = {ocean: '#0d2837', defaultLand: '#63758a'};
  f.preview.render(latest, dark); resolve({geometry}); await started;
  assert.deepEqual(first.seen, []); assert.equal(f.land.getAttribute('d'), 'flat-wrap-land');
  assert.equal(f.element.getAttribute('viewBox'), '0 0 390 844');
  assert.equal(f.ocean.getAttribute('fill'), dark.ocean);
});
test('first map completion hides and releases the preview synchronously without a timer', async () => {
  const f = fixture(); f.preview.render(frame(), palette); await f.preview.start();
  f.complete(); f.preview.dispose();
  assert.equal(f.element.hasAttribute('hidden'), true); assert.equal(f.land.getAttribute('d'), null);
  assert.equal(f.preview.render(frame(), palette), false); await f.preview.start(); assert.equal(f.loads(), 1);
});
test('late load after dispose cannot show a preview over the accepted map', async () => {
  let resolve; const f = fixture({load: () => new Promise(done => { resolve = done; })});
  f.preview.render(frame(), palette); const started = f.preview.start(); await Promise.resolve();
  f.complete(); f.preview.dispose(); resolve({geometry}); await started;
  assert.equal(f.element.hasAttribute('hidden'), true); assert.equal(f.land.getAttribute('d'), null);
});
test('already-presented pages do not load or display an initial preview', async () => {
  const f = fixture({active: false}); await f.preview.start(); f.preview.render(frame(), palette);
  assert.equal(f.loads(), 0); assert.equal(f.element.hasAttribute('hidden'), true);
});
test('land rejection stays optional, is diagnosed and cannot stall the normal map', async () => {
  const error = new Error('preview unavailable'); const f = fixture({load: async () => { throw error; }});
  await assert.doesNotReject(f.preview.start());
  assert.deepEqual(f.errors, [error]); assert.equal(f.element.hasAttribute('hidden'), true);
  f.complete(); assert.equal(f.preview.render(frame(), palette), false);
});
test('late failure after page disposal does not report against a new map', async () => {
  let reject; const f = fixture({load: () => new Promise((_, no) => { reject = no; })});
  const started = f.preview.start(); await Promise.resolve(); f.preview.dispose();
  reject(new Error('late')); await started; assert.deepEqual(f.errors, []);
});
test('invalid preview geometry is rejected without mutating or completing the main map', async () => {
  const f = fixture({load: async () => ({geometry: {type: 'FeatureCollection', features: []}})});
  await f.preview.start(); assert.equal(f.errors.length, 1); assert.equal(f.element.hasAttribute('hidden'), true);
});
test('projection failure removes the preview and never escapes into the frame renderer', async () => {
  const f = fixture(); await f.preview.start();
  const view = frame(); view.projectPath = () => { throw new Error('bad projection'); };
  assert.doesNotThrow(() => f.preview.render(view, palette));
  assert.equal(f.errors.length, 1); assert.equal(f.element.hasAttribute('hidden'), true);
});
test('an ocean-only view can have a null land path', async () => {
  const f = fixture(); await f.preview.start(); const view = frame();
  view.projectPath = value => value.type === 'Sphere' ? 'ocean' : null;
  assert.equal(f.preview.render(view, palette), true); assert.equal(f.land.getAttribute('d'), '');
});
test('a new page instance can preview even after the previous instance was disposed', async () => {
  const old = fixture(); old.preview.dispose(); const fresh = fixture();
  fresh.preview.render(frame(), palette); await fresh.preview.start();
  assert.equal(old.element.hasAttribute('hidden'), true); assert.equal(fresh.element.hasAttribute('hidden'), false);
});

test('upload-only frames reuse coastline paths while theme-only changes recolor them', async () => {
  const f = fixture(), original = frame(); f.preview.render(original, palette); await f.preview.start();
  const upload = frame(); upload.frameId = 500;
  f.preview.render(upload, {ocean: '#0d2837', defaultLand: '#63758a'});
  assert.deepEqual(upload.seen, []); assert.equal(f.land.getAttribute('fill'), '#63758a');
  const moved = frame(640, 480, 'new-camera'); f.preview.render(moved, palette);
  assert.equal(moved.seen.length, 2); assert.equal(f.land.getAttribute('d'), 'new-camera-land');
});

test('an empty clipped path may be undefined without making preview preparation fail', async () => {
  const f = fixture(); await f.preview.start(); const view = frame();
  view.projectPath = value => value.type === 'Sphere' ? 'ocean' : undefined;
  assert.equal(f.preview.render(view, palette), true); assert.equal(f.land.getAttribute('d'), '');
  assert.deepEqual(f.errors, []);
});

test('startup globe preview fits the canonical minimum world fit without changing the map frame', async () => {
  const f = fixture();
  const view = {...frame(), projection: 'globe', globeZoom: 1, cssTranslate: [320, 240]};
  await f.preview.start();
  f.preview.render(view, palette);
  assert.equal(f.ocean.getAttribute('transform'), 'translate(320 240) scale(1.25) translate(-320 -240)');
  assert.equal(f.land.getAttribute('transform'), f.ocean.getAttribute('transform'));
  assert.equal(view.globeZoom, 1);
});

test('already zoomed globe and flat maps do not receive a second preview zoom', async () => {
  const f = fixture(); await f.preview.start();
  f.preview.render({...frame(), projection: 'globe', globeZoom: 1.25, cssTranslate: [320, 240]}, palette);
  assert.equal(f.land.getAttribute('transform'), null);
  f.preview.render({...frame(), projection: 'flat', globeZoom: 1, cssTranslate: [320, 240]}, palette);
  assert.equal(f.land.getAttribute('transform'), null);
});
