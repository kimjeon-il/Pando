import { describe as contractSuite } from 'node:test';
import * as __dem_dep0 from "node:test";
import * as __dem_dep1 from "node:assert/strict";
import * as __dem_dep2 from "node:crypto";
import * as __dem_dep3 from "../../tools/check-terrain-preview.mjs";
import * as __dem_dep4 from "node:fs/promises";
import * as __dem_dep5 from "node:os";
import * as __dem_dep6 from "node:path";
import * as __dem_dep7 from "../../tools/gis/terrain-preview-sources.mjs";

// Original feature contract: terrain-preview-audit.test.mjs
contractSuite("terrain-preview-audit", () => {
const test = __dem_dep0.default;
const assert = __dem_dep1.default;
const { createHash } = __dem_dep2;
const { validatePreviewCorpus } = __dem_dep3;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = ['0/0-0.webp', '0/1-0.webp', ...[0, 1].flatMap(row => [0, 1, 2].map(column => `1/${column}-${row}.webp`))];
const dem = { version: '0.13.3', assetsSha256: hash('DEM'), tint: { sha256: hash('tint') } };
const landMaskSha256 = hash('land mask');
function fixture() {
  const files = new Map(paths.map(path => [path, Buffer.from(path)]));
  const digest = createHash('sha256');
  const tiles = Object.fromEntries([...files].map(([path, bytes]) => {
    const pin = { bytes: bytes.length, sha256: hash(bytes) };
    digest.update(path + '\0').update(Buffer.from(pin.sha256, 'hex'));
    return [path, pin];
  }));
  const manifest = { version: '0.13.3-p2', representation: 'raster-rgba-v1', levels: [{ id: 0 }, { id: 1 }], gutter: 1,
    tiles, assetsSha256: digest.digest('hex'), sourceDem: { version: dem.version, assetsSha256: dem.assetsSha256,
      tintSha256: dem.tint.sha256, landMaskSha256 } };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  return { manifest, files };
}
const verify = ({ manifest, files }, source = dem, land = landMaskSha256) => validatePreviewCorpus(manifest, files, source, land);

test('Web preview validates tile bytes and pinned DEM sources without an app mirror', () => {
  assert.deepEqual(verify(fixture()).errors, []);
});
test('preview corruption and missing files cannot pass', () => {
  const input = fixture();input.files.set('0/0-0.webp', Buffer.from('altered'));
  assert.ok(verify(input).errors.some(error => error.includes('0/0-0.webp')));
  input.files.delete('0/0-0.webp');assert.ok(verify(input).errors.some(error => error.includes('inventory')));
});
test('changed DEM, tint and land-mask pins cannot pass', () => {
  for (const source of [{ ...dem, version: 'changed' }, { ...dem, assetsSha256: hash('changed') },
    { ...dem, tint: { sha256: hash('changed') } }])
    assert.ok(verify(fixture(), source).errors.some(error => error.includes('source pin')));
  assert.ok(verify(fixture(), dem, hash('changed')).errors.some(error => error.includes('source pin')));
});

test('manifest corruption and undeclared tiles cannot pass', () => {
  const input = fixture();input.files.set('manifest.json', Buffer.from('{}'));
  assert.ok(verify(input).errors.some(error => error.includes('manifest bytes')));
  input.files.set('2/0-0.webp', Buffer.from('extra'));
  assert.ok(verify(input).errors.some(error => error.includes('inventory')));
});
});

// Original feature contract: terrain-preview-sources.test.mjs
contractSuite("terrain-preview-sources", () => {
const assert = __dem_dep1.default;
const { createHash } = __dem_dep2;
const { mkdtemp, readFile, rm, writeFile } = __dem_dep4;
const { tmpdir } = __dem_dep5;
const { join } = __dem_dep6;
const test = __dem_dep0.default;
const { readPinnedTerrainAsset, validateTerrainPreviewSources } = __dem_dep7;

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('terrain preview source contract rejects duplicate or mismatched pins',()=>{
  const countries=Buffer.from('{"type":"FeatureCollection","features":[]}'),bytes=Buffer.from('tint'),digest=sha(bytes);
  const dem={version:'0.13.3',representation:'dem-relief-v1',levels:[{id:0,rows:1,columns:1},{id:1,rows:1,columns:1}],tint:{sha256:digest}};
  const inventory={assets:['terrain/v0.13.0/0/0-0.webp','terrain/v0.13.0/1/0-0.webp','terrain/v0.13.3/tint.webp']
    .map(path=>({path,bytes:bytes.length,sha256:digest}))};
  const source={dem,inventory,countryBytes:countries,landMaskSha256:sha(countries)};
  assert.equal(validateTerrainPreviewSources(source).assets.size,3);
  const duplicated=structuredClone(inventory);duplicated.assets.push(duplicated.assets[0]);
  assert.throws(()=>validateTerrainPreviewSources({...source,inventory:duplicated}),/pins/i);
  assert.throws(()=>validateTerrainPreviewSources({...source,landMaskSha256:'0'.repeat(64)}),/mask/i);
  const changed=structuredClone(dem);changed.tint.sha256='0'.repeat(64);
  assert.throws(()=>validateTerrainPreviewSources({...source,dem:changed}),/tint/i);
});
test('pinned terrain cache verifies bytes and refuses changes or path escape',async t=>{
  const cache=await mkdtemp(join(tmpdir(),'pando-terrain-cache-'));t.after(()=>rm(cache,{recursive:true}));
  const body=Buffer.from('source bytes'),spec={bytes:body.length,sha256:sha(body)},path='terrain/0.webp',url='https://example.test/source';
  let requests=0;const fetcher=async()=>{requests++;return new Response(body);};
  assert.deepEqual(await readPinnedTerrainAsset({cache,path,url,spec,fetcher}),body);
  assert.deepEqual(await readPinnedTerrainAsset({cache,path,url,spec,fetcher}),body);assert.equal(requests,1);
  await writeFile(join(cache,path),'changed');await assert.rejects(readPinnedTerrainAsset({cache,path,url,spec,fetcher}),/differs/i);
  assert.equal(await readFile(join(cache,path),'utf8'),'changed');
  await assert.rejects(readPinnedTerrainAsset({cache,path:'../outside',url,spec,fetcher}),/scope|path/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(readPinnedTerrainAsset({cache,path:'other.webp',url,spec,fetcher,signal:controller.signal}),/abort/i);
});
});
