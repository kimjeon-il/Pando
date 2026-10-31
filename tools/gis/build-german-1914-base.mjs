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
const coastAliases={DEU:['DEU','Germany','Deutschland','Federal Republic of Germany'],DNK:['DNK','Denmark','Danmark','Kingdom of Denmark'],
  POL:['POL','Poland','Polska','Republic of Poland'],RUS:['RUS','Russia','Russian Federation','Российская Федерация'],
  LTU:['LTU','Lithuania','Lietuva','Republic of Lithuania']};
const coastControls=[['Berlin',13.405,52.52,true],['Strasbourg',7.7521,48.5734,true],['Poznan',16.9252,52.4064,true],
  ['Danzig',18.6466,54.352,true],['Memel',21.1443,55.7033,true],['Warsaw',21.0122,52.2297,false],
  ['Copenhagen',12.5683,55.6761,false],['Prague',14.4378,50.0755,false]];
export function selectModernCoastCountries(document){
  if(document?.type!=='FeatureCollection'||!Array.isArray(document.features))throw Error('Expected current country features');
  const found=new Set(),selected=[];
  for(const feature of document.features){
    const values=[feature.id,...Object.values(feature.properties||{})].filter(value=>['string','number'].includes(typeof value)).map(value=>String(value).trim());
    const code=Object.keys(coastAliases).find(key=>coastAliases[key].some(alias=>values.includes(alias)));
    if(code){found.add(code);selected.push(feature.geometry);}
  }
  if(found.size!==Object.keys(coastAliases).length)throw Error('Target current-country geometries incomplete: '+[...found].sort().join(','));
  return selected;
}
export function buildGermanModernCoast({root=defaultRoot,output,diagnostics,binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY}){
  if(!binary)throw Error('PANDO_TERRITORIAL_RECIPE_BINARY must locate the native GEOS/PROJ tool');
  const paths=[scoped(root,output),scoped(root,diagnostics)];
  if(paths[0]===paths[1]||paths.some(existsSync))throw Error('Working output already exists or output paths coincide');
  const definitions={countries:'assets/data/countries-ne-5.1.1.geojson',
    historical:'tools/historical-library/sources/german-empire-1914/histogis-deutsches-reich-1871-1919.geojson',
    helgoland:'tools/historical-library/sources/german-empire-1914/helgoland-osm-preserved.geojson',
    dune:'tools/historical-library/sources/german-empire-1914/dune-osm-way-273992076.geojson'};
  const inputs=Object.fromEntries(Object.entries(definitions).map(([key,path])=>{
    const bytes=readFileSync(scoped(root,path));return [key,{document:JSON.parse(bytes),sha256:sha(bytes),path}];
  }));
  for(const key of ['historical','helgoland','dune'])if(inputs[key].document?.type!=='Feature'||!inputs[key].document.geometry)
    throw Error('Expected preserved '+key+' source feature');
  const request={historical:inputs.historical.document.geometry,modern:selectModernCoastCountries(inputs.countries.document),
    helgoland:inputs.helgoland.document.geometry,dune:inputs.dune.document.geometry,
    controls:coastControls.map(([name,x,y,expected])=>({name,point:[x,y],expected}))};
  const result=spawnSync(binary,['--german-1914-modern-coast','-'],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:64*1024**2,windowsHide:true});
  if(result.error)throw result.error;if(result.status!==0)throw Error('Native German modern coast failed: '+result.stderr.trim());
  const native=JSON.parse(result.stdout);
  if(native.valid!==true||native.geometry?.type!=='MultiPolygon'||!Array.isArray(native.geometry.coordinates)||
    !Array.isArray(native.controls)||native.controls.length!==coastControls.length||native.controls.some((value,index)=>value!==coastControls[index][3])||
    !['outsideKm2','areaKm2','historicalAreaKm2','changedKm2','helgolandKm2','duneKm2'].every(key=>typeof native[key]==='number'&&Number.isFinite(native[key])&&native[key]>=0)||native.outsideKm2>0.01)
    throw Error('Invalid native modern coast receipt');
  if(native.geographicValid!==true||typeof native.geographicRepaired!=='boolean'||
    !Number.isFinite(native.repairBoundaryDistanceMetres)||native.repairBoundaryDistanceMetres<0||native.repairBoundaryDistanceMetres>0.01||
    !Number.isFinite(native.repairAreaDifferenceKm2)||native.repairAreaDifferenceKm2<0)
    throw Error('Invalid geographic topology repair receipt; refusing candidate output');
  const feature={type:'Feature',id:'historical-country:deutsches-reich:1914-modern-coast-r1',properties:{name:'Deutsches Reich',englishName:'German Empire',
    referenceDate:'1914-07-31',status:'working-base-modern-coastline',
    coastlineBasis:'Current website DEU/DNK/POL/RUS/LTU coastline; historical land borders retained outside coastal surgery zone',
    coastlineNote:'Intermediate geometry only. Modern coastline will later be replaced by a reconstructed 1914 coastline.',
    heligoland:'High-resolution modern Helgoland/Düne geometry retained.'},geometry:native.geometry};
  const collection={type:'FeatureCollection',name:'pandolab-german-empire-1914-modern-coast-r1',features:[feature]};
  const receipt={referenceDate:'1914-07-31',historicalGeometryApproved:false,inputs:{websiteCountries:Object.keys(coastAliases).sort(),
    coastBufferMeters:12000,historicalMatchBufferMeters:12000,sources:Object.fromEntries(Object.entries(inputs).map(([key,value])=>[key,{path:value.path,sha256:value.sha256}]))},
    validation:{valid:true,geographicRepaired:native.geographicRepaired,repairBoundaryDistanceMetres:native.repairBoundaryDistanceMetres,
      repairAreaDifferenceKm2:native.repairAreaDifferenceKm2,geometryType:native.geometry.type,componentCount:native.geometry.coordinates.length,
      historicalAreaKm2:round(native.historicalAreaKm2,3),modernCoastAreaKm2:round(native.areaKm2,3),symmetricDifferenceKm2:round(native.changedKm2,3),
      differenceOutsideCoastZoneKm2:round(native.outsideKm2,6),helgolandAreaKm2:round(native.helgolandKm2,6),duneAreaKm2:round(native.duneKm2,6),
      controlPoints:coastControls.map(([name,,,expected],index)=>({name,expected,actual:native.controls[index]}))},
    notes:['Intermediate modern-coast working base; not a historical shoreline approval.','No intended geometry change outside the 12 km modern-coast zone.']};
  withLibraryOutputs({root,paths},()=>{
    for(const path of paths)if(existsSync(path))throw Error('Working output already exists');
    for(let i=0;i<paths.length;i++){mkdirSync(dirname(paths[i]),{recursive:true});writeFileSync(paths[i],encode(i?receipt:collection),{flag:'wx'});}
  });
  return receipt;
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
    const {values}=parseArgs({options:{recipe:{type:'string'},check:{type:'boolean',default:false},'modern-coast':{type:'boolean'},output:{type:'string'},diagnostics:{type:'string'}}});
    const recipePath=resolve(defaultRoot,values.recipe||'tools/historical-library/german-empire-1914-base.recipe.json');
    const result=values['modern-coast']?buildGermanModernCoast({output:values.output,diagnostics:values.diagnostics})
      :buildGerman1914({recipe:JSON.parse(readFileSync(recipePath,'utf8')),check:values.check});
    console.log(JSON.stringify({mode:values.check?'check':'build',output:values['modern-coast']?result.validation:result.output},null,2));
  }catch(error){console.error('german-1914-base: '+error.message);process.exitCode=1;}
}
