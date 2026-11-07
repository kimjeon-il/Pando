import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:child_process";
import * as __dep2 from "node:fs/promises";
import * as __dep3 from "node:path";
import * as __dep4 from "node:util";
import * as __dep5 from "node:test";
import * as __dep6 from "../helpers/hydro-source-fixture.mjs";
import * as __dep7 from "../../tools/gis/hydro-manifest-fingerprint.mjs";
import * as __dep8 from "../../tools/gis/hydro-repair-pipeline.mjs";

// Original feature contract: hydro-repair-cli.test.mjs
contractSuite("hydro-repair-cli", () => {
const assert = __dep0.default;
const { execFile } = __dep1;
const { readFile } = __dep2;
const { join, resolve } = __dep3;
const { promisify } = __dep4;
const test = __dep5.default;
const { hydroSourceFixture } = __dep6;
const { hydroBaselineFingerprintFromDocument } = __dep7;

const exec=promisify(execFile);
test('Hydro repair CLI writes a new decoded-verifiable pack and preserves existing outputs',{
  skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY||!process.env.PANDO_HYDRO_ENCODING_DIRECTORY,
},async t=>{
  const {root,input}=await hydroSourceFixture(t),output=join(root,'new-pack'),report=join(root,'new-report.json');
  const args=[resolve('tools/repair-hydro-connectivity.mjs'),'--baseline',input,'--sources',root,'--output',output,'--report',report];
  const result=JSON.parse((await exec(process.execPath,args,{windowsHide:true})).stdout);
  assert.equal(result.changedFeatures,1);assert.equal(result.features,3);
  const receipt=JSON.parse(await readFile(report,'utf8')),manifest=JSON.parse(await readFile(join(output,'manifest.json'),'utf8'));
  assert.equal(receipt.baselineManifestFingerprint,hydroBaselineFingerprintFromDocument(await readFile(input,'utf8')));
  assert.equal(receipt.serializedVerification.remaining,0);assert.equal(manifest.container,undefined);
  const staged=join(root,'decoded.json');await exec(process.execPath,[resolve('tools/decode-hydro-connectivity.mjs'),output,staged],{windowsHide:true});
  await exec(process.execPath,[resolve('tools/verify-hydro-connectivity.mjs'),'--baseline',input,'--staged',staged,'--sources',root,'--report',report],{windowsHide:true});
  const before=await readFile(join(output,'manifest.json')),reportBefore=await readFile(report);
  await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/exist|overwrite/i);
  assert.deepEqual(await readFile(join(output,'manifest.json')),before);assert.deepEqual(await readFile(report),reportBefore);
});
});

