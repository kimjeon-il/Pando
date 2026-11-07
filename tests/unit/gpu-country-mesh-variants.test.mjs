import { describe as contractSuite } from 'node:test';
import * as __gpu_dep0 from "node:test";
import * as __gpu_dep1 from "node:assert/strict";
import * as __gpu_dep2 from "../../shared/frontend/js/modules/gpu-country-mesh-variants.js";
import * as __gpu_dep3 from "../../shared/frontend/js/modules/gpu-country-patch-presentation.js";
import * as __gpu_dep4 from "node:fs";
import * as __gpu_dep5 from "node:path";
import * as __gpu_dep6 from "node:url";
import * as __gpu_dep7 from "../../shared/frontend/js/modules/gpu-map-renderer.js";
import * as __gpu_dep8 from "../../shared/frontend/js/modules/temporal.js";
import * as __gpu_dep9 from "../../shared/frontend/js/modules/country-stroke-group-reuse.js";
import "../helpers/spherical-core.mjs";

// Original feature contract: gpu-country-mesh-variants.test.mjs
contractSuite("gpu-country-mesh-variants", () => {
const { describe : contractSuite } = __gpu_dep0;
const __contract_dep0 = __gpu_dep0;
const __contract_dep1 = __gpu_dep1;
const __contract_dep2 = __gpu_dep2;
const __contract_dep3 = __gpu_dep3;
const __contract_dep4 = __gpu_dep4;
const __contract_dep5 = __gpu_dep5;
const __contract_dep6 = __gpu_dep6;
const __contract_dep7 = __gpu_dep7;

// Original feature contract: gpu-country-mesh-variants.test.mjs
contractSuite("gpu-country-mesh-variants", () => {
const { describe : featureDescribe } = __contract_dep0;
const __suiteDependency0 = __contract_dep0;
const __suiteDependency1 = __contract_dep1;
const __suiteDependency2 = __contract_dep2;
const __suiteDependency3 = __contract_dep0;
const __suiteDependency4 = __contract_dep1;
const __suiteDependency5 = __contract_dep3;
const __suiteDependency6 = __contract_dep1;
const __suiteDependency7 = __contract_dep4;
const __suiteDependency8 = __contract_dep5;
const __suiteDependency9 = __contract_dep0;
const __suiteDependency10 = __contract_dep6;
const __suiteDependency11 = __contract_dep7;

// Original feature contract: gpu-country-mesh-variants.test.mjs
featureDescribe("gpu-country-mesh-variants", () => {
  const test = __suiteDependency0.default;
  const assert = __suiteDependency1.default;
  const {  createCountryMeshVariants  } = __suiteDependency2;
test('country mesh variants retire replaced resources once and keep the other quality when requested', () => {
  const retired = [];
  const variants = createCountryMeshVariants(entry => retired.push(entry.name));
  variants.replace('preview', () => ({ quality: 'preview', name: 'preview-1' }));
  variants.replace('canonical', () => ({ quality: 'canonical', name: 'canonical-1' }), { preserveOtherVariants: true });
  assert.deepEqual([...variants.keys()], ['preview', 'canonical']);
  variants.replace('canonical', () => {
    assert.deepEqual(retired, ['canonical-1'], 'old GPU resources are released before allocating replacements');
    return { quality: 'canonical', name: 'canonical-2' };
  }, { preserveOtherVariants: true });
  assert.deepEqual(retired, ['canonical-1']);
  variants.replace('canonical', () => ({ quality: 'canonical', name: 'canonical-3' }));
  assert.deepEqual(retired, ['canonical-1', 'preview-1', 'canonical-2']);
  assert.equal(variants.get('canonical').name, 'canonical-3');
  variants.clear();
  assert.deepEqual(retired, ['canonical-1', 'preview-1', 'canonical-2', 'canonical-3']);
});
});
// Original feature contract: gpu-country-patch-presentation.test.mjs
featureDescribe("gpu-country-patch-presentation", () => {
  const test = __suiteDependency3.default;
  const assert = __suiteDependency4.default;
  const {  createCountryPatchPresentation  } = __suiteDependency5;
test('country patch scene is held only for the current staged geometry while terrain is pending', () => {
  const owner = createCountryPatchPresentation();
  owner.begin({ eligible: true, ids: ['A'], token: 4, geometryRevision: 7, previousBaseResult: { frame: 1 } });
  assert.equal(Object.isFrozen(owner.current()), true);
  assert.equal(owner.phase(), 'waiting-mesh');
  assert.equal(owner.stage(4, 7), true);
  assert.equal(owner.canDrawOverride('A'), true);
  const ready = { geometryRevision: 7, canComposite: true, terrainAvailable: true,
    targetTileCount: 2, loadedTileCount: 1, terrainSettled: false };
  assert.equal(owner.shouldHold(ready), true);
  assert.equal(owner.heldBaseResult(), owner.current().previousBaseResult);
  assert.equal(owner.snapshot().heldFrameCount, 1);
  assert.equal(owner.shouldHold({ ...ready, geometryRevision: 8 }), false);
  assert.equal(owner.shouldHold({ ...ready, terrainSettled: true }), false);
  assert.equal(owner.promote(4, 7), true);
  assert.equal(owner.phase(), 'promoted');
  owner.retirePromoted();
  assert.equal(owner.current(), null);
});

test('country patch preservation rejects stale work and unrelated scene changes', () => {
  const owner = createCountryPatchPresentation();
  assert.equal(owner.preservesScene(() => { throw new Error('inactive scene evaluated'); }), false);
  assert.equal(owner.shouldHold({}), false);
  owner.begin({ eligible: false, ids: ['A'], token: 1, geometryRevision: 1 });
  assert.equal(owner.current(), null);
  owner.begin({ eligible: true, ids: ['A'], token: 2, geometryRevision: 2 });
  assert.equal(owner.stage(1, 2), false);
  assert.equal(owner.setIds(2, ['A', 'B']), true);
  assert.equal(owner.canDrawOverride('B'), false);
  assert.equal(owner.preservesScene(() => true), true);
  assert.equal(owner.preservesScene(() => false), false);
  owner.disablePreservation();
  assert.equal(owner.shouldHold({ geometryRevision: 2, canComposite: true, terrainAvailable: true,
    targetTileCount: 2, loadedTileCount: 1, terrainSettled: false }), false);
  assert.equal(owner.clearIfToken(1), false);
  assert.equal(owner.clearIfToken(2), true);
  assert.equal(owner.current(), null);
});
});
// Original feature contract: gpu-country-culling.test.mjs
featureDescribe("gpu-country-culling", () => {
  const assert = __suiteDependency6.default;
  const fs = __suiteDependency7.default;
  const path = __suiteDependency8.default;
  const test = __suiteDependency9.default;
  const {  fileURLToPath  } = __suiteDependency10;
  const {  countryDrawRangesForFrame, createCountryTriangleRangeMap, mergeCountryDrawRanges,  } = __suiteDependency11;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function mesh(bounds, flags = bounds.map(() => 0)) {
  const countryCount = bounds.length;
  return {
    triangleIndices: new Uint32Array(countryCount * 6),
    lineIndices: new Uint32Array(countryCount * 4),
    countryTriangleRanges: new Uint32Array(bounds.flatMap((_, index) => [index * 6, 6])),
    countryBoundaryRanges: new Uint32Array(bounds.flatMap((_, index) => [index * 4, 4])),
    countryBounds: new Int32Array(bounds.flatMap(values => values.map(value => Math.round(value * 1e6)))),
    countryBoundsFlags: new Uint32Array(flags),
    metadataCountryIds: bounds.map((_, index) => `C${index}`),
  };
}

function flatFrame({ center = [0, 0], scale = 100, viewport = [200, 100] } = {}) {
  return {
    mode: 1,
    cssViewport: viewport,
    cssTranslate: [viewport[0] / 2, viewport[1] / 2],
    cssScale: scale,
    flatCenter: center.map(value => value * Math.PI / 180),
    worldOffsets: [0],
  };
}

test('country draw culling merges adjacent visible canonical ranges', () => {
  const source = mesh([
    [-20, -5, -10, 5],
    [0, -5, 10, 5],
    [100, -5, 110, 5],
  ]);
  const result = countryDrawRangesForFrame(source, flatFrame(), { paddingPixels: 0 });
  assert.equal(result.culled, true);
  assert.equal(result.visibleCountryCount, 2);
  assert.deepEqual(result.ranges, [{ first: 0, count: 12 }]);
  assert.equal(result.indexCount, 12);
  assert.equal(result.fullIndexCount, 18);
});

test('country draw culling keeps date-line bounds visible around a 180 degree center', () => {
  const source = mesh([
    [179, -5, -179, 5],
    [0, -5, 10, 5],
  ], [1, 0]);
  const result = countryDrawRangesForFrame(source, flatFrame({ center: [180, 0], scale: 300 }), { paddingPixels: 0 });
  assert.equal(result.culled, true);
  assert.equal(result.visibleCountryCount, 1);
  assert.deepEqual(result.ranges, [{ first: 0, count: 6 }]);
});

test('globe culling rejects a country wholly behind the current hemisphere', () => {
  const source = mesh([
    [-5, -5, 5, 5],
    [175, -5, -175, 5],
  ], [0, 1]);
  const result = countryDrawRangesForFrame(source, {
    mode: 0,
    cssViewport: [400, 400],
    cssTranslate: [200, 200],
    cssScale: 100, // The entire globe fits: the rear hemisphere must still be culled.
    rowX: [0, 1, 0],
    rowY: [0, 0, -1],
    rowZ: [1, 0, 0],
    worldOffsets: [0],
  }, { paddingPixels: 0, fullRangeThreshold: 0.1 });
  assert.equal(result.culled, true);
  assert.equal(result.visibleCountryCount, 1);
  assert.deepEqual(result.ranges, [{ first: 0, count: 6 }]);
});

test('world view and legacy meshes retain one full draw range', () => {
  const source = mesh([
    [-20, -5, -10, 5],
    [100, -5, 110, 5],
  ]);
  const world = countryDrawRangesForFrame(source, flatFrame({ scale: 20, viewport: [400, 200] }), { paddingPixels: 0 });
  assert.equal(world.culled, false);
  assert.deepEqual(world.ranges, [{ first: 0, count: 12 }]);

  const legacy = countryDrawRangesForFrame({ triangleIndices: new Uint32Array(9) }, flatFrame());
  assert.equal(legacy.fallback, true);
  assert.deepEqual(legacy.ranges, [{ first: 0, count: 9 }]);
});

test('range merge keeps gaps and combines overlap or adjacency', () => {
  assert.deepEqual(mergeCountryDrawRanges([
    { first: 12, count: 3 },
    { first: 0, count: 6 },
    { first: 6, count: 6 },
    { first: 20, count: 4 },
    { first: 22, count: 4 },
  ]), [
    { first: 0, count: 15 },
    { first: 20, count: 6 },
  ]);
});

test('selection range map is materialized from metadata without reading triangle indices', () => {
  const source = {
    countryTriangleRanges: new Uint32Array([0, 6, 6, 12]),
    metadataCountryIds: ['AAA', 'BBB'],
    get triangleIndices() {
      throw new Error('metadata-backed range creation must not scan triangle indices');
    },
  };
  const ranges = createCountryTriangleRangeMap(source, source.metadataCountryIds);
  assert.deepEqual(ranges.get('AAA'), [{ first: 0, count: 6 }]);
  assert.deepEqual(ranges.get('BBB'), [{ first: 6, count: 12 }]);
});

test('selection interaction hot path performs only precomputed map lookups', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'shared/frontend/js/modules/gpu-scene-preparation.js'), 'utf8');
  const start = source.indexOf('function prepareGpuInteractionPlan(');
  assert.ok(start >= 0);
  const interactionSource = source.slice(start);
  assert.match(interactionSource, /triangleRangesByCountryId\?\.get\(id\)/);
  assert.doesNotMatch(interactionSource, /countryTriangleRanges|createCountryTriangleRangeMap|for\s*\(/);
});
});
});

