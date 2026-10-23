import assert from 'node:assert/strict';
import test from 'node:test';
import { extractReferenceMapBoundaries } from '../../assets/js/modules/reference-image-analysis-engine.js';

for (const [name, body, status, type, code] of [
  ['missing asset', '', 404, 'text/plain', 'PL-REF-MODEL-MISSING'],
  ['native missing-asset HTML response', '<!DOCTYPE html><title>PandoLab</title>', 200, 'text/html; charset=utf-8', 'PL-REF-MODEL-MISSING'],
  ['damaged JSON manifest', '{invalid', 200, 'application/json', 'PL-REF-MODEL-MANIFEST'],
]) test(`boundary inference reports ${name} before loading an image or runtime`, async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url));return new globalThis.Response(body, { status, headers: { 'Content-Type': type } });
  });
  await assert.rejects(extractReferenceMapBoundaries({ resources: { dataBase: 'https://local.test/models/' } }, {}, {}), error => {
    assert.equal(error.code, code);
    if (code === 'PL-REF-MODEL-MANIFEST') assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
  assert.deepEqual(calls, ['https://local.test/models/boundary.manifest.json']);
});
