import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countryImportIdentityKey,
  materializeResolvedCountries,
  resolveCountryIdentities,
} from '../../assets/js/modules/country-import-identity.js';

function country(id, name = id, properties = {}) {
  return {
    type: 'Feature',
    id,
    properties: { editor_id: id, editor_name: name, ...properties },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  };
}

function imported(sourceNamespace, sourceIdField, sourceId, name = sourceId) {
  return {
    type: 'Feature',
    id: sourceId,
    properties: {
      editor_name: name,
      metadata: { importIdentity: { sourceNamespace, sourceIdField, sourceId } },
    },
    geometry: { type: 'Polygon', coordinates: [[[10, 0], [11, 0], [11, 1], [10, 0]]] },
  };
}

test('official DEU source identity resolves to the canonical DEU without assigning an early UUID', () => {
  const current = [country('DEU', '독일', { iso_a3: 'DEU' })];
  const incoming = imported('natural-earth', 'ADM0_A3', 'DEU', 'Germany');
  assert.equal(incoming.properties.editor_id, undefined);

  const [resolution] = resolveCountryIdentities([incoming], current);
  assert.equal(resolution.status, 'existing');
  assert.equal(resolution.editorId, 'DEU');
  assert.equal(resolution.resolutionReason, 'official-id');

  const [materialized] = materializeResolvedCountries([resolution], { createId: () => 'must-not-be-used' });
  assert.equal(materialized.id, 'DEU');
  assert.equal(materialized.properties.editor_id, 'DEU');
  assert.deepEqual(materialized.geometry, incoming.geometry);
});

test('source aliases are namespace-aware and names never auto-match', () => {
  const current = [country('DEU', '독일', {
    iso_a3: 'DEU',
    metadata: { importIdentities: [{ sourceNamespace: 'natural-earth', sourceIdField: 'ADM0_A3', sourceId: 'DEU' }] },
  })];
  const otherNamespace = imported('custom-atlas', 'ADM0_A3', 'DEU', '독일');
  const sameName = imported('custom-atlas', 'custom_id', 'GERMANY-OLD', '독일');
  const resolutions = resolveCountryIdentities([otherNamespace, sameName], current);
  assert.deepEqual(resolutions.map(row => row.status), ['existing', 'unresolved']);
  assert.equal(resolutions[0].resolutionReason, 'official-id');

  const namespacedCurrent = country('AAA', '같은 이름', {
    metadata: { importIdentities: [{ sourceNamespace: 'source-a', sourceIdField: 'local_code', sourceId: 'X1' }] },
  });
  const otherSource = imported('source-b', 'local_code', 'X1', '같은 이름');
  const [unresolved] = resolveCountryIdentities([otherSource], [namespacedCurrent]);
  assert.equal(unresolved.status, 'unresolved');
});

test('ambiguous identities require a manual decision and successful aliases round-trip', () => {
  const incoming = imported('custom', 'code', 'X1', '새 국가');
  const sourceKey = countryImportIdentityKey(incoming);
  const unresolved = resolveCountryIdentities([incoming], []);
  assert.throws(() => materializeResolvedCountries(unresolved), /모두 확인/);

  const manuallyNew = resolveCountryIdentities([incoming], [], { manualMappings: { [sourceKey]: 'new' } });
  const [created] = materializeResolvedCountries(manuallyNew, { createId: () => 'NEW-ID' });
  assert.equal(created.properties.editor_id, 'NEW-ID');
  assert.deepEqual(created.properties.metadata.importIdentities, [{
    sourceNamespace: 'custom', sourceIdField: 'code', sourceId: 'X1',
  }]);

  const [repeat] = resolveCountryIdentities([incoming], [created]);
  assert.equal(repeat.status, 'existing');
  assert.equal(repeat.editorId, 'NEW-ID');
  assert.equal(repeat.resolutionReason, 'source-key');
});

test('manual existing-country mapping preserves its project metadata and ID', () => {
  const current = country('DEU', '독일', {
    editor_custom: true,
    metadata: { curated: true },
  });
  const incoming = imported('custom', 'code', 'GER', 'Germany');
  const sourceKey = countryImportIdentityKey(incoming);
  const resolutions = resolveCountryIdentities([incoming], [current], {
    manualMappings: { [sourceKey]: 'existing:DEU' },
  });
  const [materialized] = materializeResolvedCountries(resolutions);
  assert.equal(materialized.properties.editor_id, 'DEU');
  assert.equal(materialized.properties.editor_custom, true);
  assert.equal(materialized.properties.metadata.curated, true);
});

test('project replacement creates general external IDs but preserves trusted PandoLab IDs', () => {
  const external = imported('natural-earth', 'ADM0_A3', 'DEU', 'Germany');
  const pandolab = imported('pandolab', 'pandolab_id', 'PL-DEU', '독일');
  pandolab.properties.metadata.importIdentity.pandolabId = 'PL-DEU';
  const resolved = resolveCountryIdentities([external, pandolab], [], { allowImplicitNew: true });
  const createdIds = ['NEW-EXTERNAL'];
  const materialized = materializeResolvedCountries(resolved, { createId: () => createdIds.shift() });
  assert.equal(materialized[0].properties.editor_id, 'NEW-EXTERNAL');
  assert.equal(materialized[1].properties.editor_id, 'PL-DEU');
});