// Original feature contract: gpu-country-pick-slot-guard.test.mjs
contractSuite("gpu-country-pick-slot-guard", () => {
const assert = __contract_dep1.default;
const { readFileSync } = __contract_dep4;
const test = __contract_dep0.default;

// Exercise the renderer's private scene entrypoint without constructing a GL device.
// The real function body is evaluated with only its GPU collaborators substituted.
const source = readFileSync(new URL("../../shared/frontend/js/modules/gpu-map-renderer.js", import.meta.url), 'utf8');
const start = source.indexOf('    function ensureCountryIdScene() {');
const end = source.indexOf('    function pick(screenPoint)', start);
assert.ok(start >= 0 && end > start);
const ensureScene = new Function('isWebGlRenderer', 'gl', 'mesh', 'state', 'ensurePickTarget',
  'meshVariants', 'surfacePresentation', 'meshCountryIds', 'countryIdSceneKey', 'pickSceneKey',
  'pickFramebuffer', 'pixelWidth', 'pixelHeight', `${source.slice(start, end)}\nreturn ensureCountryIdScene();`);

for (const [canonicalIds, activeIds, expected] of [
  [['A', 'B'], ['B', 'A'], false],
  [['A', 'B'], ['A'], false],
  [['A'], ['A', 'B'], false],
  [['A', 'B'], ['A', 'B'], true],
]) {
  test(`canonical picking eligibility for canonical ${canonicalIds} and active ${activeIds}`, () => {
    let targetRequests = 0;
    const entry = { mesh: { triangleIndices: [] }, countryIds: canonicalIds };
    const gl = { bindFramebuffer() {}, viewport() {}, enable() {} };
    const result = ensureScene(() => true, gl, {}, { layerVisibility: { objects: true } },
      () => { targetRequests += 1; }, new Map([['canonical', entry]]), { quality: 'canonical', targetQuality: 'canonical' }, activeIds,
      () => 'cached-scene', 'cached-scene', {}, 10, 10);
    assert.equal(result, expected);
    assert.equal(targetRequests, expected ? 1 : 0);
  });
}

test('pending surfaces cannot allocate a country picking target', () => {
  const result = ensureScene(() => true, {}, {}, { layerVisibility: { objects: true } },
    () => assert.fail('pending surfaces must not prepare picking'), new Map(),
    { quality: 'pending', targetQuality: 'canonical' }, [], () => 'cached-scene', 'cached-scene', {}, 10, 10);
  assert.equal(result, false);
});
});
});

