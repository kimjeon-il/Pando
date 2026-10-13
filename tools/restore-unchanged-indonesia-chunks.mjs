/**
 * Preserve every preexisting unchanged canonical gzip blob byte-for-byte.
 * The only changed chunks are state-IDN and state-TLS; all 279 other chunks
 * are restored from the previously validated work/objects commit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const base='1519f609bd69f7e57dbdfdcec4e8036366bbd12f';
const indexPath='assets/data/territorial-entities/generated/v2/index.json';
const original=JSON.parse(execFileSync('git',['show',base+':'+indexPath],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}));
const index=JSON.parse(fs.readFileSync(path.join(root,indexPath),'utf8'));
const before=new Map(original.entities.map(e=>[e.entityId,e]));
const changed=new Set(['state:IDN','state:TLS']),files=[];
assert.equal(index.entities.length,281);
assert.equal(index.lineages.length,262);
assert.equal(index.entities.reduce((sum,e)=>sum+e.geometryVersionCount,0),294);
for(const e of index.entities){
 const old=before.get(e.entityId);
 assert.ok(old,'Missing original catalog ID '+e.entityId);
 if(changed.has(e.entityId)){
  assert.equal(e.geometryVersionCount,e.entityId==='state:IDN'?5:2);
  continue;
 }
 for(const key of ['geometryVersionCount','decodedBytes','bbox','geometryVersions','lifetime','sourceInfo','names','parentEntityId']){
  assert.deepEqual(e[key],old[key],e.entityId+' unexpected change in '+key);
 }
 e.compressedBytes=old.compressedBytes;
 e.sha256=old.sha256;
 files.push('assets/data/territorial-entities/generated/v2/'+e.file);
}
assert.equal(files.length,279);
execFileSync('git',['restore','--source='+base,'--',...files],{cwd:root,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(root,indexPath),JSON.stringify(index,null,2)+'\n');
console.log('Preserved 279 unrelated original chunk bytes, regenerated only IDN and TLS; total 294 versions');
