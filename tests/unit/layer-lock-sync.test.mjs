import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applicationFunctionSource } from '../../scripts/lib/application-source.mjs';

const commands = readFileSync(new URL("../../apps/editor/frontend/js/modules/app-object-commands.js", import.meta.url), 'utf8');
const search = readFileSync(new URL("../../shared/frontend/js/modules/object-search-controller.js", import.meta.url), 'utf8');

test('object lock mutations synchronize search rows without rebuilding object presentation', () => {
  const batch = applicationFunctionSource(commands, 'batchSetLocked');
  assert.match(batch, /syncLocks\(refs\)/);
  assert.doesNotMatch(batch, /invalidateObjectPresentation/);
  assert.match(batch, /presentPrimary\(\{ refreshOnly: true \}\)/);
  assert.match(batch, /syncBatchActionAvailability\(\)/);
  assert.match(batch, /objectRefLocked/);
});

test('search result rows remain independent of lock-state markup', () => {
  const row = applicationFunctionSource(search, 'rowFor');
  assert.doesNotMatch(row, /locked|Lock/);
  assert.match(search, /function syncLocks\(/);
});
