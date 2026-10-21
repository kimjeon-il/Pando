import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeLibrarySource } from '../../tools/prepare-library-publication.mjs';
import { territorialIndexEntry } from '../../assets/js/modules/territorial-index-entry.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pando-publication-test-'));
  const source = join(root, 'private');
  const target = join(root, 'materialized');
  mkdirSync(join(source, 'objects'), { recursive: true });
  const lineage = JSON.parse(readFileSync(new URL('../../assets/data/territorial-entities/source/countries/afg.json', import.meta.url)));
  const entity = { ...lineage.entities[0], lineageId: lineage.lineageId };
  const entityBytes = Buffer.from(JSON.stringify(entity));
  const entry = territorialIndexEntry(entity, { sha256: 'e'.repeat(64), compressedBytes: 42, decodedBytes: entityBytes.length });
  const index = { schemaVersion: 2, entities: [entry],
    lineages: [{ lineageId: lineage.lineageId, names: lineage.names, relations: lineage.relations, entityRefs: [entity.entityId] }],
    snapshots: [{ schemaVersion: 1, id: 'world:natural-earth-5.1.1', referenceDate: '2026-10', entityRefs: [entity.entityId] }],
  };
  const indexBytes = Buffer.from(JSON.stringify(index));
  const indexHash = hash(indexBytes), entityHash = hash(entityBytes);
  writeFileSync(join(source, 'objects', `${indexHash}.json`), indexBytes);
  writeFileSync(join(source, 'objects', `${entityHash}.json`), entityBytes);
  const manifest = { schemaVersion: 1, indexHash, entities: { [entity.entityId]: entityHash } };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  writeFileSync(join(source, 'library.json'), manifestBytes);
  return { source, target, revision: hash(manifestBytes), indexHash, entityHash, entity };
}

test('materializes verified full entities, lineages and snapshots from private content objects', () => {
  const input = fixture();
  const result = materializeLibrarySource(input);
  assert.equal(result.entityCount, 1);
  const lineage = JSON.parse(readFileSync(join(input.target, 'countries/afg.json')));
  assert.equal(lineage.entities[0].entityId, 'state:AFG');
  assert.equal(lineage.entities[0].geometryVersions[0].geometry.type, 'Polygon');
  const current = JSON.parse(readFileSync(join(input.target, 'snapshots/current-world.json')));
  assert.equal(current.id, 'world:natural-earth-5.1.1');
  assert.deepEqual(current.entityRefs, ['state:AFG']);
});

test('rejects an altered private entity before writing materialized source', () => {
  const input = fixture();
  writeFileSync(join(input.source, 'objects', `${input.entityHash}.json`), '{}');
  assert.throws(() => materializeLibrarySource(input), /hash|무결성|SHA/i);
});

test('rejects a requested revision that is not the exact library.json byte hash', () => {
  const input = fixture();
  assert.throws(() => materializeLibrarySource({ ...input, revision: 'f'.repeat(64) }), /revision|판본/i);
});
