import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyTerritorialPropertyOnly,createTerritorialEntityStore} from '../../shared/frontend/js/modules/territorial-entity-store.js';
import {createSpatialIndex} from '../../shared/frontend/js/modules/spatial-index.js';
import {countryMeshContentKey} from '../../shared/frontend/js/modules/country-mesh-content-key.js';
import {effectiveTerritorialFlagUrl} from '../../shared/frontend/js/modules/country-flags.js';
import {MAP_RENDER_DIRTY,MAP_RENDER_MASKS} from '../../shared/frontend/js/modules/map-render-coordinator.js';

const geo=(x=0)=>({type:'Polygon',coordinates:[[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]]]});
function country(id,x=0){
  return {id,type:'Feature',geometry:geo(x),properties:{
    entityKind:'general',parentId:'',name:id,
    style:{color:'#112233',opacity:1},metadata:{flagDataUrl:'data:image/png;base64,eA=='},
  }};
}
const clone=rows=>structuredClone(rows);

test('P4-3 changed name, flag and color retain exact canonical mesh but update presentation data',async()=>{
  const before=[country('A'),country('B',5)],after=clone(before);
  after[0].properties.name='Renamed A';
  after[0].properties.metadata.flagDataUrl='data:image/png;base64,Zg==';
  after[0].properties.style.color='#445566';
  const diff=classifyTerritorialPropertyOnly(before,after);
  assert.deepEqual(diff?.paintChangedIds,['A']);
  assert.deepEqual(diff?.labelChangedIds,['A']);
  assert.equal(await countryMeshContentKey(before),await countryMeshContentKey(after));
  assert.equal(effectiveTerritorialFlagUrl(after[0]),'data:image/png;base64,Zg==');
  assert.notEqual(before[0].properties.name,after[0].properties.name);
  assert.ok(MAP_RENDER_MASKS.PROJECT&MAP_RENDER_DIRTY.PROJECT,
    'full project invalidation retains neighboring label collision layout');
});

test('P4-3 geometry, country membership/order and hierarchy changes use the conservative path',async()=>{
  const before=[country('A'),country('B',5)];
  const mutations=[
    rows=>{rows[0].geometry.coordinates[0][1][0]+=0.00000001;},
    rows=>{rows[0].geometry.coordinates.push([[0.3,0.3],[0.8,0.3],[0.8,0.8],[0.3,0.8],[0.3,0.3]]);},
    rows=>{rows[0].properties.parentId='B';},
    rows=>{rows[0].properties.entityKind='regional';},
    rows=>{rows[0].properties.metadata.sourceGeometryVersion='new';},
    rows=>{rows[0].properties.style.opacity=0.8;},
    rows=>{rows.reverse();},
    rows=>{rows.pop();},
    rows=>{rows[1].id='other';},
  ];
  for(const mutate of mutations){
    const after=clone(before);mutate(after);
    assert.equal(classifyTerritorialPropertyOnly(before,after),null,'unverified changes must not reuse spatial geometry');
  }
  const altered=clone(before);altered[0].geometry.coordinates[0][1][0]+=0.00000001;
  assert.notEqual(await countryMeshContentKey(before),await countryMeshContentKey(altered));
});

test('P4-3 Core projection event distinguishes property-only from spatial changes',()=>{
  let rows=[country('A')],notify;
  const published=[];
  const store=createTerritorialEntityStore({
    documentModel:{territorialViews:()=>rows,list:()=>[],world:()=>({}),projectWorld:()=>({})},
    commandOwner:{state:()=>({}),resolveWorld:async()=>({}),setTimelineCursor:async()=>({state:{timelineCursor:'1953-12'}}),
      subscribeTransitions:handler=>{notify=handler;return ()=>{};}},
    onEntitiesReplaced:(_,state)=>published.push(state),
  });
  rows=clone(rows);rows[0].properties.name='new';
  notify();
  assert.equal(published[0].propertyOnly,true);
  assert.equal(published[0].rootGeometryChanged,false);
  assert.deepEqual(published[0].labelChangedIds,['A']);
  assert.deepEqual(published[0].paintChangedIds,[]);
  rows=clone(rows);rows[0].geometry.coordinates[0][1][0]+=0.2;
  notify();
  assert.equal(published[1].propertyOnly,false);
  assert.equal(published[1].rootGeometryChanged,true);
  store.dispose();
});

test('P4-3 spatial records keep exact bounds and IDs after an attribute-only source retarget',()=>{
  let rows=[country('A')],upserts=0,clears=0;
  const spatialRecords=new Map();
  const index={clearDomain:domain=>{clears++;for(const [key,entry] of spatialRecords)if(entry.domain===domain)spatialRecords.delete(key);},
    upsert:item=>{upserts++;spatialRecords.set(item.key,item);}};
  const state={labels:[],genericFeatures:[],hydroEdits:[],size:{width:800,height:600},projection:'globe'};
  const spatial=createSpatialIndex();
  spatial.connect({
    spatialFactories:{createMapObjectSpatialIndex:()=>index},
    projectState:{state},territorialModel:{entityRepository:{list:()=>rows}},
    domains:{renderingDomain:{getDistributionRenderRows:()=>[]}},
    cutGeometry:{coordinateBounds:()=>[0,0,2,2]},
  });
  spatial.initializeGeometryBoundsCache();
  spatial.initializeMapObjectSpatialIndex();
  spatial.rebuildMapObjectSpatialIndex();
  const initial={upserts,clears,records:[...spatialRecords.values()].map(x=>({...x}))};
  rows=clone(rows);rows[0].properties.name='Renamed A';
  assert.ok(classifyTerritorialPropertyOnly([country('A')],rows));
  assert.equal(spatial.retainTerritorialSpatialIndex(rows),true);
  spatial.rebuildMapObjectSpatialIndex();
  assert.equal(upserts,initial.upserts);
  assert.equal(clears,initial.clears);
  assert.deepEqual([...spatialRecords.values()],initial.records);
  rows=clone(rows);rows[0].geometry.coordinates[0][1][0]+=0.25;
  spatial.mapObjectGeometryRevisions.territorial++;
  spatial.rebuildMapObjectSpatialIndex();
  assert.ok(upserts>initial.upserts);
});

test('P4-3 skipped property-only contract never includes unsupported fields',()=>{
  const before=[country('A')],after=clone(before);
  after[0].properties.notes='not a paint property';
  assert.equal(classifyTerritorialPropertyOnly(before,after),null);
  const same=clone(before);
  assert.deepEqual(classifyTerritorialPropertyOnly(before,same)?.paintChangedIds,[]);
  same[0].geometry=before[0].geometry;
  // A borrowed mutable geometry cannot prove unchanged coordinates.
  assert.equal(classifyTerritorialPropertyOnly(before,same),null);
});
