import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRelativeRounds,selectedD3dAdapter} from './summarize-native-performance.mjs';

const roles=['world-standard','dense-view','editing-heavy','large-project'];
const hardware="qt.rhi.general: Adapter 0: 'NVIDIA GeForce GTX 1650' (vendor 0x10DE device 0x1F82 flags 0x0)\nqt.rhi.general:   using this adapter\nqt.rhi.general: Adapter 1: 'Microsoft Basic Render Driver' (vendor 0x1414 device 0x8C flags 0x2)";
function round(values=[10,10,10,10,10],number=1) {
 const environment={sourceCommit:'c'.repeat(40),baselineSourceCommit:'b'.repeat(40),binarySha256:'c'.repeat(64),baselineBinarySha256:'b'.repeat(64),fixtureManifestSha256:'f'.repeat(64),inputHashes:{asset:'a'.repeat(64)},
  os:'Windows 11',adapters:[{Name:'NVIDIA GeForce GTX 1650',DriverVersion:'32.0.16.1088'}],cpu:[{Name:'CPU',NumberOfLogicalProcessors:6}],cacheCondition:'fixed warm disk/fresh process',measurementProfile:'p9-relative',additionalRoundFrom:number===2?'first':null};
 const runs=[];
 const add=(id,version,warmup,value)=>{
  const provenance={...structuredClone(environment),sourceCommit:version==='baseline'?environment.baselineSourceCommit:environment.sourceCommit,binarySha256:version==='baseline'?environment.baselineBinarySha256:environment.binarySha256,runId:id,qtVersion:'6.8.3',buildType:'Release',graphicsApi:'Direct3D11'};
  runs.push({receipt:{run:id,version,warmup,binarySha256:provenance.binarySha256,exitCode:0,exitCodeObserved:true,timedOut:false,rawReportExists:true},
   report:{schema:'pandoeditor-native-performance',version:2,measurementProfile:'p9-relative',completed:true,measurementMode:'diagnostic',diagnosticReason:'Synthetic parser test only',startupToProjectViewMs:value,provenance,
    preflight:{status:'PASS'},logicalProcessors:6,fixtures:roles.map(id=>({id,manifestSha256:environment.fixtureManifestSha256,fullStack:false})),
    inputs:Array.from({length:480},()=>({matched:true,delivered:true,renderSnapshotMatched:true,renderUploadsPending:false,stateChanged:true})),
    relativeMeasurements:roles.map(fixtureId=>({fixtureId,loadAndFirstReadyFrameMs:value,panMs:value,saveMs:value,previewAndCancelMs:fixtureId==='editing-heavy'?value:null,swapIntervalsMs:Array(120).fill(value)}))},
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
