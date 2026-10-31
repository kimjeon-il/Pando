import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {physicalWaterContextKey,createPhysicalResources} from '../../shared/frontend/js/modules/physical-resources.js';

const ref={domain:'hydroBuiltin',id:'lake:historical'};
const row=(land='land-v1',water='water-v1',name='Historical Lake')=>({
  objectRef:ref,geometryRef:{id:'historical-lake-version',version:1},
  identity:{objectRef:ref,entityKind:'lake',name,layerId:'lakes_base'},
  assets:{land:{sha256:land},asset:{sha256:water}},
});

test('P4-5 physical context excludes political time but includes all actual land/water identities',()=>{
  const first=physicalWaterContextKey([row()]);
  assert.equal(physicalWaterContextKey([structuredClone(row())]),first);
  assert.notEqual(physicalWaterContextKey([row('different-land')]),first);
  assert.notEqual(physicalWaterContextKey([row('land-v1','different-water')]),first);
  assert.notEqual(physicalWaterContextKey([row('land-v1','water-v1','New label')]),first);
  assert.equal(physicalWaterContextKey([]),'[]');
  assert.throws(()=>physicalWaterContextKey([{objectRef:ref,geometryRef:{id:'x',version:1}}]),/identities/);
});

test('P4-5 unchanged historical lake versions reuse the exact physical result while other country years change',async t=>{
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  const bytes=new Map(),requests=[];
  const asset=(name,geometry)=>{
    const body=Buffer.from(JSON.stringify(geometry));
    bytes.set(name,body);
    return {url:'assets/data/'+name,encoding:'identity',
      sha256:createHash('sha256').update(body).digest('hex'),
      compressedBytes:body.length,decodedBytes:body.length};
  };
  const box=x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]});
  const modern=asset('modern',{type:'MultiPolygon',coordinates:[]});
  const historicLand=asset('historic-land',{type:'MultiPolygon',coordinates:[box(0).coordinates]});
  const lake=asset('historic-lake',box(5));
  const catalog={identities:[{objectRef:ref,entityKind:'lake',name:'Historical Lake',layerId:'lakes_base'}],
    geometries:[{geometryRef:{id:'historical-lake-version',version:1},land:historicLand,asset:lake}],
    timelineRecords:{schemaVersion:3,
      lifetimes:[{id:'lifetime',objectRef:ref,validFrom:'1920',validTo:'1930'}],
      parentRelations:[],propertyBindings:[],
      geometryBindings:[{id:'water',objectRef:ref,geometryRef:{id:'historical-lake-version',version:1},
        validFrom:'1920',validTo:'1930'}]}};
  globalThis.fetch=async url=>{
    const name=new URL(url).pathname.split('/').at(-1);
    requests.push(name);return new Response(bytes.get(name));
  };
  const state={timelineCursor:'2026-10',hydroFeatureCache:new Map(),hydroEdits:[]};
  const resources=createPhysicalResources({
    buildMeta:{dataRevision:'p4-5-fixture',physicalLand:modern,physicalWaterObjects:catalog},
    capabilities:{terrain:false,builtinHydro:false}
  });
  resources.connect({
    projectState:{state},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},
    domains:{renderingDomain:{invalidateProject:()=>{}}},
    feedback:{reportOperationError:err=>{throw err;}}
  });
  await resources.loadPhysicalLandMask();
  await resources.preparePhysicalContext('1922-12');
  state.timelineCursor='1922-12';
  const first=resources.physicalLand;
  assert.equal(first.revision,historicLand.sha256);
  assert.equal(first.water.type,'Polygon');
  const fetched=requests.length;
  await resources.preparePhysicalContext('1925-12');
  state.timelineCursor='1925-12';
  assert.strictEqual(resources.physicalLand,first);
  assert.equal(requests.length,fetched,'political-only year changes must not fetch unchanged physical objects');
  await resources.preparePhysicalContext('2000-12');
  state.timelineCursor='2000-12';
  assert.equal(resources.physicalLand.revision,modern.sha256);
  assert.equal(resources.physicalLand.water??null,null);
  assert.equal(requests.length,fetched);
  state.timelineCursor='1922-12';
  assert.strictEqual(resources.physicalLand,first,'revisiting a matching source may reuse the physical mask');
});
