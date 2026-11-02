import {normalizeHydronym} from './hydronym-normalize.mjs';
import {matchHydroOsmBounds} from './hydro-point-screen-native.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const whitespace='[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const trim=value=>value.replace(new RegExp(`^${whitespace}+|${whitespace}+(?![\\s\\S])`,'gu'),'');
export function parseHydroOsmWaterways(document,{aliases}={}){
  if(!object(document)||!object(aliases)||(document.elements!=null&&!Array.isArray(document.elements)))throw Error('Invalid Hydro OSM elements or aliases');
  const result=[];
  for(const element of document.elements||[]){if(!object(element)||element.type!=='relation')continue;
    const tags=element.tags||{},bounds=element.bounds||{};if(!object(tags)||!object(bounds)||tags.type!=='waterway')continue;
    const keys=['minlon','minlat','maxlon','maxlat'];if(keys.some(key=>!Object.hasOwn(bounds,key)))continue;
    if(keys.some(key=>bounds[key]===null||typeof bounds[key]==='object'||
      (typeof bounds[key]==='string'&&!bounds[key].trim())))throw Error('Invalid Hydro OSM extent');
    const extent=keys.map(key=>Number(bounds[key]));
    if(extent.some(value=>!Number.isFinite(value)))throw Error('Invalid Hydro OSM extent');
    if(extent[2]<=extent[0]||extent[3]<=extent[1])continue;
    const names=[...new Set(['name:ko','name','name:en'].map(key=>trim(String(tags[key]||''))).filter(Boolean))];
    if(!names.length)continue;const id=Number(element.id||0);
    if(!Number.isSafeInteger(id)||id<=0)throw Error('Invalid Hydro OSM relation ID');
    result.push({id,bounds:extent,nameKo:normalizeHydronym(String(tags['name:ko']||''),'river',aliases),names});
  }
  return result;
}
export async function matchHydroOsmWaterways({rows,targets}={},options={}){
  if(!Array.isArray(rows)||rows.some(row=>!object(row)||!Number.isSafeInteger(row.id)||row.id<=0||
    !Array.isArray(row.names)||row.names.some(name=>typeof name!=='string')||typeof row.nameKo!=='string'))
    throw Error('Explicit Hydro OSM source rows required');
  const matches=await matchHydroOsmBounds({candidates:rows.map(row=>row.bounds),targets},options);
  return matches.map(index=>index===null?null:structuredClone(rows[index]));
}
