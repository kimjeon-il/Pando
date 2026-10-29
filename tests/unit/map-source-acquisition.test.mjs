import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { acquire } from '../../plugins/pando-map-tools/lib/map-source.mjs';

const png = Buffer.from('89504e470d0a1a0a6d6170', 'hex');
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const source = overrides => ({ id:'seed', url:'https://example.test/map', format:'png', rightsReviewed:true,
  license:'CC0', maximumBytes:100, expectedBytes:png.length, sha256:hash('sha256',png), ...overrides });
const response = bytes => async () => new Response(bytes, {status:200});
async function folder(fn) { const dir = await mkdtemp(join(tmpdir(),'pando-source-test-')); try { await fn(dir); } finally { await rm(dir,{recursive:true,force:true}); } }

test('preserves source bytes and provenance and reuses the verified original', async () => folder(async dir => {
  const first = await acquire(source({published:'2024'}),dir,{fetcher:response(png)});
  assert.equal(first.status,'acquired-unlabelled');
  assert.deepEqual(await readFile(first.path),png);
  const provenance = JSON.parse(await readFile(first.provenancePath,'utf8'));
  assert.equal(provenance.published,'2024'); assert.equal(provenance.trainingReady,false);
  assert.equal((await acquire(source(),dir,{fetcher:()=>{throw Error('unexpected download');}})).status,'verified-existing');
  await assert.rejects(acquire(source({sha256:'0'.repeat(64)}),dir),/pinned|differs/i);
  assert.deepEqual(await readFile(first.path),png);
}));

test('rejects unreviewed rights, insecure redirects, bad formats and budgets without touching other files', async () => folder(async dir => {
  assert.equal((await acquire({id:'hold',rightsReviewed:false},dir)).status,'rights-unverified');
  await writeFile(join(dir,'other.part'),'protected');
  await assert.rejects(acquire(source({url:'http://example.test'}),dir,{fetcher:response(png)}),/HTTPS/);
  await assert.rejects(acquire(source(),dir,{fetcher:async()=>new Response(null,{status:302,headers:{location:'http://example.test/insecure'}})}),/HTTPS/);
  await assert.rejects(acquire(source({expectedBytes:undefined,sha256:undefined,maximumBytes:3}),dir,{fetcher:response(png)}),/budget/);
  await assert.rejects(acquire(source({expectedBytes:undefined,sha256:undefined}),dir,{fetcher:response(Buffer.from('html'))}),/PNG/);
  assert.deepEqual(await readdir(dir),['other.part']);
}));

test('honors cancellation and preserves unfamiliar partial files', async () => folder(async dir => {
  await writeFile(join(dir,'seed.png.part'),'other process');
  await assert.rejects(acquire(source(),dir,{fetcher:response(png)}),/exist/i);
  assert.equal(await readFile(join(dir,'seed.png.part'),'utf8'),'other process');
  const controller = new globalThis.AbortController(); controller.abort();
  await assert.rejects(acquire(source({id:'cancelled'}),dir,{signal:controller.signal,fetcher:response(png)}));
  assert.deepEqual(await readdir(dir),['seed.png.part']);
}));

test('recognizes all supported original formats and verifies depositor checksums', async () => folder(async dir => {
  for(const [format,bytes] of [['pdf',Buffer.from('%PDF-1.7\n')],['jpeg',Buffer.from([0xff,0xd8,0x01])],['webp',Buffer.from('RIFF1234WEBP')]]) {
    const spec=source({id:format,format,sha256:hash('sha256',bytes),md5:hash('md5',bytes),expectedBytes:bytes.length});
    const result=await acquire(spec,dir,{fetcher:response(bytes)});
    assert.deepEqual(await readFile(result.path),bytes);
    assert.equal((await acquire(spec,dir)).status,'verified-existing');
  }
  await assert.rejects(acquire(source({id:'bad-hash',md5:'wrong'}),dir,{fetcher:response(png)}),/checksum/);
  assert.ok(!(await readdir(dir)).some(path=>path.startsWith('bad-hash')));
}));

test('catalog CLI holds unreviewed sources and refuses application worktree output', async () => folder(async dir => {
  const cli=fileURLToPath(new URL('../../tools/reference-analysis/acquire-sources.mjs',import.meta.url));
  const catalog=join(dir,'catalog.json');
  await writeFile(catalog,JSON.stringify({schemaVersion:1,sources:[{id:'pending',rightsReviewed:false}]}));
  const output=execFileSync(process.execPath,[cli,'--catalog',catalog,'--output',join(dir,'out')],{encoding:'utf8'});
  assert.deepEqual(JSON.parse(output),{id:'pending',status:'rights-unverified'});
  assert.throws(()=>execFileSync(process.execPath,[cli,'--catalog',catalog,'--output',fileURLToPath(new URL('../../private-input',import.meta.url))],{stdio:'pipe'}),/Command failed/);
}));

test('a concurrently created original is never overwritten and the unfinished sidecar is removed', async () => folder(async dir => {
  await assert.rejects(acquire(source(),dir,{fetcher:async()=>{
    await writeFile(join(dir,'seed.png'),'concurrent original');
    return new Response(png,{status:200});
  }}),/exist/i);
  assert.equal(await readFile(join(dir,'seed.png'),'utf8'),'concurrent original');
  assert.deepEqual(await readdir(dir),['seed.png']);
}));

test('map CLI invokes the Node source owner and holds a source with unverified rights',
  {skip:!process.env.PANDO_MAP_PYTHON},async()=>folder(async dir=>{
    const sourcePath=join(dir,'source.json'),jobPath=join(dir,'job.json');
    await writeFile(sourcePath,JSON.stringify({id:'unreviewed',rightsReviewed:false}));
    const cli=fileURLToPath(new URL('../../plugins/pando-map-tools/scripts/map.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[cli,'analyze','--source',sourcePath,'--job',jobPath],{encoding:'utf8',env:process.env});
    assert.equal(result.status,1,result.stderr);
    const errors=result.stderr.trim().split(/\r?\n/).map(line=>JSON.parse(line));
    assert(errors.some(row=>row.phase==='source'&&row.status==='acquiring'));
    assert(errors.some(row=>row.code==='PL-MAP-SOURCE'&&/rights-unverified/.test(row.message)));
    assert.deepEqual(await readdir(dir),['source.json']);
  }));
