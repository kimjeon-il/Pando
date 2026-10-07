import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { verifyGzipAssetBytes } from '../../scripts/lib/gzip-asset-verification.mjs';

test('gzip validation accepts alternate compression but retains stored integrity bytes', () => {
  const raw = Buffer.from('[1.23456789012345,2,3]'.repeat(100));
  const existing = gzipSync(raw, { level: 1 });
  const generated = gzipSync(raw, { level: 9 });
  assert.notDeepEqual(existing, generated);
  assert.equal(verifyGzipAssetBytes(existing, generated, 'fixture'), existing);
});

test('gzip validation rejects exact coordinate and array-order differences', () => {
  const existing = gzipSync('[1.23456789012345,2,3]');
  for (const value of ['[1.23456789012346,2,3]', '[2,1.23456789012345,3]']) {
    assert.throws(() => verifyGzipAssetBytes(existing, gzipSync(value), 'fixture'), /decoded generated asset differs/);
  }
});

test('gzip validation rejects missing and corrupt transport bytes', () => {
  const generated = gzipSync('valid');
  assert.throws(() => verifyGzipAssetBytes(null, generated, 'fixture'), /missing/);
  assert.throws(() => verifyGzipAssetBytes(Buffer.from('corrupt'), generated, 'fixture'));
  assert.throws(() => verifyGzipAssetBytes(generated, Buffer.from('corrupt'), 'fixture'));
});
