import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import test from 'node:test';
import {inventory} from '../../tools/reference-analysis/corpus-inventory.mjs';

test('corpus inventory keeps original sources, report evidence, derivatives and references distinct',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-corpus-inventory-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const reports=join(root,'reports'),sources=join(root,'sources');
  mkdirSync(join(reports,'case','sources'),{recursive:true});mkdirSync(sources);
  writeFileSync(join(reports,'case','sources','historic.pdf'),'original');
  writeFileSync(join(reports,'case','comparison.png'),'screenshot');
  writeFileSync(join(reports,'case','notes.md'),'Map https://example.test/atlas.pdf and https://example.test/page');
  writeFileSync(join(sources,'preview.jpg'),'preview');
  writeFileSync(join(sources,'preview.source.json'),JSON.stringify({materialKind:'official-downsample'}));
  writeFileSync(join(sources,'derived.jpg'),'derived');
  writeFileSync(join(sources,'derived.json'),JSON.stringify({purpose:'app-runtime-input-only'}));
  const result=await inventory(reports,sources);
  const find=name=>result.entries.find(row=>row.path.endsWith(name));
  assert.equal(result.trainingReady,false);
  assert.equal(find('historic.pdf').kind,'original-candidate');
  assert.equal(find('comparison.png').kind,'report-evidence-candidate');
  assert.equal(find('preview.jpg').kind,'source-downsample-candidate');
  assert.equal(find('derived.jpg').kind,'analysis-derivative');
  assert.deepEqual(find('notes.md').urls,['https://example.test/atlas.pdf']);
  assert.equal(find('historic.pdf').sha256,createHash('sha256').update('original').digest('hex'));
  for(const row of result.entries.filter(row=>row.kind!=='source-references'))assert.equal(row.annotationStatus,'unlabelled');
});

test('inventory CLI preserves an existing output and cancellation does not return partial results',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-corpus-inventory-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const reports=join(root,'reports'),sources=join(root,'sources'),output=join(root,'output.json');
  mkdirSync(reports);mkdirSync(sources);writeFileSync(join(sources,'map.jpg'),'original');
  const args=[resolve('tools/reference-analysis/corpus-inventory.mjs'),'--reports',reports,'--sources',sources,'--output',output];
  const first=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  const before=readFileSync(output);assert.equal(JSON.parse(before).entries.length,1);
  const second=spawnSync(process.execPath,args,{encoding:'utf8'});assert.notEqual(second.status,0);
  assert.deepEqual(readFileSync(output),before);
  const controller=new globalThis.AbortController();controller.abort();
  await assert.rejects(inventory(reports,sources,{signal:controller.signal}),/abort/i);
  writeFileSync(join(sources,'map.source.json'),'[]');
  await assert.rejects(inventory(reports,sources),/invalid source metadata/i);
  assert.equal(readFileSync(join(sources,'map.jpg'),'utf8'),'original');
});
