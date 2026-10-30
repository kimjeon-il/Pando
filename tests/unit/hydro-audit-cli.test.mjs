import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {hydroSourceFixture} from '../helpers/hydro-source-fixture.mjs';
import {hydroBaselineAuditFingerprintFromDocument} from '../../tools/gis/hydro-manifest-fingerprint.mjs';

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
