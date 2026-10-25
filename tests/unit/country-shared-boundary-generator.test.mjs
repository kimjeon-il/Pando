import {repositoryFrontendUrl} from '../helpers/frontend-source.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { gzipSync, gunzipSync } from 'node:zlib';

const worldBundle = JSON.parse(fs.readFileSync(new URL('../../assets/data/world/current.json', import.meta.url), 'utf8'));
const archiveName = worldBundle.compatibility.sharedBoundaries.preview;
const archive = fs.readFileSync(repositoryFrontendUrl(`assets/data/${archiveName}`));
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

test('offline source and browser packet share compiled grouping, phase and seam rules', async () => {
  const {prepareCountrySharedBoundaryPacket}=await import(
    "../../shared/frontend/js/modules/country-shared-boundary-packet.js");
  const sources=[
    {start:[179.8,30],end:[-179.8,30],ownerIds:['E','W']},
    {start:[0,0],end:[0,.25],ownerIds:['A','B']},
    {start:[0,.25],end:[0,.5],ownerIds:['A','B']},
    {start:[180,10],end:[180,20],ownerIds:['C','D']},
  ];
  const original=structuredClone(sources);
  const packet=prepareCountrySharedBoundaryPacket(sources,[],{maxEdgeDegrees:2});
  assert.deepEqual(packet.ownerIds,['A','B','E','W']);
  assert.deepEqual(packet.ownerRanges,{
    'A|B':{first:0,count:2},'E|W':{first:2,count:2},
  });
  assert.equal(packet.segments.length,4);
  assert.ok(packet.startsEnds instanceof Float32Array);
  assert.ok(packet.chainPhase instanceof Float32Array);
  assert.deepEqual([...packet.chainPhase].slice(0,3),[0,.25,0]);
  assert.ok(packet.chainPhase[3]>0);
  assert.equal(packet.segments[2].end[0],180);
  assert.equal(packet.segments[3].start[0],-180);
  assert.deepEqual(sources,original,'render packet assembly must not edit source data');
});
