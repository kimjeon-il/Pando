import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { terrainTileRequest, fetchTerrainTile } from '../../../src/data/terrain-manifest.js';

const revision = 'f26d0896ab393aa351938637571347baa09ebf71';
const body = Buffer.from('immutable terrain tile');
const sha256 = createHash('sha256').update(body).digest('hex');
const manifest = {version:'0.13.3', urlTemplate:'terrain/v0.13.3/{level}/{column}-{row}.webp',
  assetsSha256:'abc', packaging:{sourceRevision:revision,sourcePath:'terrain/v0.13.3/manifest.json'},
  tiles:{'5/13-4.webp':{bytes:body.length,sha256}}};
const spec = {level:5,column:13,row:4}, externalSource = {revision};

test('terrain request selects either local files or the fixed source with an integrity receipt', () => {
  const local = terrainTileRequest(spec, manifest, {manifestUrl:'http://localhost/assets/data/terrain/v0.13.3/manifest.json'});
  assert.equal(local.url.origin, 'http://localhost');
  const request = terrainTileRequest(spec, manifest, {externalSource});
  assert.equal(request.url.href, `https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/${revision}/terrain/v0.13.3/5/13-4.webp`);
  assert.equal(request.sha256, sha256);
  assert.throws(() => terrainTileRequest({...spec,column:-1}, manifest, {externalSource}));
  assert.throws(() => terrainTileRequest({...spec,row:5}, manifest, {externalSource}));
  assert.throws(() => terrainTileRequest(spec, manifest, {externalSource:{revision:'0'.repeat(40)}}));
});

test('tile download rejects HTTP failures, wrong lengths, and corrupt bytes before decoding', async () => {
  const request = terrainTileRequest(spec, manifest, {externalSource});
  const response = bytes => async () => new Response(bytes);
  assert.deepEqual(Buffer.from(await (await fetchTerrainTile(request,{fetchFn:response(body)})).arrayBuffer()), body);
  await assert.rejects(fetchTerrainTile(request,{fetchFn:async()=>new Response('',{status:404})}), /HTTP 404/);
  await assert.rejects(fetchTerrainTile(request,{fetchFn:response(body.subarray(1))}), /크기/);
  await assert.rejects(fetchTerrainTile(request,{fetchFn:response(Buffer.alloc(body.length))}), /해시/);
});


test('v0.14.0 uses the new fixed source release without a second tile format', () => {
  const nextRevision='0866eb0aebb35d1355892b808de331b30c5fe52b';
  const next = {
    ...manifest,version:'0.14.0',
    urlTemplate:'terrain/v0.14.0/{level}/{column}-{row}.webp',
    packaging:{sourceRevision:nextRevision,sourcePath:'terrain/v0.14.0/manifest.json'},
  };
  const request=terrainTileRequest(spec,next,{externalSource:{revision:nextRevision}});
  assert.equal(request.url.href,
    'https://raw.githubusercontent.com/kimjeon-il/PandoLab-library-data/0866eb0aebb35d1355892b808de331b30c5fe52b/terrain/v0.14.0/5/13-4.webp');
  assert.deepEqual([request.bytes,request.sha256],[body.length,sha256]);
  assert.throws(()=>terrainTileRequest(spec,{...next,packaging:{...next.packaging,sourcePath:'terrain/v0.13.3/manifest.json'}},{externalSource:{revision:nextRevision}}));
});
