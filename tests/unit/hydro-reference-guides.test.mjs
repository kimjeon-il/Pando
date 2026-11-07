import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:assert/strict";
import * as __dep1 from "node:test";
import * as __dep2 from "../../tools/gis/hydro-reference-guides.mjs";
import * as __dep3 from "node:crypto";
import * as __dep4 from "node:fs/promises";
import * as __dep5 from "node:path";
import * as __dep6 from "../../tools/gis/hydro-source-reader.mjs";
import * as __dep7 from "../../tools/gis/hydro-connectivity-native.mjs";

// Original feature contract: hydro-reference-guides.test.mjs
contractSuite("hydro-reference-guides", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { prepareHydroReferenceGuides } = __dep2;

test('Natural Earth rows merge by identity while preserving source part and guide order',()=>{
  const rows=[
    {id:'a',properties:{pandolab_id:'river:1',name_en:'River',min_zoom:8,stroke_width:.1},geometry:{type:'LineString',coordinates:[[0,0,5],[1,0,8]]}},
    {id:'b',properties:{pandolab_id:'river:1',name_ko:'강',min_zoom:7,stroke_width:.2},geometry:{type:'MultiLineString',coordinates:[[[1,0],[2,0]],[[2,0],[3,0]]]}},
    {id:'c',properties:{name:' Other '},geometry:{type:'LineString',coordinates:[[4,0],[5,0]]}}
  ];
  const before=structuredClone(rows),result=prepareHydroReferenceGuides(rows);
  assert.deepEqual(rows,before);assert.deepEqual(result.features.map(row=>row.id),['river:1','c']);
  assert.deepEqual(result.features[0].properties,{pandolab_id:'river:1',name_en:'River',min_zoom:7,stroke_width:.2,name_ko:'강'});
  assert.deepEqual(result.lines,[[[0,0],[1,0]],[[1,0],[2,0]],[[2,0],[3,0]],[[4,0],[5,0]]]);
  assert.deepEqual(result.names,['강','강','강','Other']);
});
test('reference guides reject invalid coordinates and skip non-line or short geometry',()=>{
  const rows=[{properties:{},geometry:{type:'LineString',coordinates:[[0,0]]}},
    {properties:{},geometry:{type:'Point',coordinates:[0,0]}}];
  const result=prepareHydroReferenceGuides(rows);assert.deepEqual(result.lines,[]);
  assert.throws(()=>prepareHydroReferenceGuides([{properties:{},geometry:{type:'LineString',coordinates:[[0,NaN],[1,0]]}}]),/coordinate/i);
});
});

// Original feature contract: hydro-reference-names.test.mjs
contractSuite("hydro-reference-names", () => {
const assert = __dep0.default;
const test = __dep1.default;
const { matchHydroReferenceNames } = __dep2;

test('reference naming gives each name to the strongest qualifying basin',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const reach=(points,upstreamArea)=>({parts:[points],upstreamArea}),chains=[
      [reach([[0,.01],[4,.01]],10)],[reach([[0,.02],[4,.02]],100)],
      [reach([[0,.49],[4,.49]],10)],[reach([[2,-.1],[2,.1]],20)]],
      references=[{properties:{name_en:'River A'},geometry:{type:'LineString',coordinates:[[0,0],[4,0]]}},
        {properties:{name_en:'River B'},geometry:{type:'LineString',coordinates:[[0,.5],[4,.5]]}}];
    const result=await matchHydroReferenceNames({chains,references,bounds:[0,-1,4,1]},
      {directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT});
    assert.deepEqual(result,{1:'River A',2:'River B'});
  });
});

// Original feature contract: hydro-rhine-source.test.mjs
contractSuite("hydro-rhine-source", () => {
const assert = __dep0.default;
const { createHash } = __dep3;
const { readFile } = __dep4;
const { resolve } = __dep5;
const test = __dep1.default;
const { openHydroRiverShapeReader } = __dep6;
const { withHydroSourceSelection } = __dep7;

test('selected official Rhine source reaches match frozen Python coordinates and policies',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const oracle=JSON.parse(await readFile('tests/fixtures/hydro-rhine-sample.json','utf8')),files={};
    for(const ext of ['shp','shx','dbf']){const path=resolve(`tests/fixtures/hydro-rhine-sample.${ext}`);
      files[ext]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}
    const reader=await openHydroRiverShapeReader(files),options={directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY};
    try{await withHydroSourceSelection({files,specification:{datasetCode:'eu'},batchSize:3},async selection=>{
      const rows=await selection.records(oracle.rows.map(row=>row.id)),shapes=await reader.read(rows.map(row=>({id:row.id,recordIndex:row.recordIndex})));
      for(let i=0;i<rows.length;i++){const expected=oracle.rows[i],row=rows[i];
        for(const key of ['id','next','mainRiver','order','flow','upstreamArea','endorheic','recordIndex','stage'])assert.equal(row[key],expected[key]);
        assert.ok(Math.abs(row.score-expected.score)<1e-12);assert.ok(Math.abs(row.width-expected.width)<1e-12);
        assert.deepEqual(shapes[i].parts,expected.parts);}
    },options);}finally{await reader.close();}
  });
});
