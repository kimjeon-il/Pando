import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTerritorialLibraryEntity } from '../assets/js/modules/territorial-library.js';

export const territorialDataRoot = fileURLToPath(new URL('../assets/data/territorial-entities/', import.meta.url));
export const entityFileName = entityId => {
  if (!/^[a-z]+:[A-Za-z0-9_-]+$/.test(entityId)) throw new Error(`Unsafe entity ID: ${entityId}`);
  return `${entityId.replace(':', '-')}.json`;
};

export function readTerritorialSources(root = path.join(territorialDataRoot, 'source')) {
  const entities = fs.readdirSync(root).filter(name => name.endsWith('.json')).sort().map(name => {
    const entity = normalizeTerritorialLibraryEntity(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')));
    if (name !== entityFileName(entity.entityId)) throw new Error(`Entity filename mismatch: ${name}`);
    return entity;
  });
  const ids = new Set();
  const versions = new Set();
  for (const entity of entities) {
    if (ids.has(entity.entityId)) throw new Error(`Duplicate entity: ${entity.entityId}`);
    ids.add(entity.entityId);
    for (const version of entity.geometryVersions) {
      if (versions.has(version.id)) throw new Error(`Duplicate geometry version: ${version.id}`);
      versions.add(version.id);
    }
  }
  const byId = new Map(entities.map(entity => [entity.entityId, entity]));
  for (const entity of entities) {
    const visited = new Set([entity.entityId]);
    let parent = entity.parentEntityId;
    while (parent) {
      if (!byId.has(parent) || visited.has(parent)) throw new Error(`Invalid catalog parent: ${entity.entityId}`);
      visited.add(parent); parent = byId.get(parent).parentEntityId;
    }
  }
  return entities;
}

export function writeNewTerritorialSource(raw, root = path.join(territorialDataRoot, 'source')) {
  const entity = normalizeTerritorialLibraryEntity(raw);
  fs.mkdirSync(root, {recursive: true});
  // Import tools must never replace a human edited authoritative source.
  fs.writeFileSync(path.join(root, entityFileName(entity.entityId)), `${JSON.stringify(entity, null, 2)}\n`, {flag: 'wx'});
  return entity;
}
