import {readLibraryDataFile} from '../data/library-context.mjs';

// Display interpretation belongs to a versioned data manifest, not JavaScript
// tables. Original GIS geometry remains pinned in the external data library.
export function validateBuiltinDisplayPolicy(value){
  if(value?.schema!=='pandolab-builtin-display-policy'||value.schemaVersion!==1
     ||!Array.isArray(value.subunits)||!Array.isArray(value.territoryMerges)
     ||!value.sourceAttributions||typeof value.sourceAttributions!=='object')
    throw new TypeError('Invalid builtin display policy');
  const unitIds=new Set(),mergedIds=new Set();
  const identifier=value=>typeof value==='string'&&/^[A-Z0-9]{2,5}$/.test(value);
  for(const row of value.subunits){
    if(!identifier(row.sourceCountryId)||!identifier(row.parentId)
      ||row.sourceCountryId===row.parentId||unitIds.has(row.sourceCountryId))
      throw new TypeError('Invalid or duplicate builtin subunit relation');
    if(row.note!==undefined&&typeof row.note!=='string')throw new TypeError('Invalid subunit provenance');
    unitIds.add(row.sourceCountryId);
  }
  for(const row of value.territoryMerges){
    if(!identifier(row.sourceId)||!identifier(row.controller)
      ||row.sourceId===row.controller||unitIds.has(row.sourceId)||mergedIds.has(row.sourceId))
      throw new TypeError('Invalid or duplicate builtin territory merge');
    mergedIds.add(row.sourceId);
  }
  return value;
}
export function loadBuiltinDisplayPolicy(path='assets/data/builtin-world/display-policy-v1.json'){
 const value=validateBuiltinDisplayPolicy(JSON.parse(readLibraryDataFile(path)));
 return Object.freeze({...value,
  subunits:Object.freeze(value.subunits.map(row=>Object.freeze(row))),
  territoryMerges:Object.freeze(value.territoryMerges.map(row=>Object.freeze(row)))});
}
