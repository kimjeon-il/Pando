import test from 'node:test';
import assert from 'node:assert/strict';
import * as libraryData from '../../tools/library-data.mjs';

const expectedRevision = 'a'.repeat(40);
const otherRevision = 'b'.repeat(40);

test('expected revision guard rejects malformed revisions', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  for (const invalid of ['', 'a'.repeat(39), 'a'.repeat(41), 'g'.repeat(40), null, 123]) {
    assert.throws(() => libraryData.assertExpectedLibraryRevision({ expectedRevision: invalid, head: invalid, remote: invalid }), /40.*hex/i);
  }
});

test('expected revision guard rejects a changed checkout HEAD', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.throws(() => libraryData.assertExpectedLibraryRevision({ expectedRevision, head: otherRevision, remote: expectedRevision }), /checkout HEAD.*expected revision/i);
});

test('expected revision guard rejects a changed remote publication branch', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.throws(() => libraryData.assertExpectedLibraryRevision({ expectedRevision, head: expectedRevision, remote: otherRevision }), /remote work\/gis.*expected revision/i);
});

test('expected revision guard permits identical checkout and remote revisions', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.doesNotThrow(() => libraryData.assertExpectedLibraryRevision({ expectedRevision, head: expectedRevision, remote: expectedRevision }));
});

test('omitted expected revision preserves unguarded storage behavior', () => {
  assert.equal(typeof libraryData.assertExpectedLibraryRevision, 'function');
  assert.doesNotThrow(() => libraryData.assertExpectedLibraryRevision({ head: otherRevision, remote: expectedRevision }));
});

test('storeLibraryData rejects malformed expected revision before preparing storage', () => {
  assert.throws(() => libraryData.storeLibraryData({ root: new URL('./missing-library-root/', import.meta.url).pathname, prefixes: ['assets/data'], expectedRevision: 'invalid' }), /40.*hex/i);
});

test('expected branch permits explicit main and rejects arbitrary or mismatched branch',()=>{
 assert.doesNotThrow(()=>libraryData.assertExpectedLibraryRevision({expectedRevision,expectedBranch:'main',branch:'main',head:expectedRevision,remote:expectedRevision}));
 assert.throws(()=>libraryData.assertExpectedLibraryRevision({expectedRevision,expectedBranch:'evil',head:expectedRevision,remote:expectedRevision}),/branch/i);
 assert.throws(()=>libraryData.assertExpectedLibraryRevision({expectedRevision,expectedBranch:'main',branch:'work/gis',head:expectedRevision,remote:expectedRevision}),/branch/i);
});
