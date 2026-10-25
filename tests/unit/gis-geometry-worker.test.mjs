import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { validateCollection } from "../../apps/editor/frontend/js/modules/gis-geometry-validation.js";
import { GIS_GEOMETRY_TIMEOUT_MS, createGisGeometryValidator, createImportService } from "../../apps/editor/frontend/js/modules/import-service.js";
import {createGisCoreFixture} from '../helpers/gis-core-fixture.mjs';
import { createGisWorkerHarness } from './helpers/gis-worker-harness.mjs';

function feature(id, coordinates) {
  return {
    type: 'Feature',
    id,
    properties: { name: id },
    geometry: { type: 'MultiPolygon', coordinates: [coordinates] },
  };
}

const square = [[[0, 0], [0, 2], [2, 2], [2, 0], [0, 0]]];
const degenerate = [[[0, 0], [0, 0], [0, 0], [0, 0]]];

test('scoped GIS validation trusts unchanged canonical geometry and validates affected countries', async t => {
  const worker = createGisWorkerHarness(t);
  const collection = { type: 'FeatureCollection', features: [feature('affected', square), feature('trusted', degenerate)] };
  assert.equal((await worker.validate(collection, ['affected'])).ok, true);
  assert.equal((await worker.validate(collection)).ok, false);
});

test('scoped GIS overlap ignores unrelated pairs and full validation finds them', () => {
  const far = square.map(ring => ring.map(([x,y]) => [x+10,y]));
  const collection = { type: 'FeatureCollection', features: [feature('affected', far), feature('trusted-a', square), feature('trusted-b', square)] };
  assert.equal(validateCollection(collection, ['affected']).overlapAreaKm2, 0);
  const full = validateCollection(collection);
  assert.ok(full.overlapAreaKm2 > 0);
  assert.deepEqual(full.firstOverlap, ['trusted-a','trusted-b']);
});

test('an empty scope falls back to full validation instead of silently trusting every country', async t => {
  const worker = createGisWorkerHarness(t);
  const collection = { type: 'FeatureCollection', features: [feature('invalid', degenerate)] };
  assert.equal((await worker.validate(collection, [])).ok, false);
});

test('actual GIS Worker detects overlap through the shared calculation kernel', async t => {
  const secondSquare = [[[10, 10], [10, 12], [12, 12], [12, 10], [10, 10]]];
  const left = feature('left', square);
  left.geometry.coordinates.push(secondSquare);
  const right = feature('right', square);
  const worker = createGisWorkerHarness(t);
  const result = await worker.validate({ type: 'FeatureCollection', features: [left, right] }, ['left']);
  assert.equal(result.ok, true);
  assert.ok(result.overlapAreaKm2 > 0);
  assert.deepEqual(result.firstOverlap, ['left', 'right']);
});

test('GIS validator sends unique affected IDs and treats an empty scope as full validation', async t => {
  const messages = [];
  const worker = {
    postMessage(message) {
      messages.push(message);
      if (message.type === 'request' && message.operation === 'gis.validate') globalThis.queueMicrotask(() => this.onmessage({ data: { ...message, type: 'result', ok: true, result: { overlapAreaKm2: 0 } } }));
    },
    terminate() {},
  };
  const validator = createGisGeometryValidator({ createWorker: () => worker });
  t.after(() => validator.dispose());
  const collection = { type: 'FeatureCollection', features: [feature('A', square)] };
  assert.equal((await validator.validate(collection, ['A', 'A', '', 0])).overlapAreaKm2, 0);
  assert.deepEqual(messages[0].payload.affectedIds, ['A', '0']);
  assert.deepEqual(messages[0].payload.collection, collection);
  await validator.validate(collection, []);
  assert.equal(messages[1].payload.affectedIds, null);
  await validator.validate(collection, ['A', 'A'], { overlapAffectedIds: ['A', 'A'] });
  assert.deepEqual(messages[2].payload, {
    collection, affectedIds: ['A'], overlapAffectedIds: ['A'],
  });
});

test('GIS validator rejects timed out work, disposes its worker and permits a fresh request', async t => {
  assert.equal(GIS_GEOMETRY_TIMEOUT_MS, 60_000);
  let builds = 0, terminations = 0;
  const validator = createGisGeometryValidator({ timeoutMs: 15, createWorker: () => {
    const responds = ++builds > 1;
    return {
      postMessage(message) {
        if (responds && message.type === 'request' && message.operation === 'gis.validate') globalThis.queueMicrotask(() => this.onmessage({ data: { ...message, type: 'result', ok: true, result: { overlapAreaKm2: 0 } } }));
      },
      terminate() { terminations++; },
    };
  } });
  t.after(() => validator.dispose());
  const collection = { type: 'FeatureCollection', features: [feature('A', square)] };
  await assert.rejects(validator.validate(collection), error => error.category === 'TIMEOUT' && error.operation === 'gis.validate');
  assert.equal(terminations, 1);
  assert.equal(validator.stats().pendingCount, 0);
  assert.equal((await validator.validate(collection)).overlapAreaKm2, 0);
  assert.equal(builds, 2);
});

