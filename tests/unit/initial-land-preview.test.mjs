import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {createInitialLandPreviewAsset,simplifyInitialLandGeometry} from '../../scripts/lib/initial-land-preview.mjs';

const outer=[[0,0],[0,1],[0.1,1],[0.2,1],[1,1],[1,0],[0,0]];
const island=[[2,2],[2,2.1],[2.1,2.1],[2.1,2],[2,2]];
const hole=[[0.2,0.2],[0.4,0.2],[0.4,0.4],[0.2,0.4],[0.2,0.2]];
const source={type:'MultiPolygon',coordinates:[[outer,hole],[island]]};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('derived geometry preserves islands, water holes, winding and source bytes',()=>{
 const original=JSON.stringify(source),out=simplifyInitialLandGeometry(source);
 assert.equal(out.polygonCount,2);assert.equal(out.ringCount,3);
 assert.deepEqual(out.geometry.coordinates.map(p=>p.length),[2,1]);
 assert.ok(out.coordinateCount<=out.sourceCoordinateCount);
 assert.equal(JSON.stringify(source),original);
 for(const polygon of out.geometry.coordinates)for(const ring of polygon){
  assert.deepEqual(ring[0],ring.at(-1));assert.ok(ring.length>=4);
 }
});

test('preview output is deterministic, content-addressed, pinned and compressed',()=>{
 const raw=Buffer.from(JSON.stringify(source)),stored=gzipSync(raw,{mtime:0,level:9});
 const asset={encoding:'gzip',compressedBytes:stored.length,decodedBytes:raw.length,sha256:sha(stored)};
 const a=createInitialLandPreviewAsset(stored,asset),b=createInitialLandPreviewAsset(stored,asset);
 assert.equal(a,b);assert.equal(a.spec.sourceSha256,asset.sha256);
 assert.equal(sha(a.bytes),a.spec.sha256);
 assert.deepEqual(JSON.parse(gunzipSync(a.bytes)),a.metrics.geometry);
 assert.match(a.spec.url,/^assets\/data\/physical-land\/preview\/v1\/[a-f0-9]{24}\.json\.gz$/);
 assert.throws(()=>createInitialLandPreviewAsset(stored,{...asset,sha256:'0'.repeat(64)}),/integrity/);
 assert.throws(()=>createInitialLandPreviewAsset(stored,{...asset,decodedBytes:raw.length+1}),/decoded size/);
});

test('malformed geometry and nonfinite coordinates never create a derivative',()=>{
 assert.throws(()=>simplifyInitialLandGeometry({type:'MultiPolygon',coordinates:[[]]}),/Empty/);
 assert.throws(()=>simplifyInitialLandGeometry({type:'MultiPolygon',coordinates:[[[[0,0],[0,1],[1,1],[2,2]]]]}),/Open/);
 assert.throws(()=>simplifyInitialLandGeometry(source,{quantileFraction:2}),/quantile/);
});
