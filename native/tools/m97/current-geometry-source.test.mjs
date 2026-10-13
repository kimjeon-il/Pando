import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as generator from './cut-kernel-generate.mjs';

const root=path.resolve(generator.ROOT,'..');
const current=path.join(root,'native/assets/geometry/current');
const text=file=>readFileSync(file,'utf8').replace(/\r\n/g,'\n');

test('the current Qt geometry resource pack consumes canonical Web sources',()=>{
  assert.equal(typeof generator.generateCurrent,'function');
  const generated=generator.generateCurrent(root);
  const manifest=JSON.parse(generated.get(path.join(current,'manifest.json')));
  assert.equal(manifest.schemaVersion,2);
  assert.equal(manifest.sourceOwner,'repository Web geometry modules');
  assert.equal(manifest.artifacts.filter(row=>row.kind==='cutModule').length,16);
  for(const [artifact,source] of [
    ['polygon-geometry.js','assets/js/modules/polygon-geometry.js'],
    ['polygon-clipping-calculation.js','assets/js/modules/polygon-clipping-calculation.js'],
    ['polygon-clipping.min.js','assets/js/vendor/polygon-clipping.min.js'],
    ['d3-original.min.js','assets/js/vendor/d3.min.js'],
  ])assert.equal(generated.get(path.join(current,artifact)).toString(),text(path.join(root,source)),source);
  assert.deepEqual(generated,generator.generateCurrent(root));
});

test('a canonical source edit invalidates a generated geometry receipt',()=>{
  assert.equal(typeof generator.generateCurrent,'function');
  assert.equal(typeof generator.verifyCurrent,'function');
  const generated=generator.generateCurrent(root);
  const manifest=JSON.parse(generated.get(path.join(current,'manifest.json')));
  const fixture=mkdtempSync(path.join(tmpdir(),'canonical-geometry-source-'));
  for(const row of manifest.files){
    const target=path.join(fixture,row.path);mkdirSync(path.dirname(target),{recursive:true});
    writeFileSync(target,text(path.join(root,row.path)));
  }
  for(const [file,bytes] of generated){
    const target=path.join(fixture,path.relative(root,file));mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,bytes);
  }
  assert.equal(generator.verifyCurrent(fixture,manifest).mismatches,0);
  const target=path.join(fixture,'assets/js/modules/cut-preparation-cache.js');
  writeFileSync(target,text(target)+'\n// canonical source changed\n');
  assert.throws(()=>generator.verifyCurrent(fixture,manifest),/GEOMETRY_SOURCE_HASH_MISMATCH/);
});
