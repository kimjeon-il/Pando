import fs from 'node:fs';
import path from 'node:path';
import {readTerritorialSources,territorialDataRoot} from './territorial-entity-sources.mjs';
import {selectGeometryVersion} from '../assets/js/modules/territorial-library.js';

export function buildCurrentWorld() {
  const entities=new Map(readTerritorialSources().map(e=>[e.entityId,e]));
  const snapshot=JSON.parse(fs.readFileSync(path.join(territorialDataRoot,'source/snapshots/current-world.json'),'utf8'));
  if(snapshot.schemaVersion!==1 || new Set(snapshot.entityRefs).size!==snapshot.entityRefs.length)throw new Error('Invalid current snapshot');
  const {bbox,...metadata}=snapshot.sourceInfo.collectionMetadata;
  return {...metadata,features:snapshot.entityRefs.map(id=>{
    const entity=entities.get(id);
    if(!entity || entity.entityKind!=='general' || !entity.sourceInfo.featureId)throw new Error(`Missing current source identity: ${id}`);
    const version=selectGeometryVersion(entity,snapshot.referenceDate);
    if(!version)throw new Error(`No current geometry at ${snapshot.referenceDate}: ${id}`);
    return {type:'Feature',id:entity.sourceInfo.featureId,properties:structuredClone(entity.sourceInfo.featureProperties),geometry:structuredClone(version.geometry)};
  }),bbox};
}
