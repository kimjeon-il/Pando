import assert from 'node:assert/strict';
import test from 'node:test';
import {buildHydroCalibrationOptimization,calibrateHydroPreparedRegions,collectHydroCalibrationGeometry,markHydroCalibrationDuplicates,prepareHydroCalibrationReference} from '../../tools/gis/hydro-calibration-preparation.mjs';
import {readFileSync} from 'node:fs';

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
test('clipped reference inputs feed river and lake duplicate decisions without modifying sources',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const line={type:'LineString',coordinates:[[0,0],[1,0]]},polygon={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};
    const input={bounds:[-2,-2,2,2],baseRiverFeatures:[{geometry:line}],baseLakeFeatures:[{geometry:polygon}],
      rivers:[{parts:[line.coordinates],duplicate:false,duplicateFraction:0},{parts:[[[0,.5],[1,.5]]],duplicate:true,duplicateFraction:.9}],
      lakes:[{geometry:polygon,duplicate:false,duplicateFraction:0}]},before=structuredClone(input);
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await markHydroCalibrationDuplicates(input,options);
    assert.deepEqual(result.rivers.map(row=>[row.duplicate,row.duplicateFraction]),[[true,1],[true,0]]);
    assert.deepEqual(result.lakes.map(row=>[row.duplicate,row.duplicateFraction]),[[true,1]]);assert.deepEqual(input,before);
    const empty=await markHydroCalibrationDuplicates({...input,baseRiverFeatures:[],baseLakeFeatures:[]},options);
    assert.deepEqual(empty.rivers,input.rivers);assert.deepEqual(empty.lakes,input.lakes);
  });
test('calibration optimization receives only nonduplicate rows and preserves all stage targets',()=>{
  const source=JSON.parse(readFileSync('tests/fixtures/hydro-calibration-optimizer-oracle.json','utf8'))[0].request;
  const regions=source.regions.map(region=>({region:{calibrate:true},rivers:region.features.map(row=>({order:row.order,flow:row.first,
    upstreamArea:row.second,lengthKm:row.metricFirst,screenLength:row.metricSecond,duplicate:false})),
    riverTargets:Object.fromEntries(source.stages.map((stage,i)=>[stage.toFixed(1),{lengthKm:region.targets[i].first,screenLength:region.targets[i].second}])),
    riverBaselines:Object.fromEntries(source.stages.map((stage,i)=>[stage.toFixed(1),{lengthKm:region.baselines[i].first,screenLength:region.baselines[i].second}]))}));
  regions[0].rivers.push({duplicate:true});const before=structuredClone(regions);
  assert.deepEqual(buildHydroCalibrationOptimization({regions,kind:'river',weights:source.weights}),source);
  assert.deepEqual(regions,before);
});
test('prepared regional features are assigned through both native calibration optimizers',
  {skip:!process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT},async()=>{
    const fixtures=JSON.parse(readFileSync('tests/fixtures/hydro-calibration-optimizer-oracle.json','utf8'));
    const river=fixtures.find(row=>row.name==='river-ordinary').request,lake=fixtures.find(row=>row.name==='lake-ordinary').request;
    const stages=river.stages;
    const metrics=(rows,kind)=>Object.fromEntries(stages.map((stage,i)=>[stage.toFixed(1),kind==='river'?
      {lengthKm:rows[i].first,screenLength:rows[i].second}:{screenArea:rows[i].first,count:rows[i].second}]));
    const regions=river.regions.map((row,i)=>({region:{calibrate:true},
      rivers:row.features.map(item=>({order:item.order,flow:item.first,upstreamArea:item.second,lengthKm:item.metricFirst,
        screenLength:item.metricSecond,duplicate:false})),
      lakes:lake.regions[i].features.map(item=>({areaKm2:item.first,shorelineKm:item.second,screenArea:item.metricFirst,duplicate:false})),
      riverTargets:metrics(row.targets,'river'),riverBaselines:metrics(row.baselines,'river'),
      lakeTargets:metrics(lake.regions[i].targets,'lake'),lakeBaselines:metrics(lake.regions[i].baselines,'lake')}));
    regions[0].rivers.push({duplicate:true});regions[0].lakes.push({duplicate:true});const before=structuredClone(regions);
    const result=await calibrateHydroPreparedRegions({regions},{directory:process.env.PANDO_HYDRO_CALIBRATION_ARTIFACT});
    assert.equal(result.regions[0].rivers.at(-1).assignedStage,null);assert.equal(result.regions[0].lakes.at(-1).assignedStage,null);
    assert.equal(result.river.thresholds.length,4);assert.equal(result.lake.thresholds.length,4);
    assert.ok(result.regions.flatMap(row=>row.rivers).some(row=>row.assignedStage!==null));
    assert.ok(result.regions.flatMap(row=>row.lakes).some(row=>row.assignedStage!==null));assert.deepEqual(regions,before);
  });
