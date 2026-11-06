import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import { mapPresentationReadiness } from "../../shared/frontend/js/modules/startup-readiness.js";

const ready = { boundaryReady: true, terrainVisible: true,
  terrain: { terrainReady: true }, targetKey: 'current', presentedKey: 'current', band: 'low' };

test('completion requires matching actual presentation, boundaries and visible terrain', () => {
  assert.equal(mapPresentationReadiness(ready).status, 'ready');
  assert.equal(mapPresentationReadiness({ ...ready, presentedKey: 'old' }).status, 'presenting');
  assert.equal(mapPresentationReadiness({ ...ready, boundaryReady: false }).status, 'boundaries');
  assert.equal(mapPresentationReadiness({ ...ready, terrain: { terrainReady: false } }).status, 'terrain');
});

test('an actually presented map remains independently ready while optional DEM is pending', () => {
  const pending = mapPresentationReadiness({
    ...ready, mapPresented: true, terrain: {terrainReady: false},
  });
  assert.equal(pending.status, 'terrain');
  assert.equal(pending.mapReady, true);
  assert.equal(pending.terrainReady, false);
  assert.equal(mapPresentationReadiness({...ready, mapPresented:false}).mapReady, false);
  assert.equal(mapPresentationReadiness({...ready, presentedKey:'old'}).mapReady, false);
  assert.equal(mapPresentationReadiness({...ready, terrainVisible:false, terrain:{}}).terrainReady, true);
});

test('hidden terrain is excluded; exhausted failures never count as ready', () => {
  assert.equal(mapPresentationReadiness({ ...ready, terrainVisible: false, terrain: {} }).status, 'ready');
  const failure = mapPresentationReadiness({ ...ready, terrain: { terrainReady: false, terrainFailed: true, terrainTargetTilesSettled: true } });
  assert.equal(failure.status, 'error');
  assert.equal(failure.retry, true);
});

test('resolution limits have an explicit terminal state and low/high labels', () => {
  const limited = mapPresentationReadiness({ ...ready, terrain: { terrainReady: true, terrainResolutionLimited: true } });
  assert.equal(limited.status, 'limited');
  assert.match(limited.label, /최고 해상도/);
  assert.match(mapPresentationReadiness(ready).label, /저배율/);
  assert.match(mapPresentationReadiness({ ...ready, band: 'high' }).label, /상세/);
});


test('Canvas Worker settles file-open waiters from an actually transferred current bitmap',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const start=source.indexOf('    function settleMapPresentationWaiters() {');
  const end=source.indexOf('    function waitForMapPresentation(',start);
  assert.ok(start>0&&end>start);
  const waiters=new Set(),resolved=[];
  const context={projectGeneration:3,mapPresentationWaiters:waiters,
    mapReadiness:()=>({mapReady:true})};
  const settle=new Function(...Object.keys(context),source.slice(start,end)+';return settleMapPresentationWaiters;')(...Object.values(context));
  waiters.add({generation:2,resolve:()=>assert.fail('stale project must not settle')});
  waiters.add({generation:3,resolve:()=>resolved.push(3)});
  assert.equal(settle(),true);
  assert.deepEqual(resolved,[3]);
  assert.equal(waiters.size,1);
  const transfer=source.slice(source.indexOf('    function receiveCanvasWorkerMessage(event) {'),
    source.indexOf('    function activateCanvasFallback(',source.indexOf('    function receiveCanvasWorkerMessage(event) {')));
  assert.match(transfer,/transferFromImageBitmap\(message\.bitmap\)[\s\S]*?recordMapPresentation\(presentedVisualFrame,[\s\S]*?settleMapPresentationWaiters\(\)/);
  assert.match(transfer,/message\.surfaceQuality !== 'pending'\)\s*settleMapPresentationWaiters\(\)/);
});

