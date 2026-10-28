import test from 'node:test';
import assert from 'node:assert/strict';
import { buildResearchPurgeManifest, filterHistoryIndex } from '../../tools/library-history.mjs';

const entry = stored => ({ stored, encoding: 'gzip', bytes: 12, sha256: 'a'.repeat(64) });
test('purge follows historical report paths and removes their exclusive archives', () => {
  const retired = 'reports/borders/reconstruction/siachen/terrain.json';
  const old = { files: { 'reports/research/siachen/terrain.json': entry('archive/blobs/old.gz') } };
  const manifest = buildResearchPurgeManifest({ retiredPaths: [retired], indexes: [old], currentIndex: { files: {} } });
  assert.ok(manifest.paths.includes('reports/research/siachen/terrain.json'));
  assert.ok(manifest.paths.includes('archive/blobs/old.gz'));
  assert.deepEqual(filterHistoryIndex(old, manifest).files, {});
});
test('an archive shared with a retained logical source is preserved', () => {
  const retired = 'reports/borders/reconstruction/siachen/terrain.json';
  const old = { files: { [retired]: entry('archive/blobs/shared.gz'), 'assets/data/live.json': entry('archive/blobs/shared.gz') } };
  const manifest = buildResearchPurgeManifest({ retiredPaths: [retired], indexes: [old], currentIndex: { files: { 'assets/data/live.json': old.files['assets/data/live.json'] } } });
  assert.ok(!manifest.paths.includes('archive/blobs/shared.gz'));
  assert.deepEqual(filterHistoryIndex(old, manifest).files, { 'assets/data/live.json': old.files['assets/data/live.json'] });
  assert.equal(old.files[retired].stored, 'archive/blobs/shared.gz');
});
test('purge refuses a currently retained file and unrelated runtime or development paths', () => {
  const path = 'reports/borders/reconstruction/siachen/terrain.json';
  assert.throws(() => buildResearchPurgeManifest({ retiredPaths: [path], indexes: [], currentIndex: { files: { [path]: entry(path) } } }), /current|retain/i);
  for (const bad of ['assets/data/live.json', '../outside', 'reports/development/task.md']) {
    assert.throws(() => buildResearchPurgeManifest({ retiredPaths: [bad], indexes: [], currentIndex: { files: {} } }), /scope|research|path/i);
  }
});
