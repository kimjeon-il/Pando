import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {buildHydroCalibrationLakeFeatures,calculateHydroCalibrationScreen,clipHydroCalibrationGeometries,findHydroCalibrationLakeDuplicates,findHydroCalibrationRiverDuplicates,findHydroReferenceGuides,longestHydroSourceLines,scoreHydroGuidedBranches,selectHydroUpstreams} from '../../tools/gis/hydro-point-screen-native.mjs';

const binary=process.env.PANDO_HYDRO_POINT_SCREEN_BINARY;
const fixture={crs:'EPSG:32632',lines:[[[9,0],[9,1]],[[9.2,0],[9.2,1]]],points:[[9,0],[9.1,0.5],[9.19,0.5]]};
function invoke(value){
  assert.ok(binary,'PANDO_HYDRO_POINT_SCREEN_BINARY must name the native test tool');
  return spawnSync(binary,[],{input:JSON.stringify(value),encoding:'utf8',maxBuffer:16*1024*1024});
}
test('guided branch scores preserve distance and upstream orientation',{skip:!binary},()=>{
  const current=[[0,0],[1,0]],reference=[[-1,0],[1,0]];
  for(const [candidate,score,alignment] of [
    [[[0,0],[-1,0]],0,1],
    [[[0,0],[0,1]],.04,0],
    [[[0,.1],[0,1]],.14,0],
    [[[-1,0],[0,0]],0,1],
  ]){
    const result=invoke({mode:'guided-branch',current,candidate,reference});assert.equal(result.status,0,result.stderr);
    const actual=JSON.parse(result.stdout);assert.ok(Math.abs(actual.score-score)<1e-12);assert.ok(Math.abs(actual.alignment-alignment)<1e-12);
  }
});
test('lake polygon rings preserve nested shells, holes and orphan source order',{skip:!binary},()=>{
  const cw=(a,b,c,d)=>[[a,b],[a,d],[c,d],[c,b],[a,b]],ccw=(a,b,c,d)=>cw(a,b,c,d).reverse();
  const outer=cw(0,0,10,10),inner=cw(2,2,8,8),hole=ccw(3,3,4,4),orphan=ccw(15,15,16,16);
  const cases=[[[outer,inner,hole,orphan],{type:'MultiPolygon',coordinates:[[outer],[inner,hole],[orphan]]}],
    [[outer,orphan],{type:'Polygon',coordinates:[outer,orphan]}],[[hole,orphan],{type:'MultiPolygon',coordinates:[[hole],[orphan]]}]];
  const result=invoke({mode:'lake-polygon-rings',shapes:cases.map(([rings])=>rings)});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).geometries,cases.map(([,expected])=>expected));
  assert.notEqual(invoke({mode:'lake-polygon-rings',shapes:[[[[0,0],[1,1]]]]}).status,0);
});
test('guided branch scores handle zero direction and reject malformed geometry',{skip:!binary},()=>{
  const request={mode:'guided-branch',current:[[0,0],[1,0]],candidate:[[0,0],[-1,0]],reference:[[0,0],[0,0]]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);
  const score=JSON.parse(result.stdout);assert.ok(Math.abs(score.alignment)<1e-12);assert.equal(score.score,.04);
  for(const input of [{...request,reference:[[0,0]]},{...request,candidate:[[181,0],[0,0]]}]){
    const failed=invoke(input);assert.notEqual(failed.status,0);assert.equal(failed.stdout,'');
  }
});
test('canonical upstream selection preserves basin, guide threshold and deterministic ties',{skip:!binary},()=>{
  const row=(id,basin,area,flow,order,score=null,alignment=null)=>({id,basin,area,flow,order,score,alignment});
  const cases=[
    {candidates:[row(1,7,10,2,1),row(2,8,100,9,5)],basin:7,id:1},
    {candidates:[row(1,7,10,2,1),row(2,7,10,2,1)],basin:7,id:2},
    {candidates:[row(1,7,100,2,1,.05,.5),row(2,7,20,1,1,.01,.2),row(3,7,9,9,9,0,1)],basin:7,id:2},
    {candidates:[row(1,7,100,2,1,.17,1),row(2,7,20,1,1,.18,1)],basin:7,id:1},
    {candidates:[row(1,7,100,2,1,.16,.5),row(2,7,20,1,1,.16,.7)],basin:7,id:2},
    {candidates:[row(1,7,-2,-5,1,0,1),row(2,7,-1,-4,1,.01,1)],basin:7,id:2},
  ];
  for(const {basin,candidates,id} of cases){const result=invoke({mode:'canonical-upstream',basin,candidates});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).id,id);}
  const tied=[row(1,7,10,2,3),row(2,7,10,2,1)];
  assert.equal(JSON.parse(invoke({mode:'canonical-upstream',basin:7,candidates:tied}).stdout).id,1);
  assert.equal(JSON.parse(invoke({mode:'guided-upstream',basin:7,candidates:tied}).stdout).id,2);
  const invalid=invoke({mode:'canonical-upstream',basin:7,candidates:[]});assert.notEqual(invalid.status,0);
});
test('batched guided geometry and canonical decisions match individual native calls',{skip:!binary},()=>{
  const branches=[{current:[[0,0],[1,0]],candidate:[[0,0],[-1,0]],reference:[[-1,0],[1,0]]},
    {current:[[0,0],[1,0]],candidate:[[0,0],[0,1]],reference:[[-1,0],[1,0]]}];
  let batch=invoke({mode:'guided-branches',branches});assert.equal(batch.status,0,batch.stderr);
  assert.deepEqual(JSON.parse(batch.stdout).branches,branches.map(branch=>JSON.parse(invoke({mode:'guided-branch',...branch}).stdout)));
  const row=(id,area,score,alignment)=>({id,basin:7,area,flow:1,order:2,score,alignment});
  const groups=[{basin:7,candidates:[row(1,10,0,1),row(2,8,.04,0)]},{basin:7,candidates:[row(3,4,null,null)]}];
  batch=invoke({mode:'canonical-upstreams',groups});assert.equal(batch.status,0,batch.stderr);
  assert.deepEqual(JSON.parse(batch.stdout).groups,groups.map(group=>JSON.parse(invoke({mode:'canonical-upstream',...group}).stdout)));
  const invalid=invoke({mode:'guided-branches',branches:[branches[0],{...branches[1],current:[[0,0]]}]});
  assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('nearest geographic reference selects only lines inside the requested guide distance',{skip:!binary},()=>{
  const request={mode:'reference-guides',references:[[[0,0],[1,0]],[[0,2],[1,2]]],
    queries:[[[0,.1],[1,.1]],[[0,2.05],[1,2.05]],[[0,1],[1,1]],[]],maxDistance:.22};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);const {matches}=JSON.parse(result.stdout);
  assert.equal(matches[0].index,0);assert.ok(Math.abs(matches[0].distance-.1)<1e-12);
  assert.equal(matches[1].index,1);assert.ok(Math.abs(matches[1].distance-.05)<1e-12);
  assert.deepEqual(matches.slice(2),[null,null]);
  const empty=invoke({...request,references:[]});assert.equal(empty.status,0,empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).matches,[null,null,null,null]);
  const invalid=invoke({...request,queries:[[[181,0],[0,0]]]});assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('longest source line chooses the first planar maximum and ignores short parts',{skip:!binary},()=>{
  const reaches=[[[[0,0]],[[0,0],[1,0]],[[0,0],[0,1]]],[[[0,0],[1,0]],[[0,0],[3,0]]],[[[0,0]]],[]];
  const result=invoke({mode:'longest-lines',reaches});assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).indices,[1,1,null,null]);
  const invalid=invoke({mode:'longest-lines',reaches:[[[[0,0],[181,0]]]]});
  assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('OSM waterway extent matching preserves overlap, ambiguity and missing-match decisions',{skip:!binary},()=>{
  const request={mode:'osm-waterway-match',candidates:[[0,0,10,10],[30,30,31,31]],
    targets:[[0,0,10,10],[30,30,31,31],[50,50,51,51]]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).matches,[0,1,null]);
  const empty=invoke({...request,candidates:[]});assert.equal(empty.status,0,empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).matches,[null,null,null]);
  const ambiguous=invoke({...request,candidates:[[0,0,10,10],[0.01,0.01,10.01,10.01]]});
  assert.equal(ambiguous.status,0,ambiguous.stderr);assert.deepEqual(JSON.parse(ambiguous.stdout).matches,[null,null,null]);
  const invalid=invoke({...request,candidates:[[0,0,0,10]]});assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('calibration screen preserves pixel line length and polygon hole area',{skip:!binary},()=>{
  const request={mode:'calibration-screen',bounds:[0,0,10,10],width:100,height:100,
    lines:[[[0,0],[3,4]]],polygons:[{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],
      [[1,1],[1,3],[3,3],[3,1],[1,1]]]}]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);
  const values=JSON.parse(result.stdout);assert.equal(values.lineLengthPx,50);assert.equal(values.polygonAreaPx,1200);
  assert.ok(Math.abs(values.lineLengthKm-Math.hypot(3*111.320*Math.cos(5*Math.PI/180),4*110.574))<1e-10);
  assert.ok(Math.abs(values.polygonAreaKm2-12*111.320*Math.cos(5*Math.PI/180)*110.574)<1e-8);
  const empty=invoke({...request,lines:[],polygons:[]});assert.equal(empty.status,0,empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout),{lineLengthPx:0,lineLengthKm:0,polygonAreaPx:0,polygonAreaKm2:0});
  const invalid=invoke({...request,bounds:[0,0,0,10]});assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('calibration river duplicates preserve sampled overlap and direction thresholds',{skip:!binary},()=>{
  const request={mode:'calibration-river-duplicates',centerLat:0,distanceKm:4,baseLines:[[[0,0],[1,0]]],
    rivers:[[[[0,0],[1,0]]],[[[0,.01],[1,.01]]],[[[0,.1],[1,.1]]],[[[.5,-.1],[.5,.1]]]]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).rivers,[{duplicate:true,duplicateFraction:1},{duplicate:true,duplicateFraction:1},
    {duplicate:false,duplicateFraction:0},{duplicate:false,duplicateFraction:.2}]);
  const empty=invoke({...request,baseLines:[]});assert.equal(empty.status,0,empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).rivers,request.rivers.map(()=>({duplicate:false,duplicateFraction:0})));
});
test('calibration lake duplicates preserve coverage, overlap and separation decisions',{skip:!binary},()=>{
  const polygon=(x,y,w,h)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
  const request={mode:'calibration-lake-duplicates',centerLat:0,distanceKm:5,
    basePolygons:[polygon(0,0,2,2)],lakes:[polygon(0,0,2,2),polygon(1.9,0,2,2),polygon(5,5,1,1)]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout).lakes;
  assert.deepEqual(rows.map(row=>row.duplicate),[true,false,false]);assert.equal(rows[0].duplicateFraction,1);
  assert.ok(Math.abs(rows[1].duplicateFraction-.05)<1e-12);assert.equal(rows[2].duplicateFraction,0);
  const empty=invoke({...request,basePolygons:[]});assert.equal(empty.status,0,empty.stderr);
  assert.deepEqual(JSON.parse(empty.stdout).lakes,request.lakes.map(()=>({duplicate:false,duplicateFraction:0})));
});
test('calibration clipping keeps only the explicitly bounded source geometry',{skip:!binary},()=>{
  const request={mode:'calibration-clip',bounds:[0,0,2,2],geometries:[{type:'LineString',coordinates:[[-1,1],[3,1]]},
    {type:'Polygon',coordinates:[[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]},
    {type:'LineString',coordinates:[[5,5],[6,6]]}]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);const clipped=JSON.parse(result.stdout).geometries;
  assert.deepEqual(clipped[0],{type:'LineString',coordinates:[[0,1],[2,1]]});
  assert.deepEqual(clipped[2],{type:'LineString',coordinates:[]});
  const metric=invoke({mode:'calibration-screen',bounds:[0,0,2,2],width:100,height:100,lines:[],polygons:[clipped[1]]});
  assert.equal(metric.status,0,metric.stderr);assert.equal(JSON.parse(metric.stdout).polygonAreaPx,2500);
  const invalid=invoke({...request,bounds:[0,0,0,2]});assert.notEqual(invalid.status,0);assert.equal(invalid.stdout,'');
});
test('selected HydroRIVERS become clipped calibration features with original score floor',{skip:!binary},()=>{
  const request={mode:'calibration-river-features',bounds:[0,-1,3,1],width:300,height:200,reaches:[
    {id:102,next:0,mainRiver:102,order:6,flow:3.5,upstreamArea:200,parts:[[[1,0],[2,0]]]},
    {id:101,next:102,mainRiver:102,order:1,flow:0,upstreamArea:100,parts:[[[0,0],[1,0]]]},
    {id:103,next:0,mainRiver:103,order:6,flow:3.5,upstreamArea:200,parts:[[[5,0],[6,0]]]}
  ]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout).rivers;
  assert.equal(rows.length,1);assert.equal(rows[0].sourceId,102);assert.equal(rows[0].nextDown,0);
  assert.deepEqual(rows[0].parts,[[[1,0],[2,0]]]);assert.equal(rows[0].sourceCoordinateCount,2);
  assert.ok(Math.abs(rows[0].lengthKm-111.32)<1e-10);assert.equal(rows[0].screenLength,100);
  assert.equal(rows[0].duplicate,false);assert.equal(rows[0].duplicateFraction,0);assert.equal(rows[0].assignedStage,null);
});
test('selected HydroLAKES become clipped calibration features with source coordinate counts',{skip:!binary},()=>{
  const polygon=(x,y,w,h)=>({type:'Polygon',coordinates:[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]]});
  const request={mode:'calibration-lake-features',bounds:[0,0,2,2],width:100,height:100,lakes:[
    {id:10,name:'Lake A',areaKm2:5,shorelineKm:10,geometry:polygon(-1,-1,2,2)},
    {id:11,name:'Small',areaKm2:.5,shorelineKm:2,geometry:polygon(0,0,1,1)},
    {id:12,name:'Outside',areaKm2:3,shorelineKm:4,geometry:polygon(4,4,1,1)}]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout).lakes;
  assert.equal(rows.length,1);assert.equal(rows[0].sourceId,10);assert.equal(rows[0].name,'Lake A');
  assert.equal(rows[0].sourceCoordinateCount,5);assert.equal(rows[0].screenArea,2500);
  assert.equal(rows[0].geometry.type,'Polygon');assert.equal(rows[0].duplicate,false);assert.equal(rows[0].assignedStage,null);
});
test('reference feature metrics count clipped features rather than line parts',{skip:!binary},()=>{
  const request={mode:'calibration-reference-features',kind:'river',bounds:[0,0,2,2],width:100,height:100,geometries:[
    {type:'MultiLineString',coordinates:[[[-1,1],[3,1]],[[.5,0],[.5,1]]]},
    {type:'LineString',coordinates:[[5,5],[6,6]]}]};
  const result=invoke(request);assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout).features;
  assert.equal(rows[0].count,1);assert.equal(rows[0].screenLength,150);
  assert.ok(Math.abs(rows[0].lengthKm-(2*111.320*Math.cos(Math.PI/180)+110.574))<1e-9);
  assert.deepEqual(rows[1],{count:0,lengthKm:0,screenLength:0});
});
test('source-bound guided branch and upstream batches return ordered native decisions',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const branches=[{current:[[0,0],[1,0]],candidate:[[0,0],[-1,0]],reference:[[-1,0],[1,0]]},
      {current:[[0,0],[1,0]],candidate:[[0,0],[0,1]],reference:[[-1,0],[1,0]]}];
    const scores=await scoreHydroGuidedBranches(branches,options);
    assert.deepEqual(scores,[{score:0,alignment:1},{score:0.04,alignment:0}]);
    const candidates=scores.map((value,i)=>({id:i+1,basin:7,area:10,flow:1,order:1,...value}));
    assert.deepEqual(await selectHydroUpstreams([{basin:7,candidates}],{...options,kind:'canonical'}),[1]);
    await assert.rejects(selectHydroUpstreams([{basin:7,candidates:[]}],{...options,kind:'canonical'}),/candidate|upstream/i);
  });
