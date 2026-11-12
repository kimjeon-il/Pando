import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFixtureCoverage,withNormalizedAdmissionBudget,withExperimentViewInvalidation,withPlaceSnapshotTrace,withTerrainOnlyCapture,scaleAtZoom} from '../../../scripts/terrain-experiment/fixture-coverage.mjs';

test('preflight detects conservative visibility and budget downgrade before a Viewer run',()=>{
  const levels=size=>[
    {id:4,width:21600,height:10800,tileSize:1024,columns:22,rows:11},
    {id:5,width:43200,height:21600,tileSize:size,columns:Math.ceil(43200/size),rows:Math.ceil(21600/size)},
  ];
  const keys=size=>{
    const result=new Set();
    for(let y=6144/size;y<8192/size;y++)for(let x=32768/size;x<34816/size;x++)result.add(`5/${x}-${y}`);
    return result;
  };
  const options={center:[102,28],viewport:[1280,752],scale:10570.56};
  const large=inspectFixtureCoverage({manifest:{levels:levels(1024),gutter:1},availableKeys:keys(1024),...options});
  assert.equal(large.requestedTiles,8);
  assert.equal(large.admittedLevel,4);
  assert.ok(large.missingKeys.length>0);
  assert.equal(large.valid,false);
  const normalized=inspectFixtureCoverage({manifest:{levels:levels(1024),gutter:1},availableKeys:new Set([...keys(1024),...large.missingKeys]),
    policy:{byteBudget:192*1024*1024,bytesPerPixel:12},...options});
  assert.equal(normalized.admittedLevel,5);
  assert.equal(normalized.valid,true);
  const small=inspectFixtureCoverage({manifest:{levels:levels(512),gutter:1},availableKeys:keys(512),...options});
  assert.equal(small.requestedTiles,17);
  assert.equal(small.admittedLevel,5);
  assert.equal(small.missingKeys.length,3);
  assert.equal(small.valid,false);
  const complete=inspectFixtureCoverage({manifest:{levels:levels(512),gutter:1},availableKeys:new Set([...keys(512),...small.missingKeys]),...options});
  assert.equal(complete.valid,true);
});

test('normalized budget is explicit and refuses a changed or ambiguous Viewer policy',()=>{
  const marker='byteBudget: 96 * 1024 * 1024, bytesPerPixel: 12';
  assert.equal(withNormalizedAdmissionBudget(`const x={${marker}};`),
    'const x={byteBudget: 192 * 1024 * 1024, bytesPerPixel: 12};');
  assert.throws(()=>withNormalizedAdmissionBudget('no policy'),/contract changed/);
  assert.throws(()=>withNormalizedAdmissionBudget(`${marker};${marker}`),/contract changed/);
});

test('experiment camera repaint invalidates the full view and refuses a changed host contract',()=>{
  const source="requestRepaint: reason => dependencies.domains.renderingDomain?.invalidateGpuFrame?.(reason || 'legacy-host-repaint'),";
  assert.match(withExperimentViewInvalidation(source),/requestRender\?\.\(\{kind:'view-settle'/);
  assert.throws(()=>withExperimentViewInvalidation('different'),/host contract changed/);
  assert.throws(()=>withExperimentViewInvalidation(source+source),/host contract changed/);
});

test('preflight accounts for the initial non-unit globe zoom',()=>{
  assert.ok(Math.abs(scaleAtZoom(412.9125,1.25,32)-10570.56)<1e-8);
  assert.throws(()=>scaleAtZoom(10,0,32),/zoom/);
});

test('place snapshot trace preserves the actual label invalidation',()=>{
  const marker="onSnapshot: () => dependencies.domains.renderingDomain.invalidateLabels('builtin-places-ready'),";
  const result=withPlaceSnapshotTrace(marker);
  assert.match(result,/__pandoPlaceSnapshots/);assert.match(result,/invalidateLabels\('builtin-places-ready'\)/);
  assert.throws(()=>withPlaceSnapshotTrace('changed'),/label contract changed/);
});

test('terrain-only capture is placed after land and rejects a changed scene pass',()=>{
  const marker="renderTerrain('land');";
  const result=withTerrainOnlyCapture(marker);
  assert.ok(result.indexOf(marker)<result.indexOf('gl.readPixels'));
  assert.match(result,/__pandoTerrainCapture/);
  assert.throws(()=>withTerrainOnlyCapture('changed'),/scene contract changed/);
});
