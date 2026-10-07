import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createObjectSelectionController, objectRefKey } from '../assets/js/modules/object-selection-controller.js';
import { createObjectSelectionController as baselineController } from '../tests/fixtures/portability/baseline-selection.mjs';

const directory = new URL('../tests/fixtures/portability/', import.meta.url);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function selectionTrace(createController, corpus) {
  let revision = 0;
  const selection = createController({ onChange: () => revision++ });
  return corpus.operations.map(step => {
    switch (step.op) {
      case 'replace': selection.replace(step.ref, { scope: step.scope }); break;
      case 'toggle': selection.toggle(step.ref, { scope: step.scope }); break;
      case 'range': selection.selectRange(step.ref, step.ordered, { scope: step.scope, additive: step.additive }); break;
      case 'setMany': selection.setMany(step.refs, { primary: step.primary, scope: step.scope }); break;
      case 'remove': selection.remove(step.ref); break;
      case 'prune': {
        const keys = new Set(step.keep.map(objectRefKey));
        selection.prune(ref => keys.has(ref.key)); break;
      }
      case 'clear': selection.clear(); break;
      default: throw new Error(`Unknown selection operation: ${step.op}`);
    }
    const { keys, primaryKey } = selection.snapshot();
    return { keys, primaryKey, revision,
      anchors: Object.fromEntries(corpus.scopes.map(scope => [scope, selection.rangeAnchor(scope)])) };
  });
}

export function verifyPlatformPortability(nativeProbe = null) {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory)));
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(name, directory))), expected, `Fixture hash: ${name}`);
  }
  const corpus = JSON.parse(readFileSync(new URL('selection.json', directory)));
  assert.equal(corpus.operations.length, manifest.steps);
  assert.equal(corpus.expected.length, manifest.steps);
  const baseline = selectionTrace(baselineController, corpus);
  const current = selectionTrace(createObjectSelectionController, corpus);
  assert.deepEqual(baseline, corpus.expected, 'Frozen baseline versus independently specified selection results');
  assert.deepEqual(current, baseline, 'Current Web versus pre-refactor selection');
  let native = null;
  if (nativeProbe) {
    const observed = JSON.parse(execFileSync(nativeProbe, [], { input: JSON.stringify(corpus), encoding: 'utf8' }));
    assert.deepEqual(observed, corpus.expected, 'Native order, primary, revisions and anchors');
    native = { steps: observed.length, binarySha256: sha256(readFileSync(nativeProbe)) };
  }
  return { webBaseline: manifest.webBaseline, appBaseline: manifest.appBaseline,
    fixtureSha256: manifest.sha256, expected: manifest.steps, webProcessed: current.length,
    native, mismatches: 0, crossPlatformVerified: native !== null };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = verifyPlatformPortability(process.argv[2]);
  report.webHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim();
  console.log(JSON.stringify(report, null, 2));
}