// Original feature contract: country-stroke-group-reuse.test.mjs
contractSuite("country-stroke-group-reuse", () => {
const assert = __gpu_dep1.default;
const test = __gpu_dep0.default;
const { sharedCalculationCore } = __gpu_dep8;
const { assembleStrokeWithGroupReuse } = __gpu_dep9;

const row=(left,right,owners)=>({start:[left,10],end:[right,10],ownerIds:owners});
const quality=.499;
const native=(rows,angle)=>sharedCalculationCore.boundaryAssembleStrokePacket(rows,angle);
const full=rows=>native(rows.map(segment=>[segment.start,segment.end,segment.ownerIds]),quality);

test('P6 first-visit owner group reuse is byte-exact against original native C++ assembly',()=>{
  const a=['A','B'],b=['C'],c=['D'];
  const first=[row(0,1,a),row(1,2,a),row(5,6,b),row(6,7,b)];
  const initial=assembleStrokeWithGroupReuse(first,quality,native);
  assert.equal(initial.reusedGroups,0);
  assert.deepEqual(initial.packet,full(first));
  const second=[...first.slice(0,2),row(5,6.1,b),row(6.1,7,b),row(8,9,c)];
  const stages=[];
  const next=assembleStrokeWithGroupReuse(second,quality,native,initial.cache,
    (stage,ms,details)=>stages.push({stage,ms,...details}));
  assert.equal(next.reusedGroups,1);
  assert.equal(next.assembledGroups,2);
  assert.deepEqual(next.packet,full(second));
  assert.equal(stages.find(s=>s.stage==='group-reuse').reusedInputSegments,2);
  const back=assembleStrokeWithGroupReuse(first,quality,native,next.cache);
  assert.deepEqual(back.packet,full(first));
  assert.equal(back.packet.startsEnds.length,back.packet.segments.length*4);
  assert.equal(back.packet.chainPhase.length,back.packet.segments.length);
});

test('P6 owner group reuse invalidates raw double changes and quality, not just rounded GPU floats',()=>{
  const same=[row(0,1,['A','B']),row(3,4,['C'])];
  const first=assembleStrokeWithGroupReuse(same,quality,native);
  const changed=[row(0,1+1e-9,['A','B']),row(3,4,['C'])];
  const newPacket=assembleStrokeWithGroupReuse(changed,quality,native,first.cache);
  assert.equal(newPacket.reusedGroups,1);
  assert.equal(newPacket.assembledGroups,1);
  assert.deepEqual(newPacket.packet,full(changed));
  const differentQuality=assembleStrokeWithGroupReuse(same,2,native,first.cache);
  assert.equal(differentQuality.reusedGroups,0);
  assert.deepEqual(differentQuality.packet,
    native(same.map(segment=>[segment.start,segment.end,segment.ownerIds]),2));
});

test('P6 owner key collisions, malformed rows, and empty input defer to original compiled validation',()=>{
  const collision=[row(0,1,['A','B']),row(3,4,['A|B'])];
  const result=assembleStrokeWithGroupReuse(collision,quality,native);
  assert.equal(result.cache,null);
  assert.deepEqual(result.packet,full(collision));
  const empty=assembleStrokeWithGroupReuse([],quality,native);
  assert.equal(empty.cache,null);
  assert.deepEqual(empty.packet,full([]));
  const malformed=[row(0,1,[])];
  assert.throws(()=>assembleStrokeWithGroupReuse(malformed,quality,native),
    error=>error?.code==='PL-BOUNDARY-PACKET');
});
});
