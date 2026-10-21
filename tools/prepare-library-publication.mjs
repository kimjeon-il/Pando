import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTerritorialLibraryEntity, normalizeTerritorialLibraryIndex,
  normalizeTerritorialLineage } from '../assets/js/modules/territorial-library.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const CURRENT_WORLD_SNAPSHOT_ID = 'world:natural-earth-5.1.1';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(bytes.toString('utf8'));

function contentObject(source, digest) {
  if (!HEX64.test(digest)) throw new Error('Invalid private library object hash');
  const bytes = readFileSync(join(source, 'objects', `${digest}.json`));
  if (sha256(bytes) !== digest) throw new Error(`Private library object SHA-256 mismatch: ${digest}`);
  return json(bytes);
}

// The target must be fresh. The public checkout and the user's source tree stay untouched.
export function materializeLibrarySource({ source, target, revision }) {
  if (!source || !target || !HEX64.test(revision) || existsSync(target)) {
    throw new Error('A fresh publication target and exact library revision are required');
  }
  const manifestBytes = readFileSync(join(source, 'library.json'));
  if (sha256(manifestBytes) !== revision) throw new Error('Private library revision does not match library.json bytes');
  const manifest = json(manifestBytes);
  if (manifest?.schemaVersion !== 1 || !HEX64.test(manifest.indexHash)
    || !manifest.entities || typeof manifest.entities !== 'object' || Array.isArray(manifest.entities)) {
    throw new Error('Invalid private library manifest');
  }
  const index = normalizeTerritorialLibraryIndex(contentObject(source, manifest.indexHash));
  const ids = index.entities.map(entry => entry.entityId);
  if (ids.length !== Object.keys(manifest.entities).length
    || ids.some(id => !HEX64.test(manifest.entities[id]))) {
    throw new Error('Private library manifest does not match index entities');
  }
  const entities = new Map(ids.map(id => {
    const entity = normalizeTerritorialLibraryEntity(contentObject(source, manifest.entities[id]));
    if (entity.entityId !== id) throw new Error(`Private library entity identity mismatch: ${id}`);
    const entry = index.entities.find(item => item.entityId === id);
    if (entity.entityKind !== entry.entityKind || entity.lineageId !== entry.lineageId
      || entity.parentEntityId !== entry.parentEntityId
      || JSON.stringify(entity.lifetime) !== JSON.stringify(entry.lifetime)
      || JSON.stringify(entity.names) !== JSON.stringify(entry.names)
      || JSON.stringify(entity.geometryVersions.map(row => row.versionId))
        !== JSON.stringify(entry.geometryVersions.map(row => row.versionId))) {
      throw new Error(`Private library index/entity metadata mismatch: ${id}`);
    }
    return [id, entity];
  }));
  const files = new Map();
  for (const lineage of index.lineages) {
    const value = { schemaVersion: 1, lineageId: lineage.lineageId, names: lineage.names,
      entities: lineage.entityRefs.map(id => entities.get(id)), relations: lineage.relations };
    normalizeTerritorialLineage(value);
    files.set(`countries/${lineage.lineageId}.json`, value);
  }
  let hasCurrentWorld = false;
  for (const snapshot of index.snapshots) {
    const name = snapshot.id === CURRENT_WORLD_SNAPSHOT_ID ? 'current-world' : snapshot.id;
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name) || files.has(`snapshots/${name}.json`)) {
      throw new Error(`Unsafe or duplicate snapshot identity: ${snapshot.id}`);
    }
    if (snapshot.id === CURRENT_WORLD_SNAPSHOT_ID) hasCurrentWorld = true;
    files.set(`snapshots/${name}.json`, snapshot);
  }
  if (!hasCurrentWorld) throw new Error('The selected current-world snapshot is missing');
  for (const [relative, value] of files) {
    const file = join(target, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  return { revision, entityCount: entities.size, lineageCount: index.lineages.length,
    snapshotCount: index.snapshots.length, target };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => {
    const at = process.argv.indexOf(name);
    return at < 0 ? null : process.argv[at + 1];
  };
  const source = arg('--source'), target = arg('--target'), revision = arg('--revision');
  const sourceRevision = arg('--source-revision');
  if (!source || !target || !HEX40.test(sourceRevision)) throw new Error('Pinned private source checkout is required');
  const actual = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  if (actual !== sourceRevision) throw new Error('Private source checkout does not match pinned Git commit');
  console.log(JSON.stringify(materializeLibrarySource({ source, target, revision })));
}