test('pending map-open resource updates reach the current visual-frame commit',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const start=source.indexOf("    function invalidateGpuFrame(reason = 'gpu-frame') {");
  const end=source.indexOf("    function invalidateGpuInteraction(",start);
  assert.ok(start>0&&end>start);
  const events=[];
  const gate=new Set();
  const invalidate=new Function('disposed','gpuRecovery','mapPresentationWaiters','renderViewFrame',
    'scheduleGpuFrame',source.slice(start,end)+';return invalidateGpuFrame;')(
      false,{snapshot:()=>({active:false}),fallbackTicket:()=>null},gate,
      reason=>events.push('visual:'+reason),reason=>events.push('gpu:'+reason));
  invalidate('tile-ready');
  gate.add({generation:4});
  invalidate('scene-ready');
  gate.clear();
  invalidate('steady');
  assert.deepEqual(events,['gpu:tile-ready','visual:scene-ready','gpu:steady']);
});

test('accepted map and physical background keys are independent of optional DEM target changes',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const start=source.indexOf('    function mapTargetKey(');
  const middle=source.indexOf('    function mapReadiness()',start);
  const bgStart=source.indexOf('    function backgroundTargetKey(');
  const bgEnd=source.indexOf('    function retryMapPreparation()',bgStart);
  assert.ok(start>0&&middle>start&&bgStart>middle&&bgEnd>bgStart);
  const frame={frameId:9,viewRevision:2,projectionRevision:1,cssViewport:[900,600],
    cssScale:420,cssTranslate:[450,300],viewState:{rotation:[0,0,0],projection:'globe'}};
  const context={lastVisualFrame:frame,projectGeneration:3,renderDeviceContextRevision:2,
    geometryRevisionTracker:{committedRevision:()=>4},countryPaletteRevision:2,physicalStyleStateRevision:1,
    state:{physicalSettings:{terrainVisible:true}},surfacePresentation:{quality:'canonical',geometryQuality:'canonical'},
    renderScene:{polygons:[{role:'physical-land',sourceKey:'land:4'}]}};
  const params=Object.keys(context),values=Object.values(context);
  const mapKey=new Function(...params,source.slice(start,middle)+';return mapTargetKey;')(...values);
  const backgroundKey=new Function(...params,source.slice(bgStart,bgEnd)+';return backgroundTargetKey;')(...values);
  const first=mapKey(frame),background=backgroundKey(frame);
  const secondTerrain={terrainTargetKey:'next-lod'};
  assert.equal(mapKey(frame,secondTerrain),first);
  assert.equal(backgroundKey(frame,secondTerrain),background);
  context.renderScene.polygons[0].sourceKey='land:5';
  assert.notEqual(backgroundKey(frame),background,'a new physical source still requires a new background');
  context.physicalStyleStateRevision=2;
  const styledMapKey=new Function(...params,source.slice(start,middle)+';return mapTargetKey;')(...Object.values(context));
  assert.notEqual(styledMapKey(frame),first,'a changed physical style invalidates the map');
});

test('a real background presentation key cannot certify an unpresented canonical country surface',()=>{
  const source=readFileSync(new URL('../../shared/frontend/js/modules/gpu-map-renderer.js',import.meta.url),'utf8');
  const begin=source.indexOf('    function mapTargetKey(');
  const end=source.indexOf('    function mapReadiness()',begin);
  assert.ok(begin>=0&&end>begin,'map target key must be supplied by the canonical renderer');
  const frame={frameId:7,viewRevision:3,projectionRevision:1,cssScale:450,cssTranslate:[450,300]};
  const surface={quality:'pending',geometryQuality:'canonical'};
  const fields={
    lastVisualFrame:frame, currentTerrainReadiness:()=>({terrainTargetKey:'same-base'}),
    projectGeneration:3,renderDeviceContextRevision:2,
    geometryRevisionTracker:{committedRevision:()=>5},
    countryPaletteRevision:9,physicalStyleStateRevision:1,
    state:{physicalSettings:{terrainVisible:true}},
    terrainPreparation:{},surfacePresentation:surface,
  };
  const fn=new Function(...Object.keys(fields),source.slice(begin,end)+';return mapTargetKey;')(...Object.values(fields));
  const backgroundOnly=fn(frame);
  assert.equal(fn(frame),backgroundOnly,'identical input must be stable');
  surface.quality='canonical';
  const withCountries=fn(frame);
  assert.notEqual(backgroundOnly,withCountries,'a real canonical frame needs its own presentation certificate');
  surface.geometryQuality='preview';
  assert.notEqual(withCountries,fn(frame),'different country geometry LOD must invalidate old presentation');
});
