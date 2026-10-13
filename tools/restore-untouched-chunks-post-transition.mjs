/**
 * Preserve bit-for-bit all 278 unmodified gzip catalog blobs when regenerating
 * the three changed country chunks. Git sources are pinned to pre-repair SHA.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const base='f1f9a53b1535024c9a3c207a127f2e8393619bf8';
const indexPath='assets/data/territorial-entities/generated/v2/index.json';
const old=JSON.parse(execFileSync('git',['show',base+':'+indexPath],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
const index=JSON.parse(fs.readFileSync(path.join(root,indexPath),'utf8'));
const unchanged=new Map(old.entities.map(e=>[e.entityId,e]));
const changed=new Set(['state:SDN','state:SDS','state:UKR']);
const files=[];
assert.equal(old.entities.length,281);
assert.equal(index.entities.length,281);
assert.equal(index.entities.reduce((n,e)=>n+e.geometryVersionCount,0),290);
assert.equal(index.lineages.length,262);
for(const e of index.entities){
 if(changed.has(e.entityId)){
  assert.equal(e.geometryVersionCount,e.entityId==='state:SDS'?2:3);
  continue;
 }
 const before=unchanged.get(e.entityId);
 assert.ok(before,'Missing unchanged ID '+e.entityId);
 for(const key of ['geometryVersionCount','decodedBytes','bbox','geometryVersions','lifetime','sourceInfo','names','parentEntityId']){
  assert.deepEqual(e[key],before[key],'Unchanged metadata '+e.entityId+' '+key);
 }
 e.compressedBytes=before.compressedBytes;
 e.sha256=before.sha256;
 files.push('assets/data/territorial-entities/generated/v2/'+e.file);
}
assert.equal(files.length,278);
execFileSync('git',['restore','--source='+base,'--',...files],{cwd:root,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(root,indexPath),JSON.stringify(index,null,2)+'\n');
console.log('Byte-identical restoration: 278 untouched gzip chunks; retained 3 new country chunks');
