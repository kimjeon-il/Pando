import {execFile} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from '../native-tool.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const hydroPointScreenSources=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/hydro/point-screen.cpp',
  'shared/core/include/pandoeditor/losslessjson.h','shared/core/src/losslessjson.cpp']);
export function lineParts(geometry){
  if(geometry?.type==='LineString')return [geometry.coordinates];
  if(geometry?.type==='MultiLineString')return geometry.coordinates;
  throw Error('Unrecognized line geometry type: '+geometry?.type);
}
export function validatePointScreenResult(result,lineCount,pointCount,{allowFilteredLines=false}={}){
  if(!result||!Array.isArray(result.lineLengthsMeters)||
    (allowFilteredLines?(result.lineLengthsMeters.length<1||result.lineLengthsMeters.length>lineCount):result.lineLengthsMeters.length!==lineCount)||
    result.lineLengthsMeters.some(value=>!Number.isFinite(value)||value<0)||!Array.isArray(result.points)||result.points.length!==pointCount||
    result.points.some(item=>!item||!Number.isFinite(item.distanceMeters)||item.distanceMeters<0||
      !Array.isArray(item.nearestLonLat)||item.nearestLonLat.length!==2||item.nearestLonLat.some(value=>!Number.isFinite(value))))
    throw Error('Invalid native point-screen result');
}
export function windowsHydroRuntime(root){
  if(typeof root!=='string'||!root)throw Error('The matching OSGeo4W runtime root is required');
  const runtime=resolve(root),installed=readFileSync(join(runtime,'etc/setup/installed.db'),'utf8');
  for(const entry of ['geos geos-3.15.0-1.tar.bz2','proj9-runtime proj9-runtime-9.8.1-1.tar.bz2',
    'proj-runtime-data proj-runtime-data-9.8.1-1.tar.bz2']){
    if(!installed.split(/\r?\n/).some(line=>line.startsWith(entry+' ')))throw Error('OSGeo4W runtime version mismatch: '+entry.split(' ')[0]);
  }
  for(const name of ['bin/geos_c.dll','bin/proj_9.dll','share/proj/proj.db']){
    if(!statSync(join(runtime,name)).isFile())throw Error('OSGeo4W runtime file is missing: '+name);
  }
  return {bin:join(runtime,'bin'),projData:join(runtime,'share/proj')};
}
export async function screenHydroPoints(input,{root=defaultRoot,directory=resolve(root,'build-native/hydro-point-screen/artifact'),runtimeRoot,signal}={}){
  signal?.throwIfAborted();
  const executable=process.platform==='win32'?'pando-hydro-point-screen.exe':'pando-hydro-point-screen';
  const {binary,manifest}=verifyNativeTool({root,directory,target:'hydro-point-screen',executable,sourceFiles:hydroPointScreenSources});
  const environment={...process.env};
  if(process.platform==='win32'){
    if(manifest.runtimeVersion!=='osgeo4w-geos-3.15.0-proj-9.8.1')throw Error('Native Hydro point screen runtime mismatch');
    const runtime=windowsHydroRuntime(runtimeRoot);environment.PATH=runtime.bin+delimiter+(process.env.PATH||'');
    environment.PROJ_DATA=runtime.projData;environment.PROJ_LIB=runtime.projData;
  }
  const bytes=JSON.stringify(input);if(Buffer.byteLength(bytes)>256*1024*1024)throw Error('Point-screen input too large');
  const stdout=await new Promise((accept,reject)=>{
    const child=execFile(binary,[],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:16*1024*1024,signal,env:environment},
      (error,text,stderr)=>error?reject(new Error('Native Hydro point screen failed: '+error.message+' '+stderr,{cause:error})):accept(text));
    child.stdin.on('error',error=>{if(error.code!=='EPIPE')child.kill();});child.stdin.end(bytes);
  });
  signal?.throwIfAborted();return JSON.parse(stdout);
}
export async function scoreHydroGuidedBranches(branches,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(branches)||branches.length>10000||branches.some(row=>['current','candidate','reference'].some(key=>
    !Array.isArray(row?.[key])||row[key].length<2||row[key].some(point=>!Array.isArray(point)||point.length!==2||
      point.some(value=>!Number.isFinite(value))))))throw Error('Explicit bounded Hydro guided branch geometry required');
  if(!branches.length)return [];
  const result=await screenHydroPoints({mode:'guided-branches',branches},options);
  if(!Array.isArray(result?.branches)||result.branches.length!==branches.length||result.branches.some(row=>
    !Number.isFinite(row?.score)||row.score<0||!Number.isFinite(row.alignment)||Math.abs(row.alignment)>1.0000000001))
    throw Error('Invalid Hydro guided branch receipt');
  return result.branches;
}
export async function selectHydroUpstreams(groups,{kind,...options}={}){
  options.signal?.throwIfAborted();
  if(!['canonical','guided'].includes(kind)||!Array.isArray(groups)||groups.length>10000||groups.some(group=>
    !Number.isSafeInteger(group?.basin)||!Array.isArray(group.candidates)||!group.candidates.length||
    group.candidates.some(row=>!Number.isSafeInteger(row?.id)||!Number.isSafeInteger(row.basin)||!Number.isSafeInteger(row.order)||
      !Number.isFinite(row.area)||!Number.isFinite(row.flow)||
      !((row.score===null&&row.alignment===null)||(Number.isFinite(row.score)&&row.score>=0&&
        Number.isFinite(row.alignment)&&Math.abs(row.alignment)<=1.0000000001)))||
    new Set(group.candidates.map(row=>row.id)).size!==group.candidates.length))throw Error('Invalid Hydro upstream candidate groups');
  if(!groups.length)return [];
  const result=await screenHydroPoints({mode:kind+'-upstreams',groups},options);
  if(!Array.isArray(result?.groups)||result.groups.length!==groups.length||result.groups.some((row,i)=>
    !Number.isSafeInteger(row?.id)||!groups[i].candidates.some(candidate=>candidate.id===row.id)))
    throw Error('Invalid Hydro upstream decision receipt');
  return result.groups.map(row=>row.id);
}
export async function findHydroReferenceGuides({references,queries,maxDistance}={},options={}){
  options.signal?.throwIfAborted();
  const validLine=line=>Array.isArray(line)&&line.length>=2&&line.every(point=>Array.isArray(point)&&point.length===2&&
    point.every((value,i)=>Number.isFinite(value)&&Math.abs(value)<=(i===0?180:90)));
  if(!Array.isArray(references)||references.length>100000||references.some(line=>!validLine(line))||
    !Array.isArray(queries)||queries.length>100000||queries.some(line=>!Array.isArray(line)||(line.length&&!validLine(line)))||
    !Number.isFinite(maxDistance)||maxDistance<0)throw Error('Explicit bounded Hydro reference guides required');
  if(!queries.length)return [];
  const result=await screenHydroPoints({mode:'reference-guides',references,queries,maxDistance},options);
  if(!Array.isArray(result?.matches)||result.matches.length!==queries.length||result.matches.some((row,i)=>row!==null&&
    (!queries[i].length||!Number.isSafeInteger(row?.index)||row.index<0||row.index>=references.length||
      !Number.isFinite(row.distance)||row.distance<0||row.distance>maxDistance)))
    throw Error('Invalid Hydro reference guide receipt');
  return result.matches;
}
export async function longestHydroSourceLines(reaches,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(reaches)||reaches.length>100000||reaches.some(parts=>!Array.isArray(parts)))
    throw Error('Explicit bounded Hydro source parts required');
  if(!reaches.length)return [];
  const result=await screenHydroPoints({mode:'longest-lines',reaches},options);
  if(!Array.isArray(result?.indices)||result.indices.length!==reaches.length||result.indices.some((index,i)=>
    index===null?reaches[i].some(part=>Array.isArray(part)&&part.length>=2):
      !Number.isSafeInteger(index)||index<0||index>=reaches[i].length||!Array.isArray(reaches[i][index])||reaches[i][index].length<2))
    throw Error('Invalid Hydro longest line receipt');
  return result.indices.map((index,i)=>index===null?null:reaches[i][index]);
}
export async function matchHydroOsmBounds({candidates,targets}={},options={}){
  options.signal?.throwIfAborted();
  const valid=(box,nonempty)=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&
    (nonempty?box[2]>box[0]&&box[3]>box[1]:box[2]>=box[0]&&box[3]>=box[1]);
  if(!Array.isArray(candidates)||candidates.length>1000000||candidates.some(box=>!valid(box,true))||
    !Array.isArray(targets)||targets.length>100000||targets.some(box=>!valid(box,false)))throw Error('Explicit bounded Hydro OSM extents required');
  if(!targets.length)return [];
  if(!candidates.length)return targets.map(()=>null);
  const result=await screenHydroPoints({mode:'osm-waterway-match',candidates,targets},options);
  if(!Array.isArray(result?.matches)||result.matches.length!==targets.length||result.matches.some(index=>
    index!==null&&(!Number.isSafeInteger(index)||index<0||index>=candidates.length)))throw Error('Invalid Hydro OSM match receipt');
  return result.matches;
}
export async function calculateHydroCalibrationScreen({bounds,width,height,lines,polygons}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(bounds)||bounds.length!==4||bounds.some(value=>!Number.isFinite(value))||bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||
    !Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0||!Array.isArray(lines)||!Array.isArray(polygons))
    throw Error('Explicit Hydro calibration screen dimensions and geometry required');
  const result=await screenHydroPoints({mode:'calibration-screen',bounds,width,height,lines,polygons},options);
  if(!Number.isFinite(result?.lineLengthPx)||result.lineLengthPx<0||!Number.isFinite(result.polygonAreaPx)||result.polygonAreaPx<0)
    throw Error('Invalid Hydro calibration screen receipt');
  return result;
}
export async function findHydroCalibrationRiverDuplicates({centerLat,distanceKm,baseLines,rivers}={},options={}){
  options.signal?.throwIfAborted();
  if(!Number.isFinite(centerLat)||Math.abs(centerLat)>90||!Number.isFinite(distanceKm)||distanceKm<0||
    !Array.isArray(baseLines)||!Array.isArray(rivers)||rivers.length>100000)throw Error('Explicit Hydro calibration river input required');
  if(!rivers.length)return [];
  const result=await screenHydroPoints({mode:'calibration-river-duplicates',centerLat,distanceKm,baseLines,rivers},options);
  if(!Array.isArray(result?.rivers)||result.rivers.length!==rivers.length||result.rivers.some(row=>
    typeof row?.duplicate!=='boolean'||!Number.isFinite(row.duplicateFraction)||row.duplicateFraction<0||row.duplicateFraction>1||
    (row.duplicate&&row.duplicateFraction<.18)))throw Error('Invalid Hydro calibration duplicate receipt');
  return result.rivers;
}
export async function findHydroCalibrationLakeDuplicates({centerLat,distanceKm,basePolygons,lakes}={},options={}){
  options.signal?.throwIfAborted();
  if(!Number.isFinite(centerLat)||Math.abs(centerLat)>90||!Number.isFinite(distanceKm)||distanceKm<0||
    !Array.isArray(basePolygons)||!Array.isArray(lakes)||lakes.length>100000)throw Error('Explicit Hydro calibration lake input required');
  if(!lakes.length)return [];
  const result=await screenHydroPoints({mode:'calibration-lake-duplicates',centerLat,distanceKm,basePolygons,lakes},options);
  if(!Array.isArray(result?.lakes)||result.lakes.length!==lakes.length||result.lakes.some(row=>
    typeof row?.duplicate!=='boolean'||!Number.isFinite(row.duplicateFraction)||row.duplicateFraction<0||row.duplicateFraction>1.0000000001))
    throw Error('Invalid Hydro calibration lake duplicate receipt');
  return result.lakes;
}
export async function clipHydroCalibrationGeometries({bounds,geometries}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(bounds)||bounds.length!==4||bounds.some(value=>!Number.isFinite(value))||bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||
    !Array.isArray(geometries)||geometries.length>100000||geometries.some(value=>!value||typeof value!=='object'||Array.isArray(value)))
    throw Error('Explicit Hydro calibration clipping bounds and geometry required');
  if(!geometries.length)return [];
  const result=await screenHydroPoints({mode:'calibration-clip',bounds,geometries},options);
  const kinds=new Set(['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection']);
  if(!Array.isArray(result?.geometries)||result.geometries.length!==geometries.length||
    result.geometries.some(value=>!value||!kinds.has(value.type)))throw Error('Invalid Hydro calibration clipping receipt');
  return result.geometries;
}
// Compare only explicitly selected border fragments with the exact shared
// country boundary in geographic coordinates, matching the retained GIS test.
export async function verifyHydroBorderFragments({left,right,pair,features},options={}){
  if(!left||!right||typeof pair!=='string'||!/^[A-Z]{3}\/[A-Z]{3}$/.test(pair)||!Array.isArray(features)||!features.length)
    throw Error('Explicit country pair and selected river fragments required');
  const points=[];
  for(const row of features){const meta=row?.metadata;
    if(meta?.category!=='river'||meta.flags!==1||typeof meta.source!=='string'||
      !meta.source.includes('Natural Earth border ')||!meta.source.endsWith(' '+pair))throw Error('Invalid border fragment source pair or flags');
    const parts=lineParts(row.geometry);
    if(!Array.isArray(parts)||!parts.length)throw Error('Border fragment lines required');
    for(const part of parts){if(!Array.isArray(part)||!part.length)throw Error('Border fragment points required');
      for(const point of part){if(!Array.isArray(point)||point.length!==2||point.some(value=>!Number.isFinite(value)))
          throw Error('Invalid border fragment coordinate');points.push(point);if(points.length>1000000)throw Error('Too many border fragment points');}}
  }
  const result=await screenHydroPoints({mode:'shared-boundary',left,right,points},options);
  if(!Array.isArray(result?.distances)||result.distances.length!==points.length||
    result.distances.some(value=>!Number.isFinite(value)||value<0))throw Error('Invalid shared boundary distances');
  let maximum=0;for(const distance of result.distances)maximum=Math.max(maximum,distance);
  if(maximum>2e-6)throw Error('Border fragment differs from exact country shared boundary');
  return {pair,fragments:features.length,points:points.length,maxDistanceDegrees:maximum};
}
