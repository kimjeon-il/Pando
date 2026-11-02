import {calculateHydroCalibrationScreen,clipHydroCalibrationGeometries} from './hydro-point-screen-native.mjs';

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
export async function prepareHydroCalibrationReference({bounds,width,height,features}={},options={}){
  options.signal?.throwIfAborted();
  if(!Array.isArray(features)||features.some(row=>!row||typeof row!=='object'||!row.geometry))
    throw Error('Explicit calibration reference features required');
  const snapshot=structuredClone({bounds,width,height,features}),clipped=[];
  for(let at=0;at<snapshot.features.length;at+=1000){
    const geometries=snapshot.features.slice(at,at+1000).map(row=>row.geometry);
    for(const geometry of await clipHydroCalibrationGeometries({bounds:snapshot.bounds,geometries},options))clipped.push(geometry);
  }
  const {lines,polygons}=collectHydroCalibrationGeometry(clipped);
  const metrics=await calculateHydroCalibrationScreen({bounds:snapshot.bounds,width:snapshot.width,height:snapshot.height,lines,polygons},options);
  return {lines,polygons,screenLength:metrics.lineLengthPx,screenArea:metrics.polygonAreaPx};
}
