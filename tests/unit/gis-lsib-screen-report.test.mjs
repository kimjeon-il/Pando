import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {evaluateLSIBScreens} from '../../tools/gis/verify-lsib-screen-delta.mjs';
import {readLSIBLines} from '../../tools/gis/lsib-source-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const id='c133c4d6-bf4f-489d-b51e-abf2be55d369';
const square={type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]]]};
const entry={countries:['AAA','BBB'],status:'supplemented',sourceLineIds:[id],segments:[{status:'supplemented',anchors:[[0,0],[4,4]]}]};
const source={type:'LineString',coordinates:[[0,0],[4,0],[4,4]]};

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