test('source-bound reference guides retain their source index and threshold',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const references=[[[0,0],[1,0]],[[0,2],[1,2]]],queries=[[[0,.1],[1,.1]],[[0,1],[1,1]],[]];
    const matches=await findHydroReferenceGuides({references,queries,maxDistance:.22},options);
    assert.equal(matches[0].index,0);assert.ok(Math.abs(matches[0].distance-.1)<1e-12);assert.deepEqual(matches.slice(1),[null,null]);
    assert.deepEqual(await findHydroReferenceGuides({references:[],queries,maxDistance:.22},options),[null,null,null]);
    await assert.rejects(findHydroReferenceGuides({references,queries,maxDistance:-1},options),/reference/i);
  });
test('source-bound longest-line selection returns original source parts',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const reaches=[[[[0,0]],[[0,0],[1,0]],[[0,0],[0,1]]],[[[0,0],[2,0]]],[]];
    assert.deepEqual(await longestHydroSourceLines(reaches,options),[reaches[0][1],reaches[1][0],null]);
  });
test('source-bound calibration screen computes only explicitly selected geometry',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const input={bounds:[0,0,10,10],width:100,height:100,lines:[[[0,0],[3,4]]],
      polygons:[{type:'Polygon',coordinates:[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[1,3],[3,3],[3,1],[1,1]]]}]};
    const before=structuredClone(input),options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await calculateHydroCalibrationScreen(input,options);assert.equal(result.lineLengthPx,50);assert.equal(result.polygonAreaPx,1200);
    assert.ok(Math.abs(result.lineLengthKm-Math.hypot(3*111.320*Math.cos(5*Math.PI/180),4*110.574))<1e-10);
    assert.deepEqual(input,before);await assert.rejects(calculateHydroCalibrationScreen({...input,width:0},options),/screen|dimensions/i);
  });