test('current territorial import validates the complete batch and publishes only changed root IDs', async () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL("../../shared/frontend/js/vendor/polygon-clipping.min.js", import.meta.url), 'utf8'), context);
  const {store,repository,events,rootPatches:patches,committer}=await createGisCoreFixture([],{runtime:{uid:()=> 'source',polygonClipping:context.polygonClipping}});
  let result = { targetType: 'general', collection: { type: 'FeatureCollection', features: [
    feature('A', square), { ...feature('child', square), properties: { parent_id: 'A' } },
  ] } };
  const service = createImportService({ openImportWizard: async () => result, getWizardOptions: () => ({}),
    getProjectGeneration: () => 7, validateStructuredGeometry: () => assert.fail('territorial validation belongs to the transaction') });
  const planned = await service.openFiles([{ name: 'entities.geojson' }]);
  assert.equal(planned.status, 'planned');
  assert.equal(planned.plan.kind, 'territorial');
  assert.equal(planned.plan.projectGeneration, 7);
  assert.deepEqual(await committer.commitTerritorialImport(planned.plan.payload.result, 'entities.geojson'), ['A', 'child']);
  assert.equal(repository.get('child').properties.parentId, 'A');
  assert.deepEqual(repository.get('A').geometry, feature('A', square).geometry);
  assert.deepEqual(patches, [['A']]);
  assert.deepEqual(events, ['history', 'save']);
  const before = store.snapshot();
  result = { targetType: 'general', collection: { features: [feature('new', square), feature('new', square)] } };
  const duplicate = await service.openFiles([{ name: 'duplicates.geojson' }]);
  await assert.rejects(committer.commitTerritorialImport(duplicate.plan.payload.result, 'duplicates.geojson'), /duplicate|Duplicate|ID가 중복/);
  assert.deepEqual(store.snapshot(), before);
  assert.deepEqual(patches, [['A']]);
  assert.deepEqual(events, ['history', 'save']);
});

test('library pair scope checks new land against every donor without skipping donor shape validation', () => {
  const disjoint = square.map(ring => ring.map(([x,y]) => [x+12,y]));
  const overlap = square.map(ring => ring.map(([x,y]) => [x+1,y]));
  const donor = feature('donor', square), untouched = feature('untouched', overlap);
  const gained = feature('gained', disjoint);
  const collection = { type:'FeatureCollection', features:[donor, untouched, gained] };
  // The generic caller continues to detect donor/unchanged overlap.
  assert.deepEqual(validateCollection(collection, ['donor','gained']).firstOverlap, ['donor','untouched']);
  // A known difference-only donor cannot introduce a previously absent overlap.
  assert.equal(validateCollection(collection, ['donor','gained'],
    { overlapAffectedIds:['gained'] }).overlapAreaKm2, 0);
  const intersecting = { type:'FeatureCollection', features:[donor, untouched, feature('gained', overlap)] };
  assert.deepEqual(validateCollection(intersecting, ['donor','gained'],
    { overlapAffectedIds:['gained'] }).firstOverlap, ['donor','gained']);
  const invalidDonor = { type:'FeatureCollection', features:[feature('donor', degenerate), gained] };
  assert.throws(() => validateCollection(invalidDonor, ['donor','gained'],
    { overlapAffectedIds:['gained'] }), /유효하지 않습니다/);
  assert.throws(() => validateCollection(collection, ['donor'],
    { overlapAffectedIds:['gained'] }), /pair scope/);
});

test('large multipolygon overlap is validated as a whole without losing area or unmodified geometry', () => {
  const far = n => [[n*4,0],[n*4,2],[n*4+2,2],[n*4+2,0],[n*4,0]];
  const islands = Array.from({length:70},(_,i)=>[far(i)]);
  const large = {type:'Feature',id:'islands',properties:{name:'islands'},geometry:{type:'MultiPolygon',coordinates:islands}};
  const intersecting = feature('overlap',[[[0.5,0.5],[0.5,1.5],[1.5,1.5],[1.5,0.5],[0.5,0.5]]]);
  const separate = feature('far',[[[-4,0],[-4,1],[-3,1],[-3,0],[-4,0]]]);
  const input={type:'FeatureCollection',features:[large,intersecting]};
  const unchanged=structuredClone(input);
  const found=validateCollection(input,['overlap']);
  assert.deepEqual(found.firstOverlap,['islands','overlap']);
  assert.ok(found.overlapAreaKm2>1000);
  assert.deepEqual(input,unchanged);
  assert.equal(validateCollection({type:'FeatureCollection',features:[large,separate]},['far']).overlapAreaKm2,0);
});
