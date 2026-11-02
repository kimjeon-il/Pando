import {normalizeHydronym} from './hydronym-normalize.mjs';
import {validateIndependentHydronyms} from './hydro-independent-name-policy.mjs';

const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
// Python sorts Unicode code points, rather than UTF-16 code units.
function compareNames(left,right){const a=Array.from(left,char=>char.codePointAt(0)),b=Array.from(right,char=>char.codePointAt(0));
  for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]-b[i];return a.length-b.length;}
const sortedUnique=values=>[...new Set(values)].sort(compareNames);
export function createHydroSystemNamer({aliases,systemOverrides,independentDocument}={}){
  if(!isObject(aliases)||!isObject(systemOverrides)||Object.values(aliases).some(value=>typeof value!=='string')||
    Object.values(systemOverrides).some(row=>!isObject(row)||typeof row.nameKo!=='string'||
      (row.aliases!==undefined&&(!Array.isArray(row.aliases)||row.aliases.some(value=>typeof value!=='string')))))
    throw Error('Invalid Hydro name overrides');
  const aliasSnapshot=structuredClone(aliases),overrideSnapshot=structuredClone(systemOverrides);
  const independent=validateIndependentHydronyms(structuredClone(independentDocument));
  const reviewed=new Set([...Object.values(aliasSnapshot),...Object.values(overrideSnapshot).map(row=>row.nameKo.trim())]);
  const normalize=value=>normalizeHydronym(value,'river',aliasSnapshot);
  return function nameSystem(input){
    const {systemId,chainIndexes,mainstemIndex,neNames}=input??{};
    if(!Number.isSafeInteger(systemId)||systemId<=0||!Array.isArray(chainIndexes)||!chainIndexes.length||
      chainIndexes.some(index=>!Number.isSafeInteger(index)||index<0)||new Set(chainIndexes).size!==chainIndexes.length||
      !chainIndexes.includes(mainstemIndex)||!isObject(neNames)||Object.values(neNames).some(value=>typeof value!=='string'))
      throw Error('Invalid Hydro system naming input');
    const override=overrideSnapshot[String(systemId)],replacement=independent[String(systemId)];
    const matches=replacement?{}:input.osmByChain;
    if(!isObject(matches))throw Error('Explicit Hydro OSM match decisions required');
    for(const match of Object.values(matches))if(match!=null&&(!isObject(match)||!Number.isSafeInteger(Number(match.id))||
      Number(match.id)<=0||(match.nameKo!==undefined&&typeof match.nameKo!=='string')||
      (match.names!==undefined&&(!Array.isArray(match.names)||match.names.some(value=>typeof value!=='string')))))
      throw Error('Invalid Hydro OSM match');
    const main=normalize(neNames[mainstemIndex]||''),neOther=sortedUnique(chainIndexes.map(index=>normalize(neNames[index]||'')).filter(Boolean));
    const osmNames=sortedUnique(chainIndexes.flatMap(index=>(matches[index]?.names||[]).map(normalize)).filter(Boolean));
    const osmName=matches[mainstemIndex]?.nameKo||'';
    const reviewedName=[main,...neOther,normalize(osmName),...osmNames].find(name=>reviewed.has(name))||'';
    const chosen=replacement?.nameKo||override?.nameKo||reviewedName||osmName||main||neOther[0]||'';
    let displayName=normalize(chosen),nameEnriched=Boolean(displayName);
    if(!displayName)displayName=`미명명 수계 ${systemId}`;
    const osmRelationIds=[...new Set(chainIndexes.map(index=>matches[index]).filter(Boolean).map(match=>Number(match.id)))].sort((a,b)=>a-b);
    let outputAliases=sortedUnique([...neOther,...osmNames,...(override?.aliases||[])].filter(name=>name&&name!==displayName));
    let tributaryNames=sortedUnique(chainIndexes.filter(index=>index!==mainstemIndex).flatMap(index=>
      [normalize(neNames[index]||''),normalize(matches[index]?.nameKo||'')]).filter(name=>name&&name!==displayName));
    if(replacement){outputAliases=[...replacement.aliases].sort(compareNames);tributaryNames=[...replacement.tributaryNames].sort(compareNames);}
    return {displayName,nameEnriched,aliases:outputAliases,tributaryNames,osmRelationIds,independent:Boolean(replacement)};
  };
}
