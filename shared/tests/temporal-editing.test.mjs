import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {createEmptyTerritorialState} from "../frontend/js/modules/territorial-entity-store.js";
import {createCoreDocumentReadModel} from "../frontend/js/modules/core-document-read-model.js";
import {createTerritorialFeature} from "../frontend/js/modules/territorial-units.js";

const modulePath=resolve(process.env.PANDOEDITOR_WASM_MODULE ?? 'build-native/wasm/wasm/pandoeditor-core.js');
const {default:createCore}=await import(pathToFileURL(modulePath));
const core=await createCore({wasmBinary:await readFile(modulePath.replace(/\.js$/,'.wasm'))});
const seed=JSON.parse(await readFile(new URL('../../tests/fixtures/portability/web-document-seed.json',import.meta.url)));
const cursor=(session,month)=>session.setTimelineCursor(month,session.projectState().epoch);
const execute=(session,field,value)=>session.executeCommand({commandId:'territorial.field',expectedEpoch:session.projectState().epoch,
  targets:[{domain:'territorial',id:'A'}],payload:{id:'A',field,value}});
const name=session=>session.resolveWorld(session.projectState().timelineCursor,session.projectState().epoch).entities
  .find(row=>row.id==='A').properties.name?.name ?? seed.territorialEntities.find(row=>row.id==='A').properties.name;

test('startup empty state is admitted by the current C++ timeline contract',()=>{
  const empty=createEmptyTerritorialState();
  assert.deepEqual(core.timelineNormalizeRecords(empty.timelineRecords,{entities:[],geometryExists:()=>false}),empty.timelineRecords);
});

test('dated creation Undo and Redo republish every required geometry to the Web read model',()=>{
  const session=new core.DocumentSession({validateFlagDataUrl:()=>{}});
  try {
    session.documentLoad(JSON.stringify(seed),'2012-01');cursor(session,'2012-01');
    const model=createCoreDocumentReadModel(session.documentSnapshot());
    const accept=result=>model.acceptTransition({...result,world:session.resolveWorld('2012-01',result.state.epoch)},'history');
    const feature=createTerritorialFeature({id:'TEMPORAL_NEW',entityKind:'general',name:'New',
      geometry:{type:'Polygon',coordinates:[[[20,0],[21,0],[21,1],[20,0]]]}});
    const result=session.executeCommand({commandId:'territorial.create',expectedEpoch:session.projectState().epoch,
      targets:[{domain:'territorial',id:feature.id}],payload:{feature}});
    assert.equal(result.ok,true);accept(result);
    accept(session.undo(session.projectState().epoch));assert.equal(model.get({domain:'territorial',id:feature.id}),null);
    accept(session.redo(session.projectState().epoch));
    assert.deepEqual(model.territorialViews().find(row=>row.id===feature.id).geometry,feature.geometry);
  }finally{session.delete();}
});

test('dated names preserve previous months and the next explicit change',()=>{
  const session=new core.DocumentSession({validateFlagDataUrl:()=>{}});
  try {
    session.documentLoad(JSON.stringify(seed),'2012-01');
    cursor(session,'2013-01');assert.equal(execute(session,'name','Future').ok,true);
    cursor(session,'2012-01');assert.equal(execute(session,'name','Inserted').ok,true);
    cursor(session,'2011-01');assert.equal(name(session),seed.territorialEntities.find(row=>row.id==='A').properties.name);
    cursor(session,'2012-01');assert.equal(name(session),'Inserted');
    cursor(session,'2013-01');assert.equal(name(session),'Future');
  }finally{session.delete();}
});

test('cursor-only export restores the work month without changing history or dirty state',()=>{
  const session=new core.DocumentSession({validateFlagDataUrl:()=>{}}),restored=new core.DocumentSession({validateFlagDataUrl:()=>{}});
  try {
    session.documentLoad(JSON.stringify(seed),'2026-10');const before=session.projectState();cursor(session,'2012-01');
    const state=session.projectState();assert.equal(state.dirty,before.dirty);assert.equal(state.canUndo,before.canUndo);
    const exported=session.exportSnapshot({expectedEpoch:state.epoch,format:'pandolab-project-state',version:'0.36.0',savedAt:'2026-10-16T00:00:00Z'});
    assert.equal(JSON.parse(exported.storageJson).editorState.lastViewedMonth,'2012-01');
    const prepared=restored.validateImport(exported.storageJson,null);
    assert.equal(prepared.editorState.lastViewedMonth,'2012-01');
    restored.documentLoad(JSON.stringify(prepared),'2026-10');assert.equal(restored.projectState().timelineCursor,'2012-01');
    assert.equal(execute(restored,'name','Resumed').ok,true);
    cursor(restored,'2011-01');assert.equal(name(restored),seed.territorialEntities.find(row=>row.id==='A').properties.name);
  }finally{session.delete();restored.delete();}
});
