import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countryImportIdentityKey,
  materializeResolvedCountries,
  resolveCountryIdentities,
} from '../../assets/js/modules/country-import-identity.js';

function country(id, name = id, properties = {}) {
  return {
    type: 'Feature', id,
    properties: { name, ...properties },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
  };
}

function imported(sourceNamespace, sourceIdField, sourceId, name = sourceId, extraProperties = {}) {
  return {
    type: 'Feature', id: sourceId,
    properties: { name, ...extraProperties },
    importIdentity: { sourceNamespace, sourceIdField, sourceId },
    geometry: { type: 'Polygon', coordinates: [[[10, 0], [11, 0], [11, 1], [10, 0]]] },
  };
}

test('official DEU source identity resolves to the canonical DEU without assigning an early UUID', () => {
  const current = [country('DEU', '독일')];
  const incoming = imported('natural-earth', 'ADM0_A3', 'DEU', 'Germany');
  const [resolution] = resolveCountryIdentities([incoming], current);
  assert.equal(resolution.status, 'existing');
  assert.equal(resolution.editorId, 'DEU');
  assert.equal(resolution.resolutionReason, 'official-id');
  const [materialized] = materializeResolvedCountries([resolution], { createId: () => 'must-not-be-used' });
  assert.equal(materialized.id, 'DEU');
  assert.deepEqual(materialized.properties, { name: '독일' });
  assert.deepEqual(materialized.geometry, incoming.geometry);
  assert.equal('importIdentity' in materialized, false);
});

test('only trusted IDs auto-match; names and arbitrary source aliases do not', () => {
  const current = [country('DEU', '독일')];
  const official = imported('custom-atlas', 'ISO_A3', 'DEU', 'Germany');
  const sameName = imported('custom-atlas', 'custom_id', 'GERMANY-OLD', '독일');
  const resolutions = resolveCountryIdentities([official, sameName], current);
  assert.deepEqual(resolutions.map(row => row.status), ['existing', 'unresolved']);
  assert.equal(resolutions[0].resolutionReason, 'official-id');
});

test('manual new identities are not persisted and do not auto-match on a later import', () => {
  const incoming = imported('custom', 'code', 'X1', '새 국가', { color: '#ff0000', arbitrary: 'discard' });
  const sourceKey = countryImportIdentityKey(incoming);
  const unresolved = resolveCountryIdentities([incoming], []);
  assert.throws(() => materializeResolvedCountries(unresolved), /모두 확인/);
  const manuallyNew = resolveCountryIdentities([incoming], [], { manualMappings: { [sourceKey]: 'new' } });
  const [created] = materializeResolvedCountries(manuallyNew, { createId: () => 'NEW-ID' });
  assert.equal(created.id, 'NEW-ID');
  assert.deepEqual(created.properties, { name: '새 국가' });
  assert.equal('importIdentity' in created, false);
  const [repeat] = resolveCountryIdentities([incoming], [created]);
  assert.equal(repeat.status, 'unresolved');
});

test('manual existing-country mapping preserves only canonical ID name dates and incoming geometry', () => {
  const current = country('DEU', '독일', { validFrom: '1949-05-23', ignored: true });
  const incoming = imported('custom', 'code', 'GER', 'Germany', { validTo: '1990-10-02', editor_color: '#ff0000' });
  const sourceKey = countryImportIdentityKey(incoming);
  const resolutions = resolveCountryIdentities([incoming], [current], { manualMappings: { [sourceKey]: 'existing:DEU' } });
  const [materialized] = materializeResolvedCountries(resolutions);
  assert.equal(materialized.id, 'DEU');
  assert.deepEqual(materialized.properties, { name: '독일', validFrom: '1949-05-23', validTo: '1990-10-02' });
});

test('replacement preserves trusted official PandoLab and GeoJSON IDs while FIDs receive UUIDs', () => {
  const official = imported('natural-earth', 'ADM0_A3', 'DEU', 'Germany');
  const pandolab = imported('pandolab', 'pandolab_id', 'PL-DEU', '독일');
  pandolab.importIdentity.pandolabId = 'PL-DEU';
  const featureId = imported('geojson', '__feature_id__', 'HIST-DEU', '역사 독일');
  const fid = imported('vector', '__fid__', '7', '새 국가');
  const resolved = resolveCountryIdentities([official, pandolab, featureId, fid], [], { allowImplicitNew: true });
  const generated = ['NEW-FID'];
  const materialized = materializeResolvedCountries(resolved, { createId: () => generated.shift() });
  assert.deepEqual(materialized.map(feature => feature.id), ['DEU', 'PL-DEU', 'HIST-DEU', 'NEW-FID']);
});
