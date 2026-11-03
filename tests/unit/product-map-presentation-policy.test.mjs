import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  VIEWER_MAP_INPUT_RESERVED_SELECTOR,
  createViewerMapPreparationPresenter,
} from '../../apps/viewer/js/modules/viewer-map-presentation-policy.js';


const root=new URL('../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('shared renderer and input presentation stay product-neutral',()=>{
  const renderer=read('shared/frontend/js/modules/map-renderer-composition.js');
  const input=read('shared/frontend/js/modules/map-input-presentation.js');
  assert.doesNotMatch(renderer,/\bproductMode\b/);
  assert.doesNotMatch(renderer,/mapPreparationNotice/);
  assert.match(renderer,/presentMapPreparation/);
  assert.match(renderer,/Map renderer requires a preparation presenter\./);
  assert.match(renderer,/presentMapPreparation\(presentation/);
  assert.doesNotMatch(input,/\bproductMode\b/);
  assert.doesNotMatch(input,/\.editor-drawer|\.project-bounds-picker/);
  assert.match(input,/reservedTargetSelector/);
  assert.match(input,/const editing=editingHooks!==null/);
});
