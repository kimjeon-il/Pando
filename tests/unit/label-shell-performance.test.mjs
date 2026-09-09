import { readApplicationOwners, applicationFunctionSource } from '../../scripts/lib/application-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = readApplicationOwners('map-projection', 'gpu-scene', 'map-host', 'country-labels');
const rendering = await readFile(new URL('../../assets/js/modules/rendering-domain.js', import.meta.url), 'utf8');

const functionSource = applicationFunctionSource;

test('globe shell uses frame-context circles instead of rebuilding a D3 Sphere path', () => {
  const shell = functionSource(app, 'updatePandoGlobeShell', 'featureFromGeometry');
  assert.match(shell, /frameContext\?\.cssTranslate/);
  assert.match(shell, /frameContext\?\.cssScale/);
  assert.match(shell, /\.attr\('cx', translate\[0\]\)/);
  assert.match(shell, /\.attr\('r', radius\)/);
  assert.doesNotMatch(shell, /Sphere|\.attr\('d'|\bpath\b/);
  assert.match(app, /append\('circle'\)\.attr\('class', 'map-ocean map-ocean-globe'\)/);
  assert.match(app, /append\('circle'\)\.attr\('class', 'globe-shadow'\)/);
  assert.match(rendering, /const syncBaseView = \(viewState = null\) =>/);
  assert.match(rendering, /b\.graticuleLayer\?\.attr\('display', gpuOwnsGraticule \? 'none' : null\)/);
  assert.match(rendering, /viewPresentation: commitViewAttachedLayers/);
});

test('label positioning commits inside the shared visual frame without a private cadence', () => {
  assert.doesNotMatch(rendering, /labelCadenceIntervalMs|scheduleLabelPositions|pendingLabelPositionFrameContext/);
  assert.match(rendering, /renderCountryLabelPositions = frameContext => \{/);
  assert.match(rendering, /renderUserLabelPositions = frameContext => applyUserLabelPositions\(frameContext\)/);
  assert.match(rendering, /renderCountryLabelPositions\(frame\)/);
  assert.match(rendering, /renderUserLabelPositions\(frame\)/);
  assert.match(rendering, /projectVisibleCoordinate\(coordinate, frameContext\)/);
  assert.match(app, /countryLabelPoints: new Map/);
  assert.match(app, /userLabelPoints: new Map/);
  assert.doesNotMatch(app, /if \(!isCoordVisible\(coordinate\)\) continue;\s*const point = activeProjection\(\)\(coordinate\)/);
});
