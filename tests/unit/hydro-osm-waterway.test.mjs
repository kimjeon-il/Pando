import assert from 'node:assert/strict';
import test from 'node:test';
import {matchHydroOsmWaterways,parseHydroOsmWaterways} from '../../tools/gis/hydro-osm-waterway.mjs';

const input={elements:[
  {type:'relation',id:10,tags:{type:'waterway','name:ko':'예시 강',name:'Example River','name:en':'Example River'},
    bounds:{minlon:0,minlat:0,maxlon:10,maxlat:10}},
  {type:'relation',id:11,tags:{type:'waterway',name:'Second'},bounds:{minlon:30,minlat:30,maxlon:31,maxlat:31}},
  {type:'way',id:12,tags:{type:'waterway',name:'ignore'},bounds:{minlon:0,minlat:0,maxlon:1,maxlat:1}},
  {type:'relation',id:13,tags:{type:'waterway',name:'invalid'},bounds:{minlon:0,minlat:0,maxlon:0,maxlat:1}}
]};
test('OSM waterway source parsing preserves valid IDs, extents and normalized names',()=>{
  const before=structuredClone(input),rows=parseHydroOsmWaterways(input,{aliases:{}});
  assert.deepEqual(rows,[{id:10,bounds:[0,0,10,10],nameKo:'예시강',names:['예시 강','Example River']},
    {id:11,bounds:[30,30,31,31],nameKo:'',names:['Second']}]);assert.deepEqual(input,before);
  assert.throws(()=>parseHydroOsmWaterways({elements:'bad'},{aliases:{}}),/elements/i);
});
test('source-bound OSM matching returns only unambiguous selected relations',
  {skip:!process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY},async()=>{
    const rows=parseHydroOsmWaterways(input,{aliases:{}}),options={directory:process.env.PANDO_HYDRO_POINT_SCREEN_DIRECTORY,
      runtimeRoot:process.env.PANDO_HYDRO_RUNTIME_ROOT};
    const matches=await matchHydroOsmWaterways({rows,targets:[[0,0,10,10],[50,50,51,51]]},options);
    assert.deepEqual(matches,[rows[0],null]);
    const duplicate=[rows[0],{...rows[0],id:99,bounds:[0.01,0.01,10.01,10.01]}];
    assert.deepEqual(await matchHydroOsmWaterways({rows:duplicate,targets:[[0,0,10,10]]},options),[null]);
  });