test('source-bound calibration duplicate screen returns fractions without changing input',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const input={centerLat:0,distanceKm:4,baseLines:[[[0,0],[1,0]]],rivers:[[[[0,0],[1,0]]],[[[.5,-.1],[.5,.1]]]]};
    const before=structuredClone(input),options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    assert.deepEqual(await findHydroCalibrationRiverDuplicates(input,options),
      [{duplicate:true,duplicateFraction:1},{duplicate:false,duplicateFraction:.2}]);
    assert.deepEqual(input,before);
  });
test('source-bound lake duplicate screen retains original polygons',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const polygon={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]};
    const input={centerLat:0,distanceKm:5,basePolygons:[polygon],lakes:[polygon]},before=structuredClone(input);
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    assert.deepEqual(await findHydroCalibrationLakeDuplicates(input,options),[{duplicate:true,duplicateFraction:1}]);
    assert.deepEqual(input,before);
  });
test('source-bound calibration clipping composes with screen metrics',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const input={bounds:[0,0,2,2],geometries:[{type:'LineString',coordinates:[[-1,1],[3,1]]}]},before=structuredClone(input);
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const clipped=await clipHydroCalibrationGeometries(input,options);
    assert.deepEqual(clipped,[{type:'LineString',coordinates:[[0,1],[2,1]]}]);
    const metrics=await calculateHydroCalibrationScreen({bounds:input.bounds,width:100,height:100,
      lines:[clipped[0].coordinates],polygons:[]},options);
    assert.equal(metrics.lineLengthPx,100);assert.equal(metrics.polygonAreaPx,0);
    assert.ok(Math.abs(metrics.lineLengthKm-2*111.320*Math.cos(Math.PI/180))<1e-10);
    assert.deepEqual(input,before);
  });
