import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instrumentMapBaselineSource} from '../helpers/map-transition-baseline.mjs';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('viewer template has a quiet live status and no central loading surface', () => {
  const html = read('apps/viewer/templates/index.html');
  assert.match(html, /id="viewerStatus" class="ui-visually-hidden" role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /viewer-loading/);
  assert.match(html, /class="viewer-map-notices"/);
  assert.match(html, /id="mapPreparationRetry"/);
  assert.doesNotMatch(read('apps/viewer/css/viewer.css'), /viewer-loading/);
});
test('P0 observes the actual presentation callback and successful completion, not status visibility', () => {
  const source = read('apps/viewer/js/modules/viewer-composition.js');
  // Visibility is not a readiness API. Removing it must not break the probe.
  const independent = source.replaceAll('status.hidden=true;', '').replaceAll('status.hidden=false;', '');
  const instrumented = instrumentMapBaselineSource(independent, 'viewer-composition.js');
  assert.equal(instrumented.split('globalThis.__PANDO_P0__.presented(month);').length - 1, 1);
  assert.equal(instrumented.split('globalThis.__PANDO_P0__.settled();').length - 1, 1);
  assert.match(instrumented, /commit\(\);globalThis\.__PANDO_P0__\.presented\(month\);/);
  assert.ok(instrumented.indexOf('await searchController.completeHydration();') < instrumented.indexOf('globalThis.__PANDO_P0__.settled();'));
});

test('quiet completion stays accessible and does not invent readiness or retain retry controls', async () => {
  const {presentViewerLoadStatus} = await import('../../apps/viewer/js/modules/viewer-load-status.js');
  const element = {dataset: {ready: 'false'}, hidden: true, children: [],
    setAttribute(name, value) { this[name] = value; },
    set textContent(value) { this.text = value; this.children = []; }};
  presentViewerLoadStatus(element, '연결 실패', {error: true});
  element.children.push({type: 'button'});
  assert.equal(element.className, 'ui-floating-surface viewer-map-error');
  presentViewerLoadStatus(element, '지도 준비 완료.');
  assert.equal(element.hidden, false);
  assert.equal(element.role, 'status');
  assert.equal(element['aria-live'], 'polite');
  assert.equal(element['aria-atomic'], 'true');
  assert.equal(element.className, 'ui-visually-hidden');
  assert.equal(element.dataset.ready, 'false');
  assert.deepEqual(element.children, []);
});
