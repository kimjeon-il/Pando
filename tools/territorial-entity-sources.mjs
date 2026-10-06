import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTerritorialLibraryEntity, normalizeTerritorialLineage } from '../assets/js/modules/territorial-library.js';

export const territorialDataRoot = fileURLToPath(new URL('../assets/data/territorial-entities/', import.meta.url));
export const entityFileName = entityId => {
  if (!/^[a-z]+:[A-Za-z0-9_-]+$/.test(entityId)) throw new Error(`Unsafe entity ID: ${entityId}`);
  return `${entityId.replace(':', '-')}.json`;
};

export function readTerritorialLineages(root = path.join(territorialDataRoot, 'source')) {
  const directory = path.join(root, 'countries');
  const lineages = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().map(name => {
    const lineage = normalizeTerritorialLineage(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
    if (name !== `${lineage.lineageId}.json`) throw new Error(`Lineage filename mismatch: ${name}`);
    return lineage;
  });
  const entities = lineages.flatMap(lineage => lineage.entities);
  const ids = new Set();
  for (const entity of entities) {
    if (ids.has(entity.entityId)) throw new Error(`Duplicate entity: ${entity.entityId}`);
    ids.add(entity.entityId);
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
  for (const lineage of lineages) for (const relation of lineage.relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) throw new Error('Missing lineage relation endpoint');
  }
  return lineages;
}

export function readTerritorialSources(root = path.join(territorialDataRoot, 'source')) {
  return readTerritorialLineages(root).flatMap(lineage => lineage.entities.map(entity => Object.freeze({...entity,lineageId:lineage.lineageId})));
}

// Curated source tools patch one identity in its existing lineage. Siblings,
// lineage names and relations are kept byte-for-value rather than normalized.
export function updateTerritorialSource(entityId, update, root = path.join(territorialDataRoot, 'source')) {
  const lineages = readTerritorialLineages(root);
  const lineage = lineages.find(item => item.entities.some(entity => entity.entityId === entityId));
  if (!lineage) throw new Error(`Missing source entity: ${entityId}`);
  const file = path.join(root, 'countries', `${lineage.lineageId}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const index = raw.entities.findIndex(entity => entity.entityId === entityId);
  const replacement = update(structuredClone(raw.entities[index]));
  if (replacement.entityId !== entityId) throw new Error('Source update changed identity');
  normalizeTerritorialLibraryEntity(replacement);
  raw.entities[index] = replacement;
  normalizeTerritorialLineage(raw);
  const ids = new Set(lineages.flatMap(item => item.entities.map(entity => entity.entityId)));
  if (replacement.parentEntityId && !ids.has(replacement.parentEntityId)) throw new Error('Missing source parent');
  const byId = new Map(lineages.flatMap(item => item.entities.map(entity => [entity.entityId,entity])));
  byId.set(entityId,replacement);
  const seen=new Set([entityId]);let parent=replacement.parentEntityId;
  while(parent){if(seen.has(parent))throw new Error('Cyclic source parent');seen.add(parent);parent=byId.get(parent).parentEntityId;}
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`);
  return normalizeTerritorialLibraryEntity(replacement);
}
