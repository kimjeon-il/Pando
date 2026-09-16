import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applicationFunctionSource } from '../../scripts/lib/application-source.mjs';

const source = readFileSync(new URL('../../assets/js/modules/app-progressive-startup.js', import.meta.url), 'utf8');

test('progressive and canonical startup share one ordered runtime initializer', () => {
  assert.match(source, /async function initializeStartupRuntime\(/);
  const helper = applicationFunctionSource(source, 'initializeStartupRuntime');
  const orderedSteps = [
    'applyLayoutMode',
    'bindUI',
    'beginHydration',
    'initSvg',
    'resizeMap',
    'afterInitialMapSetup();',
    "mapHostStage = 'frame-pending'",
    'await awaitVisualFrame()',
    "mapHostStage = 'host-initialize'",
    'initializeMapHost',
    "mapHostStage = 'gpu-initialize'",
    'gpuMapRenderer.initialize',
    "mapHostStage = 'ready'",
    'startMapResizeObserver',
  ];
  let previous = -1;
  for (const step of orderedSteps) {
    const index = helper.indexOf(step);
    assert.ok(index > previous, `startup runtime step is missing or out of order: ${step}`);
    previous = index;
  }
  assert.match(helper, /return \{ gpuReady, gpuInitializeMs \}/);

  const progressive = applicationFunctionSource(source, 'initProgressive');
  const canonical = applicationFunctionSource(source, 'init');
  assert.match(progressive, /\{ gpuInitializeMs \}\s*=\s*await initializeStartupRuntime\(\)/);
  assert.match(canonical, /\{ gpuReady \}\s*=\s*await initializeStartupRuntime\(\{[\s\S]*afterInitialMapSetup:[\s\S]*mapEditClient\.rebase/);
  for (const entrypoint of [progressive, canonical]) {
    assert.doesNotMatch(entrypoint, /applyLayoutMode|bindUI|beginHydration|initializeMapHost|gpuMapRenderer\.initialize|startMapResizeObserver/);
  }
});
