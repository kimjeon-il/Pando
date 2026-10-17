// Test-only source injection. The committed application remains byte-for-byte
// identical; CI writes these hooks only to its disposable checkout.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const patches = [
  {
    path: 'assets/js/modules/country-shared-boundary-packet.js',
    needle: '  return { preparedStore, replace, patch,',
    replacement: '  return { __retainerTestOwners: { contacts, contactsByOwner, edges }, preparedStore, replace, patch,',
  },
  {
    path: 'assets/js/modules/boundary-topology.js',
    needle: '  return { patch, replace, get: id => byId.get(String(id)), values: () => [...byId.values()],',
    replacement: '  return { __retainerTestOwners: { byId, spatialIndex }, patch, replace, get: id => byId.get(String(id)), values: () => [...byId.values()],',
  },
];
if (process.env.PANDO_RETENTION_DIAGNOSTIC_ISOLATED !== '1')
  throw new Error('PANDO_DIAGNOSTIC_ISOLATION_REQUIRED: do not instrument committed product code');
for (const { path, needle, replacement } of patches) {
  const data = await readFile(path, 'utf8');
  assert.equal(data.split(needle).length, 2, 'Source contract changed: ' + path);
  assert.ok(!data.includes('__retainerTestOwners'), 'Only a clean checkout may be instrumented: ' + path);
  await writeFile(path, data.replace(needle, replacement));
  console.log('ISOLATED_OWNER_HOOK', path);
}
