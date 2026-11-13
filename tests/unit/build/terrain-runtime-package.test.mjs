import test from 'node:test';
import assert from 'node:assert/strict';
import {describeTerrainRuntime} from '../../../tools/build/package-terrain-runtime.mjs';
import {terrainAssetDigest} from '../../../tools/gis/terrain-dem-assets.mjs';
const template = {
  version: '0.13.0', representation: 'dem-relief-v1', crs: 'EPSG:4326',
  extent: [-180, -90, 180, 90], registration: 'cell-center', gutter: 1,
  sourceGridOrigin: [-180, 90], sourceResolutionDegrees: [1/120, 1/120],
  tileFormat: 'lossless WebP RGBA', elevation: { decode: 'R*256+G-12000', biasMeters: 12000,
    spacingMeters: 1, validEncodedRange: [0, 65535] },
  shade: { azimuthDegrees: 315, altitudeDegrees: 45, ambient: 0.42, diffuse: 0.58, polarFallbackDegrees: 89.5 },
  channels: { r: 'encoded elevation high byte', g: 'encoded elevation low byte',
    b: 'precomputed hillshade', a: '255' },
  tint: { url: 'terrain/v0.13.3/tint.webp', width: 4096, height: 2048 },
  assetsSha256: 'abc', sources: [], urlTemplate: 'terrain/v0.13.0/{level}/{column}-{row}.webp',
  levels: Array.from({ length: 6 }, (_, id) => ({ id, width: 1350*2**id, height: 675*2**id,
    columns: Math.ceil(1350*2**id/1024), rows: Math.ceil(675*2**id/1024), tileSize: 1024 })),
};

test('existing numerical DEM receives local addresses and verified tile receipts without tint copying',async()=>{
 const source=structuredClone(template),tile={bytes:12,sha256:'a'.repeat(64)},digest=terrainAssetDigest();source.tint.sha256='b'.repeat(64);
 const paths=[];for(const level of source.levels)for(let row=0;row<level.rows;row++)for(let column=0;column<level.columns;column++){
  const p=level.id+'/'+column+'-'+row+'.webp';paths.push(p);digest.add(p,tile.sha256);
 }source.assetsSha256=digest.finish(source.tint.sha256);
 const read=[],result=await describeTerrainRuntime(source,{revision:'c'.repeat(40),sourceSha256:'d'.repeat(64),readTile:async p=>{read.push(p);return tile;}});
 assert.deepEqual(read,paths);assert.deepEqual(result.levels,source.levels);assert.deepEqual(result.channels,source.channels);
 assert.equal(result.urlTemplate,'terrain/v0.13.0/{level}/{column}-{row}.webp');
 assert.equal(Object.hasOwn(result.tiles,'tint.webp'),false);assert.equal(result.packaging.sourceRevision,'c'.repeat(40));
 await assert.rejects(describeTerrainRuntime(source,{revision:'c'.repeat(40),sourceSha256:'d'.repeat(64),readTile:async()=>({...tile,sha256:'e'.repeat(64)})}),/digest differs/);
});
