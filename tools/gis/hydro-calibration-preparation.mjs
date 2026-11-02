import {buildHydroCalibrationLakeFeatures,buildHydroCalibrationRiverFeatures,calculateHydroCalibrationScreen,clipHydroCalibrationGeometries,findHydroCalibrationLakeDuplicates,findHydroCalibrationRiverDuplicates} from './hydro-point-screen-native.mjs';
import {assignHydroCalibrationStages,optimizeHydroCalibration} from './hydro-calibration-native.mjs';
import {readHydroRegion} from './hydro-source-reader.mjs';

const calibrationStages=[6,6.7,7,7.5];
export function buildHydroCalibrationOptimization({regions,kind,weights}={}){
  if(!Array.isArray(regions)||!['river','lake'].includes(kind)||!Array.isArray(weights)||!weights.length||
    weights.some(pair=>!Array.isArray(pair)||pair.length!==2||pair.some(value=>!Number.isFinite(value))))
    throw Error('Explicit Hydro calibration regions, kind and weights required');
  const river=kind==='river',field=river?'rivers':'lakes',targetField=river?'riverTargets':'lakeTargets',baseField=river?'riverBaselines':'lakeBaselines';
  const metric=row=>{const first=river?row?.lengthKm:row?.screenArea,second=river?row?.screenLength:row?.count;
    if(!Number.isFinite(first)||!Number.isFinite(second))throw Error('Invalid Hydro calibration stage metric');return {first,second};};
  const output=[];
  for(const data of regions){if(typeof data?.region?.calibrate!=='boolean')throw Error('Invalid Hydro calibration region');
    if(!data.region.calibrate)continue;
    if(!Array.isArray(data[field])||data[field].some(row=>typeof row?.duplicate!=='boolean'))throw Error('Invalid Hydro calibration features');
    const features=data[field].filter(row=>!row.duplicate).map(row=>{
      const first=river?row.flow:row.areaKm2,second=river?row.upstreamArea:row.shorelineKm,metricFirst=river?row.lengthKm:row.screenArea;
      if(!Number.isFinite(first)||!Number.isFinite(second)||!Number.isFinite(metricFirst)||
        (river&&(!Number.isSafeInteger(row.order)||!Number.isFinite(row.screenLength))))throw Error('Invalid Hydro calibration feature metric');
      return river?{order:row.order,first,second,metricFirst,metricSecond:row.screenLength}:{first,second,metricFirst};
    });
    output.push({features,targets:calibrationStages.map(stage=>metric(data[targetField]?.[stage.toFixed(1)])),
      baselines:calibrationStages.map(stage=>metric(data[baseField]?.[stage.toFixed(1)]))});
  }
  return {kind,stages:[...calibrationStages],regions:output,weights:structuredClone(weights)};
}
export async function calibrateHydroPreparedRegions({regions}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(regions))throw Error('Explicit prepared Hydro calibration regions required');
  const snapshot=structuredClone(regions);
  const riverWeights=[1,1.3,1.7,2.1,2.5,3,3.5,4].flatMap(flow=>[-.5,-.25,0,.25,.5,.7].map(area=>[flow,area]));
  const lakeWeights=[-5,-4,-3,-2.5,-2,-1.5,-1,-.5,0,.5,1].map(shoreline=>[1,shoreline]);
  const riverRequest=buildHydroCalibrationOptimization({regions:snapshot,kind:'river',weights:riverWeights});
  const lakeRequest=buildHydroCalibrationOptimization({regions:snapshot,kind:'lake',weights:lakeWeights});
  const [river,lake]=await Promise.all([optimizeHydroCalibration(riverRequest,options),optimizeHydroCalibration(lakeRequest,options)]);
  const assign=async(kind,result)=>{
    const field=kind==='river'?'rivers':'lakes',features=snapshot.flatMap(region=>{
      if(!Array.isArray(region[field]))throw Error('Invalid Hydro calibration region features');return region[field];});
    if(features.some(row=>typeof row?.duplicate!=='boolean'))throw Error('Invalid Hydro duplicate status');
    if(!features.some(row=>!row.duplicate)){for(const row of features)row.assignedStage=null;return;}
    if(result.thresholds.length!==calibrationStages.length)throw Error('Hydro calibration thresholds are missing');
    const rows=features.map(row=>row.duplicate?{duplicate:true}:kind==='river'?
      {duplicate:false,order:row.order,first:row.flow,second:row.upstreamArea}:
      {duplicate:false,first:row.areaKm2,second:row.shorelineKm});
    const assigned=await assignHydroCalibrationStages({kind,stages:calibrationStages,weights:result.weights,thresholds:result.thresholds,features:rows},options);
    for(let i=0;i<features.length;i++)features[i].assignedStage=assigned[i];
  };
  await Promise.all([assign('river',river),assign('lake',lake)]);options.signal?.throwIfAborted();
  return {regions:snapshot,river,lake};
}

