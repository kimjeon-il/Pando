import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPhysicalResources} from '../../shared/frontend/js/modules/physical-resources.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

for(const requestModern of [true,false])test(requestModern
  ? 'leaving the historical window during first lake admission cannot overwrite the modern second lake'
  : 'changing only the timeline cursor prevents stale second lake admission before the next frame', {timeout:5000},async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  const bytes=new Map();
  const asset=(name,geometry)=>{
    const body=Buffer.from(JSON.stringify(geometry));bytes.set(name,body);
    return {url:'assets/data/'+name,encoding:'identity',sha256:createHash('sha256').update(body).digest('hex'),compressedBytes:body.length,decodedBytes:body.length};
  };
  const box=x=>({type:'Polygon',coordinates:[[[x,0],[x+1,0],[x+1,1],[x,0]]]});
  const baseline=asset('baseline',{type:'MultiPolygon',coordinates:[]});
  const historyLand=asset('historical-land',{type:'MultiPolygon',coordinates:[box(0).coordinates]});
  const aral={domain:'hydroBuiltin',id:'waterbody:aral'},caspian={domain:'hydroBuiltin',id:'waterbody:caspian'};
  const aralRef={id:'aral-history',version:1},oldRef={id:'caspian-history',version:1},modernRef={id:'caspian-modern',version:1};
  const catalog={identities:[aral,caspian].map(objectRef=>({objectRef,entityKind:'lake',name:objectRef.id,layerId:'lakes_base'})),
    geometries:[{geometryRef:aralRef,land:historyLand,asset:asset('aral-history',box(5))},
      {geometryRef:oldRef,land:historyLand,asset:asset('caspian-history',box(2))},
      {geometryRef:modernRef,land:baseline,asset:asset('caspian-modern',box(3))}],
    timelineRecords:{schemaVersion:3,lifetimes:[aral,caspian].map(objectRef=>({id:'life:'+objectRef.id,objectRef,validFrom:null,validTo:null})),parentRelations:[],propertyBindings:[],geometryBindings:[
      {id:'aral-old',objectRef:aral,validFrom:'1922-01-01',validTo:'1929-12-31',geometryRef:aralRef},
      {id:'caspian-old',objectRef:caspian,validFrom:'1922-01-01',validTo:'1929-12-31',geometryRef:oldRef},
      {id:'caspian-modern',objectRef:caspian,validFrom:'1930-01-01',validTo:null,geometryRef:modernRef}]}};
  globalThis.fetch=async url=>new Response(bytes.get(new URL(url).pathname.split('/').at(-1)));
  const firstAdmission=deferred(),releaseFirst=deferred(),modernReady=deferred(),lateReady=deferred();
  t.after(()=>releaseFirst.resolve());
  let admissions=0,ready=0;
  const state={timelineCursor:'',hydroEdits:[],hydroFeatureCache:new Map()};
  const resource=createPhysicalResources({buildMeta:{dataRevision:'admission-race',physicalLand:baseline,physicalWaterObjects:catalog},capabilities:{terrain:false,builtinHydro:true,eagerBuiltinHydro:false}});
  resource.connect({projectState:{state},physicalConfig:{PHYSICAL_DATA_BASE_URL:'http://fixture/assets/data/'},
    cutGeometry:{coordinateBounds:()=>[0,0,6,1]},platform:{d3:{geo:{centroid:()=>[0,0]}}},
    hydroPresentation:{allBuiltInHydroFeatures:()=>[...state.hydroFeatureCache.values()],HYDRO_LAYER_META:{lakes_base:{category:'lake'}},hydroCategoryKey:value=>value},
    physicalServices:{isHydroFeatureVisible:()=>true},
    domains:{projectDomain:{admitSelectionCatalog:async (_domain,references)=>{
      references();admissions++;
      if(admissions===1){firstAdmission.resolve();await releaseFirst.promise;}
    }},renderingDomain:{invalidateProject:reason=>{
      if(reason==='physical-water-ready'){ready++;(ready===1?modernReady:lateReady).resolve();}
    }}},feedback:{reportOperationError:error=>{throw error;}}});
  await resource.loadPhysicalData({includeHydro:false});
  state.timelineCursor='1922';void resource.physicalLand;
  await firstAdmission.promise;
  assert.equal(state.hydroFeatureCache.has(aral.id),true,'the first historical lake is awaiting canonical admission');
  state.timelineCursor='1930';
  if(requestModern){
    void resource.physicalLand;await modernReady.promise;
    assert.deepEqual(state.hydroFeatureCache.get(caspian.id).properties.geometryRef,modernRef);
    releaseFirst.resolve();await lateReady.promise;
    assert.deepEqual(state.hydroFeatureCache.get(caspian.id).properties.geometryRef,modernRef,
      'late historical admission must not overwrite the current modern selection/copy resource');
  }else{
    releaseFirst.resolve();await modernReady.promise;
    assert.equal(state.hydroFeatureCache.has(caspian.id),false,
      'the actual date selection changes before a background getter updates its requested key');
    assert.equal(admissions,1,'the second stale source must never cross the canonical admission boundary');
  }
});
