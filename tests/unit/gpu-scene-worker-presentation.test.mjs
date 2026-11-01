import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('after polygon preparation, Canvas Worker schedules a base redraw rather than interaction-only invalidation',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-scene.js',import.meta.url),'utf8');
  assert.match(source,/builder\.preparePolygons\([\s\S]*?\.then\(\(\) => \{[\s\S]*?syncGpuRenderScene\(\);[\s\S]*?mode === 'canvas-worker'[\s\S]*?requestPreparedCanvasFrame\?\.\(\);[\s\S]*?invalidateBaseScene\('canvas-scene-ready'\)/);
  assert.match(source,/else\s+dependencies\.domains\.renderingDomain\.invalidateGpuInteraction\('overlay-mesh-ready'\)/);
});

test('Canvas Worker scene redraw is a base invalidation retaining document and geometry state owners',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-scene.js',import.meta.url),'utf8');
  const prep=source.slice(source.indexOf('builder.preparePolygons('),source.indexOf('if (pendingPreparation) { pendingPreparation = null;'));
  assert.doesNotMatch(prep,/documentLoad\(|setTimelineCursor\(|replaceSnapshot\(|resetProjectGeneration\(|dispose\(/);
  assert.doesNotMatch(prep,/invalidateProject\(/);
});

test('prepared Canvas Worker frames are requested only for a live current project and physical scene',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('    function requestPreparedCanvasFrame() {');
  const end=source.indexOf('    function renderLatestVisualFrame() {',begin);
  assert.ok(begin>=0&&end>begin);
  const handoff=source.slice(begin,end);
  for(const contract of [/disposed/,/rendererMode !== 'canvas-worker'/,/projectRenderBlocked/,
    /canvasWorker\?\.ready/,/lastVisualFrame/,/lastVisualFrame\.projectGeneration/,
    /projectGeneration/,/physicalSceneMatchesContext\(renderScene, getPhysicalContextState\(\)\)/,
    /renderCanvasWorker\(lastVisualFrame\)/])assert.match(handoff,contract);
  assert.doesNotMatch(handoff,/commitVisualFrame\(|recordMapPresentation\(|countriesPublishedGeneration\s*=/);
});
