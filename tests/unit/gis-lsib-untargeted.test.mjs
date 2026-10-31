import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import test from 'node:test';
import {buildLSIBUntargetedCandidate} from '../../tools/gis/lsib-untargeted.mjs';

const cases=JSON.parse(await readFile(new URL('../fixtures/lsib-untargeted-oracle.json',import.meta.url),'utf8'));
for(const fixture of cases)test(`untargeted LSIB: ${fixture.name}`,async()=>{
  const input=structuredClone(fixture),result=await buildLSIBUntargetedCandidate(input);
  assert.deepEqual(result.changes,fixture.expected.changes);
  assert.deepEqual(result.boundaries,fixture.expected.boundaries);
  assert.equal(result.sourceRevision,'fixture');assert.deepEqual(input,fixture);
});
test('untargeted LSIB rejects missing execution dependencies',async()=>{
  await assert.rejects(buildLSIBUntargetedCandidate(cases[0],{binary:'missing-lsib-native'}),/native.*failed/i);
  await assert.rejects(buildLSIBUntargetedCandidate({...cases[0],sourceRevision:null}),/inputs required/i);
});
test('selected AUT/LIE candidate matches the prior Python output',{skip:!process.env.PANDO_LSIB_UNTARGETED_ORACLE},async()=>{
  const fixture=JSON.parse(await readFile(process.env.PANDO_LSIB_UNTARGETED_ORACLE,'utf8'));
  const result=await buildLSIBUntargetedCandidate(fixture);
  assert.deepEqual(result.changes,fixture.expected.changes);
  assert.deepEqual(result.boundaries,fixture.expected.boundaries);
});
test('remaining Python source runner uses the Node candidate and propagates failure',{
  skip:!process.env.PANDO_PYTHON_ORACLE
},()=>{
  const script=`import importlib.util,json,os,sys\nfrom pathlib import Path\nfrom unittest.mock import patch\nfrom shapely.geometry import shape\nspec=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nx=json.load(sys.stdin);records=[{'properties':r['properties'],'line':shape(r['geometry'])} for r in x['records']];disputes=[{'line':shape(g)} for g in x['disputes']]\nargs=(records,disputes,x['entities'],x['versions'],x['geometries'],x['inputHashes'],x['sourceRevision'])\nr=m.build_untargeted_candidate(*args)\nassert r['changes']==x['expected']['changes'] and r['boundaries']==x['expected']['boundaries'] and r['sourceRevision']==x['sourceRevision']\nwith patch.dict(os.environ,{'PANDO_TERRITORIAL_RECIPE_BINARY':str(Path('missing-lsib-native').resolve())}):\n try: m.build_untargeted_candidate(*args)\n except RuntimeError as error: assert 'untargeted candidate failed' in str(error)\n else: raise AssertionError('missing native executable was accepted')\nprint('ok')`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input:JSON.stringify(cases[0]),encoding:'utf8',windowsHide:true,timeout:180000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
test('remaining source runner refuses existing candidate or evidence before any writes',{
  skip:!process.env.PANDO_PYTHON_ORACLE
},async()=>{
  const base=resolve(tmpdir()),root=await mkdtemp(join(base,'pando-lsib-preflight-'));
  assert.ok(root.startsWith(base+sep+'pando-lsib-preflight-'));
  try{
    const output=join(root,'candidate.json'),evidence=join(root,'evidence');
    const run=()=>spawnSync(process.env.PANDO_PYTHON_ORACLE,['tools/supplement-lsib-boundaries.py','--archive','absent.zip',
      '--disputed-directory','absent-disputes','--evidence-directory',evidence,'--output',output],{encoding:'utf8',windowsHide:true});
    await writeFile(output,'protected');let result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/output already exists/i);
    assert.equal(await readFile(output,'utf8'),'protected');
    await rm(output);await mkdir(evidence);await writeFile(join(evidence,'line-index.json'),'evidence');
    result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/output already exists/i);
    assert.equal(await readFile(join(evidence,'line-index.json'),'utf8'),'evidence');
    await assert.rejects(readFile(output),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});
