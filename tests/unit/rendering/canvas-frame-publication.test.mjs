import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCanvasWorkerFrame, mapPresentationTargetKey } from '../../../src/rendering/map-render-publication.js';

const current = {
  presentationKey:'project-3/view-6/physical-2',
  backgroundPresentationKey:'project-3/base-6',
  physicalStyleRevision:2,geometryRevision:44,styleRevision:9,
  surfaceQuality:'canonical',
};
const frame = {...current, projectGeneration:3, bitmap:{width:100,height:50}};
const policy = {...current, expectedPresentationKey:current.presentationKey,
  expectedBackgroundKey:current.backgroundPresentationKey,physicalMatches:true,
  backgroundEligible:false,
};

test('Canvas only admits the complete current physical/date/style frame',()=>{
  assert.equal(classifyCanvasWorkerFrame(frame,policy),'');
  for(const [change,reason] of [
    [{presentationKey:'project-3/old-camera'},'presentation'],
    [{geometryRevision:43},'geometry'],
    [{styleRevision:8},'style'],
    [{surfaceQuality:'pending'},'quality'],
  ]) assert.equal(classifyCanvasWorkerFrame({...frame,...change},policy),reason,
    'stale '+reason+' must not publish its bitmap');
  assert.equal(classifyCanvasWorkerFrame(frame,{...policy,physicalMatches:false}),'physical');
});

test('Canvas background-only publication is bound to the physical camera and style',()=>{
  const options={...policy,backgroundEligible:true};
  assert.equal(classifyCanvasWorkerFrame(frame,options),'',
    'background requires a separate certified presentation');
  assert.equal(classifyCanvasWorkerFrame({...frame,backgroundPresentationKey:'old-camera'},options),
    'background-presentation');
  assert.equal(classifyCanvasWorkerFrame({...frame,physicalStyleRevision:1},options),
    'physical-style');
  assert.equal(classifyCanvasWorkerFrame(frame,{...options,physicalMatches:false}),'physical');
});

test('camera and project changes create new picture identities; scheduling frame id does not',()=>{
  const original = {cssViewport:[1280,800],cssScale:512,cssTranslate:[640,400],dpr:1,
    viewState:{projection:'globe',rotation:[0,0,0]}};
  const deps = {projectGeneration:3,contextRevision:5,geometryRevision:11,paletteRevision:6,
    physicalStyleRevision:2,terrainVisible:true,surfaceQuality:'canonical',surfaceGeometryQuality:'exact'};
  const key=mapPresentationTargetKey({...original,frameId:20},deps);
  assert.equal(mapPresentationTargetKey({...original,frameId:21},deps),key);
  assert.notEqual(mapPresentationTargetKey({...original,cssScale:640},deps),key);
  assert.notEqual(mapPresentationTargetKey({...original,viewState:{...original.viewState,rotation:[5,0,0]}},deps),key);
  assert.notEqual(mapPresentationTargetKey(original,{...deps,projectGeneration:4}),key);
  assert.notEqual(mapPresentationTargetKey(original,{...deps,geometryRevision:12}),key);
  assert.notEqual(mapPresentationTargetKey(original,{...deps,physicalStyleRevision:3}),key);
});
