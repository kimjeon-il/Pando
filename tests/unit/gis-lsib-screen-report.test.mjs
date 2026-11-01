import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {evaluateLSIBScreens,runLSIBScreen,selectedLSIBSourceIds} from '../../tools/gis/verify-lsib-screen-delta.mjs';
import {readLSIBLines} from '../../tools/gis/lsib-source-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const id='c133c4d6-bf4f-489d-b51e-abf2be55d369';
const square={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]]]};
const entry={countries:['AAA','BBB'],status:'supplemented',sourceLineIds:[id],segments:[{status:'supplemented',anchors:[[0,0],[4,4]]}]};
const source={type:'LineString',coordinates:[[0,0],[4,0],[4,4]]};

test('LSIB source selection honors pair, withheld and independently reviewed references',()=>{
  const other='4990410a-4158-4932-8445-90397c840a87';
  const candidate={boundaries:[entry,{...entry,sourceLineIds:[id,id]},
    {...entry,status:'withheld',sourceLineIds:[other]},
    {...entry,referenceManifest:'reviewed.json',sourceLineIds:[other]},
    {...entry,kind:'coastline',sourceLineIds:[other]},
    {...entry,countries:['CCC','DDD'],sourceLineIds:[other]}]};
  assert.deepEqual(selectedLSIBSourceIds(candidate,'AAA/BBB'),[id]);
  assert.deepEqual(selectedLSIBSourceIds(candidate),[id,other]);
});

