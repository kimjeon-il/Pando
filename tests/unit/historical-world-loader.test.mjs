import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { smallHistoricalWorld } from '../helpers/historical-world.mjs';
const module = await import('../../assets/js/modules/historical-world-loader.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  assert.equal(typeof module.createHistoricalWorldLoader, 'function');
  const project = smallHistoricalWorld(), decoded = Buffer.from(JSON.stringify(project)), compressed = gzipSync(decoded);
  const spec = { url: 'project.gz', encoding: 'gzip', compressedBytes: compressed.length, decodedBytes: decoded.length, sha256: hash(compressed) };
  const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, sourceMonth: '2026-10', project: spec }));
  const assets = new Map([['manifest.json', manifest], ['project.gz', compressed]]);
  const cache = new Map(); let failNetwork = false; let calls = 0;
  const loader = module.createHistoricalWorldLoader({ manifestUrl: 'manifest.json', dataRevision: 'test',
    manifestSpec: { encoding: 'identity', compressedBytes: manifest.length, decodedBytes: manifest.length, sha256: hash(manifest) },
    fetchFn: async url => { calls++; return new Response(failNetwork ? 'broken' : assets.get(url)); },
    cacheStorage: { open: async () => ({ match: async url => cache.has(url) ? new Response(cache.get(url)) : undefined,
      put: async (url, response) => cache.set(url, Buffer.from(await response.arrayBuffer())), delete: async url => cache.delete(url) }) },
  });
  return { loader, project, cache, assets, get calls() { return calls; }, fail(value) { failNetwork = value; } };
}
test('newWorldRestoresFullTimeline', async () => {
  const input = fixture(), result = await input.loader.loadProject();
  assert.deepEqual(result.project, input.project); assert.equal(result.manifest.sourceMonth, '2026-10');
});
test('corruptCachedAssetRejectsThenRetries', async () => {
  const input = fixture(); input.cache.set('project.gz', input.assets.get('project.gz').subarray(0, 20));
  const result = await input.loader.loadProject();
  assert.deepEqual(result.project, input.project); assert.equal(input.calls, 2);
  input.cache.clear(); input.fail(true);
  await assert.rejects(input.loader.loadProject(), /크기|무결성|size|integrity/);
  input.fail(false); assert.deepEqual((await input.loader.loadProject()).project, input.project);
});
