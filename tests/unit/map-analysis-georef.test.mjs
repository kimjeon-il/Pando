import assert from 'node:assert/strict';
import test from 'node:test';
import * as georef from '../../plugins/pando-map-tools/lib/analysis/georef.mjs';

import {
  buildReferenceImageAutoGeoref,
  buildReferenceImageCalibrationWarp,
  buildReferenceImageLinearConstraintPoints,
  buildReferenceImageLinearRefinement,
  buildReferenceImageMesh,
  buildReferenceImageProjectiveWarpFromQuad,
  buildReferenceImageWarp,
  REFERENCE_IMAGE_WARP_MODES,
} from '../../plugins/pando-map-tools/lib/analysis/georef.mjs';

const point = (id, image, coordinate) => ({ id, image, coordinate });

const distributed=(map)=>[.05,.35,.65,.95].flatMap(u=>[.05,.35,.65,.95].map(v=>point(`${u}/${v}`,[u,v],map(u,v))));
test('automatic calibration selects the simplest independently validated fit rather than interpolating every control',()=>{
  const points=distributed((u,v)=>[-100+20*u+3*v,40+2*u-10*v]);
  const result=georef.selectReferenceImageGeoreference(points,{width:400,height:400});
  assert.equal(result.warp.mode,'affine');assert.equal(result.quality.recommended,true);
  assert.ok(result.quality.crossValidationP95Pixels<.001);
  assert.equal(result.quality.modelComparison.length,4);
  assert.equal(georef.selectReferenceImageGeoreference(points,{width:400,height:400},{mode:'tps'}).warp.mode,'tps');
});
test('nonlinear calibration is selected only when source-pixel cross validation improves',()=>{
  const points=distributed((u,v)=>[-100+20*u+1.5*Math.sin(Math.PI*v),40+20*v+.5*Math.sin(Math.PI*u)]);
  const result=georef.selectReferenceImageGeoreference(points,{width:400,height:400});
  assert.equal(result.warp.mode,'tps');assert.equal(result.quality.recommended,true);
  assert.ok(result.quality.crossValidationP95Pixels<=8);
  assert.ok(result.quality.modelComparison.filter(row=>row.mode!=='tps').every(row=>!row.recommended));
});
test('sparse controls cannot make an interpolating TPS look validated through its training residual',()=>{
  const points=[[.1,.3],[.3,.4],[.6,.3],[.65,.7],[.4,.65],[.1,.6]].map(([u,v],i)=>point(String(i),[u,v],[-130+u*80,70-v*30+i*.01]));
  const result=georef.selectReferenceImageGeoreference(points,{width:1600,height:1200});
  assert.notEqual(result.warp.mode,'tps');assert.equal(result.quality.recommended,false);
  assert.equal(result.quality.crossValidationP95Pixels,null);
  assert.equal(result.quality.modelComparison.find(row=>row.mode==='tps').eligible,false);
  assert.ok(result.quality.imageCoverage<.2);
});

test('cropped TPS validation measures the same original-UV transform rather than refitting a rescaled kernel',()=>{
  const points=distributed((u,v)=>[-100+20*u+1.5*Math.sin(Math.PI*v),40+20*v+.5*Math.sin(Math.PI*u)])
    .map(row=>({...row,image:[.1+row.image[0]*.6,.05+row.image[1]*.9]}));
  const full=georef.georeferenceQuality(points,'tps',{width:1001,height:1001});
  const crop=georef.georeferenceQuality(points,'tps',{width:1001,height:1001,mapping:{rect:{x:100,y:50,width:601,height:901}}});
  assert.ok(Number.isFinite(full.crossValidationP95Pixels));
  assert.ok(Math.abs(crop.crossValidationP95Pixels-full.crossValidationP95Pixels)<1e-5);
  assert.ok(Math.abs(crop.imageCoverage-.81)<1e-8);
});

