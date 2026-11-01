import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {builtinProject} from '../../tests/helpers/builtin-world.mjs';

const jsPath=resolve(process.env.PANDOEDITOR_WASM_MODULE
  ||'build-native/p5-5/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(jsPath).href);
const core=await createCore({wasmBinary:await readFile(jsPath.replace(/\.js$/,'.wasm'))});
const seed=JSON.parse(await readFile(new URL('../../tests/fixtures/portability/web-document-seed.json',import.meta.url)));
const month='2026-10',setup={initialMonth:month,timelineRange:null,
  initialMapBounds:null,sourceMode:'builtin'};
const input=builtinProject(month,month);
const json=Buffer.from(JSON.stringify(input));
const sourceBytes=new Uint8Array(json);
const source={kind:'stored-asset',sourceBytes,encoding:'identity',
  compressedBytes:sourceBytes.byteLength,decodedBytes:sourceBytes.byteLength,
  baseDataset:input.baseDataset,sourceMonth:month,
  fingerprint:createHash('sha256').update(sourceBytes).digest('hex')};
const provenance={dataRevision:'p5-5-fixture',manifestSha256:'a'.repeat(64)};
const make=()=>new core.DocumentSession({validateFlagDataUrl(){}});
function assertUnchanged(session,before,stored){
  assert.deepEqual(session.projectState(),before);
  assert.equal(session.storageSnapshot(),stored);
}
test('P5-5 WASM exports exact typed temporal source/candidate ABI under pinned Core binary',()=>{
  assert.equal(core.coreAbiVersion,1);
  const owner=make();
  try {
    for(const fn of ['temporalSourcePrepare','temporalSourceStats','temporalSourceRelease',
      'temporalCandidatePrepare','temporalCandidateInspect','temporalCandidateDiscard',
      'temporalCandidateAdopt'])assert.equal(typeof owner[fn],'function',fn);
  }finally{owner.delete();}
});
test('P5-5 native bytes are copied; read-only source and candidate keep active state unchanged',()=>{
  const owner=make();
  try{
    const before=owner.documentLoad(JSON.stringify(seed),month),original=owner.storageSnapshot();
    const arguments_={source,...provenance,expectedEpoch:before.epoch};
    const receipt=owner.temporalSourcePrepare(arguments_);
    assert.ok(receipt.sourceId>0);
    assert.equal(receipt.sourceMonth,month);
    assert.equal(sourceBytes.byteLength,json.length,'no caller-buffer detachment');
    assert.equal(owner.temporalSourceStats().entries,1);
    assert.equal(owner.temporalSourceStats().declaredDecodedBytes,json.length);
    assertUnchanged(owner,before,original);
    const duplicate=owner.temporalSourcePrepare({...arguments_,source:{...source,
      sourceBytes:new Uint8Array(json)}});
    assert.equal(duplicate.sourceId,receipt.sourceId);
    assert.equal(duplicate.reused,true);
    const payload={sourceId:receipt.sourceId,targetMonth:month,
      sourceFingerprint:source.fingerprint,expectedEpoch:before.epoch,
      setup,documentId:'p5-5-verified'};
    const prepared=owner.temporalCandidatePrepare(payload);
    assert.equal(prepared.reused,false);
    assert.equal(prepared.worldSha256.length,64);
    assert.equal(owner.temporalCandidatePrepare(payload).candidateId,prepared.candidateId);
    const inspection=owner.temporalCandidateInspect({candidateId:prepared.candidateId,expectedEpoch:before.epoch});
    assert.equal(inspection.world.month,month);
    assert.ok(Array.isArray(inspection.world.entities));
    assert.ok(inspection.world.entities.length>0);
    assertUnchanged(owner,before,original);
    assert.throws(()=>owner.temporalCandidatePrepare({...payload,targetMonth:'2025-12'}),
      error=>error?.code==='CORE_TEMPORAL_CANDIDATE_MONTH');
    assert.throws(()=>owner.temporalSourcePrepare({...arguments_,source:{...source,
      sourceBytes:new Uint8Array([0,1,2]),compressedBytes:3,decodedBytes:3}}),
      error=>error?.code==='PL-SCHEMA-BASE');
    assert.equal(owner.temporalCandidateDiscard({candidateId:prepared.candidateId,expectedEpoch:before.epoch}),true);
    assert.equal(owner.temporalCandidateDiscard({candidateId:prepared.candidateId,expectedEpoch:before.epoch}),false);
    assert.equal(owner.temporalCandidateInspect({candidateId:prepared.candidateId,expectedEpoch:before.epoch}),null);
    assert.equal(owner.temporalSourceRelease({sourceId:receipt.sourceId,expectedEpoch:before.epoch}),true);
    assert.equal(owner.temporalSourceRelease({sourceId:receipt.sourceId,expectedEpoch:before.epoch}),false);
    assert.equal(owner.temporalSourceStats().entries,0);
    assertUnchanged(owner,before,original);
  }finally{owner.delete();}
});
test('P5-5 WASM adopt acknowledges accepted Core projection and existing rollback restores former state',()=>{
  const session=make(),legacy=make();
  try{
    const before=session.documentLoad(JSON.stringify(seed),month);
    legacy.documentLoad(JSON.stringify(seed),month);
    const original=session.storageSnapshot(),sourceReceipt=session.temporalSourcePrepare(
      {source:{...source,sourceBytes:new Uint8Array(json)},...provenance,expectedEpoch:before.epoch});
    const expected=session.temporalCandidatePrepare({
      sourceId:sourceReceipt.sourceId,targetMonth:month,sourceFingerprint:source.fingerprint,
      setup,documentId:'p5-5-verified',expectedEpoch:before.epoch});
    const legacyBaseline=legacy.storageBaselineLoad(source,legacy.projectState().epoch);
    legacy.documentLoadBaseline(legacyBaseline.storageBaselineId,setup);
    const capsule=session.captureReplacement(before.epoch);
    assert.throws(()=>session.temporalCandidateAdopt({candidateId:expected.candidateId,
      sourceId:expected.sourceId,targetMonth:month,sourceFingerprint:source.fingerprint,
      worldSha256:expected.worldSha256,replacementId:capsule+1,expectedEpoch:before.epoch}),
      error=>error?.code==='CORE_TEMPORAL_CANDIDATE_CAPSULE');
    assertUnchanged(session,before,original);
    const {state:accepted,delta}=session.temporalCandidateAdopt({
      candidateId:expected.candidateId,sourceId:expected.sourceId,targetMonth:month,
      sourceFingerprint:source.fingerprint,worldSha256:expected.worldSha256,
      replacementId:capsule,expectedEpoch:before.epoch});
    assert.equal(delta,null,'fresh builtin identity acknowledges a complete projection');
    assert.equal(accepted.timelineCursor,month);
    assert.ok(accepted.epoch>before.epoch);
    assert.equal(session.temporalSourceStats().entries,0);
    const current=session.resolveWorld(month,accepted.epoch);
    assert.deepEqual(current.entities,legacy.resolveWorld(month,legacy.projectState().epoch).entities);
    assert.throws(()=>session.temporalCandidateAdopt({
      candidateId:expected.candidateId,sourceId:expected.sourceId,targetMonth:month,
      sourceFingerprint:source.fingerprint,worldSha256:expected.worldSha256,
      replacementId:capsule,expectedEpoch:accepted.epoch}),
      error=>error?.code==='CORE_TEMPORAL_CANDIDATE_STALE');
    const restored=session.rollbackReplacement(capsule,accepted.epoch);
    assert.equal(restored.epoch,accepted.epoch+1);
    assert.equal(restored.timelineCursor,before.timelineCursor);
    assert.equal(restored.storageBaselineId,before.storageBaselineId);
    assert.equal(restored.canUndo,before.canUndo);
    assert.equal(session.storageSnapshot(),original);
    assert.equal(session.releaseReplacement(capsule),false);
    assert.equal(session.temporalSourceStats().entries,0);
  }finally{session.delete();legacy.delete();}
});