test('source-bound selected lake features retain source identity and clipping metrics',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const lakes=[{id:10,name:'Lake A',areaKm2:5,shorelineKm:10,
      geometry:{type:'Polygon',coordinates:[[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]]]}}],before=structuredClone(lakes);
    const options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const result=await buildHydroCalibrationLakeFeatures({bounds:[0,0,2,2],width:100,height:100,lakes},options);
    assert.equal(result[0].sourceId,10);assert.equal(result[0].screenArea,2500);assert.equal(result[0].sourceCoordinateCount,5);
    assert.deepEqual(lakes,before);
  });
test('native point screen computes projected lengths and closest points',{skip:!binary},()=>{
  const output=invoke(fixture);assert.equal(output.status,0,output.stderr);
  const result=JSON.parse(output.stdout);assert.equal(result.points.length,3);assert.equal(result.lineLengthsMeters.length,2);
  assert.ok(result.lineLengthsMeters.every(x=>x>110000&&x<111000));
  assert.ok(result.points[0].distanceMeters<1e-6);
  assert.ok(result.points[1].distanceMeters>10000&&result.points[1].distanceMeters<12000);
  assert.ok(result.points[2].distanceMeters>1000&&result.points[2].distanceMeters<1200);
  assert.ok(Math.abs(result.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
  assert.ok(Math.abs(result.points[2].nearestLonLat[1]-0.500000007662718)<1e-8);
});
test('native point screen rejects invalid CRS and coordinates without partial output',{skip:!binary},()=>{
  for(const input of [{...fixture,crs:'EPSG:4326'}, {...fixture,points:[[181,0]]},{...fixture,lines:[[[9,0]]]},{...fixture,mode:'unknown'}]){
    const result=invoke(input);assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
test('native point screen supports independent input parts for batch audits',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'parts',lines:[...fixture.lines,[[9,0],[9,0]]]});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(output.points.length,3);
  assert.equal(output.lineLengthsMeters.length,2);
  assert.ok(Math.abs(output.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
});
test('native point screen reports line lengths when a system has no external points',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'parts',points:[]});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.deepEqual(output.points,[]);assert.equal(output.lineLengthsMeters.length,2);
});
test('native point screen supports indexed nearest-line searches',{skip:!binary},()=>{
  const result=invoke({...fixture,mode:'tree'});assert.equal(result.status,0,result.stderr);
  const output=JSON.parse(result.stdout);assert.equal(output.points.length,3);
  assert.ok(Math.abs(output.points[2].nearestLonLat[0]-9.199992435555043)<1e-8);
});
test('native vector screen compares both directions in projected coordinates',{skip:!binary},()=>{
  const line=[[145,-37.8],[145.01,-37.81]],result=invoke({crs:'EPSG:32755',mode:'vector',lines:[line],referenceLines:[line],points:[],samples:5});
  assert.equal(result.status,0,result.stderr);const output=JSON.parse(result.stdout);
  assert.equal(output.lineLengthsMeters.length,1);assert.equal(output.referenceLengthsMeters.length,1);
  assert.equal(output.hydroToReferenceMeters.length,5);assert.equal(output.referenceToHydroMeters.length,5);
  assert.ok(output.hydroToReferenceMeters.every(value=>value<1e-6));
  assert.ok(output.referenceToHydroMeters.every(value=>value<1e-6));
  assert.equal(output.referenceBoundsMeters.length,4);
});
test('native vector screen rejects missing, invalid or degenerate source lines',{skip:!binary},()=>{
  for(const referenceLines of [[],[[[145,-37.8],[145,-37.8]]]]){
    const result=invoke({crs:'EPSG:32755',mode:'vector',lines:[[[145,-37.8],[145.01,-37.81]]],referenceLines,points:[],samples:5});
    assert.notEqual(result.status,0);assert.equal(result.stdout,'');
  }
});
