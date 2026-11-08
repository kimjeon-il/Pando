// Renderer v2 gate: exercise observable draw, resource, publication and
// backend behavior. Internal function names and source placement are not
// contracts, so this gate deliberately never slices or matches source text.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const suites = [
  'tests/unit/gpu-base-scene-order.test.mjs',
  'tests/unit/gpu-helper-utils.test.mjs',
  'tests/unit/gpu-resource-owners.test.mjs',
  'tests/unit/gpu-scene-staging.test.mjs',
  'tests/unit/gpu-stroke-renderer.test.mjs',
  'tests/unit/gpu-canvas-worker.test.mjs',
  'tests/unit/map-presentation-readiness.test.mjs',
];
const result = spawnSync(process.execPath,
  ['--test','--test-concurrency=1',...suites],
  { cwd:process.cwd(), stdio:'inherit', env:process.env });
if(result.error) {
  console.error('Renderer v2 behavioral verification could not start:',result.error);
  process.exitCode=1;
} else if(result.signal) {
  console.error('Renderer v2 behavioral verification terminated:',result.signal);
  process.exitCode=1;
} else {
  process.exitCode=result.status===0?0:1;
}
