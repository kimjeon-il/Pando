// Destructive test hooks are installed into a disposable CI checkout only.
// No product Worker is instrumented in a committed source tree.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

if (process.env.PANDO_PREPARED_DIAGNOSTIC_ISOLATED !== '1')
  throw new Error('PANDO_PREPARED_DIAGNOSTIC_ISOLATION_REQUIRED');

const patches = [
  {
    path: 'assets/js/modules/country-shared-boundary-packet.js',
    needle: '  return { preparedStore, replace, patch,',
    replacement: '  return { __preparedTestOwners: { contacts, contactsByOwner, edges }, preparedStore, replace, patch,',
  },
  {
    path: 'assets/js/modules/boundary-topology.js',
    needle: '  return { patch, replace, get: id => byId.get(String(id)), values: () => [...byId.values()],',
    replacement: '  return { __preparedTestOwners: { byId, spatialIndex }, patch, replace, get: id => byId.get(String(id)), values: () => [...byId.values()],',
  },
  {
    path: 'assets/js/modules/country-contact-core.js',
    needle: 'const wireRows=new WeakMap();',
    replacement: `const wireRows=new WeakMap();
globalThis.__PANDO_PREPARED_TEST_WIRE__ = {
  has: prepared => wireRows.has(prepared),
  drop: prepared => wireRows.delete(prepared),
};`,
  },
];
for (const { path, needle, replacement } of patches) {
  const original = await readFile(path, 'utf8');
  assert.equal(original.split(needle).length, 2, 'Injection anchor changed: ' + path);
  assert.ok(!original.includes('__preparedTestOwners') && !original.includes('__PANDO_PREPARED_TEST_WIRE__'),
    'Only uninstrumented product checkout is permitted: ' + path);
  await writeFile(path, original.replace(needle, replacement));
  console.log('PREPARED_TEST_ONLY_HOOK', path);
}