test('controls outside the selected panel cannot recommend a crop or inflate its coverage',()=>{
  const points=distributed((u,v)=>[-100+20*u,40+20*v]);
  const result=georef.georeferenceQuality(points,'affine',{width:1001,height:1001,mapping:{rect:{x:100,y:100,width:501,height:501}}});
  assert.equal(result.recommended,false);
  assert.equal(result.reason,'control-outside-validation-domain');
  assert.equal(result.crossValidationP95Pixels,null);
});

test('similarity warp fits two control points', () => {
  const warp = buildReferenceImageWarp([
    point('a', [0, 0], [10, 20]),
    point('b', [1, 0], [20, 20]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.SIMILARITY });
  assert.equal(warp.ok, true);
  assert.deepEqual(warp.project([0.5, 0]), [15, 20]);
});

test('affine warp reproduces a skewed plane', () => {
  const controlPoints = [
    point('a', [0, 0], [30, 10]),
    point('b', [1, 0], [40, 12]),
    point('c', [0, 1], [28, 20]),
    point('d', [1, 1], [38, 22]),
  ];
  const warp = buildReferenceImageWarp(controlPoints, { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  assert.equal(warp.ok, true);
  const center = warp.project([0.5, 0.5]);
  assert.ok(Math.abs(center[0] - 34) < 1e-8);
  assert.ok(Math.abs(center[1] - 16) < 1e-8);
});

test('projective warp passes through four corner control points', () => {
  const controlPoints = [
    point('a', [0, 0], [0, 0]),
    point('b', [1, 0], [12, 1]),
    point('c', [1, 1], [10, 10]),
    point('d', [0, 1], [-1, 9]),
  ];
  const warp = buildReferenceImageWarp(controlPoints, { mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE });
  assert.equal(warp.ok, true);
  for (const controlPoint of controlPoints) {
    const projected = warp.project(controlPoint.image);
    assert.ok(Math.abs(projected[0] - controlPoint.coordinate[0]) < 1e-7);
    assert.ok(Math.abs(projected[1] - controlPoint.coordinate[1]) < 1e-7);
  }
});

test('projective quad warp maps all four image corners exactly and rejects invalid quads', () => {
  const quad = [[0, 0], [12, 1], [10, 10], [-1, 9]];
  const warp = buildReferenceImageProjectiveWarpFromQuad(quad);
  assert.equal(warp.ok, true);
  const imageCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let index = 0; index < imageCorners.length; index += 1) {
    const projected = warp.project(imageCorners[index]);
    assert.ok(Math.abs(projected[0] - quad[index][0]) < 1e-7);
    assert.ok(Math.abs(projected[1] - quad[index][1]) < 1e-7);
  }
  assert.equal(buildReferenceImageProjectiveWarpFromQuad([[0, 0]]).ok, false);
});

test('similarity fit honors a pinned anchor exactly while soft GCPs absorb residual', () => {
  const controlPoints = [
    { ...point('anchor', [0.25, 0.5], [10, 20]), pinned: true },
    point('a', [0, 0], [0, 0]),
    point('b', [1, 0], [20, 2]),
    point('outlier', [0, 1], [80, 60]),
  ];
  const warp = buildReferenceImageWarp(controlPoints, { mode: REFERENCE_IMAGE_WARP_MODES.SIMILARITY });
  assert.equal(warp.ok, true);
  const anchor = warp.project([0.25, 0.5]);
  assert.ok(Math.abs(anchor[0] - 10) < 1e-9);
  assert.ok(Math.abs(anchor[1] - 20) < 1e-9);
  assert.equal(warp.diagnostics.hardPointCount, 1);
  assert.equal(warp.diagnostics.softPointCount, 3);
  assert.ok(warp.diagnostics.hardMaxMeters < 0.01);
  assert.ok(warp.diagnostics.rmsMeters > 0);
});

test('one pinned anchor plus one soft GCP is sufficient for similarity calibration', () => {
  const warp = buildReferenceImageWarp([
    { ...point('anchor', [0, 0], [10, 20]), pinned: true },
    point('gcp', [1, 0], [20, 20]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.SIMILARITY });
  assert.equal(warp.ok, true);
  const anchor = warp.project([0, 0]);
  assert.ok(Math.abs(anchor[0] - 10) < 1e-9);
  assert.ok(Math.abs(anchor[1] - 20) < 1e-9);
  assert.ok(warp.diagnostics.hardMaxMeters < 0.01);
});

test('affine and projective fits preserve a pinned anchor under noisy soft GCPs', () => {
  const cases = [
    {
      mode: REFERENCE_IMAGE_WARP_MODES.AFFINE,
      points: [
        { ...point('anchor', [0.4, 0.6], [30, 15]), pinned: true },
        point('a', [0, 0], [20, 5]),
        point('b', [1, 0], [42, 8]),
        point('c', [0, 1], [17, 28]),
        point('noise', [1, 1], [55, 35]),
      ],
    },
    {
      mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE,
      points: [
        { ...point('anchor', [0.35, 0.55], [40, 20]), pinned: true },
        point('a', [0, 0], [30, 10]),
        point('b', [1, 0], [55, 12]),
        point('c', [1, 1], [51, 35]),
        point('d', [0, 1], [27, 32]),
        point('noise', [0.7, 0.3], [49, 18]),
      ],
    },
  ];
  for (const item of cases) {
    const warp = buildReferenceImageWarp(item.points, { mode: item.mode });
    assert.equal(warp.ok, true);
    const pinned = item.points[0];
    const actual = warp.project(pinned.image);
    assert.ok(Math.abs(actual[0] - pinned.coordinate[0]) < 1e-7);
    assert.ok(Math.abs(actual[1] - pinned.coordinate[1]) < 1e-7);
    assert.ok(warp.diagnostics.hardMaxMeters < 0.01);
  }
});

test('pinned metadata survives normalization and diagnostics', () => {
  const warp = buildReferenceImageWarp([
    { ...point('anchor', [0, 0], [10, 20]), pinned: true },
    point('b', [1, 0], [20, 20]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.SIMILARITY });
  assert.equal(warp.ok, true);
  assert.equal(warp.controlPoints[0].pinned, true);
  assert.equal(warp.diagnostics.residuals.find(item => item.id === 'anchor').pinned, true);
});

test('composite calibration switches corner pins plus calibration to TPS rubber sheet', () => {
  const mapQuad = [[0, 0], [12, 1], [10, 10], [-1, 9]];
  const warp = buildReferenceImageCalibrationWarp({
    mapQuad,
    cornerPinEnabled: true,
    anchor: { image: [0.45, 0.55], coordinate: [4.2, 5.3] },
    controlPoints: [
      point('soft-a', [0.2, 0.3], [2.1, 2.4]),
      point('soft-b', [0.75, 0.25], [10.5, 0.5]),
    ],
    mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE,
  });
  assert.equal(warp.ok, true);
  assert.equal(warp.mode, REFERENCE_IMAGE_WARP_MODES.TPS);
  assert.equal(warp.diagnostics.hardPointCount, 5);
  assert.equal(warp.diagnostics.softPointCount, 2);
  assert.ok(warp.diagnostics.hardMaxMeters < 0.01);
});

test('composite calibration leaves corner-pin-only records to placement rendering', () => {
  const warp = buildReferenceImageCalibrationWarp({
    mapQuad: [[0, 0], [12, 1], [10, 10], [-1, 9]],
    cornerPinEnabled: true,
    controlPoints: [],
    anchor: null,
  });
  assert.equal(warp.ok, false);
  assert.equal(warp.reason, 'insufficient-control-points');
});

test('composite calibration rejects missing corner quad when calibration depends on it', () => {
  const warp = buildReferenceImageCalibrationWarp({
    mapQuad: null,
    cornerPinEnabled: true,
    anchor: { image: [0.5, 0.5], coordinate: [5, 5] },
  });
  assert.equal(warp.ok, false);
  assert.equal(warp.reason, 'invalid-corner-pin-quad');
  assert.equal(warp.mode, REFERENCE_IMAGE_WARP_MODES.TPS);
});

test('TPS rubber sheet keeps four corner pins and an internal anchor exact while fitting soft GCPs', () => {
  const points = [
    { ...point('corner-0', [0, 0], [0, 0]), pinned: true },
    { ...point('corner-1', [1, 0], [12, 1]), pinned: true },
    { ...point('corner-2', [1, 1], [10, 10]), pinned: true },
    { ...point('corner-3', [0, 1], [-1, 9]), pinned: true },
    { ...point('anchor', [0.45, 0.55], [4.2, 5.3]), pinned: true },
    point('soft-a', [0.2, 0.3], [2.1, 2.4]),
    point('soft-noise', [0.75, 0.25], [10.5, 0.5]),
  ];
  const warp = buildReferenceImageWarp(points, { mode: REFERENCE_IMAGE_WARP_MODES.TPS });
  assert.equal(warp.ok, true);
  for (const hard of points.filter(item => item.pinned)) {
    const actual = warp.project(hard.image);
    assert.ok(Math.abs(actual[0] - hard.coordinate[0]) < 1e-7);
    assert.ok(Math.abs(actual[1] - hard.coordinate[1]) < 1e-7);
  }
  assert.equal(warp.diagnostics.hardPointCount, 5);
  assert.equal(warp.diagnostics.softPointCount, 2);
  assert.ok(warp.diagnostics.hardMaxMeters < 0.01);
  assert.ok(warp.diagnostics.rmsMeters >= 0);
});

test('TPS warp interpolates its control points and auto selects TPS with six points', () => {
  const controlPoints = [
    point('a', [0, 0], [100, 30]),
    point('b', [1, 0], [110, 31]),
    point('c', [1, 1], [109, 40]),
    point('d', [0, 1], [99, 39]),
    point('e', [0.5, 0.25], [105, 33]),
    point('f', [0.4, 0.7], [103.5, 37.5]),
  ];
  const warp = buildReferenceImageWarp(controlPoints);
  assert.equal(warp.ok, true);
  assert.equal(warp.mode, REFERENCE_IMAGE_WARP_MODES.TPS);
  for (const controlPoint of controlPoints) {
    const projected = warp.project(controlPoint.image);
    assert.ok(Math.abs(projected[0] - controlPoint.coordinate[0]) < 1e-6);
    assert.ok(Math.abs(projected[1] - controlPoint.coordinate[1]) < 1e-6);
  }
});

test('linear constraints are sparsely resampled and auto-reversed against the base warp', () => {
  const baseWarp = buildReferenceImageWarp([
    point('a', [0, 0], [10, 50]),
    point('b', [1, 0], [20, 50]),
    point('c', [0, 1], [10, 40]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  assert.equal(baseWarp.ok, true);
  const sampled = buildReferenceImageLinearConstraintPoints([
    {
      id: 'coast',
      kind: 'coastline',
      image: [[0.2, 0.2], [0.5, 0.25], [0.8, 0.2]],
      coordinates: [[18, 48], [15, 47.5], [12, 48]],
      weight: 1,
    },
  ], { baseWarp, samplesPerConstraint: 4 });
  assert.equal(sampled.length, 4);
  assert.ok(sampled.every(item => item.linearConstraintId === 'coast'));
  assert.ok(sampled[0].coordinate[0] < sampled.at(-1).coordinate[0]);
});

test('linear refinement keeps anchor exact and bends the warp through sparse line constraints', () => {
  const controlPoints = [
    point('a', [0, 0], [10, 50]),
    point('b', [1, 0], [20, 50]),
    point('c', [0, 1], [10, 40]),
    point('d', [1, 1], [20, 40]),
  ];
  const anchor = { image: [0.5, 0.5], coordinate: [15, 45] };
  const result = buildReferenceImageLinearRefinement({
    controlPoints,
    anchor,
    baseMode: REFERENCE_IMAGE_WARP_MODES.AFFINE,
    linearConstraints: [{
      id: 'river',
      kind: 'river',
      image: [[0.2, 0.55], [0.5, 0.62], [0.8, 0.55]],
      coordinates: [[12, 44.8], [15, 43.8], [18, 44.8]],
      weight: 1,
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, REFERENCE_IMAGE_WARP_MODES.TPS);
  assert.equal(result.linePointCount, 4);
  assert.ok(result.diagnostics.hardMaxMeters < 0.01);
  const pinned = result.project(anchor.image);
  assert.ok(Math.abs(pinned[0] - anchor.coordinate[0]) < 1e-7);
  assert.ok(Math.abs(pinned[1] - anchor.coordinate[1]) < 1e-7);
  for (const sample of result.linePoints) {
    const actual = result.project(sample.image);
    assert.ok(Math.abs(actual[0] - sample.coordinate[0]) < 1e-6);
    assert.ok(Math.abs(actual[1] - sample.coordinate[1]) < 1e-6);
  }
});

test('mesh uses geographic coordinates from the solved warp', () => {
  const warp = buildReferenceImageWarp([
    point('a', [0, 0], [10, 20]),
    point('b', [1, 0], [20, 20]),
    point('c', [0, 1], [10, 30]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  const mesh = buildReferenceImageMesh(warp, { columns: 2, rows: 2 });
  assert.equal(mesh.vertices.length, 9);
  assert.equal(mesh.triangles.length, 8);
  assert.deepEqual(mesh.vertices[4].uv, [0.5, 0.5]);
  const coordinate = mesh.vertices[4].coordinate;
  assert.ok(Math.abs(coordinate[0] - 15) < 1e-8);
  assert.ok(Math.abs(coordinate[1] - 25) < 1e-8);
});

test('diagnostics flags control points concentrated in a small image area', () => {
  const warp = buildReferenceImageWarp([
    point('a', [0.1, 0.1], [10, 20]),
    point('b', [0.2, 0.1], [11, 20]),
    point('c', [0.1, 0.2], [10, 21]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  assert.equal(warp.ok, true);
  assert.ok(warp.diagnostics.warnings.includes('control-points-concentrated'));
});


test('automatic georeferencing rejects a bad candidate and preserves the hard anchor', () => {
  const coordinate = ([u, v]) => [10 + 2 * u + 0.1 * v, 50 + 0.2 * u + 2 * v];
  const candidates = [
    point('a', [0, 0], coordinate([0, 0])),
    point('b', [1, 0], coordinate([1, 0])),
    point('c', [0, 1], coordinate([0, 1])),
    point('d', [1, 1], coordinate([1, 1])),
    point('e', [0.2, 0.7], coordinate([0.2, 0.7])),
    point('f', [0.75, 0.35], coordinate([0.75, 0.35])),
    point('bad-city-match', [0.8, 0.2], [25, 65]),
  ].map((candidate, index) => ({ ...candidate, confidence: 1 - index * 0.03, origin: 'city' }));
  const anchorImage = [0.5, 0.5];
  const anchor = { image: anchorImage, coordinate: coordinate(anchorImage) };
  const result = buildReferenceImageAutoGeoref(candidates, {
    anchor,
    mode: REFERENCE_IMAGE_WARP_MODES.AFFINE,
    inlierThresholdMeters: 2000,
    maxTrials: 128,
    seed: 12345,
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, REFERENCE_IMAGE_WARP_MODES.AFFINE);
  assert.equal(result.inlierCount, 6);
  assert.deepEqual(result.rejectedIds, ['bad-city-match']);
  assert.ok(result.diagnostics.hardMaxMeters < 0.01);
  const projectedAnchor = result.project(anchorImage);
  assert.ok(Math.abs(projectedAnchor[0] - anchor.coordinate[0]) < 1e-9);
  assert.ok(Math.abs(projectedAnchor[1] - anchor.coordinate[1]) < 1e-9);
});

test('automatic georeferencing selects affine when cross-validation beats projective', () => {
  const images = [
    [0, 0], [1, 0], [0, 1], [1, 1],
    [0.2, 0.7], [0.75, 0.35], [0.35, 0.2], [0.65, 0.85],
  ];
  const coordinate = ([u, v]) => [10 + 2.4 * u + 0.35 * v, 50 + 0.25 * u + 1.8 * v];
  const result = buildReferenceImageAutoGeoref(
    images.map((image, index) => ({ ...point(String(index), image, coordinate(image)), confidence: 0.9 })),
    { mode: REFERENCE_IMAGE_WARP_MODES.AUTO, inlierThresholdMeters: 5000, seed: 13 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, REFERENCE_IMAGE_WARP_MODES.AFFINE);
  assert.equal(result.diagnostics.modelSelection.consensusMode, REFERENCE_IMAGE_WARP_MODES.PROJECTIVE);
  assert.equal(result.diagnostics.modelSelection.selectedMode, REFERENCE_IMAGE_WARP_MODES.AFFINE);
  const affine = result.diagnostics.modelSelection.validations.find(item => item.mode === REFERENCE_IMAGE_WARP_MODES.AFFINE);
  const projective = result.diagnostics.modelSelection.validations.find(item => item.mode === REFERENCE_IMAGE_WARP_MODES.PROJECTIVE);
  assert.ok(affine);
  assert.ok(projective);
  assert.ok(affine.rmsMeters <= projective.rmsMeters * 1.01);
});

test('automatic georeferencing keeps projective when perspective is real', () => {
  const images = [
    [0, 0], [1, 0], [0, 1], [1, 1],
    [0.2, 0.7], [0.75, 0.35], [0.35, 0.2], [0.65, 0.85],
  ];
  const coordinate = ([u, v]) => {
    const denominator = 1 + 0.12 * u - 0.08 * v;
    return [
      (10 + 2.2 * u + 0.4 * v) / denominator,
      (50 + 0.3 * u + 2.1 * v) / denominator,
    ];
  };
  const result = buildReferenceImageAutoGeoref(
    images.map((image, index) => ({ ...point(String(index), image, coordinate(image)), confidence: 0.9 })),
    { mode: REFERENCE_IMAGE_WARP_MODES.AUTO, inlierThresholdMeters: 5000, seed: 17 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, REFERENCE_IMAGE_WARP_MODES.PROJECTIVE);
  assert.equal(result.diagnostics.modelSelection.selectedMode, REFERENCE_IMAGE_WARP_MODES.PROJECTIVE);
});

test('automatic georeferencing is deterministic for the same seed', () => {
  const candidates = [
    point('a', [0, 0], [10, 50]),
    point('b', [1, 0], [12, 50]),
    point('c', [0, 1], [10, 52]),
    point('d', [1, 1], [12, 52]),
    point('e', [0.4, 0.6], [10.8, 51.2]),
    point('bad', [0.2, 0.8], [30, 20]),
  ];
  const options = {
    mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE,
    inlierThresholdMeters: 2500,
    maxTrials: 96,
    seed: 77,
  };
  const first = buildReferenceImageAutoGeoref(candidates, options);
  const second = buildReferenceImageAutoGeoref(candidates, options);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.inlierIds, second.inlierIds);
  assert.deepEqual(first.rejectedIds, second.rejectedIds);
  assert.equal(first.trials, second.trials);
});

test('automatic georeferencing fails cleanly when there are too few candidates', () => {
  const result = buildReferenceImageAutoGeoref([
    point('a', [0, 0], [10, 50]),
    point('b', [1, 0], [12, 50]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.AFFINE });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'insufficient-auto-georef-candidates');
  assert.equal(result.minimumPoints, 3);
});

test('automatic georeferencing keeps TPS out of the robust coarse-fit stage', () => {
  const result = buildReferenceImageAutoGeoref([
    point('a', [0, 0], [10, 50]),
    point('b', [1, 0], [12, 50]),
    point('c', [0, 1], [10, 52]),
  ], { mode: REFERENCE_IMAGE_WARP_MODES.TPS });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported-auto-georef-mode');
});