test('LSIB screen report preserves selected pair, distances and provisional status',{skip:!binary},async()=>{
  const candidate={boundaries:[entry,{...entry,countries:['CCC','DDD'],status:'withheld'}]};
  const report=await evaluateLSIBScreens({candidate,entities:{AAA:square},sourceById:{[id]:source},pair:'AAA/BBB'},{binary});
  assert.equal(report.sections,1);assert.deepEqual(report.sourceIds,['dos-lsib-11.4']);
  assert.equal(report.historicalGroundTruthVerified,false);
  assert.equal(report.results[0].sampledMaximumCssPx,0);
  assert.ok(Math.abs(report.continuousUpperBoundCssPx-(.001*2560*64/360/2))<1e-12);
  assert.deepEqual(report.results[0].anchors,entry.segments[0].anchors);
});
test('LSIB screen report rejects deviations without producing a report',{skip:!binary},async()=>{
  const displaced={type:'LineString',coordinates:[[0,.02],[4,.02],[4,4]]};
  await assert.rejects(evaluateLSIBScreens({candidate:{boundaries:[entry]},entities:{AAA:square},sourceById:{[id]:displaced}},{binary}),
    error=>/exceeds tolerance/i.test(error.message)&&Array.isArray(error.diagnostic?.reference));
});
test('LSIB screen report retains reviewed enclave and coastline provenance',{skip:!binary},async()=>{
  const ring=square.coordinates[0],igmPath='reviewed-igm.json',coastPath='reviewed-coast.json';
  const candidate={boundaries:[
    {countries:['ITA','SMR'],status:'supplemented',referenceManifest:igmPath,segments:[{status:'supplemented',closedRing:true,enclave:'SMR',anchors:[]}]},
    {countries:['AAA'],status:'supplemented',kind:'coastline',referenceManifest:coastPath,referenceRole:'monaco',segments:[{status:'supplemented',anchors:[[0,0],[4,0]]}]}
  ]};
  const reviewedByManifest={
    [igmPath]:{sourceId:'igm-dbsn-2025-06-27',referenceManifest:igmPath,lines:{igm:ring}},
    [coastPath]:{sourceId:'ign-bdtopo-v3-monaco-coast',referenceManifest:coastPath,lines:{monaco:[[0,0],[4,0]]}}
  };
  const report=await evaluateLSIBScreens({candidate,entities:{SMR:square,AAA:square},sourceById:{},reviewedByManifest},{binary});
  assert.equal(report.sections,2);assert.deepEqual(report.sourceIds,['igm-dbsn-2025-06-27','ign-bdtopo-v3-monaco-coast']);
  assert.equal(report.results[0].referenceManifest,igmPath);assert.equal(report.results[1].referenceManifest,coastPath);
});
test('LSIB CLI refuses to overwrite an existing report before reading inputs',async t=>{
  const folder=await mkdtemp(join(tmpdir(),'pando-lsib-node-')),path=join(folder,'existing.json');
  await writeFile(path,'existing evidence');t.after(async()=>{await unlink(path);await rmdir(folder);});
  const result=spawnSync(process.execPath,['tools/gis/verify-lsib-screen-delta.mjs','--candidate','missing-candidate',
    '--archive','missing-archive','--output',path],{encoding:'utf8',windowsHide:true});
  assert.notEqual(result.status,0);assert.match(result.stderr,/exist/i);assert.equal(await readFile(path,'utf8'),'existing evidence');
});
test('actual AUT-LIE source preserves the frozen Python section result',{
  skip:!binary||!process.env.PANDO_LSIB_ARCHIVE||!process.env.PANDO_GDAL_OGR2OGR||!process.env.PANDO_LSIB_DISPLAY_ORACLE
},async()=>{
  const old=JSON.parse(await readFile(process.env.PANDO_LSIB_DISPLAY_ORACLE,'utf8'));
  const rows=await readLSIBLines({archive:process.env.PANDO_LSIB_ARCHIVE,ids:[id],binary:process.env.PANDO_GDAL_OGR2OGR},{binary});
  const candidate={boundaries:[{countries:['AUT','LIE'],status:'supplemented',sourceLineIds:[id],segments:[{status:'supplemented',anchors:old.anchors}]}]};
  const report=await evaluateLSIBScreens({candidate,entities:{AUT:old.geometry},sourceById:{[id]:rows[0].geometry}},{binary});
  assert.equal(report.samples,2464+423);assert.equal(report.sections,1);
  assert.ok(Math.abs(report.sampledMaximumCssPx-.18131739355200677)<1e-10);
});
test('LSIB report workflow reads selected original and protects its output',{
  skip:!binary||!process.env.PANDO_LSIB_ARCHIVE||!process.env.PANDO_GDAL_OGR2OGR||!process.env.PANDO_LSIB_DISPLAY_ORACLE
},async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-lsib-workflow-'));
  const dirs=['tools','tools/historical-library','tools/historical-library/sources','tools/historical-library/sources/lsib-11.4',
    'assets','assets/data','assets/data/territorial-entities','assets/data/territorial-entities/source','assets/data/territorial-entities/source/countries'];
  for(const dir of dirs)await mkdir(join(root,dir));
  const provenance=join(root,dirs[3],'provenance.json'),entity=join(root,dirs[8],'state-AUT.json');
  const candidatePath=join(root,'candidate.json'),output=join(root,'result.json');
  t.after(async()=>{for(const path of [output,candidatePath,entity,provenance])await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});
    for(const dir of dirs.reverse())await rmdir(join(root,dir));await rmdir(root);});
  const old=JSON.parse(await readFile(process.env.PANDO_LSIB_DISPLAY_ORACLE,'utf8'));
  await writeFile(provenance,JSON.stringify({archiveSha256:'1eb5af7e80fce60e48d27eba80ae81fd2b25c9cf59f4f4e2efc89c06ad57490a'}));
  await writeFile(entity,JSON.stringify({metadata:{representativeGeometryVersionId:'current'},geometryVersions:[{versionId:'current',geometry:old.geometry}]}));
  await writeFile(candidatePath,JSON.stringify({boundaries:[{countries:['AUT','LIE'],status:'supplemented',sourceLineIds:[id],segments:[{status:'supplemented',anchors:old.anchors}]}]}));
  const args={candidate:candidatePath,archive:process.env.PANDO_LSIB_ARCHIVE,output,pair:'AUT/LIE'},options={root,binary,ogrBinary:process.env.PANDO_GDAL_OGR2OGR};
  const report=await runLSIBScreen(args,options),bytes=await readFile(output,'utf8');
  assert.equal(report.samples,2464+423);assert.deepEqual(JSON.parse(bytes),report);
  assert.ok(Math.abs(report.sampledMaximumCssPx-.18131739355200677)<1e-10);
  await assert.rejects(runLSIBScreen(args,options),/already exists/i);assert.equal(await readFile(output,'utf8'),bytes);
});
