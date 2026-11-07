import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {libraryCheckout} from '../../tools/library-data.mjs';
import { join } from 'node:path';
import { entityFileName, readTerritorialSources, readTerritorialLineages, territorialSourceRoot } from '../../tools/territorial-entity-sources.mjs';
import { normalizeTerritorialLibraryEntity } from '../../tools/gis/territorial-library.js';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const countryPath = id => join(territorialSourceRoot, 'countries', entityFileName(id));
const lineagePath = id => join(territorialSourceRoot, 'lineages', id + '.json');
const files = kind => fs.readdirSync(join(territorialSourceRoot, kind)).filter(name => name.endsWith('.json'));
const receiptFor = (index, kind, name) => index.files['assets/data/territorial-entities/source/' + kind + '/' + name];
function assertCurrentReceipt(index, kind, name) {
  const file = join(territorialSourceRoot, kind, name);
  const bytes = fs.readFileSync(file), receipt = receiptFor(index, kind, name);
  assert.ok(receipt, 'source omitted from the current pinned archive: ' + file);
  assert.equal(bytes.length, receipt.bytes, file + ': archive source byte length changed');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), receipt.sha256,
    file + ': source bytes differ from pinned archive index');
  return JSON.parse(bytes);
}

test('the active library reads every country, lineage and complete geometry without loss', () => {
  const pin = read(new URL('../../config/library-data.json', import.meta.url));
  assert.match(pin.revision, /^[a-f0-9]{40}$/);
  assert.ok(pin.repository, 'library source identity required');
  const archive = JSON.parse(execFileSync('git', ['show', pin.revision + ':archive/index.json'], {
    cwd: libraryCheckout(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  }));
  assert.ok(archive.files, 'the pinned library must supply independent source receipts');
  const entities = readTerritorialSources(), lineages = readTerritorialLineages();
  assert.ok(entities.length && lineages.length, 'reject an empty library');
  assert.equal(entities.length, files('countries').length);
  assert.equal(lineages.length, files('lineages').length);
  const countries = new Map(entities.map(row => [row.entityId, row]));
  assert.equal(countries.size, entities.length, 'duplicate country identity');
  const members = new Set();
  for (const lineage of lineages) {
    const raw = assertCurrentReceipt(archive, 'lineages', lineage.lineageId + '.json');
    assert.deepEqual(lineage.entityRefs, raw.entityRefs, lineage.lineageId);
    assert.deepEqual(lineage.relations, raw.relations, lineage.lineageId);
    for (const id of lineage.entityRefs) {
      assert.ok(countries.has(id), 'missing lineage member: ' + id);
      assert.ok(!members.has(id), 'duplicate lineage member: ' + id);
      assert.equal(countries.get(id).lineageId, lineage.lineageId);
      members.add(id);
    }
    for (const relation of lineage.relations)
      assert.ok(countries.has(relation.from) && countries.has(relation.to), 'missing relation endpoint');
  }
  assert.equal(members.size, entities.length, 'orphan source entities');
  for (const entity of entities) {
    const raw = assertCurrentReceipt(archive, 'countries', entityFileName(entity.entityId));
    for (const key of ['entityId', 'entityKind', 'lineageId', 'names', 'alternateNames', 'parentEntityId'])
      assert.deepEqual(entity[key], raw[key], entity.entityId + ': ' + key);
    assert.deepEqual(entity.sourceInfo, raw.sourceInfo || {}, entity.entityId + ': source provenance');
    assert.deepEqual(entity.geometryVersions.map(row => row.geometry),
      raw.geometryVersions.map(row => row.geometry), entity.entityId + ': coordinates');
    const versions = entity.geometryVersions.map(row => row.versionId);
    assert.ok(versions.length > 0);
    assert.equal(new Set(versions).size, versions.length, entity.entityId + ': duplicate version');
    const visited = new Set([entity.entityId]);
    for (let parent = entity.parentEntityId; parent; parent = countries.get(parent)?.parentEntityId) {
      assert.ok(countries.has(parent) && !visited.has(parent), entity.entityId + ': broken parent chain');
      visited.add(parent);
    }
  }
});

test('invalid identities, duplicate geometry versions and corrupt coordinates are refused', () => {
  const entity = readTerritorialSources()[0];
  const original = read(countryPath(entity.entityId));
  const invalidId = structuredClone(original);
  invalidId.entityId = 'not-a-valid-id';
  assert.throws(() => normalizeTerritorialLibraryEntity(invalidId), /identity|kind/i);
  const duplicate = structuredClone(original);
  duplicate.geometryVersions.push(structuredClone(duplicate.geometryVersions[0]));
  assert.throws(() => normalizeTerritorialLibraryEntity(duplicate), /duplicate.*version/i);
  const corrupted = structuredClone(original);
  const firstPoint = value => Array.isArray(value)
    ? (value.length === 2 && value.every(Number.isFinite) ? value : value.map(firstPoint).find(Boolean)) : null;
  const point = firstPoint(corrupted.geometryVersions[0].geometry.coordinates);
  assert.ok(point, 'source polygon has actual coordinates');
  point[0] = 181;
  assert.throws(() => normalizeTerritorialLibraryEntity(corrupted), /coordinate|geometry|invalid/i);
  assert.deepEqual(read(countryPath(entity.entityId)), original, 'negative tests must not mutate source files');
});
