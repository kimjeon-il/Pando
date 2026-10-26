#!/usr/bin/env node
/**
 * Read-only, pinned source audit for the July 1914 German Empire recipe.
 * An older HistoGIS 1871–1919 working polygon is NOT the Harvard 26-state
 * HGIS 1914 input. The original HGIS source must not be inferred, invented,
 * downloaded into the public repository, or silently replaced.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';

export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const PATHS=Object.freeze({
  naturalEarth:'assets/data/countries-ne-5.1.1.geojson',
  hgis:'tools/historical-library/sources/german-empire-1914/hgis-germany-states-1914.geojson',
  generated:'tools/historical-library/generated/german-empire-1914-base.geojson',
  histogis:'tools/historical-library/sources/german-empire-1914/histogis-deutsches-reich-1871-1919.geojson',
  working:'tools/historical-library/working/german-empire-1914-base.geojson',
  workingDiagnostics:'reports/geography/germany/diagnostics/german-empire-1914-base.diagnostics.json',
});
export const APPROVED_NE_SHA='52590ce133a779fc678496844c844137aeaa0dca41ceca1621cd7c50169f5efb';
export const HISTOGIS_SHA='0a75047b62dc835abd5a47282a7df71dedb4802395cd476d68f645fb5b81e9e9';
export const WORKING_SHA='1fc5aa30b821b981dc67d71dc62dd8643e1b24b006779c64489f7ec3a0cb2bfb';
export const DIAGNOSTICS_SHA='3eabc1d1ce5b32c3d0aef9564ab24edb39f1c7b0a1d11bd5f5feb493e5f8543c';
const MAX=32*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const isHex=s=>typeof s==='string' && /^[0-9a-f]{64}$/.test(s);
const fetchBytes=async url=>{
  const r=await fetch(url,{signal:AbortSignal.timeout(120000)});
  check(r.ok,'Pinned historical source fetch returned HTTP '+r.status);
  const advertised=Number(r.headers.get('content-length')||0);
  check(!advertised||advertised<=MAX,'Pinned historical source container oversized');
  const b=Buffer.from(await r.arrayBuffer());
  check(b.length<=MAX,'Pinned historical source response oversized');
  return b;
};
export function inventory(index,recipe){
  check(index?.files &&typeof index.files==='object','Pinned archive index unavailable');
  check(recipe?.referenceDate==='1914-07-31'
    &&recipe.sources?.hgisStates?.expectedFeatureCount===26
    &&recipe.sources.hgisStates.path===PATHS.hgis
    &&recipe.sources?.canonicalCountries?.path===PATHS.naturalEarth
    &&recipe.nativeStatus==='pending-actual-hgis-source-hash-and-geometry-oracle',
    'German 1914 source contract or historical source status changed');
  const storedNE=index.files[PATHS.naturalEarth];
  check(storedNE?.sha256===APPROVED_NE_SHA
    &&String(recipe.sources.canonicalCountries.sha256).toLowerCase()===APPROVED_NE_SHA,
    'Pinned Natural Earth digest and German 1914 recipe disagree');
  for(const [key,sha] of [
    ['histogis',HISTOGIS_SHA],['working',WORKING_SHA],['workingDiagnostics',DIAGNOSTICS_SHA]
  ])check(index.files[PATHS[key]]?.sha256===sha,
    'A different historical working-source archive is pinned: '+key);
  return {
    hgisIndexed:Boolean(index.files[PATHS.hgis]),
    generatedIndexed:Boolean(index.files[PATHS.generated]),
    naturalEarthIndexed:true,
    legacyWorkingGeometryIndexed:true,
    distinctHistoGISSourceIndexed:true,
    hgisPath:PATHS.hgis,
  };
}
export function extractArchived(index,path,stored){
  const entry=index?.files?.[path];
  check(entry &&isHex(entry.sha256)&&Number.isSafeInteger(entry.bytes)
    &&entry.bytes>0&&entry.bytes<=MAX
    &&typeof entry.stored==='string','No valid pinned archive receipt: '+path);
  check(entry.stored===path &&entry.encoding==='identity'
    ||/^archive\/blobs\/[0-9a-f]{64}\.(gz|bin)$/.test(entry.stored)
      &&['gzip','raw','none'].includes(entry.encoding),
    'Invalid archival source container mapping: '+path);
  const zipped=Buffer.from(stored);
  check(zipped.length<=MAX,'Archived compressed source oversized: '+path);
  const original=entry.encoding==='gzip'?gunzipSync(zipped):zipped;
  check(original.length===entry.bytes &&hash(original)===entry.sha256,
    'Archived source SHA-256 or byte length mismatch: '+path);
  return {bytes:original,sha256:entry.sha256,decodedBytes:entry.bytes};
}
export function verifyHistoricalStateSource(payload,recipe){
  check(payload?.type==='FeatureCollection'
    &&payload.features?.length===26,
    'A 26-feature original HGIS Germany 1914 polygon collection is mandatory');
  const names=new Set();
  const extent=[Infinity,Infinity,-Infinity,-Infinity];
  let vertices=0;
  const point=xy=>{
    check(Array.isArray(xy)&&xy.length>=2
      &&xy.every(Number.isFinite)&&Math.abs(xy[0])<=180&&Math.abs(xy[1])<=90,
      'Invalid original HGIS WGS84 point');
    extent[0]=Math.min(extent[0],xy[0]);extent[1]=Math.min(extent[1],xy[1]);
    extent[2]=Math.max(extent[2],xy[0]);extent[3]=Math.max(extent[3],xy[1]);
    vertices++;
  };
  const polygon=rings=>{
    check(Array.isArray(rings)&&rings.length>0,'Missing HGIS original polygon rings');
    for(const ring of rings){
      check(ring?.length>=4,'Incomplete HGIS original ring');
      check(ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1],
        'Unclosed HGIS original ring');
      for(const xy of ring)point(xy);
    }
  };
  for(const feature of payload.features){
    const geo=feature?.geometry, name=feature?.properties?.STAAT_NAME;
    check(typeof name==='string'&&name.trim()&&!names.has(name.trim()),
      'Missing or duplicate 1914 HGIS state identity');
    names.add(name.trim());
    check(['Polygon','MultiPolygon'].includes(geo?.type),
      'A 1914 HGIS original contains a non-polygon feature');
    if(geo.type==='Polygon')polygon(geo.coordinates);
    else for(const component of geo.coordinates)polygon(component);
  }
  const expected=recipe.sources.hgisStates.expectedBounds;
  const tolerance=recipe.sources.hgisStates.boundsToleranceDegrees;
  check(extent.every((n,i)=>Math.abs(n-expected[i])<=tolerance),
    '1914 HGIS source bounds do not match the published catalog envelope');
  return {features:payload.features.length,namedStates:names.size,
    coordinateCount:vertices,bounds:extent};
}
export function verifyCanonicalDEU(payload){
  check(payload?.type==='FeatureCollection'&&Array.isArray(payload.features),
    'Natural Earth source is not a FeatureCollection');
  const id=f=>f.id??f.properties?.editor_id??f.properties?.iso_a3??f.properties?.ADM0_A3;
  const matches=payload.features.filter(f=>id(f)==='DEU');
  check(matches.length===1 &&['Polygon','MultiPolygon'].includes(matches[0].geometry?.type),
    'Canonical Natural Earth DEU country missing or duplicated');
  return {featureCount:payload.features.length,countryId:'DEU',
    geometryType:matches[0].geometry.type};
}
export function verifyHeligolandNative(source,recipe,{
  binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY,
}={}){
  check(binary&&existsSync(binary),'C++ GEOS/PROJ recipe executable required');
  const candidate=mkdtempSync(join(tmpdir(),'german-1914-ne-'));
  try{
    const src=join(candidate,'countries.json'),spec=join(candidate,'heligoland.recipe.json');
    writeFileSync(src,source,{flag:'wx'});
    writeFileSync(spec,JSON.stringify({
      sources:{canonicalCountries:{path:'countries.json',crs:'EPSG:4326'}},
      operations:recipe.operations.filter(row=>
        ['modern-deu','heligoland-components'].includes(row.id)),
    }),{flag:'wx'});
    const p=spawnSync(binary,[candidate,spec],{
      encoding:'utf8',maxBuffer:2*1024*1024,
    });
    check(!p.error&&p.status===0,
      'Pinned Natural Earth Heligoland native GEOS audit failed: '+
      (p.stderr||p.error?.message||p.status));
    const output=JSON.parse(p.stdout);
    check(output.type==='MultiPolygon'
      &&output.coordinates?.length===recipe.heligolandPatch.expectedComponents,
      'Pinned Natural Earth island component count changed');
    const unchanged=readFileSync(src);
    check(unchanged.equals(source),'Read-only 1914 island validation changed its source');
    return {passed:true,componentCount:output.coordinates.length,
      nativeGeometrySha256:hash(Buffer.from(JSON.stringify(output)))};
  }finally{rmSync(candidate,{recursive:true,force:true});}
}
export async function audit(index,recipe,{
  revision,
  readOriginal,
  native=verifyHeligolandNative,
}={}){
  const info=inventory(index,recipe);
  const read=async(name)=>{
    const entry=index.files[PATHS[name]];
    check(entry,'Historical pinned source missing: '+name);
    return extractArchived(index,PATHS[name],await readOriginal(entry.stored));
  };
  const modern=await read('naturalEarth');
  check(modern.sha256===APPROVED_NE_SHA,'Canonical Natural Earth original differs');
  const modernInfo=verifyCanonicalDEU(JSON.parse(modern.bytes.toString('utf8')));
  const islands=native(modern.bytes,recipe);
  const histogis=await read('histogis');
  const working=await read('working');
  const legacy=await read('workingDiagnostics');
  check(histogis.sha256===HISTOGIS_SHA &&working.sha256===WORKING_SHA
    &&legacy.sha256===DIAGNOSTICS_SHA,'Previously archived 1914 working evidence changed');
  const diagnostics=JSON.parse(legacy.bytes.toString('utf8'));
  check(diagnostics.source?.repository==='acdh-oeaw/histogis-data'
    &&diagnostics.source?.sourcePolygonCount===27
    &&diagnostics.source?.license==='CC BY 4.0',
    'Previously archived working source is not the expected distinct HistoGIS dataset');
  check(diagnostics.referenceDate==='1914-07-31',
    'Original working geography reference date changed');
  let source=null;
  if(info.hgisIndexed){
    const archived=await read('hgis');
    source={sha256:archived.sha256,
      ...verifyHistoricalStateSource(JSON.parse(archived.bytes.toString('utf8')),recipe)};
  }
  return {
    schema:'pando-1914-german-originals-audit-v1',
    libraryRevision:revision,
    status:source?'hgis-present-needs-native-parity':'blocked-hgis-26-source-not-archived',
    native1914FullReconstructionVerified:false,
    originalHGIS1914Verified:Boolean(source),
    hgisOriginal:source,
    originalHGISSourceIndexed:info.hgisIndexed,
    generatedC1RecipeAssetIndexed:info.generatedIndexed,
    canonicalNE:{sha256:modern.sha256,decodedBytes:modern.decodedBytes,
      ...modernInfo,heligoland:islands},
    legacyWorking:{histoGISSha256:histogis.sha256,
      workingGeoJsonSha256:working.sha256,diagnosticsSha256:legacy.sha256,
      source:'HistoGIS, not the Harvard 26-state HGIS layer',
      sourcePolygonCount:27,notValidHGISOracle:true},
    rights:'Original Harvard HGIS permitted for non-commercial academic research only; do not silently redistribute',
    unchangedOriginals:true,applicationOrLibraryDataModified:false,
    caution:'A verified modern Heligoland donor and archived HistoGIS working derivative cannot validate the missing 26-state HGIS original.',
  };
}
export async function main(argv=process.argv.slice(2),{
  readRemote=fetchBytes,
}={}){
  let output;
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--output'&&argv[i+1]&&!output)output=resolve(argv[++i]);
    else throw Error('Usage: --output NEW_PRIVATE_RECEIPT.json');
  }
  check(output,'A fresh report output file is required');
  check(!existsSync(output),'Never overwrite previous historical original evidence');
  const config=JSON.parse(readFileSync(join(ROOT,'config/library-data.json'),'utf8'));
  check(config.repository==='kimjeon-il/PandoLab-library-data'
    &&/^[0-9a-f]{40}$/.test(config.revision),'Pinned library revision missing');
  const recipe=JSON.parse(readFileSync(join(
    ROOT,'tools/historical-library/german-empire-1914-base.recipe.json'),'utf8'));
  const base='https://raw.githubusercontent.com/'+config.repository+'/'+config.revision+'/';
  const index=JSON.parse((await readRemote(base+'archive/index.json')).toString('utf8'));
  const evidence=await audit(index,recipe,{
    revision:config.revision,
    readOriginal:path=>readRemote(base+path),
  });
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  console.log('GERMAN_1914_ORIGINALS='+JSON.stringify(evidence));
  return evidence;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error('german-1914-originals: '+e.message);process.exitCode=1;});