// Match the Python iter_lines / iter_polygons behavior for clipped geometries.
export function collectHydroCalibrationGeometry(geometries){
  if(!Array.isArray(geometries))throw Error('Explicit calibration geometry required');
  const lines=[],polygons=[];
  function visit(geometry){
    if(!geometry||typeof geometry!=='object'||Array.isArray(geometry))throw Error('Invalid calibration geometry');
    const {type,coordinates}=geometry;
    if(type==='GeometryCollection'){
      if(!Array.isArray(geometry.geometries))throw Error('Invalid calibration geometry collection');
      for(const child of geometry.geometries)visit(child);return;
    }
    if(!['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(type)||!Array.isArray(coordinates))
      throw Error('Invalid calibration geometry');
    if(type==='LineString'){if(coordinates.length)lines.push(coordinates);return;}
    if(type==='MultiLineString'){for(const line of coordinates){if(!Array.isArray(line))throw Error('Invalid calibration line');if(line.length)lines.push(line);}return;}
    if(type==='Polygon'){if(coordinates.length)polygons.push({type:'Polygon',coordinates});return;}
    if(type==='MultiPolygon')for(const polygon of coordinates){if(!Array.isArray(polygon))throw Error('Invalid calibration polygon');
      if(polygon.length)polygons.push({type:'Polygon',coordinates:polygon});}
  }
  for(const geometry of geometries)visit(geometry);return {lines,polygons};
}
async function clipFeatures(bounds,features,options){
  if(!Array.isArray(features)||features.some(row=>!row||typeof row!=='object'||!row.geometry))
    throw Error('Explicit calibration reference features required');
  const clipped=[];
  for(let at=0;at<features.length;at+=1000){
    const geometries=features.slice(at,at+1000).map(row=>row.geometry);
    for(const geometry of await clipHydroCalibrationGeometries({bounds,geometries},options))clipped.push(geometry);
  }
  return collectHydroCalibrationGeometry(clipped);
}
export async function prepareHydroCalibrationReference({bounds,width,height,features}={},options={}){
  options.signal?.throwIfAborted();
  const snapshot=structuredClone({bounds,width,height,features});
  const {lines,polygons}=await clipFeatures(snapshot.bounds,snapshot.features,options);
  const metrics=await calculateHydroCalibrationScreen({bounds:snapshot.bounds,width:snapshot.width,height:snapshot.height,lines,polygons},options);
  return {lines,polygons,lengthKm:metrics.lineLengthKm,screenLength:metrics.lineLengthPx,screenArea:metrics.polygonAreaPx};
}
export async function prepareHydroCalibrationRivers({archive,specification,selected,bounds,width=1200,height=720}={},options={}){
  options.signal?.throwIfAborted();
  const source=await readHydroRegion({archive,specification,selected,detail:'generation',signal:options.signal}),result=[];
  for(let at=0;at<source.sourceOrder.length;at+=4096){const ids=source.sourceOrder.slice(at,at+4096);
    const reaches=ids.map(id=>({id,...source.rows[id]}));
    for(const row of await buildHydroCalibrationRiverFeatures({bounds,width,height,reaches},options))result.push(row);
  }
  return result;
}
export async function prepareHydroCalibrationLakes({lakes,bounds,width=1200,height=720}={},options={}){
  options.signal?.throwIfAborted();if(!Array.isArray(lakes))throw Error('Explicit selected Hydro lake source required');
  const source=structuredClone(lakes),result=[];
  const ids=new Set();for(const row of source){if(!Number.isSafeInteger(row?.id)||row.id<=0||ids.has(row.id))
    throw Error('Invalid or duplicate Hydro lake identity');ids.add(row.id);}
  if(!source.length)return buildHydroCalibrationLakeFeatures({bounds,width,height,lakes:source},options);
  for(let at=0;at<source.length;at+=4096){
    for(const row of await buildHydroCalibrationLakeFeatures({bounds,width,height,lakes:source.slice(at,at+4096)},options))result.push(row);
  }
  return result;
}
export async function markHydroCalibrationDuplicates({bounds,baseRiverFeatures,baseLakeFeatures,rivers,lakes}={},options={}){
  options.signal?.throwIfAborted();
  const invalid=row=>typeof row?.duplicate!=='boolean'||!Number.isFinite(row.duplicateFraction)||row.duplicateFraction<0||row.duplicateFraction>1;
  if(!Array.isArray(bounds)||bounds.length!==4||bounds.some(value=>!Number.isFinite(value))||bounds[2]<=bounds[0]||bounds[3]<=bounds[1]||
    !Array.isArray(rivers)||!Array.isArray(lakes)||rivers.some(invalid)||lakes.some(invalid))throw Error('Explicit calibration duplicate inputs required');
  const data=structuredClone({bounds,baseRiverFeatures,baseLakeFeatures,rivers,lakes});
  const [baseRivers,baseLakes]=await Promise.all([clipFeatures(data.bounds,data.baseRiverFeatures,options),clipFeatures(data.bounds,data.baseLakeFeatures,options)]);
  const centerLat=(data.bounds[1]+data.bounds[3])/2;
  const applyRivers=async()=>{if(!baseRivers.lines.length)return;
    for(let at=0;at<data.rivers.length;at+=4096){const rows=data.rivers.slice(at,at+4096);
      const result=await findHydroCalibrationRiverDuplicates({centerLat,distanceKm:4,baseLines:baseRivers.lines,rivers:rows.map(row=>row.parts)},options);
      for(let i=0;i<rows.length;i++){rows[i].duplicateFraction=result[i].duplicateFraction;
        if(result[i].duplicateFraction>=.18)rows[i].duplicate=result[i].duplicate;}}
  };
  const applyLakes=async()=>{if(!baseLakes.polygons.length)return;
    for(let at=0;at<data.lakes.length;at+=4096){const rows=data.lakes.slice(at,at+4096);
      const result=await findHydroCalibrationLakeDuplicates({centerLat,distanceKm:5,basePolygons:baseLakes.polygons,lakes:rows.map(row=>row.geometry)},options);
      for(let i=0;i<rows.length;i++){rows[i].duplicate=result[i].duplicate;rows[i].duplicateFraction=result[i].duplicateFraction;}}
  };
  await Promise.all([applyRivers(),applyLakes()]);options.signal?.throwIfAborted();return {rivers:data.rivers,lakes:data.lakes};
}
