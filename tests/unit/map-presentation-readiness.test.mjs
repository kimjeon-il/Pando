import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPresentationReadiness } from "../../shared/frontend/js/modules/startup-readiness.js";

const ready = { boundaryReady: true, terrainVisible: true,
  terrain: { terrainReady: true }, targetKey: 'current', presentedKey: 'current', band: 'low' };

test('completion requires matching actual presentation, boundaries and visible terrain', () => {
  assert.equal(mapPresentationReadiness(ready).status, 'ready');
  assert.equal(mapPresentationReadiness({ ...ready, presentedKey: 'old' }).status, 'presenting');
  assert.equal(mapPresentationReadiness({ ...ready, boundaryReady: false }).status, 'boundaries');
  assert.equal(mapPresentationReadiness({ ...ready, terrain: { terrainReady: false } }).status, 'terrain');
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
