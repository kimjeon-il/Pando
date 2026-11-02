import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareHydroReferenceGuides} from '../../tools/gis/hydro-reference-guides.mjs';

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
