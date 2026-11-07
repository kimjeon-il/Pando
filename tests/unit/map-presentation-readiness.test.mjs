import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPresentationReadiness } from '../../shared/frontend/js/modules/startup-readiness.js';
import { createMapVisualFrame } from '../../shared/frontend/js/modules/map-visual-frame.js';

const snapshot = center => createMapVisualFrame({frameId: 1, viewRevision: 1,
  viewState: {projection:'flat', size:{width:900,height:600}, scale:420,
    translate:[450,300], projectionCenter:center}});
const stage = (current, presented=current, overrides={}) => ({
  boundaryReady:true, terrainVisible:true, terrain:{terrainReady:true},
  targetKey:current.signature, presentedKey:presented?.signature, band:'low', ...overrides,
});

test('only an accepted frame with its own source/camera identity certifies a ready map', () => {
  const initial=snapshot([0,0]), changed=snapshot([20,0]);
  assert.equal(mapPresentationReadiness(stage(initial)).status, 'ready');
  assert.equal(mapPresentationReadiness(stage(initial)).mapReady, true);
  const pending=mapPresentationReadiness(stage(changed,initial));
  assert.equal(pending.mapReady,false);
  assert.equal(pending.status,'presenting');
  assert.equal(mapPresentationReadiness(stage(changed,changed)).mapReady,true);
  assert.equal(mapPresentationReadiness(stage(initial,null)).mapReady,false);
  assert.equal(mapPresentationReadiness(stage(initial,initial,{mapPresented:false})).mapReady,false);
});

test('optional terrain cannot hide an accepted country frame or report false completion', () => {
  const frame=snapshot([0,0]);
  const terrain=mapPresentationReadiness(stage(frame,frame,{terrain:{terrainReady:false}}));
  assert.equal(terrain.mapReady,true);
  assert.equal(terrain.terrainReady,false);
  assert.equal(terrain.status,'terrain');
  const readyWithoutTerrain=mapPresentationReadiness(stage(frame,frame,{terrainVisible:false,terrain:{}}));
  assert.equal(readyWithoutTerrain.status,'ready');
  assert.equal(readyWithoutTerrain.terrainReady,true);
  const failed=mapPresentationReadiness(stage(frame,frame,{terrain:{terrainReady:false,terrainFailed:true}}));
  assert.equal(failed.status,'error');
  assert.equal(failed.retry,true);
  assert.equal(mapPresentationReadiness(stage(frame,frame,{boundaryReady:false})).status,'boundaries');
  assert.equal(mapPresentationReadiness(stage(frame,frame,{boundaryFailed:true})).status,'error');
});

test('a resolution-limited frame is explicitly complete but never claims additional DEM data', () => {
  const frame=snapshot([0,0]);
  const limited=mapPresentationReadiness(stage(frame,frame,{terrain:{terrainReady:true,terrainResolutionLimited:true}}));
  assert.equal(limited.mapReady,true);
  assert.equal(limited.terrainReady,true);
  assert.equal(limited.status,'limited');
  assert.ok(limited.label.includes('최고 해상도'));
  assert.match(mapPresentationReadiness(stage(frame)).label,/저배율/);
});
