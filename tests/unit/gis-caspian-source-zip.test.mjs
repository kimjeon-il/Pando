import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {zipFixture} from '../helpers/geonames-fixtures.mjs';
import {digest} from '../../tools/gis/verify-historical-linework.mjs';
import {MEMBER,ARCHIVE_SHA,MEMBER_SHA,approvedNetworkBytes}
 from '../../tools/gis/verify-approved-caspian-network.mjs';
const polygonLines={type:'FeatureCollection',features:[
 {type:'Feature',id:'1',properties:{hybrid_role:'NOT_COAST'},
  geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},
 {type:'Feature',id:'2',properties:{hybrid_role:'NE_reuse'},
  geometry:{type:'LineString',coordinates:[[1,0],[2,0]]}},
]};
test('reviewed network extraction checks outer ZIP SHA and inner GeoJSON member digest/CRC',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'caspian-zip-fixture-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const bytes=zipFixture(MEMBER,JSON.stringify(polygonLines),{deflate:true});
 const path=join(dir,'approved.zip');
 writeFileSync(path,bytes);
 const expectedArchiveSha=digest(bytes);
 const expectedMemberSha=digest(Buffer.from(JSON.stringify(polygonLines)));
 const data=await approvedNetworkBytes(path,{
   expectedArchiveSha,expectedMemberSha,expectedFeatures:2,
 });
 assert.equal(data.features,2);
 assert.deepEqual(data.bytes,Buffer.from(JSON.stringify(polygonLines)));
 assert.equal(data.zipSha256,expectedArchiveSha);
 assert.equal(data.memberSha256,expectedMemberSha);
 assert.deepEqual(readFileSync(path),bytes);
 await assert.rejects(approvedNetworkBytes(path,{
   expectedArchiveSha:'0'.repeat(64),expectedMemberSha,expectedFeatures:2,
 }),/ZIP SHA-256 mismatch/);
 await assert.rejects(approvedNetworkBytes(path,{
   expectedArchiveSha,expectedMemberSha:'0'.repeat(64),expectedFeatures:2,
 }),/network SHA-256 mismatch/);
});
test('historical network shape and CRC errors cannot be accepted as an empty proof',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'caspian-zip-bad-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const bytes=zipFixture(MEMBER,JSON.stringify(polygonLines),{corruptCrc:true});
 const path=join(dir,'incorrect.zip');
 writeFileSync(path,bytes);
 await assert.rejects(approvedNetworkBytes(path,{
  expectedArchiveSha:digest(bytes),
  expectedMemberSha:digest(Buffer.from(JSON.stringify(polygonLines))),
  expectedFeatures:2,
 }),/CRC/);
 const good=zipFixture(MEMBER,JSON.stringify(polygonLines));
 writeFileSync(path,good);
 await assert.rejects(approvedNetworkBytes(path,{
  expectedArchiveSha:digest(good),
  expectedMemberSha:digest(Buffer.from(JSON.stringify(polygonLines))),
  expectedFeatures:266,
 }),/266-segment topology/);
});
test('the production Caspian receipts and source member are immutable literal contracts',()=>{
 assert.equal(ARCHIVE_SHA,'3df45ab6e7d3a4b1dfac42b29f28cc1c932c3b1be9f866ccd7df6bb769b9a5b4');
 assert.equal(MEMBER_SHA,'f6fce5c05021ae8fa080d8bf350a73aa1f4d4e1016e2a1dfffcc49809fc7361e');
 assert.ok(MEMBER.endsWith('waterbody-boundary-network.geojson'));
});
