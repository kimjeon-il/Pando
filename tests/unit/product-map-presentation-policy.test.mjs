import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  VIEWER_MAP_INPUT_RESERVED_SELECTOR,
  createViewerMapPreparationPresenter,
} from '../../apps/viewer/js/modules/viewer-map-presentation-policy.js';
import {
  EDITOR_MAP_INPUT_RESERVED_SELECTOR,
  createEditorMapPreparationPresenter,
} from '../../apps/editor/frontend/js/modules/editor-map-presentation-policy.js';

const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('shared renderer and input presentation stay product-neutral',()=>{
  const renderer=read('shared/frontend/js/modules/map-renderer-composition.js');
  const input=read('shared/frontend/js/modules/map-input-presentation.js');
  assert.doesNotMatch(renderer,/\bproductMode\b/);
  assert.doesNotMatch(renderer,/mapPreparationNotice/);
  assert.match(renderer,/presentMapPreparation/);
  assert.doesNotMatch(input,/\bproductMode\b/);
  assert.doesNotMatch(input,/\.editor-drawer|\.project-bounds-picker/);
  assert.match(input,/reservedTargetSelector/);
});

test('Viewer and Editor own distinct preparation presentation and reserved targets',()=>{
  const viewerNodes=Object.fromEntries(['mapPreparationStatus','mapPreparationRetry','mapPreparationNotice']
    .map(id=>[id,{textContent:'',hidden:false,onclick:null}]));
  let viewerRetries=0;
  const viewer=createViewerMapPreparationPresenter(id=>viewerNodes[id]);
  viewer({status:'error',label:'현재 화면 준비 실패',retry:true},{retry:()=>viewerRetries++});
  assert.equal(viewerNodes.mapPreparationStatus.textContent,'불러오기 실패');
  assert.equal(viewerNodes.mapPreparationNotice.hidden,false);
  assert.equal(viewerNodes.mapPreparationRetry.hidden,false);
  viewerNodes.mapPreparationRetry.onclick();
  assert.equal(viewerRetries,1);

  const editorNodes=Object.fromEntries(['mapPreparationStatus','mapPreparationRetry']
    .map(id=>[id,{textContent:'',hidden:false,onclick:null}]));
  let editorRetries=0;
  const editor=createEditorMapPreparationPresenter(id=>editorNodes[id]);
  editor({status:'error',label:'현재 화면 준비 실패',retry:true},{retry:()=>editorRetries++});
  assert.equal(editorNodes.mapPreparationStatus.textContent,'현재 화면 준비 실패');
  assert.equal(editorNodes.mapPreparationRetry.hidden,false);
  editorNodes.mapPreparationRetry.onclick();
  assert.equal(editorRetries,1);

  assert.match(VIEWER_MAP_INPUT_RESERVED_SELECTOR,/contenteditable/);
  assert.doesNotMatch(VIEWER_MAP_INPUT_RESERVED_SELECTOR,/editor-drawer|project-bounds-picker/);
  assert.match(EDITOR_MAP_INPUT_RESERVED_SELECTOR,/editor-drawer/);
  assert.match(EDITOR_MAP_INPUT_RESERVED_SELECTOR,/project-bounds-picker/);
});

test('product composition injects its own renderer and input policies',()=>{
  const viewer=read('apps/viewer/js/modules/viewer-map.js');
  const editorRenderer=read('apps/editor/frontend/js/modules/app-service-assembly.js');
  const editorInput=read('apps/editor/frontend/js/modules/app-lifecycle-assembly.js');
  assert.match(viewer,/createViewerMapPreparationPresenter/);
  assert.match(viewer,/VIEWER_MAP_INPUT_RESERVED_SELECTOR/);
  assert.match(editorRenderer,/createEditorMapPreparationPresenter/);
  assert.match(editorInput,/EDITOR_MAP_INPUT_RESERVED_SELECTOR/);
});
