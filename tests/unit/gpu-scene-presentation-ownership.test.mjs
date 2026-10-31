import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapContentPresentation} from '../../shared/frontend/js/modules/map-content-presentation.js';

function fixture() {
  const actions={pending:0,replace:0,sync:0,draw:0,coverage:[],interaction:[]};
  const countries={
    getState:()=>({layerVisibility:{objects:true},pendingCountryRenderIds:new Set()}),
    renderPendingCountryOverlays:()=>{actions.pending++;},
    replaceGpuSceneDomain:()=>{actions.replace++;},
    syncGpuRenderScene:()=>{actions.sync++;},
    applyGpuSceneCoverage:value=>actions.coverage.push(value),
    applyGpuInteractionCoverage:value=>actions.interaction.push(value),
    gpuMapRenderer:{renderFrame:()=>{actions.draw++;return{succeeded:true};}},
  };
  const content=createMapContentPresentation({countries,active:()=>{},requireFrame:value=>value});
  return {actions,content,frame:{__mapVisualFrame:true,frameId:9}};
}

test('presentation-only country pass cannot replace scene after GPU draw but retains coverage',()=>{
  const f=fixture(), result={succeeded:true,frameId:9};
  const outcome=f.content.renderCountries(f.frame,{presentationOnly:true,gpuResult:result});
  assert.equal(outcome,result);
  assert.equal(f.actions.pending,0,'pending geometry belongs to preparation, not frame approval');
  assert.equal(f.actions.replace,0,'presentation must not overwrite drawn GPU scene');
  assert.equal(f.actions.sync,0,'presentation must not advance rendered scene identity');
  assert.equal(f.actions.draw,0,'presentation must not draw a second GPU frame');
  assert.deepEqual(f.actions.coverage,[result]);
  assert.deepEqual(f.actions.interaction,[result]);
});

test('normal country pass still synchronizes geometry and draws before presenting',()=>{
  const f=fixture(),result=f.content.renderCountries(f.frame);
  assert.deepEqual([f.actions.pending,f.actions.replace,f.actions.sync,f.actions.draw],[1,1,1,1]);
  assert.deepEqual(f.actions.coverage,[result]);
  assert.deepEqual(f.actions.interaction,[result]);
});
