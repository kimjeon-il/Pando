import {stringifyJsonBuffer,parseJsonBuffer} from './buffer-json.mjs';
import {createHash} from 'node:crypto';
import {territorialSourceLayout,validateTerritorialSourceGeometry} from '../../src/data/territorial-source-format.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const logicalRef=(entityId,versionId)=>({id:entityId+':'+versionId,version:1});
const fail=message=>{throw Error('Territorial geometry resource: '+message);};

/** Storage owns immutable coordinate bytes; the domain still receives a fully
 * materialized entity. No coordinate normalization or geometric work occurs. */
export function encodeTerritorialSource(entity){
 if(entity?.schemaVersion!==2||typeof entity.entityId!=='string'||!Array.isArray(entity.geometryVersions)
  ||Object.hasOwn(entity,'storageLayout'))fail('invalid source entity');
 const descriptor=structuredClone({...entity,geometryVersions:[]}),geometries=new Map(),ids=new Set();
 descriptor.storageLayout=territorialSourceLayout;
 descriptor.geometryVersions=entity.geometryVersions.map(version=>{
  const {geometry}=version;
  if(!geometry||typeof version.versionId!=='string'||!version.versionId||ids.has(version.versionId)
    ||Object.hasOwn(version,'geometryResource'))fail('invalid geometry version');
  ids.add(version.versionId);
  const bytes=Buffer.concat([stringifyJsonBuffer(geometry),Buffer.from('\n')]),sha256=hash(bytes),file='geometries/sha256-'+sha256+'.json';
  const prior=geometries.get(file);if(prior&&!prior.equals(bytes))fail('conflicting content hash');
  geometries.set(file,bytes);
  const resource={logicalRef:logicalRef(entity.entityId,version.versionId),role:'source',type:geometry.type,file,sha256,bytes:bytes.length};
  return Object.fromEntries(Object.entries(version).map(([key,value])=>key==='geometry'
    ?['geometryResource',resource]:[key,structuredClone(value)]));
 });
 return {descriptor,geometries};
}

export function decodeTerritorialSource(descriptor,readGeometry){
 if(descriptor?.storageLayout!==territorialSourceLayout||descriptor.schemaVersion!==2||typeof descriptor.entityId!=='string'
  ||!Array.isArray(descriptor.geometryVersions)||typeof readGeometry!=='function')fail('invalid source descriptor');
 const entity=structuredClone(descriptor);delete entity.storageLayout;
 entity.geometryVersions=descriptor.geometryVersions.map(version=>{
  const resource=validateTerritorialSourceGeometry(version,entity.entityId);
  const bytes=readGeometry(resource.file,resource);
  if(!Buffer.isBuffer(bytes)||bytes.length!==resource.bytes||hash(bytes)!==resource.sha256)fail('missing or corrupt geometry payload');
  let geometry;try{geometry=parseJsonBuffer(bytes);}catch{fail('invalid geometry JSON');}
  if(geometry.type!==resource.type)fail('geometry resource type mismatch');
  return Object.fromEntries(Object.entries(version).map(([key,value])=>key==='geometryResource'
    ?['geometry',geometry]:[key,structuredClone(value)]));
 });
 return entity;
}
