import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import test from 'node:test';
import {hydroSourceFixture} from '../helpers/hydro-source-fixture.mjs';

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
