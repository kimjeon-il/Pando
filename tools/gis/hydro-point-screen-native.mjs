import {execFile} from 'node:child_process';
import {readFileSync,statSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTool} from "../build/native-tool.mjs";

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
export const hydroPointScreenSources=Object.freeze(['tools/cpp/CMakeLists.txt','tools/cpp/hydro/point-screen.cpp',
  'tools/cpp/map-image/raster-draw.h','tools/cpp/map-preview/PILLOW-LICENSE',
  'src/data/native/include/pandoeditor/losslessjson.h','src/data/native/src/losslessjson.cpp']);
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
export async function observeHydroOutlets({land,lakes,points}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(land)||!land.length||land.length>100000||!Array.isArray(lakes)||lakes.length>100000||
    !Array.isArray(points)||points.length>100000||points.some(point=>!Array.isArray(point)||point.length!==2||
      point.some((value,i)=>!Number.isFinite(value)||Math.abs(value)>(i===0?180:90))))
    throw Error('Explicit rendered Hydro land, lakes and outlet points required');
  if(!points.length)return [];
  const result=await screenHydroPoints({mode:'outlet-observations',land,lakes,points},options);
  if(!Array.isArray(result?.observations)||result.observations.length!==points.length||result.observations.some(row=>
    !row||!(row.lakeDistance===null||(Number.isFinite(row.lakeDistance)&&row.lakeDistance>=0))||typeof row.lakeCovers!=='boolean'||
    !Number.isFinite(row.coastDistance)||row.coastDistance<0||typeof row.onLand!=='boolean'||
    !Number.isFinite(row.outsideLength)||row.outsideLength<0||!Array.isArray(row.target)||row.target.length!==2||
    row.target.some(value=>!Number.isFinite(value))))throw Error('Invalid Hydro outlet observations');
  return result.observations;
}
function validBorderCandidate(row){
  return row===null||(Number.isFinite(row?.start)&&row.start>=0&&Number.isFinite(row.end)&&row.end>=0&&Number.isFinite(row.length)&&row.length>0&&
    Number.isFinite(row.score)&&row.score>=0&&Array.isArray(row.distances)&&row.distances.length>0&&
    row.distances.every(value=>Number.isFinite(value)&&value>=0&&value<=12)&&Array.isArray(row.metricBorder)&&row.metricBorder.length>=2&&
    row.metricBorder.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)));
}
export async function scoreHydroBorderCandidates(requests,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(requests)||requests.length>10000)throw Error('Explicit bounded Hydro border candidates required');
  if(!requests.length)return [];
  const result=await screenHydroPoints({mode:'border-candidates',requests},options);
  if(!Array.isArray(result?.candidates)||result.candidates.length!==requests.length||result.candidates.some(row=>!validBorderCandidate(row)))
    throw Error('Invalid Hydro border candidate receipt');return result.candidates;
}
export async function findHydroSharedCountryBorders(countries,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(countries)||countries.length>100000||countries.some(row=>typeof row?.id!=='string'||!row.id||!row.geometry)||
    new Set(countries.map(row=>row.id)).size!==countries.length)throw Error('Explicit unique Hydro country polygons required');
  if(!countries.length)return [];
  const result=await screenHydroPoints({mode:'shared-country-borders',countries},options);
  const ids=new Set(countries.map(row=>row.id));
  if(!Array.isArray(result?.lines)||result.lines.some(row=>!Array.isArray(row?.pair)||row.pair.length!==2||
    row.pair[0]>=row.pair[1]||row.pair.some(id=>!ids.has(id))||!Array.isArray(row.coordinates)||row.coordinates.length<2||
    row.coordinates.some(point=>!Array.isArray(point)||point.length!==2||point.some((value,i)=>!Number.isFinite(value)||Math.abs(value)>(i===0?180:90)))))
    throw Error('Invalid Hydro shared country borders');return result.lines;
}
export async function selectHydroBorderCandidates({borders,requests}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(borders)||borders.length>100000||!Array.isArray(requests)||requests.length>10000)
    throw Error('Explicit bounded Hydro indexed border requests required');
  if(!requests.length)return [];
  const result=await screenHydroPoints({mode:'border-candidate-index',borders,requests},options);
  if(!Array.isArray(result?.candidates)||result.candidates.length!==requests.length||result.candidates.some(row=>
    !validBorderCandidate(row)||(row!==null&&(!Number.isSafeInteger(row.lineIndex)||row.lineIndex<0||row.lineIndex>=borders.length||
      !Array.isArray(row.pair)||row.pair.length!==2||row.pair.some((value,i)=>value!==borders[row.lineIndex]?.pair?.[i])))))
    throw Error('Invalid Hydro indexed border candidates');return result.candidates;
}
export async function findHydroNearbyBorders({borders,requests}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(borders)||borders.length>100000||!Array.isArray(requests)||requests.length>10000)
    throw Error('Explicit bounded Hydro nearby border requests required');
  if(!requests.length)return [];
  const result=await screenHydroPoints({mode:'border-nearby-index',borders,requests},options);
  if(!Array.isArray(result?.nearby)||result.nearby.length!==requests.length||result.nearby.some(row=>!Array.isArray(row)||
    row.some((value,index)=>!Number.isSafeInteger(value)||value<0||value>=borders.length||(index&&row[index-1]>=value))))
    throw Error('Invalid Hydro nearby border indexes');return result.nearby;
}
export async function findHydroPartialBorderRuns(requests,options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(requests)||requests.length>10000)throw Error('Explicit bounded Hydro partial borders required');
  if(!requests.length)return [];
  const result=await screenHydroPoints({mode:'partial-border-runs',requests},options);
  const validLine=line=>Array.isArray(line)&&line.length>=2&&line.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite));
  if(!Array.isArray(result?.runs)||result.runs.length!==requests.length||result.runs.some(rows=>!Array.isArray(rows)||rows.some(row=>
    !Number.isFinite(row.sourceStart)||!Number.isFinite(row.sourceEnd)||row.sourceStart<0||row.sourceEnd-row.sourceStart<10||
    !Number.isFinite(row.length)||row.length<10||!Number.isFinite(row.sourceLength)||row.sourceLength<row.sourceEnd||
    !Number.isFinite(row.latitude)||Math.abs(row.latitude)>90||
    !validLine(row.metricSource)||!validLine(row.metricBorder))))throw Error('Invalid Hydro partial border runs');return result.runs;
}
export async function findHydroBorderJunctions({borders,requests}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(borders)||borders.length>100000||!Array.isArray(requests)||requests.length>10000)
    throw Error('Explicit bounded Hydro border junction requests required');
  if(!requests.length)return [];
  const result=await screenHydroPoints({mode:'border-junctions',borders,requests},options);
  if(!Array.isArray(result?.junctions)||result.junctions.length!==requests.length||result.junctions.some(point=>point!==null&&
    (!Array.isArray(point)||point.length!==2||point.some((value,i)=>!Number.isFinite(value)||Math.abs(value)>(i===0?180:90)))))
    throw Error('Invalid Hydro border junctions');return result.junctions;
}
export async function scoreHydroReferenceNameCandidates({bounds,references,chains}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(bounds)||bounds.length!==4||bounds.some(value=>!Number.isFinite(value))||
    bounds[2]<bounds[0]||bounds[3]<bounds[1]||!Array.isArray(references)||references.length>100000||
    !Array.isArray(chains)||chains.length>10000)throw Error('Explicit bounded Hydro reference naming inputs required');
  if(!chains.length)return [];
  const result=await screenHydroPoints({mode:'reference-name-candidates',bounds,references,chains},options);
  if(!Array.isArray(result?.candidates)||result.candidates.length!==chains.length||result.candidates.some((row,index)=>row!==null&&
    (row.index!==chains[index]?.index||typeof row.name!=='string'||!row.name||!Number.isFinite(row.area)||row.area!==chains[index].area||
      !Number.isFinite(row.distance)||row.distance<0||row.distance>4||!Number.isFinite(row.alignment)||row.alignment<.55||row.alignment>1.0000000001)))
    throw Error('Invalid Hydro reference name candidates');return result.candidates;
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
  if(!Number.isFinite(result?.lineLengthPx)||result.lineLengthPx<0||!Number.isFinite(result.lineLengthKm)||result.lineLengthKm<0||
    !Number.isFinite(result.polygonAreaPx)||result.polygonAreaPx<0||!Number.isFinite(result.polygonAreaKm2)||result.polygonAreaKm2<0)
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
export async function buildHydroCalibrationRiverFeatures({bounds,width,height,reaches}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(bounds)||bounds.length!==4||bounds.some(value=>!Number.isFinite(value))||bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||
    !Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0||!Array.isArray(reaches)||reaches.length>100000)
    throw Error('Explicit Hydro calibration river features required');
  if(!reaches.length)return [];
  const order=new Map();for(let i=0;i<reaches.length;i++){
    const row=reaches[i];if(!Number.isSafeInteger(row?.id)||row.id<=0||order.has(row.id))throw Error('Invalid Hydro calibration source identity');
    order.set(row.id,i);
  }
  const result=await screenHydroPoints({mode:'calibration-river-features',bounds,width,height,reaches},options);
  if(!Array.isArray(result?.rivers))throw Error('Invalid Hydro calibration river receipt');
  let previous=-1;
  for(const row of result.rivers){const index=order.get(row?.sourceId),source=reaches[index];
    if(index===undefined||index<=previous||row.nextDown!==source.next||row.mainRiver!==source.mainRiver||row.order!==source.order||
      row.flow!==source.flow||row.upstreamArea!==source.upstreamArea||!Array.isArray(row.parts)||!row.parts.length||
      !Number.isSafeInteger(row.sourceCoordinateCount)||row.sourceCoordinateCount<0||!Number.isFinite(row.lengthKm)||row.lengthKm<0||
      !Number.isFinite(row.screenLength)||row.screenLength<0||row.duplicate!==false||row.duplicateFraction!==0||row.assignedStage!==null)
      throw Error('Invalid Hydro calibration river result');previous=index;
  }
  return result.rivers;
}
export async function buildHydroCalibrationLakeFeatures({bounds,width,height,lakes}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(bounds)||bounds.length!==4||bounds.some(value=>!Number.isFinite(value))||bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||
    !Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0||!Array.isArray(lakes)||lakes.length>100000)
    throw Error('Explicit Hydro calibration lake features required');
  if(!lakes.length)return [];
  const order=new Map();for(let i=0;i<lakes.length;i++){
    const row=lakes[i];if(!Number.isSafeInteger(row?.id)||row.id<=0||order.has(row.id))throw Error('Invalid Hydro calibration lake identity');
    order.set(row.id,i);
  }
  const result=await screenHydroPoints({mode:'calibration-lake-features',bounds,width,height,lakes},options);
  if(!Array.isArray(result?.lakes))throw Error('Invalid Hydro calibration lake receipt');
  let previous=-1;
  for(const row of result.lakes){const index=order.get(row?.sourceId),source=lakes[index];
    if(index===undefined||index<=previous||row.name!==source.name||row.areaKm2!==source.areaKm2||row.shorelineKm!==source.shorelineKm||
      !['Polygon','MultiPolygon'].includes(row.geometry?.type)||!Number.isSafeInteger(row.sourceCoordinateCount)||row.sourceCoordinateCount<0||
      !Number.isFinite(row.screenArea)||row.screenArea<0||row.duplicate!==false||row.duplicateFraction!==0||row.assignedStage!==null)
      throw Error('Invalid Hydro calibration lake result');previous=index;
  }
  return result.lakes;
}
export async function organizeHydroLakePolygons(shapes,options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(shapes)||shapes.length>4096)throw Error('Explicit bounded Hydro lake shapes required');
  if(!shapes.length)return [];
  const result=await screenHydroPoints({mode:'lake-polygon-rings',shapes},options);
  if(!Array.isArray(result?.geometries)||result.geometries.length!==shapes.length||
    result.geometries.some(geometry=>!['Polygon','MultiPolygon'].includes(geometry?.type)||!Array.isArray(geometry.coordinates)))
    throw Error('Invalid native Hydro lake polygons');
  return result.geometries;
}
export async function renderHydroCalibrationImageLayers(input,options={}){
  options.signal?.throwIfAborted();
  const keys=['baseLines','basePolygons','referenceLines','referencePolygons','hydroLines','hydroPolygons'];
  if(!Array.isArray(input?.bounds)||input.bounds.length!==4||input.bounds.some(value=>!Number.isFinite(value))||
    input.bounds[2]<=input.bounds[0]||input.bounds[3]<=input.bounds[1]||keys.some(key=>!Array.isArray(input[key])))
    throw Error('Explicit Hydro calibration image layers required');
  const result=await screenHydroPoints({...input,mode:'calibration-image-layers'},options);
  if(result?.width!==1744||result?.height!==510||typeof result.rgba!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.rgba))
    throw Error('Invalid native Hydro calibration image');
  const data=Buffer.from(result.rgba,'base64');if(data.length!==1744*510*4)throw Error('Invalid native Hydro calibration image size');
  return {width:1744,height:510,data};
}
export async function measureHydroCalibrationReferenceFeatures({kind,bounds,width,height,geometries}={},options={}){
  options.signal?.throwIfAborted();
  if(!['river','lake'].includes(kind)||!Array.isArray(bounds)||bounds.length!==4||bounds.some(value=>!Number.isFinite(value))||
    bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0||
    !Array.isArray(geometries)||geometries.length>1000)throw Error('Explicit bounded Hydro reference features required');
  if(!geometries.length)return [];
  const result=await screenHydroPoints({mode:'calibration-reference-features',kind,bounds,width,height,geometries},options);
  const fields=kind==='river'?['lengthKm','screenLength']:['areaKm2','screenArea'];
  if(!Array.isArray(result?.features)||result.features.length!==geometries.length||result.features.some(row=>
    ![0,1].includes(row?.count)||fields.some(key=>!Number.isFinite(row[key])||row[key]<0)))
    throw Error('Invalid Hydro reference feature receipt');
  return result.features;
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