// Original feature contract: hydro-repair-pipeline.test.mjs
contractSuite("hydro-repair-pipeline", () => {
const assert = __dep0.default;
const { readFile } = __dep2;
const test = __dep5.default;
const { buildVerifiedHydroRepair } = __dep8;

test('pinned source, repair, encoding, pack and production decoder preserve the staged Hydro result',{
  skip:!process.env.PANDO_HYDRO_ENCODING_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async()=>{
  const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/spec.json','utf8'));
  const lines=[{fid:1,source:'101',points:[[0,0],[.999,0]],bounds:[0,0,999000,0]},
    {fid:2,source:'102',points:[[1,0],[2,0]],bounds:[1000000,0,2000000,0]},
    {fid:3,source:'103',points:[[0,1],[1,0]],bounds:[0,0,1000000,1000000]}];
  const features=lines.map(row=>({metadata:{fid:row.fid,logicalFid:row.fid+100,awId:'river:'+row.fid,name:'River '+row.fid,
    sourceId:row.source,source:'fixture',layerId:'fixture',category:'river',bounds:row.bounds,stage:0,flags:0,
    fragmentIndex:0,fragmentCount:1,width:1.25,systemId:'s'},geometry:{type:'LineString',coordinates:row.points},widths:[[1,1]]}));
  const baseline={manifest:{stages:Array.from({length:4},(_,id)=>({id,minZoom:6+id}))},features},before=structuredClone(baseline);
  const archives=[{archive:'tests/fixtures/hydro-source/fixture.zip',specification}];
  const result=await buildVerifiedHydroRepair({baseline,archives},{connectivityDirectory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
    encodingDirectory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  assert.deepEqual(baseline,before);assert.deepEqual(result.plan.changedFeatureIds,[1]);
  assert.equal(result.verification.features,3);assert.equal(result.verification.remaining,0);
  assert.equal(result.pack.stats.featureCount,3);assert(result.pack.files.has('index.bin.gz'));
  const wrong=structuredClone(specification);wrong.files[0].sha256='0'.repeat(64);
  await assert.rejects(buildVerifiedHydroRepair({baseline,archives:[{archive:archives[0].archive,specification:wrong}]},
    {connectivityDirectory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,encodingDirectory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY}),/hash/i);
  assert.deepEqual(baseline,before);
  const controller=new AbortController();controller.abort();
  await assert.rejects(buildVerifiedHydroRepair({baseline,archives},{signal:controller.signal}),/abort/i);
});
});

// Original feature contract: hydro-staged-cli.test.mjs
contractSuite("hydro-staged-cli", () => {
const assert = __dep0.default;
const { execFile } = __dep1;
const { readFile, writeFile } = __dep2;
const { resolve } = __dep3;
const { promisify } = __dep4;
const test = __dep5.default;
const { hydroSourceFixture } = __dep6;

const exec=promisify(execFile);
test('Hydro verification CLI reads pinned regional ZIPs and updates only the verified report',{
  skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async t=>{
  const {root,staged,input,output,receipt}=await hydroSourceFixture(t);
  const args=[resolve('tools/verify-hydro-connectivity.mjs'),'--baseline',input,'--staged',output,'--sources',root,'--report',receipt];
  const result=await exec(process.execPath,args,{windowsHide:true});
  const verification=JSON.parse(result.stdout);assert.equal(verification.features,3);assert.equal(verification.remaining,0);
  const saved=JSON.parse(await readFile(receipt,'utf8'));assert.deepEqual(saved.serializedVerification,verification);
  staged.features[2].geometry.coordinates[0]=[0,2];await writeFile(output,JSON.stringify(staged));
  const before=await readFile(receipt);await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/geometry/i);
  assert.deepEqual(await readFile(receipt),before);
});
});

// Original feature contract: hydro-audit-cli.test.mjs
contractSuite("hydro-audit-cli", () => {
const assert = __dep0.default;
const { execFile } = __dep1;
const { readFile } = __dep2;
const { join, resolve } = __dep3;
const { promisify } = __dep4;
const test = __dep5.default;
const { hydroSourceFixture } = __dep6;
const { hydroBaselineAuditFingerprintFromDocument } = __dep7;

const exec=promisify(execFile);
test('Hydro audit CLI verifies all source regions and refuses to overwrite reports',{
  skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async t=>{
  const {root,input}=await hydroSourceFixture(t),report=join(root,'audit.json');
  const args=[resolve('tools/audit-hydro-connectivity.mjs'),'--baseline',input,'--sources',root,'--report',report];
  const output=JSON.parse((await exec(process.execPath,args,{windowsHide:true})).stdout),saved=JSON.parse(await readFile(report,'utf8'));
  assert.deepEqual(output,saved.regions);assert.equal(saved.regions.eu.repairable,1);
  assert.deepEqual(saved.issues.map(row=>row.source),[101]);
  assert.equal(saved.baselineManifestSha256,hydroBaselineAuditFingerprintFromDocument(await readFile(input,'utf8')));
  const before=await readFile(report);await assert.rejects(exec(process.execPath,args,{windowsHide:true}),/exist|overwrite/i);
  assert.deepEqual(await readFile(report),before);
});
});
