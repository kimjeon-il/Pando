import{isDeepStrictEqual}from'node:util';
import{assertHistoricalDisplayChanges,assertHistoricalCompiledChanges}from'./historical-display-review.mjs';
const intersects=(prefixes,scope)=>prefixes.some(p=>p===scope||p.startsWith(scope+'/')||scope.startsWith(p+'/'));
/** Preflight both source stores and compiled-only publication; no writes or full geometry traversal. */
export function assertHistoricalStorageChanges({prefixes,sourceIndex,previousSourceIndex,builtinIndex,previousBuiltinIndex,readSource,readPreviousSource,readCountry,readPreviousCountry,sourceFileChanged,readRawSource,countryFileChanged}){
 const territorial=intersects(prefixes,'assets/data/territorial-entities'),builtin=intersects(prefixes,'assets/data/builtin-world');if(!territorial&&!builtin)return {sources:0,countries:0};
 const oldSources=new Map(previousSourceIndex.entities.map(e=>[e.entityId,e])),oldCountries=new Map(previousBuiltinIndex.entities.map(e=>[e.entityId,e]));let sources=0,countries=0;
 const compiledInputs=builtin?builtinIndex.inputHashes.sourceRevisions:{};
 for(const entry of sourceIndex.entities){const prior=oldSources.get(entry.entityId),rawChanged=territorial&&sourceFileChanged(entry),inputChanged=Object.hasOwn(compiledInputs,entry.entityId)&&compiledInputs[entry.entityId]!==previousBuiltinIndex.inputHashes.sourceRevisions[entry.entityId];if(!territorial&&!inputChanged)continue;if(rawChanged&&!isDeepStrictEqual(readRawSource(entry),readSource(entry)))throw Error('Historical source/chunk input mismatch: '+entry.entityId);if(inputChanged&&compiledInputs[entry.entityId]!==entry.sha256)throw Error('Historical compiled input identity differs from paired source: '+entry.entityId);if(prior?.sha256===entry.sha256)continue;assertHistoricalDisplayChanges(readSource(entry),prior?readPreviousSource(prior):null);sources++;}
 if(builtin)for(const entry of builtinIndex.entities){const prior=oldCountries.get(entry.entityId);if(prior?.sha256===entry.sha256&&!countryFileChanged(entry))continue;assertHistoricalCompiledChanges(readCountry(entry),prior?readPreviousCountry(prior):null);countries++;}
 return {sources,countries};
}
