import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';

const worldBundle = JSON.parse(fs.readFileSync(new URL('../../assets/data/world/current.json', import.meta.url), 'utf8'));
const archiveName = worldBundle.compatibility.sharedBoundaries.preview;
const archive = fs.readFileSync(new URL(`../../assets/data/${archiveName}`, import.meta.url));
const decoded = gunzipSync(archive);

async function checkArchive(t, replacement, { missing = false } = {}) {
  const readFile = fs.readFileSync.bind(fs);
  const exists = fs.existsSync.bind(fs);
  t.mock.method(fs, 'readFileSync', (file, ...options) =>
    String(file).endsWith(archiveName) ? replacement : readFile(file, ...options));
  t.mock.method(fs, 'existsSync', file =>
    String(file).endsWith(archiveName) && missing ? false : exists(file));
  t.mock.method(console, 'log', () => {});
  const previousArgv = process.argv;
  process.argv = [...previousArgv, '--check'];
  try {
    await import(new URL(`../../tools/build-country-shared-boundaries.mjs?case=${encodeURIComponent(t.name)}`, import.meta.url));
  } finally {
    process.argv = previousArgv;
  }
}

test('shared boundary generator accepts platform gzip headers with identical exact content', async t => {
  const otherPlatform = Buffer.from(archive);
  otherPlatform[9] = archive[9] === 3 ? 10 : 3;
  assert.equal(otherPlatform.equals(archive), false);
  assert.deepEqual(gunzipSync(otherPlatform), decoded);
  await checkArchive(t, otherPlatform);
});

test('shared boundary generator accepts different valid DEFLATE encoding of identical exact content', async t => {
  const otherCompression = gzipSync(decoded, { level: 1 });
  assert.equal(otherCompression.subarray(10, -8).equals(archive.subarray(10, -8)), false);
  assert.deepEqual(gunzipSync(otherCompression), decoded);
  await checkArchive(t, otherCompression);
});

for (const property of ['signatures', 'segments']) {
  test(`shared boundary generator rejects stale ${property} despite valid gzip`, async t => {
    const changed = JSON.parse(decoded);
    if (property === 'signatures') changed.signatures[Object.keys(changed.signatures)[0]] = 'stale-geometry-signature';
    else changed.segments[0].start[0] += 0.01;
    await assert.rejects(checkArchive(t, gzipSync(JSON.stringify(changed))), /is stale/);
  });
}

test('shared boundary generator rejects different exact JSON bytes even for equivalent parsed data', async t => {
  await assert.rejects(checkArchive(t, gzipSync(`${decoded.toString()}\n`)), /is stale/);
});

test('shared boundary generator rejects corrupted gzip checksum', async t => {
  const corrupted = Buffer.from(archive);
  corrupted[corrupted.length - 8] ^= 1;
  await assert.rejects(checkArchive(t, corrupted), /incorrect data check/);
});

test('shared boundary generator rejects missing archives', async t => {
  await assert.rejects(checkArchive(t, archive, { missing: true }), /is stale/);
});
