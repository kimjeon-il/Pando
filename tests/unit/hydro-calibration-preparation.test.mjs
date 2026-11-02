import assert from 'node:assert/strict';
import test from 'node:test';
import {assembleHydroCalibrationResults,buildHydroCalibrationOptimization,calibrateHydroPreparedRegions,collectHydroCalibrationGeometry,markHydroCalibrationDuplicates,measureHydroCalibrationReferenceStages,prepareHydroCalibrationLakes,prepareHydroCalibrationReference,prepareHydroCalibrationStageReferences,selectHydroCalibrationReferences} from '../../tools/gis/hydro-calibration-preparation.mjs';
import {readFileSync} from 'node:fs';

test('calibration geometry collection keeps lines and polygons and ignores empty or point parts',()=>{
  const line=[[0,0],[1,1]],polygon=[[[0,0],[1,0],[1,1],[0,0]]];
  const geometry=[{type:'GeometryCollection',geometries:[{type:'MultiLineString',coordinates:[[],line]},
    {type:'MultiPolygon',coordinates:[[],polygon]},{type:'Point',coordinates:[0,0]}]}];
  assert.deepEqual(collectHydroCalibrationGeometry(geometry),{lines:[line],polygons:[{type:'Polygon',coordinates:polygon}]});
  assert.throws(()=>collectHydroCalibrationGeometry([{type:'Unknown'}]),/geometry/i);
});
test('calibration references select intersecting base and regional source features without double layers',()=>{
  const feature=(id,geometry)=>({type:'Feature',id,properties:{min_zoom:6},geometry});
  const inside=feature('inside',{type:'LineString',coordinates:[[0,0],[1,1]]}),outside=feature('outside',{type:'LineString',coordinates:[[20,20],[21,21]]});
  const lake=feature('lake',{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]});
  const input={regions:[{id:'a',bbox:[-1,-1,2,2],riverLayer:'regional',lakeLayer:'lakes_base'},
    {id:'b',bbox:[19,19,22,22],riverLayer:'rivers_base',lakeLayer:'lakes_base'}],
  layers:{rivers_base:[inside,outside],lakes_base:[lake],regional:[inside]}};
  const before=structuredClone(input),result=selectHydroCalibrationReferences(input);
  assert.deepEqual(result.references.a.riverReference.baseFeatures,[inside]);assert.deepEqual(result.references.a.riverReference.supplementFeatures,[inside]);
  assert.equal(result.references.a.riverReference.sameLayer,false);assert.equal(result.references.a.lakeReference.sameLayer,true);
  assert.deepEqual(result.references.b.riverReference.baseFeatures,[outside]);assert.equal(result.references.b.riverReference.sameLayer,true);
  assert.deepEqual(result.representativeSource.rivers,[inside,outside]);assert.deepEqual(input,before);
  assert.throws(()=>selectHydroCalibrationReferences({...input,layers:{...input.layers,regional:[{geometry:{type:'LineString',coordinates:[[NaN,0]]}}]}}),/coordinate/i);
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
    assert.ok(Math.abs(result.lengthKm-2*111.320*Math.cos(Math.PI/180))<1e-10);
    assert.deepEqual(input,before);
  });
test('reference stage metrics keep per-feature counts and zoom thresholds',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const features=[{properties:{min_zoom:6},geometry:{type:'MultiLineString',coordinates:[[[-1,1],[3,1]],[[.5,0],[.5,1]]]}},
      {properties:{min_zoom:7},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},
      {properties:{min_zoom:6},geometry:{type:'LineString',coordinates:[[5,5],[6,6]]}}];
    const before=structuredClone(features),options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await measureHydroCalibrationReferenceStages({kind:'river',bounds:[0,0,2,2],width:100,height:100,features},options);
    assert.equal(result['6.0'].count,1);assert.equal(result['6.0'].screenLength,150);
    assert.equal(result['6.7'].count,1);assert.equal(result['7.0'].count,2);assert.equal(result['7.0'].screenLength,200);
    assert.deepEqual(features,before);
  });
test('same-layer calibration targets reuse baseline without reading a supplement',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const input={kind:'river',bounds:[0,0,2,2],width:100,height:100,sameLayer:true,
      baseFeatures:[{properties:{min_zoom:6},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}}]};
    Object.defineProperty(input,'supplementFeatures',{get(){throw Error('supplement must not be read');}});
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await prepareHydroCalibrationStageReferences(input,options);
    assert.equal(result.baselines['6.0'].count,1);assert.deepEqual(result.targets,result.baselines);
    const added=await prepareHydroCalibrationStageReferences({kind:'river',bounds:[0,0,2,2],width:100,height:100,sameLayer:false,
      baseFeatures:input.baseFeatures,supplementFeatures:[{properties:{min_zoom:7},geometry:{type:'LineString',coordinates:[[0,1],[1,1]]}}]},options);
    assert.equal(added.targets['6.0'].count,1);assert.equal(added.targets['7.0'].count,2);assert.equal(added.baselines['7.0'].count,1);
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
test('selected lake source prepares features for calibration duplicate screening',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const polygon={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]};
    const input={bounds:[-2,-2,2,2],width:100,height:100,lakes:[{id:7,name:'Test',areaKm2:5,shorelineKm:8,geometry:polygon}]};
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const lakes=await prepareHydroCalibrationLakes(input,options);
    const result=await markHydroCalibrationDuplicates({bounds:input.bounds,baseRiverFeatures:[],baseLakeFeatures:[{geometry:polygon}],rivers:[],lakes},options);
    assert.equal(result.lakes.length,1);assert.equal(result.lakes[0].sourceId,7);assert.equal(result.lakes[0].duplicate,true);
    assert.equal(result.lakes[0].duplicateFraction,1);
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
test('calibration results reuse verified regional metrics and retain explicit source evidence',()=>{
  const oracle=JSON.parse(readFileSync('tests/fixtures/hydro-calibration-metrics-oracle.json','utf8'));
  const regions=[{...structuredClone(oracle.input),region:{id:'europe',label:'Europe',bbox:[0,0,1,1],calibrate:true}}];
  const input={regions,river:{weights:[1,-.25],thresholds:[10,9,8,7]},lake:{weights:[1,1],thresholds:[5,4,3,2]},
    sources:{hydroRivers:{eu:{file:'fixture.shp',size:10}}},representativeChecks:oracle.representativeExpected,worldEstimate:oracle.worldExpected};
  const before=structuredClone(input),result=assembleHydroCalibrationResults(input);
  assert.deepEqual(result.regions.europe.rivers,oracle.metrics.river);assert.deepEqual(result.regions.europe.lakes,oracle.metrics.lake);
  assert.equal(result.regions.europe.riverCandidates,oracle.input.rivers.length);assert.deepEqual(result.sources,input.sources);
  assert.deepEqual(result.formula.rivers.thresholds,{'6.0':10,'6.7':9,'7.0':8,'7.5':7});
  assert.equal(result.searchSpace.riverWeights.length,48);assert.equal(result.searchSpace.lakeWeights.length,11);assert.deepEqual(input,before);
});
