import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {loadLSIBReviewedSource} from '../../tools/gis/lsib-reviewed-source.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
test('reviewed LSIB source refuses paths outside the library source scope',async()=>{
  await assert.rejects(loadLSIBReviewedSource({root:process.cwd(),manifestPath:'../outside.json'}),/scope|path|escape/i);
});
test('reviewed LSIB source rejects changed bytes and unreviewed coast features',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-lsib-reviewed-'));
  const folder=join(root,'tools','historical-library','sources','fixture');await mkdir(folder,{recursive:true});
  const manifestFile=join(folder,'manifest.json'),sourceFile=join(folder,'source.json');
  t.after(async()=>{await unlink(manifestFile);await unlink(sourceFile);for(const p of [folder,join(root,'tools','historical-library','sources'),join(root,'tools','historical-library'),join(root,'tools'),root])await rmdir(p);});
  const source=JSON.stringify({features:[{type:'Feature',properties:{cleabs:'one',niveau:'wrong'},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}]});
  await writeFile(sourceFile,source);
  const manifest={schemaVersion:1,countries:['FRA','MCO'],sourceId:'ign-bdtopo-v3-monaco-coast',sourceCrs:'EPSG:4326',
    sourceFile:'tools/historical-library/sources/fixture/source.json',sourceFileSha256:'0'.repeat(64),features:{monaco:'one',west:'two',east:'three'}};
  await writeFile(manifestFile,JSON.stringify(manifest));
  const request={root,manifestPath:'tools/historical-library/sources/fixture/manifest.json'};
  await assert.rejects(loadLSIBReviewedSource(request),/pinned evidence/i);
  manifest.sourceFileSha256=createHash('sha256').update(source).digest('hex');await writeFile(manifestFile,JSON.stringify(manifest));
  await assert.rejects(loadLSIBReviewedSource(request),/high.water/i);
});
test('reviewed IGM and Monaco lines match existing Python and PROJ',{skip:!binary||!process.env.PANDO_LSIB_REVIEWED_ORACLE},async()=>{
  const {items}=JSON.parse(await readFile(process.env.PANDO_LSIB_REVIEWED_ORACLE,'utf8'));
  const igm=await loadLSIBReviewedSource({root:process.cwd(),manifestPath:'tools/historical-library/sources/reviewed-boundaries-2026-10-22/smr-igm-reference.json',binary});
  const coast=await loadLSIBReviewedSource({root:process.cwd(),manifestPath:'tools/historical-library/sources/monaco-reviewed-2026-10-22/coast-reference.json',binary});
  assert.equal(igm.sourceId,'igm-dbsn-2025-06-27');assert.equal(coast.sourceId,'ign-bdtopo-v3-monaco-coast');
  const {lines,referenceManifest,...metadata}=coast;
  assert.deepEqual(metadata,JSON.parse(await readFile(referenceManifest,'utf8')));
  for(const row of items){const actual=row.name==='igm'?igm.lines.igm:coast.lines[row.name];
    assert.equal(actual.length,row.expected.length,row.name);
    for(let i=0;i<actual.length;i++)for(let c=0;c<2;c++)assert.ok(Math.abs(actual[i][c]-row.expected[i][c])<1e-12,`${row.name} ${i}/${c}`);
  }
});
test('selected reviewed coastline retains the original Python source metadata',{
  skip:!binary||!process.env.PANDO_PYTHON_ORACLE||!process.env.PANDO_LSIB_REVIEWED_ORACLE
},async()=>{
  const manifestPath='tools/historical-library/sources/monaco-reviewed-2026-10-22/coast-reference.json';
  const script=`import importlib.util,json,pathlib\nspec=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nlines,metadata=m.reviewed_coast_reference(pathlib.Path.cwd(),${JSON.stringify(manifestPath)})\nprint(json.dumps({'metadata':metadata,'lines':{k:list(v.coords) for k,v in lines.items()}}))`;
  const original=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  assert.equal(original.status,0,original.stderr);const expected=JSON.parse(original.stdout);
  const {lines,...metadata}=await loadLSIBReviewedSource({root:process.cwd(),manifestPath,binary});
  assert.deepEqual(metadata,expected.metadata);assert.deepEqual(lines,expected.lines);
});
test('selected IGM reference retains its original transformation metadata',{
  skip:!binary||!process.env.PANDO_PYTHON_ORACLE||!process.env.PANDO_LSIB_REVIEWED_ORACLE
},async()=>{
  const manifestPath='tools/historical-library/sources/reviewed-boundaries-2026-10-22/smr-igm-reference.json';
  const script=`import importlib.util,json,pathlib\nspec=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py')\nm=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\nline,metadata=m.reviewed_reference(pathlib.Path.cwd(),${JSON.stringify(manifestPath)})\nprint(json.dumps({'metadata':metadata,'coordinates':list(line.coords)}))`;
  const original=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  assert.equal(original.status,0,original.stderr);const expected=JSON.parse(original.stdout);
  const {lines,...metadata}=await loadLSIBReviewedSource({root:process.cwd(),manifestPath,binary});
  assert.deepEqual(metadata,expected.metadata);assert.equal(lines.igm.length,expected.coordinates.length);
  assert.deepEqual(metadata.transformation,{description:'axis order change (2D) + ETRS89 to WGS 84 (1) + axis order change (2D)',accuracyMetres:1});
  for(let i=0;i<lines.igm.length;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(lines.igm[i][j]-expected.coordinates[i][j])<1e-12);
});
