import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {currentCountryFlagUrl} from '../assets/js/modules/country-flags.js';
import {BUILTIN_SUBUNITS} from '../assets/js/modules/builtin-subunits.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const parents=new Map(BUILTIN_SUBUNITS.map(({sourceCountryId,parentId})=>[sourceCountryId,parentId]));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function territorialSourceFromNaturalEarth(feature) {
  const id=String(feature.id);
  const flag=currentCountryFlagUrl(id);
  const defaultFlagDataUrl=flag ? path.relative(root,fileURLToPath(flag)).split(path.sep).join('/') : '';
  return {
    schemaVersion:2,entityId:`state:${id}`,entityKind:'general',
    names:{ko:feature.properties.name},alternateNames:[],lifetime:{validFrom:null,validTo:null},
    parentEntityId:parents.has(id)?`state:${parents.get(id)}`:'',
    geometryVersions:[{versionId:`state:${id}:natural-earth-5.1.1`,validFrom:null,validTo:null,datePrecision:'current',certainty:'high',sourceId:'natural-earth-5.1.1',geometry:feature.geometry}],
    metadata:{sourceFeatureId:id,...(defaultFlagDataUrl?{defaultFlagDataUrl}:{})},
    sourceInfo:{sourceId:'natural-earth-5.1.1',title:'Natural Earth 5.1.1 Admin 0 Countries',license:'Public domain',featureId:feature.id,featureProperties:feature.properties,geometrySha256:sha(feature.geometry)},
  };
}
