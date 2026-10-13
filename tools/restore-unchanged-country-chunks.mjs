/**
 * Restore byte-identical compressed country chunks from the pinned pre-merge
 * baseline, while preserving the three newly consolidated chunks.
 * One-time deterministic repair; never changes decoded geometries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const base = '98484d20d9c075b273d1d2e5a9cd975e2c16e2dd';
const indexPath = 'assets/data/territorial-entities/generated/v2/index.json';
const oldIndex = JSON.parse(execFileSync('git', ['show', base + ':' + indexPath], {cwd:root,maxBuffer:4*1024*1024,encoding:'utf8'}));
const index = JSON.parse(fs.readFileSync(path.join(root,indexPath),'utf8'));
const exempt = new Set(['state:IDN','state:UKR','state:SDN']);
const prior = new Map(oldIndex.entities.map(e=>[e.entityId,e]));
assert.equal(index.entities.length,281);
const restored = [];
for (const e of index.entities) {
  if (exempt.has(e.entityId)) {
    assert.equal(e.geometryVersions.length,2);
    continue;
  }
  const old = prior.get(e.entityId);
  assert.ok(old,'Missing pre-merge entity: '+e.entityId);
  assert.equal(e.geometryVersionCount,old.geometryVersionCount);
  assert.deepEqual(e.lifetime,old.lifetime);
  assert.deepEqual(e.bbox,old.bbox);
  assert.deepEqual(e.geometryVersions,old.geometryVersions);
  assert.equal(e.decodedBytes,old.decodedBytes);
  e.compressedBytes=old.compressedBytes;
  e.sha256=old.sha256;
  restored.push('assets/data/territorial-entities/generated/v2/'+old.file);
}
assert.equal(restored.length,278);
execFileSync('git',['restore','--source='+base,'--',...restored],{cwd:root,maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(root,indexPath),JSON.stringify(index,null,2)+'\n');
console.log('Restored 278 unchanged compressed chunks from '+base.slice(0,12)+'; kept 3 consolidated chunks');
