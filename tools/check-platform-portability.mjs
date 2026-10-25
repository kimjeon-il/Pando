import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { objectRefKey } from "../shared/frontend/js/modules/object-selection-controller.js";
import { createObjectSelectionController as baselineController } from '../tests/fixtures/portability/baseline-selection.mjs';
import { createNodeSelection } from '../tests/helpers/core-selection.mjs';

const directory = new URL('../tests/fixtures/portability/', import.meta.url);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function baselineSelectionTrace(createController, corpus) {
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

// The public Web projection exposes order, primary and revision. Scope anchors
// remain C++ owned; their behavior is observed through subsequent range steps.
export async function currentSelectionTrace(corpus) {
  const owner = await createNodeSelection({ territorialIds: corpus.refs.map(ref => ref.id),
    genericIds: [], labelIds: [], distributionIds: [] });
  try {
    const selection = owner.domain, trace = [];
    for (const step of corpus.operations) {
      switch (step.op) {
        case 'replace': await selection.replace(step.ref, { scope: step.scope }); break;
        case 'toggle': await selection.toggle(step.ref, { scope: step.scope }); break;
        case 'range': await selection.selectRange(step.ref, step.ordered,
          { scope: step.scope, additive: step.additive }); break;
        case 'setMany': await selection.setMany(step.refs, { primary: step.primary, scope: step.scope }); break;
        case 'remove': await selection.remove(step.ref); break;
        case 'prune': await selection.prune(new Set(step.keep.map(objectRefKey))); break;
        case 'clear': await selection.clear(); break;
        default: throw new Error(`Unknown selection operation: ${step.op}`);
      }
      const snapshot = selection.snapshot();
      trace.push({ keys: snapshot.selection.keys, primaryKey: snapshot.selection.primaryKey,
        revision: snapshot.revision });
    }
    return trace;
  } finally { owner.dispose(); }
}

const publicSelectionObservation = ({ keys, primaryKey, revision }) => ({ keys, primaryKey, revision });

export async function verifyPlatformPortability() {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory)));
  for (const [name, expected] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(name, directory))), expected, `Fixture hash: ${name}`);
  }
  const corpus = JSON.parse(readFileSync(new URL('selection.json', directory)));
  assert.equal(corpus.operations.length, manifest.steps);
  assert.equal(corpus.expected.length, manifest.steps);
  const baseline = baselineSelectionTrace(baselineController, corpus);
  const current = await currentSelectionTrace(corpus);
  assert.deepEqual(baseline, corpus.expected, 'Frozen baseline versus independently specified selection results');
  assert.deepEqual(current, baseline.map(publicSelectionObservation), 'Current Web Core projection versus frozen selection results');
  return { webBaseline: manifest.webBaseline, appBaseline: manifest.appBaseline,
    fixtureSha256: manifest.sha256, expected: manifest.steps, webProcessed: current.length,
    mismatches: 0, crossPlatformVerified: false };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = await verifyPlatformPortability();
  report.webHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' }).trim();
  console.log(JSON.stringify(report, null, 2));
}
