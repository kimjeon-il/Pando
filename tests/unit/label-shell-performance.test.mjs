import { applicationFunctionSource } from '../helpers/source-functions.mjs';
import {readFrontendSources} from '../helpers/read-frontend-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = readFrontendSources('map-projection', 'gpu-scene', 'map-workspace-host', 'territorial-labels');
const rendering = await readFile(new URL("../../shared/frontend/js/modules/rendering-domain.js", import.meta.url), 'utf8');
const content = await readFile(new URL("../../shared/frontend/js/modules/map-content-presentation.js", import.meta.url), 'utf8');
const labels = await readFile(new URL("../../shared/frontend/js/modules/label-presentation.js", import.meta.url), 'utf8');

const functionSource = applicationFunctionSource;

test('globe shell uses frame-context circles instead of rebuilding a D3 Sphere path', () => {
  const shell = functionSource(readFrontendSources('map-projection'), 'updatePandoGlobeShell', 'featureFromGeometry');
  assert.match(shell, /frameContext\.cssTranslate/);
  assert.match(shell, /frameContext\.cssScale/);
  assert.match(shell, /\.attr\('cx', translate\[0\]\)/);
  assert.match(shell, /\.attr\('r', radius\)/);
  assert.doesNotMatch(shell, /Sphere|\.attr\('d'|\bpath\b/);
  assert.match(app, /append\('circle'\)\.attr\('class', 'map-ocean map-ocean-globe'\)/);
  assert.match(app, /append\('circle'\)\.attr\('class', 'globe-shadow'\)/);
  assert.match(content, /const syncBaseView = \(viewState = null\) =>/);
  assert.match(content, /replaceGpuSceneDomain\?\.\('base-graticule', \{ strokes:/);
  assert.doesNotMatch(rendering, /graticuleLayer|gpuOwnsGraticule/);
  assert.match(rendering, /viewPresentation: commitViewAttachedLayers/);
});

test('label positioning commits inside the shared visual frame without a private cadence', () => {
  assert.doesNotMatch(rendering, /labelCadenceIntervalMs|scheduleLabelPositions|pendingLabelPositionFrameContext/);
  assert.doesNotMatch(labels, /labelCadenceIntervalMs|scheduleLabelPositions|pendingLabelPositionFrameContext/);
  assert.match(labels, /renderTerritorialLabelPositions = frameContext => \{/);
  assert.match(labels, /renderUserLabelPositions = frameContext => applyUserLabelPositions\(frameContext\)/);
  assert.match(rendering, /renderTerritorialLabelPositions\(frame\)/);
  assert.match(rendering, /renderUserLabelPositions\(frame\)/);
  assert.match(rendering, /frameProjectCoordinate\(coordinate, frameContext\)/);
  assert.match(app, /territorialLabelPoints: new Map/);
  assert.match(app, /userLabelPoints: new Map/);
  assert.doesNotMatch(app, /if \(!isCoordVisible\(coordinate\)\) continue;\s*const point = activeProjection\(\)\(coordinate\)/);
});
