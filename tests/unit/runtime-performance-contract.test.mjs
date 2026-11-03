import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relativePath => readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');



const projectDomain = read('shared/frontend/js/modules/project-domain.js');
const metrics = read('shared/frontend/js/modules/runtime-performance-metrics.js');



test('performance report covers startup long tasks, mobile sheet cadence and commit-to-paint', () => {
  assert.match(metrics, /firstLoadWindowMs/);
  assert.match(metrics, /MOBILE_SHEET_DRAG: 'mobile-sheet\.drag'/);
  assert.match(metrics, /COMMIT_TO_PAINT: 'ui\.commit-to-paint'/);
  assert.match(metrics, /estimatedMissedFrames/);
  assert.match(metrics, /usedJSHeapSize/);
});
