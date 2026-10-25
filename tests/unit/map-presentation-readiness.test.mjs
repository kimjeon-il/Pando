import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPresentationReadiness } from "../../shared/frontend/js/modules/startup-readiness.js";

const ready = { boundaryReady: true, terrainVisible: true,
  terrain: { terrainReady: true }, targetKey: 'current', presentedKey: 'current', band: 'low' };

test('completion requires matching actual presentation, boundaries and visible terrain', () => {
  assert.equal(mapPresentationReadiness(ready).status, 'ready');
  assert.equal(mapPresentationReadiness({ ...ready, presentedKey: 'old' }).status, 'presenting');
  assert.equal(mapPresentationReadiness({ ...ready, boundaryReady: false }).status, 'boundaries');
  assert.equal(mapPresentationReadiness({ ...ready, terrain: { terrainReady: false } }).status, 'terrain');
});

test('hidden terrain is excluded; exhausted failures never count as ready', () => {
  assert.equal(mapPresentationReadiness({ ...ready, terrainVisible: false, terrain: {} }).status, 'ready');
  const failure = mapPresentationReadiness({ ...ready, terrain: { terrainReady: false, terrainFailed: true, terrainTargetTilesSettled: true } });
  assert.equal(failure.status, 'error');
  assert.equal(failure.retry, true);
});

test('resolution limits have an explicit terminal state and low/high labels', () => {
  const limited = mapPresentationReadiness({ ...ready, terrain: { terrainReady: true, terrainResolutionLimited: true } });
  assert.equal(limited.status, 'limited');
  assert.match(limited.label, /최고 해상도/);
  assert.match(mapPresentationReadiness(ready).label, /저배율/);
  assert.match(mapPresentationReadiness({ ...ready, band: 'high' }).label, /상세/);
});
