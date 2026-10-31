import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectDomain} from '../../shared/frontend/js/modules/project-domain.js';

const setup=month=>({initialMonth:month,timelineRange:null,initialMapBounds:null,sourceMode:'builtin'});
function fixture({productMode='viewer',present=async()=>true}={}){
 let current={documentId:'viewer',projectSetup:setup('1950-12')},capsule,nextCapsule=0;
 const calls=[];
 const owner={
  captureReplacement:async()=>{calls.push('capture');capsule=structuredClone(current);return ++nextCapsule;},
  releaseReplacement:async()=>{calls.push('release');},
  rollbackReplacement:async()=>{calls.push('rollback');current=capsule;},
  loadBaseline:async(_id,value)=>{calls.push('load');current={...current,projectSetup:value};},
  transitionBaseline:async(_id,value)=>{calls.push('transition');current={...current,projectSetup:value};return {ok:true};},
  selectionCatalogLoad:async()=>{},
 };
 const domain=createProjectDomain({productMode,commandOwner:owner,documentModel:{snapshot:()=>current},
  readBuiltinSelectionCatalogs:()=>[],replaceSnapshot:async()=>present(current),restoreReplacement:async()=>{calls.push('restored');}});
 return {domain,owner,calls,month:()=>current.projectSetup.initialMonth};
}
const source=month=>async()=>({baselineId:7,setup:setup(month)});

test('viewer uses one load at startup and the dedicated native transition for subsequent dates',async()=>{
 const f=fixture();await f.domain.open(source('1950-12'),{source:'builtin'});
 await f.domain.transitionBuiltin(source('1951-12'));
 await f.domain.transitionBuiltin(source('1952-12'));
 assert.equal(f.month(),'1952-12');assert.equal(f.calls.filter(x=>x==='load').length,1);
 assert.equal(f.calls.filter(x=>x==='transition').length,2);
 assert.equal(f.calls.filter(x=>x==='capture').length,3);assert.equal(f.calls.filter(x=>x==='release').length,3);
});

test('failed temporal presentation restores the last accepted source without reporting a new date',async()=>{
 const failure=new Error('render failed');const f=fixture({present:async()=>{throw failure;}});
 await assert.rejects(f.domain.transitionBuiltin(source('1951-12')),value=>value===failure);
 assert.equal(f.month(),'1950-12');assert.deepEqual(f.calls,['capture','transition','rollback','restored','release']);
 assert.equal(f.domain.isOpening(),false);assert.equal(f.domain.isReplacing(),false);
 assert.equal(f.domain.getGeneration(),2,'rollback must advance, never reuse the failed render generation');
});

test('latest date waits for superseded rollback and cannot be overwritten by an older completion',async()=>{
 let release,entered;const held=new Promise(r=>{release=r;}),arrival=new Promise(r=>{entered=r;});
 const f=fixture({present:async current=>{if(current.projectSetup.initialMonth==='1951-12'){entered();await held;}return true;}});
 const older=f.domain.transitionBuiltin(source('1951-12'));await arrival;
 const newer=f.domain.transitionBuiltin(source('1952-12'));release();
 assert.equal(await older,false);assert.equal(await newer,true);assert.equal(f.month(),'1952-12');
 assert.equal(f.calls.filter(x=>x==='rollback').length,1);assert.equal(f.calls.filter(x=>x==='load').length,0);
});

test('source failures and editor calls cannot enter the viewer temporal replacement transaction',async()=>{
 const f=fixture(),failure=new Error('source unavailable');
 await assert.rejects(f.domain.transitionBuiltin(async()=>{throw failure;}),value=>value===failure);
 assert.equal(f.month(),'1950-12');assert.deepEqual(f.calls,[]);
 const editor=fixture({productMode:'editor'});
 await assert.rejects(async()=>editor.domain.transitionBuiltin(source('1951-12')),/viewer/i);
 assert.deepEqual(editor.calls,[]);
});
