import test from 'node:test';
import assert from 'node:assert/strict';
import * as history from '../../tools/library-history.mjs';

test('retention filters generated editions while retaining source history and shared archives', () => {
  assert.equal(typeof history.buildHistoryRetentionManifest, 'function');
  const source = 'tools/historical-library/sources/master.json';
  const generated = 'assets/data/world/current.json';
  const indexes = [{ files: {
    [source]: {stored:'archive/source.gz',sha256:'original'},
    [generated]: {stored:'archive/old.gz',sha256:'old'},
    'reports/development/retired.json': {stored:'archive/source.gz',sha256:'original'},
  } }, {files:{[generated]:{stored:'archive/current.gz',sha256:'current'}}}];
  const manifest = history.buildHistoryRetentionManifest({
    keepPaths:[source,generated], currentOnly:{[generated]:['current']}, indexes,
  });
  assert.deepEqual(Object.keys(history.filterHistoryIndex(indexes[0],manifest).files),[source]);
  assert.ok(manifest.keepPaths.includes('archive/source.gz'));
  assert.ok(!manifest.keepPaths.includes('archive/old.gz'));
  assert.ok(manifest.keepPaths.includes('archive/current.gz'));
  assert.deepEqual(Object.keys(indexes[0].files),[source,generated,'reports/development/retired.json']);
});

test('retention follows explicit historical aliases and rejects ambiguous or unsafe inputs', () => {
  assert.equal(typeof history.buildHistoryRetentionManifest, 'function');
  const keep='reports/borders/history/current.md', old='reports/research/current.md';
  const manifest=history.buildHistoryRetentionManifest({keepPaths:[keep],aliases:{[old]:keep},allowedBlobIds:{[keep]:['current-blob']},indexes:[{files:{[old]:{stored:'archive/old.gz',sha256:'old'}}}]});
  assert.ok(manifest.keepPaths.includes(old));
  assert.deepEqual(manifest.allowedBlobIds[old],['current-blob']);
  assert.ok(history.filterHistoryIndex({files:{[old]:{stored:'archive/old.gz',sha256:'old'}}},manifest).files[old]);
  for(const path of ['../outside','C:/outside','a/../b','/root'])assert.throws(()=>history.buildHistoryRetentionManifest({keepPaths:[path],indexes:[]}),/path/i);
  assert.throws(()=>history.buildHistoryRetentionManifest({keepPaths:[keep],currentOnly:{missing:['a']},indexes:[]}),/retained/i);
});
