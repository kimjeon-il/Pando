import {builtinCountryAssets} from "../src/data/builtin-country-files.js";

const builtinRoot='assets/data/builtin-world/generated/v1/';
/** Select runtime dependencies without mutating the complete historical archive.
 * The callback must return verified bytes from this archive's pinned revision.
 * Older pins remain explicitly restorable for the one-time conversion tool. */
export function runtimeArchiveIndex(index,readVerified){
 const descriptor=index.files?.[builtinRoot+'index.json'];
 if(!descriptor)return index;
 const catalog=JSON.parse(readVerified(descriptor));
 if(catalog.storageLayout!=='country-files-v1')return index;
 const active=new Set([builtinRoot+'index.json',builtinRoot+'coverage-report.json']);
 for(const spec of builtinCountryAssets(catalog)){
  const path=builtinRoot+spec.file,archived=index.files[path];
  if(!archived||archived.sha256!==spec.sha256||archived.bytes!==spec.compressedBytes)
   throw Error('Builtin country archive integrity pin mismatch: '+path);
  active.add(path);
 }
 return {...index,files:Object.fromEntries(Object.entries(index.files).filter(([path])=>!path.startsWith(builtinRoot)||active.has(path)))};
}
