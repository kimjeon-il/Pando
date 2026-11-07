import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createViewerInitialPresentation} from '../../apps/viewer/js/modules/viewer-initial-presentation.js';
import {presentViewerLoadStatus} from '../../apps/viewer/js/modules/viewer-load-status.js';

const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('viewer status stays accessible without covering the displayed map', () => {
  const html = read('apps/viewer/templates/index.html');
  const region = html.match(/<span\b[^>]*\bid="viewerStatus"[^>]*>/)?.[0];
  assert.ok(region, 'Viewer must expose an accessible status region');
  for (const [attribute, value] of [['class', 'ui-visually-hidden'], ['role', 'status'],
    ['aria-live', 'polite'], ['aria-atomic', 'true']])
    assert.match(region, new RegExp('\\b' + attribute + '="' + value + '"'));
  assert.doesNotMatch(html, /\bid="viewer-loading"/);
  assert.match(html, /\bid="mapPreparationRetry"/);
});

test('first real map frame publishes once independently of status labels and optional terrain', () => {
  let presented = 0;
  const owner = createViewerInitialPresentation({onPresented: () => presented++});
  const request = owner.track(() => true);
  assert.equal(owner.hasPresented(), false);
  assert.equal(request.accept(4), false, 'project acceptance is not paint confirmation');
  assert.equal(owner.observe({status: 'ready', mapReady: false}, 4), false);
  assert.equal(owner.observe({status: 'terrain', mapReady: true, terrainReady: false}, 3), false,
    'a previously painted generation cannot complete this request');
  assert.equal(owner.observe({status: 'terrain', mapReady: true, terrainReady: false}, 4), true);
  assert.equal(owner.hasPresented(), true);
  assert.equal(presented, 1);
  assert.equal(owner.observe({status: 'ready', mapReady: true}, 4), false);
  request.cancel();
  owner.dispose();
  assert.equal(presented, 1);
});

test('quiet completion preserves accessibility without declaring the renderer ready', () => {
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
