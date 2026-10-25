import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGenericFeatureService,
  normalizeGenericFeatureCollection,
  normalizeGenericFeatureSemantics,
} from "../../apps/editor/frontend/js/modules/generic-feature-service.js";

const genericFeature = (id, geometry = { type: 'Point', coordinates: [1, 2] }, properties = {}) => ({
  type: 'Feature', id, geometry, properties: { schemaVersion: 2, name: id, color: '#123456', ...properties },
});

test('Generic normalization rejects old versions and retired top-level semantics', () => {
  for (const properties of [{ schemaVersion: 1 }, { schemaVersion: undefined },
    { schemaVersion: 2, role: 'territory' }, { schemaVersion: 2, ownerId: 'A' }]) {
    const feature = genericFeature('old', undefined, properties), before = structuredClone(feature);
    assert.throws(() => normalizeGenericFeatureSemantics(feature));
    assert.deepEqual(feature, before);
  }
});

test('new v2 Generic Feature uses canonical fallback provenance and rejects duplicate IDs', () => {
  const [normalized] = normalizeGenericFeatureCollection([genericFeature('one', undefined, {
    schemaVersion: 2,
    source: { schemaVersion: 1, kind: 'gis', dataset: 'roads', sourceId: 'r-1', sourceFormat: 'geojson', sourceType: 'road' },
  })]);
  assert.equal(normalized.properties.source.kind, 'gis');
  assert.throws(() => normalizeGenericFeatureCollection([genericFeature('one'), genericFeature('one')]), /중복/);
});

test('generic feature service sends commands without mutating its accepted read model', async () => {
  let genericFeatures = Object.freeze([]);
  const commands = [];
  let acknowledge;
  const service = createGenericFeatureService({
    documentModel: { list: domain => { assert.equal(domain, 'generic'); return genericFeatures; } },
    commandOwner: {
      executeCommand(command) {
        commands.push(command);
        return new Promise(resolve => { acknowledge = resolve; });
      },
    },
  });
  const feature = genericFeature('one', undefined, { schemaVersion: 2, source: {
    kind: 'gis', sourceFormat: 'geojson', sourceId: 'original',
    details: { legacyGenericSemantics: { ownerId: 'country-a', landBinding: 'hard' } },
  } });
  const created = service.add(feature);
  assert.equal(typeof created?.then, 'function');
  assert.equal(service.get('one'), null);
  assert.deepEqual(commands[0], { commandId: 'generic.create', targets: [{ domain: 'generic', id: 'one' }], payload: { feature } });
  const accepted = Object.freeze(normalizeGenericFeatureSemantics(structuredClone(feature)));
  genericFeatures = Object.freeze([accepted]);
  acknowledge({ ok: true, changed: true, before: { genericFeatures: [] }, after: { genericFeatures } });
  assert.equal(await created, accepted);
  const changed = service.updateMetadata('one', 'notes', '  Independent object  ');
  assert.equal(service.get('one'), accepted);
  assert.equal(commands[1].payload.value, '  Independent object  ', 'the Core owns normalization');
  const edited = Object.freeze({ ...accepted, properties: Object.freeze({ ...accepted.properties, notes: 'Independent object' }) });
  genericFeatures = Object.freeze([edited]);acknowledge({ ok: true, changed: true, before: { genericFeatures: [accepted] }, after: { genericFeatures } });
  assert.deepEqual(await changed, { ok: true, changed: true, feature: edited });
  const removed = service.remove('one');
  assert.equal(service.get('one'), edited);
  genericFeatures = Object.freeze([]);acknowledge({ ok: true, changed: true, before: { genericFeatures: [edited] }, after: { genericFeatures } });
  assert.deepEqual(await removed, { ok: true, feature: edited });
  assert.equal(service.list().length, 0);
  assert.deepEqual(commands.map(command => command.commandId), ['generic.create', 'generic.metadata', 'generic.remove']);
});

test('generic service preserves declared no-op and failure results from Core', async () => {
  const feature = Object.freeze(genericFeature('one'));
  const replies = [{ ok: true, changed: false, before: { genericFeatures: [feature] }, after: { genericFeatures: [feature] } },
    { ok: false, changed: false, error: { code: 'not-found', message: 'missing' } },
    { ok: false, changed: false, error: { code: 'invalid', message: 'unsupported field' } }];
  const service = createGenericFeatureService({ documentModel: { list: () => [feature] },
    commandOwner: { executeCommand: async () => replies.shift() } });
  assert.deepEqual(await service.updateMetadata('one', 'name', 'one'), { ok: true, changed: false, feature });
  assert.deepEqual(await service.remove('missing'), { ok: false, code: 'not-found' });
  await assert.rejects(service.updateMetadata('one', 'role', 'old field'), error => error.code === 'invalid' && error.message === 'unsupported field');
});

test('generic creation captures its submitted input and uses the exact ACK projection', async () => {
  const input = genericFeature('one');
  const accepted = Object.freeze(structuredClone(input));
  let acknowledge, dispatched;
  const service = createGenericFeatureService({ documentModel: { list: () => [genericFeature('later')] },
    commandOwner: { executeCommand(command) { dispatched = command;return new Promise(resolve => { acknowledge = resolve; }); } } });
  const pending = service.add(input);
  input.id = 'edited by caller';input.properties.name = 'mutated';
  assert.equal(dispatched.payload.feature.id, 'one');
  assert.equal(dispatched.payload.feature.properties.name, 'one');
  acknowledge({ ok: true, changed: true, before: { genericFeatures: [] }, after: { genericFeatures: [accepted] } });
  assert.equal(await pending, accepted);
});

test('generic imports preserve target order and never locally skip an empty import', async () => {
  const features = [genericFeature('two'), genericFeature('one')], commands = [];
  const service = createGenericFeatureService({ documentModel: { list: () => [] },
    commandOwner: { async executeCommand(command) {
      commands.push(command);
      return { ok: true, changed: true, before: { genericFeatures: [] }, after: { genericFeatures: features } };
    } } });
  assert.deepEqual(await service.addMany(features), features);
  assert.deepEqual(commands[0].targets, [{ domain: 'generic', id: 'two' }, { domain: 'generic', id: 'one' }]);
  assert.deepEqual(await service.addMany([]), []);
  assert.equal(commands[1].commandId, 'generic.import');
  assert.deepEqual(commands[1].payload, { features: [] });
});
