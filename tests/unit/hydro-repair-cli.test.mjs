import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {hydroSourceFixture} from '../helpers/hydro-source-fixture.mjs';
import {hydroBaselineFingerprintFromDocument} from '../../tools/gis/hydro-manifest-fingerprint.mjs';

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
