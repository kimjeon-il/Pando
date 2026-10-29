// Provenance and working-output ownership for the common C++ territorial engine.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {withLibraryOutputs} from '../library-data.mjs';
import {verifyCanonicalDEU,verifyHistoricalStateSource} from './verify-german-1914-originals.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
const round=(n,digits)=>Number(n.toFixed(digits));
const bounds=values=>values.map(value=>round(value,7));
const encode=value=>JSON.stringify(value,null,2)+'\n';
function scoped(root,path){
  if(typeof path!=='string'||!path||isAbsolute(path))throw Error('Expected a repository-relative path');
  const result=resolve(root,path),rel=relative(root,result);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Path escaped repository scope');
  return result;
}
function source(root,definition){
  const path=scoped(root,definition.path),bytes=readFileSync(path),normalized=Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n'));
  return {path,document:JSON.parse(bytes.toString('utf8')),sha256:sha(normalized)};
}
function coordinateRounding(value,digits){
  return Array.isArray(value)?value.map(child=>coordinateRounding(child,digits)):typeof value==='number'?round(value,digits):value;
}
export function buildGerman1914({root=defaultRoot,recipe,binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,check=false}){
  if(!binary)throw Error('PANDO_TERRITORIAL_RECIPE_BINARY must locate the native GEOS/PROJ tool');
  if(recipe?.validation?.areaMethod!=='wgs84-geodesic')throw Error('German area method must be WGS84 geodesic');
  const hgis=source(root,recipe.sources.hgisStates),country=source(root,recipe.sources.canonicalCountries);
  const raw=verifyHistoricalStateSource(hgis.document,recipe);verifyCanonicalDEU(country.document);
  if(country.sha256!==recipe.sources.canonicalCountries.sha256.toUpperCase())throw Error('Canonical country source SHA-256 mismatch');
  const paths=[scoped(root,recipe.output),scoped(root,recipe.diagnosticsOutput)];
  if(paths[0]===paths[1])throw Error('Output and diagnostics paths must differ');
  if(!check&&paths.some(existsSync))throw Error('Working output already exists; preserve the existing derivative');
  const process=spawnSync(binary,['--german-1914-base',root,'-'],{input:JSON.stringify(recipe),encoding:'utf8',maxBuffer:64*1024**2,windowsHide:true});
  if(process.error)throw process.error;if(process.status!==0)throw Error('Native historical recipe failed: '+process.stderr.trim());
  const native=JSON.parse(process.stdout),correction=recipe.linearCorrection,patch=native.patch,result=native.output;
  const geometry={...native.geometry,coordinates:coordinateRounding(native.geometry.coordinates,recipe.roundingDigits??7)};
  const collection={type:'FeatureCollection',name:'pandolab-german-empire-1914-working-base',crs:{type:'name',properties:{name:'EPSG:4326'}},features:[{
    type:'Feature',id:'historical-country:deutsches-reich:1914-base',properties:{name:'Deutsches Reich',referenceDate:recipe.referenceDate,status:'working-base-not-final',
      source:'HGIS Germany 1914, OSHistory linear correction, Natural Earth v5.1.1 Heligoland patch'},geometry}]};
  const payload=encode(collection),diagnostics={recipeId:recipe.id,referenceDate:recipe.referenceDate,
    source:{path:recipe.sources.hgisStates.path,sha256:hgis.sha256,featureCount:raw.features,rawBounds:bounds(raw.bounds)},
    linearCorrection:{source:correction.source,upstreamCommit:correction.upstreamCommit,longitude:correction.longitude,latitude:correction.latitude,
      implementation:'axis-correct port: WE->longitude, SN->latitude',correctedBoundsBeforePatch:bounds(native.corrected.bounds)},
    heligolandPatch:{componentCount:patch.componentCount,bounds:bounds(patch.bounds),areaKm2:round(patch.areaKm2,6)},
    output:{areaKm2:round(result.areaKm2,6),bounds:bounds(result.bounds),componentCount:result.componentCount,coordinateCount:result.coordinateCount,
      heligolandPatchDifferenceKm2:round(result.heligolandPatchDifferenceKm2,9),bytes:Buffer.byteLength(payload)}};
  const documents=[payload,encode(diagnostics)];
  if(check){
    for(let i=0;i<paths.length;i++)if(readFileSync(paths[i],'utf8').replaceAll('\r\n','\n')!==documents[i])throw Error('Generated file is stale: '+paths[i]);
  }else withLibraryOutputs({root,paths},()=>{
    for(let i=0;i<paths.length;i++){mkdirSync(dirname(paths[i]),{recursive:true});writeFileSync(paths[i],documents[i],{flag:'wx'});}
  });
  return diagnostics;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{recipe:{type:'string'},check:{type:'boolean',default:false}}});
    const recipePath=resolve(defaultRoot,values.recipe||'tools/historical-library/german-empire-1914-base.recipe.json');
    const result=buildGerman1914({recipe:JSON.parse(readFileSync(recipePath,'utf8')),check:values.check});
    console.log(JSON.stringify({mode:values.check?'check':'build',output:result.output},null,2));
  }catch(error){console.error('german-1914-base: '+error.message);process.exitCode=1;}
}
