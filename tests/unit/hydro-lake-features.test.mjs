import assert from 'node:assert/strict';
import test from 'node:test';
import {buildHydroLakeFeatures} from '../../tools/gis/hydro-lake-features.mjs';

test('Natural Earth lake features preserve names, stages and source identity',
  {skip:!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY},async()=>{
    const polygon={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},lakes=[
      {id:'lake-a',properties:{name_ko:'테스트 호수',min_zoom:6,source_id:'A'},geometry:polygon},
      {id:'lake-b',properties:{name_en:'Blue Lake',min_zoom:7},geometry:polygon},
      {id:'skip',properties:{},geometry:{type:'Point',coordinates:[0,0]}}];
    const result=await buildHydroLakeFeatures({lakes,aliases:{},fidStart:4,logicalFidStart:8},
      {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
    assert.equal(result.nextFid,6);assert.equal(result.nextLogicalFid,10);assert.equal(result.features.length,2);
    assert.deepEqual(result.features.map(row=>[row.metadata.fid,row.metadata.logicalFid,row.metadata.name,row.metadata.stage,row.metadata.sourceId]),
      [[4,8,'테스트호수',0,'A'],[5,9,'Blue',2,'lake-b']]);
  });
