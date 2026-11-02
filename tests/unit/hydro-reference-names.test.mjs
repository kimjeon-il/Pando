import assert from 'node:assert/strict';
import test from 'node:test';
import {matchHydroReferenceNames} from '../../tools/gis/hydro-reference-guides.mjs';

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
