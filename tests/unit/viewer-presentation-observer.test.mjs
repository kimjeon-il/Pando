import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createViewerInitialPresentation} from '../../apps/viewer/js/modules/viewer-initial-presentation.js';

// Exercise the actual composition adapter without starting a GPU or loading data.
const source = readFileSync(new URL('../../shared/frontend/js/modules/map-renderer-composition.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '').replaceAll('export function ', 'function ');
function rendererFixture(options, {duringConstruction = false} = {}) {
  let inputs, retries = 0, generation = 0;
  const nodes = Object.fromEntries(['mapPreparationStatus', 'mapPreparationRetry', 'mapPreparationNotice']
    .map(id => [id, {textContent: '', hidden: false}]));
  const renderer = {getProjectGeneration: () => generation, setRenderQuality() {}, retryMapPreparation() { retries++; }};
  const context = {createGpuMapRenderer: value => {
    inputs = value;
    if (duringConstruction) value.rendererUi.setMapPreparationStatus({status: 'ready', label: '준비됨', retry: false});
    return renderer;
  }};
  runInNewContext(source, context);
  const ports = Object.fromEntries(['platformConfigurationA', 'layerPresentation', 'physicalConfig', 'projectState',
    'builtinCountries', 'countryLabelModel', 'colorModel', 'hydroPresentation', 'hydroModel', 'physicalResources',
    'physicalServices', 'surfaces', 'readinessUi', 'preferences', 'mapHostViewB', 'feedback', 'renderQuality', 'renderScene']
    .map(name => [name, {}]));
  ports.platform = {$: id => nodes[id]};
  context.createMapRenderer(ports, options);
  return {publish: inputs.rendererUi.setMapPreparationStatus, nodes, retries: () => retries,
    setGeneration: value => { generation = value; }};
}

test('renderer observer receives real readiness without altering retry or label presentation', () => {
  const events = [];
  const fixture = rendererFixture({productMode: 'viewer', onMapPreparationStatus: state => events.push(state)});
  const waiting = {status: 'loading', label: '현재 화면 준비 중', retry: false};
  const ready = {status: 'ready', label: '현재 화면 준비됨', retry: false};
  fixture.publish(waiting); fixture.publish(ready);
  assert.deepEqual(events, [waiting, ready]);
  assert.equal(fixture.nodes.mapPreparationStatus.textContent, '준비됨');
  assert.equal(fixture.nodes.mapPreparationNotice.hidden, true);
  fixture.publish({status: 'error', label: '현재 화면 준비 실패', retry: true});
  assert.equal(fixture.nodes.mapPreparationStatus.textContent, '불러오기 실패');
  assert.equal(fixture.nodes.mapPreparationRetry.hidden, false);
  fixture.nodes.mapPreparationRetry.onclick();
  assert.equal(fixture.retries(), 1);
});

test('renderer readiness and accepted generation jointly finish the viewer first-map state', () => {
  const state = createViewerInitialPresentation();
  const fixture = rendererFixture({productMode: 'viewer', onMapPreparationStatus: state.observe});
  const ready = {status: 'ready', label: '준비됨', retry: false};
  fixture.publish(ready);
  const request = state.track(() => true);
  fixture.setGeneration(3);
  fixture.publish(ready);
  assert.equal(state.hasPresented(), false);
  request.accept(3);
  assert.equal(state.hasPresented(), true);
});

test('editor renderer remains usable without a viewer presentation observer', () => {
  const fixture = rendererFixture({productMode: 'editor'});
  fixture.publish({status: 'ready', label: '현재 화면 준비됨', retry: false});
  assert.equal(fixture.nodes.mapPreparationStatus.textContent, '현재 화면 준비됨');
  assert.equal(fixture.nodes.mapPreparationRetry.hidden, true);
});


test('renderer generation, not a newer domain generation, identifies the displayed frame', () => {
  const state = createViewerInitialPresentation();
  const fixture = rendererFixture({productMode: 'viewer', onMapPreparationStatus: state.observe});
  const request = state.track(() => true);
  request.accept(3);
  fixture.setGeneration(1);
  fixture.publish({status: 'ready', label: '준비됨', retry: false});
  assert.equal(state.hasPresented(), false);
  fixture.setGeneration(3);
  fixture.publish({status: 'ready', label: '준비됨', retry: false});
  assert.equal(state.hasPresented(), true);
});

test('construction-time preparation is not mistaken for a displayed renderer frame', () => {
  const events = [];
  const fixture = rendererFixture({productMode: 'viewer', onMapPreparationStatus: value => events.push(value)},
    {duringConstruction: true});
  assert.equal(events.length, 0);
  fixture.publish({status: 'ready', label: '준비됨', retry: false});
  assert.equal(events.length, 1);
});
