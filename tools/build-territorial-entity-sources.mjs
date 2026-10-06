import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {currentCountryFlagUrl} from '../assets/js/modules/country-flags.js';
import {BUILTIN_SUBUNITS,builtinSubunitId} from '../assets/js/modules/builtin-subunits.js';
import {writeNewTerritorialSource} from './territorial-entity-sources.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const parents=new Map(BUILTIN_SUBUNITS.map(({sourceCountryId,parentId})=>[sourceCountryId,parentId]));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function territorialSourceFromNaturalEarth(feature) {
  const id=String(feature.id);
  const flag=currentCountryFlagUrl(id);
  const defaultFlagDataUrl=flag ? path.relative(root,fileURLToPath(flag)).split(path.sep).join('/') : '';
  return {
    schemaVersion:1,entityId:`state:${id}`,entityKind:'general',canonicalName:feature.properties.name,
    displayNames:{ko:feature.properties.name},alternateNames:[],lifetime:{validFrom:null,validTo:null},
    parentEntityId:parents.has(id)?`state:${parents.get(id)}`:'',
    geometryVersions:[{id:`state:${id}:natural-earth-5.1.1`,validFrom:null,validTo:null,datePrecision:'current',certainty:'high',sourceId:'natural-earth-5.1.1',geometry:feature.geometry}],
    metadata:{sourceFeatureId:id,projectEntityId:parents.has(id)?builtinSubunitId(id):id,...(defaultFlagDataUrl?{defaultFlagDataUrl}:{})},
    sourceInfo:{sourceId:'natural-earth-5.1.1',title:'Natural Earth 5.1.1 Admin 0 Countries',license:'Public domain',featureId:feature.id,featureProperties:feature.properties,geometrySha256:sha(feature.geometry)},
  };
}

if(process.argv.includes('--import')) {
  const input=process.argv[process.argv.indexOf('--input')+1];
  if(!process.argv.includes('--input')) throw new Error('Explicit --input required for the one-time provenance import');
  const collection=JSON.parse(fs.readFileSync(input,'utf8'));
  for(const feature of collection.features) {
    const e=writeNewTerritorialSource(territorialSourceFromNaturalEarth(feature));
    if(sha(e.geometryVersions[0].geometry)!==sha(feature.geometry)) throw new Error(`Geometry changed: ${feature.id}`);
  }
  console.log(`Imported ${collection.features.length} unchanged Natural Earth entities; existing sources cannot be overwritten.`);
}
