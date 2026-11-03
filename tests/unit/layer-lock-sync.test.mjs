import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applicationFunctionSource } from '../../scripts/lib/application-source.mjs';


const search = readFileSync(new URL("../../shared/frontend/js/modules/object-search-controller.js", import.meta.url), 'utf8');



test('search result rows remain independent of lock-state markup', () => {
  const row = applicationFunctionSource(search, 'rowFor');
  assert.doesNotMatch(row, /locked|Lock/);
  assert.match(search, /function syncLocks\(/);
});
