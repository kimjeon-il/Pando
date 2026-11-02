import assert from 'node:assert/strict';
import test from 'node:test';
import {collectHydroCalibrationGeometry,prepareHydroCalibrationReference} from '../../tools/gis/hydro-calibration-preparation.mjs';

test('calibration geometry collection keeps lines and polygons and ignores empty or point parts',()=>{
  const line=[[0,0],[1,1]],polygon=[[[0,0],[1,0],[1,1],[0,0]]];
  const geometry=[{type:'GeometryCollection',geometries:[{type:'MultiLineString',coordinates:[[],line]},
    {type:'MultiPolygon',coordinates:[[],polygon]},{type:'Point',coordinates:[0,0]}]}];
  assert.deepEqual(collectHydroCalibrationGeometry(geometry),{lines:[line],polygons:[{type:'Polygon',coordinates:polygon}]});
  assert.throws(()=>collectHydroCalibrationGeometry([{type:'Unknown'}]),/geometry/i);
});
test('calibration reference preparation clips source and produces the metric fields',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const input={bounds:[0,0,2,2],width:100,height:100,features:[
      {geometry:{type:'LineString',coordinates:[[-1,1],[3,1]]}},
      {geometry:{type:'Polygon',coordinates:[[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]}}
    ]},before=structuredClone(input);
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await prepareHydroCalibrationReference(input,options);
    assert.equal(result.screenLength,100);assert.equal(result.screenArea,2500);assert.equal(result.lines.length,1);assert.equal(result.polygons.length,1);
    assert.deepEqual(input,before);
  });
