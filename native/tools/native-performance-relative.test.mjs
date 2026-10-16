import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRelativeRounds,selectedD3dAdapter} from './summarize-native-performance.mjs';

const roles=['world-standard','dense-view','editing-heavy','large-project'];
const hardware="qt.rhi.general: Adapter 0: 'NVIDIA GeForce GTX 1650' (vendor 0x10DE device 0x1F82 flags 0x0)\nqt.rhi.general:   using this adapter\nqt.rhi.general: Adapter 1: 'Microsoft Basic Render Driver' (vendor 0x1414 device 0x8C flags 0x2)";
function round(values=[10,10,10,10,10],number=1,fixtureIds=roles) {
 const environment={sourceCommit:'c'.repeat(40),baselineSourceCommit:'b'.repeat(40),binarySha256:'c'.repeat(64),baselineBinarySha256:'b'.repeat(64),fixtureManifestSha256:'f'.repeat(64),inputHashes:{asset:'a'.repeat(64)},
  os:'Windows 11',adapters:[{Name:'NVIDIA GeForce GTX 1650',DriverVersion:'32.0.16.1088'}],cpu:[{Name:'CPU',NumberOfLogicalProcessors:6}],fixtureIds:[...fixtureIds],cacheCondition:'fixed warm disk/fresh process',measurementProfile:'p9-relative',additionalRoundFrom:number===2?'first':null};
 const runs=[];
 const add=(id,version,warmup,value)=>{
  const provenance={...structuredClone(environment),sourceCommit:version==='baseline'?environment.baselineSourceCommit:environment.sourceCommit,binarySha256:version==='baseline'?environment.baselineBinarySha256:environment.binarySha256,runId:id,qtVersion:'6.8.3',buildType:'Release',graphicsApi:'Direct3D11'};
  const input=(fixtureId,scenarioId)=>({fixtureId,scenarioId,latencyMs:value,matched:true,delivered:true,renderSnapshotMatched:true,renderUploadsPending:false,stateChanged:true});
  runs.push({receipt:{run:id,version,warmup,binarySha256:provenance.binarySha256,exitCode:0,exitCodeObserved:true,timedOut:false,rawReportExists:true},
   report:{schema:'pandoeditor-native-performance',version:2,measurementProfile:'p9-relative',completed:true,measurementMode:'diagnostic',diagnosticReason:'Synthetic parser test only',startupMeasurement:'existing-world-project-open',startupToProjectViewMs:value,initialProjectLoadMs:value,fixtureIds:[...fixtureIds],provenance,
    preflight:{status:'PASS'},logicalProcessors:6,fixtures:fixtureIds.map(id=>({id,manifestSha256:environment.fixtureManifestSha256,fullStack:false})),
    inputs:fixtureIds.flatMap(fixtureId=>[...Array.from({length:['editing-heavy','large-project'].includes(fixtureId)?6:0},()=>input(fixtureId,'combined-pan')),...Array.from({length:120},()=>input(fixtureId,'flat-pan'))]),
    relativeMeasurements:fixtureIds.map(fixtureId=>({fixtureId,loadAndFirstReadyFrameMs:value,panMs:value,panInputCount:120,saveMs:value,
     previewAndCancelMs:['editing-heavy','large-project'].includes(fixtureId)?value:null,
     previewEntityId:fixtureId==='editing-heavy'?'DEU':fixtureId==='large-project'?'RUS':'',
     previewGesture:fixtureId==='editing-heavy'?'pointer-drag':fixtureId==='large-project'?'keyboard-nudge':'',swapIntervalsMs:Array(120).fill(value)}))},
   processSamples:[{workingSetBytes:value*100,privateBytes:value*50,responding:true}],rendererLog:hardware});
 };
 if(number===1)for(const version of ['baseline','candidate'])add(`warmup-${version}`,version,true,10000);
 for(let i=1;i<=5;i++)for(const version of ['baseline','candidate'])add(`${number===1?'run':'extra'}-${i}-${version}`,version,false,version==='baseline'?10:values[i-1]);
 return {environment,runs};
}
test('P9 excludes two warmups and compares five fixed alternating pairs',()=>{
 const result=summarizeRelativeRounds([round([8,8,8,8,8])]);
 assert.equal(result.status,'no-regression');assert.equal(result.m98Acceptance,false);
 assert.equal(result.metrics.startupToProjectViewMs.baseline.count,5);
 assert.equal(result.metrics.startupToProjectViewMs.candidate.median,8);
 assert.equal(result.metrics['dense-view.frameP95Ms'].candidate.median,8);
 assert.equal(result.metrics['editing-heavy.previewAndCancelMs'].candidate.count,5);
 assert.equal(result.metrics['large-project.previewAndCancelMs'].candidate.median,8);
 assert.equal(result.metrics['large-project.previewInputTotalMs'].candidate.median,48);
 assert.equal(result.metrics['large-project.previewInputP95Ms'].candidate.median,8);
 assert.equal(result.metrics['large-project.previewInputP95Ms'].candidate.count,5);
 assert.equal(result.previewInputReceipts.find(v=>v.run==='run-1-candidate'&&v.fixtureId==='large-project').inputCount,6);
 assert.match(result.previewTimingDefinitions.previewAndCancelMs,/canonical document serialization/);
 assert.equal(result.startupMeasurement,'existing-world-project-open');
 assert.equal(result.metrics.peakWorkingSetBytes.candidate.median,800);
});
test('selected adapter is authenticated and software enumeration alone is harmless',()=>{
 assert.equal(selectedD3dAdapter(hardware).name,'NVIDIA GeForce GTX 1650');
 assert.equal(selectedD3dAdapter(hardware.replace('flags 0x0','flags 0x2')).hardware,false);
 const r=round();r.runs[0].rendererLog=hardware.replace('NVIDIA GeForce GTX 1650','Microsoft Basic Render Driver');
 assert.equal(summarizeRelativeRounds([r]).status,'BLOCKED');
});
test('hash-map fixture receipt order does not change pinned input identity',()=>{
 const r=round();r.runs[3].report.fixtures.reverse();
 assert.equal(summarizeRelativeRounds([r]).status,'no-regression');
});
test('Qt lowercase fixture hashes match PowerShell uppercase hashes without accepting changed or missing hashes',()=>{
 const r=round();
 r.environment.fixtureManifestSha256=r.environment.fixtureManifestSha256.toUpperCase();
 for(const run of r.runs)run.report.provenance.fixtureManifestSha256=r.environment.fixtureManifestSha256;
 assert.equal(summarizeRelativeRounds([r]).status,'no-regression');
 for(const hash of ['e'.repeat(64),'bad',null,undefined]){
  const changed=structuredClone(r);changed.runs[2].report.fixtures[0].manifestSha256=hash;
  assert.equal(summarizeRelativeRounds([changed]).status,'BLOCKED');
 }
});
test('source, binary, fixture, Qt and device mismatches block comparison',()=>{
 for(const mutation of [
  r=>r.runs[3].report.provenance.binarySha256='d'.repeat(64),
  r=>r.runs[3].report.provenance.fixtureManifestSha256='d'.repeat(64),
  r=>r.runs[3].report.provenance.qtVersion='6.7.0',
  r=>r.runs[3].report.provenance.adapters[0].DriverVersion='other',
  r=>r.runs[3].report.provenance.inputHashes.asset='d'.repeat(64),
 ]) {const r=round();mutation(r);assert.equal(summarizeRelativeRounds([r]).status,'BLOCKED');}
});
test('failed runs and incomplete frame/input evidence are retained as blockers',()=>{
 for(const mutation of [r=>r.runs[3].receipt.exitCode=1,r=>r.runs[3].report.relativeMeasurements[0].swapIntervalsMs=[],r=>r.runs[3].report.inputs[0].matched=false]) {
  const r=round();mutation(r);assert.equal(summarizeRelativeRounds([r]).status,'BLOCKED');
 }
});
test('both real entity previews and the saved-project startup label are required',()=>{
 for(const mutation of [
  r=>r.runs[3].report.relativeMeasurements[2].previewEntityId='RUS',
  r=>r.runs[3].report.relativeMeasurements[3].previewEntityId='DEU',
  r=>r.runs[3].report.relativeMeasurements[3].previewGesture='pointer-drag',
  r=>r.runs[3].report.relativeMeasurements[3].previewAndCancelMs=null,
  r=>r.runs[3].report.inputs.splice(r.runs[3].report.inputs.findIndex(v=>v.fixtureId==='large-project'&&v.scenarioId==='combined-pan'),1),
  r=>r.runs[3].report.inputs.find(v=>v.fixtureId==='large-project'&&v.scenarioId==='combined-pan').latencyMs=null,
  r=>r.runs[3].report.inputs.find(v=>v.fixtureId==='large-project'&&v.scenarioId==='combined-pan').latencyMs=-1,
  r=>delete r.runs[3].report.startupMeasurement,
  r=>r.runs[3].report.startupMeasurement='cold-world-bootstrap',
 ]) {const r=round();mutation(r);assert.equal(summarizeRelativeRounds([r]).status,'BLOCKED');}
 const extended=round(undefined,1,['large-project']);
 for(const run of extended.runs)run.report.inputs.push({...run.report.inputs.find(v=>v.scenarioId==='combined-pan')});
 const result=summarizeRelativeRounds([extended]);
 assert.equal(result.status,'no-regression');assert.equal(result.previewInputReceipts[0].inputCount,7);
 assert.equal(result.metrics['large-project.previewInputTotalMs'].candidate.median,70);
});
test('a slower RUS preview distribution independently fails P9 comparison',()=>{
 for(const metric of ['previewAndCancelMs','previewInputTotalMs','previewInputP95Ms']) {
  const r=round();
  if(metric==='previewInputTotalMs')for(const run of r.runs)if(run.receipt.version==='baseline') {
   const inputs=run.report.inputs.filter(v=>v.fixtureId==='large-project'&&v.scenarioId==='combined-pan');
   for(const [index,input]of inputs.entries())input.latencyMs=index===0?10:0;
  }
  for(const run of r.runs)if(run.receipt.version==='candidate') {
   if(metric==='previewAndCancelMs')run.report.relativeMeasurements[3].previewAndCancelMs=20;
   else {const inputs=run.report.inputs.filter(v=>v.fixtureId==='large-project'&&v.scenarioId==='combined-pan');
    for(const input of inputs)input.latencyMs=metric==='previewInputTotalMs'?10:0;
    if(metric==='previewInputP95Ms')inputs[0].latencyMs=20;
   }
  }
  const result=summarizeRelativeRounds([r]);
  assert.equal(result.status,'regression');
  assert.equal(result.metrics[`large-project.${metric}`].status,'regression');
  assert.equal(result.metrics[`large-project.${metric}`].candidate.count,5);
  assert.equal(result.metrics.startupToProjectViewMs.status,'no-regression');
  if(metric==='previewInputTotalMs')assert.equal(result.metrics['large-project.previewInputP95Ms'].status,'no-regression');
  if(metric==='previewInputP95Ms')assert.equal(result.metrics['large-project.previewInputTotalMs'].status,'no-regression');
 }
});
test('one additional five-pair round is available only after uncertainty',()=>{
 const first=round([9,11,11,11,9]);const result=summarizeRelativeRounds([first]);
 assert.equal(result.status,'uncertain');assert.equal(result.additionalRoundAllowed,true);
 const second=round([11,11,11,11,11],2);
 const final=summarizeRelativeRounds([first,second]);assert.equal(final.roundCount,2);assert.equal(final.additionalRoundAllowed,false);
 assert.equal(final.status,'uncertain');
 assert.equal(summarizeRelativeRounds([first,second,second]).status,'BLOCKED');
 assert.equal(summarizeRelativeRounds([round([8,8,8,8,8]),second]).status,'BLOCKED');
});
test('fully separated slower distributions are a regression and never retried',()=>{
 const result=summarizeRelativeRounds([round([12,12,12,12,12])]);
 assert.equal(result.status,'regression');assert.equal(result.additionalRoundAllowed,false);
});
test('large-project-only comparison retains RUS coverage and explicitly limits its scope',()=>{
 const result=summarizeRelativeRounds([round([8,8,8,8,8],1,['large-project'])]);
 assert.equal(result.status,'no-regression');assert.deepEqual(result.fixtureIds,['large-project']);
 assert.equal(result.fullFixtureCoverage,false);assert.equal(result.m98Acceptance,false);
 assert.equal(result.metrics['large-project.previewAndCancelMs'].candidate.count,5);
 assert.equal(result.metrics['large-project.previewInputTotalMs'].candidate.count,5);
 assert.equal(result.metrics['editing-heavy.previewAndCancelMs'],undefined);
 assert.ok(result.limitations.some(text=>text.includes('does not complete full four-role P9')));
});
test('selected fixture IDs, first-load timing and per-role input receipts are strict',()=>{
 for(const mutate of [
  r=>r.environment.fixtureIds=[],
  r=>r.environment.fixtureIds=['large-project','large-project'],
  r=>r.environment.fixtureIds=['unknown'],
  r=>r.runs[3].report.fixtureIds=roles,
  r=>r.runs[3].report.relativeMeasurements.push({...r.runs[3].report.relativeMeasurements[0],fixtureId:'editing-heavy'}),
  r=>r.runs[3].report.inputs.pop(),
  r=>r.runs[3].report.inputs[0].fixtureId='world-standard',
  r=>r.runs[3].report.relativeMeasurements[0].panInputCount=119,
  r=>r.runs[3].report.initialProjectLoadMs=99,
 ]) {const r=round(undefined,1,['large-project']);mutate(r);assert.equal(summarizeRelativeRounds([r]).status,'BLOCKED');}
 const first=round([9,11,11,11,9],1,['large-project']),second=round(undefined,2,['editing-heavy']);
 assert.equal(summarizeRelativeRounds([first,second]).status,'BLOCKED');
});
