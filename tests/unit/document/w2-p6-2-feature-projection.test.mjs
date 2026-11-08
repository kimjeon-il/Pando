import assert from 'node:assert/strict';
import test from 'node:test';
import {projectCountryBoundaryMessage as project} from "../../../tools/w2-p6-2-project-country-feature.mjs";

const geometry={type:'MultiPolygon',coordinates:[
  [[[-180,40],[-179,40],[-179,41],[-180,40]]],
  [[[12,50],[12.1,50],[12.1,51],[12,50]],[[12.02,50.1],[12.03,50.1],[12.03,50.2],[12.02,50.1]]],
]};
const first={type:'Feature',id:'ROOT',properties:{
  parentId:'',entityKind:'general',name:'Country',metadata:{large:[1,2,3]},
  notes:'Do not transfer this',style:{color:'#acf'},validFrom:'1900-01-01',
  validTo:null,sourceGeometryVersion:'a'.repeat(64),
},boundaryGeometryRevision:'1:0',geometry};
const child={...first,id:'CHILD',boundaryRootId:'ROOT',boundaryPristine:false,
  properties:{...first.properties,parentId:'ROOT',name:'Province'}};
const message={type:'replace',requestId:5,projectGeneration:2,geometryRevision:2,
  quality:'canonical',includeOutlines:true,cacheUrl:'https://test.invalid/boundary',
  skipCacheReconcile:false,features:[first,child],removedIds:['MISSING']};

test('P6-2 reference-preserving projection excludes unrelated fields without changing the source',()=>{
  const source=structuredClone(message);
  const slim=project(message);
  assert.notStrictEqual(slim,message);
  assert.notStrictEqual(slim.features,message.features);
  assert.deepEqual(message,source,'the Core/Viewer feature input must remain unchanged');
  assert.strictEqual(slim.features[0].geometry,geometry,'no coordinate clone on the UI path');
  assert.equal(slim.features[0].geometry.coordinates[1][1].length,4);
  assert.deepEqual(Object.keys(slim.features[0]),['type','id','geometry','properties','boundaryGeometryRevision']);
  assert.deepEqual(slim.features[0].properties,{entityKind:'general',parentId:''});
  assert.deepEqual(Object.keys(slim.features[1]),
    ['type','id','geometry','properties','boundaryRootId','boundaryGeometryRevision']);
  assert.equal(slim.features[1].boundaryRootId,'ROOT');
  assert.equal(slim.features[1].properties.parentId,'ROOT');
  assert.equal(slim.features[1].boundaryPristine,undefined);
  for(const key of ['type','requestId','projectGeneration','geometryRevision',
    'quality','includeOutlines','cacheUrl','skipCacheReconcile','removedIds'])
    assert.deepEqual(slim[key],message[key]);
  assert.ok(JSON.stringify(slim).length<JSON.stringify(message).length);
});

test('P6-2 name-only metadata changes cannot change projected boundary input',()=>{
  const renamed=structuredClone(message);
  renamed.features[0].properties.name='new name';
  renamed.features[0].properties.metadata={new:'source'};
  assert.deepEqual(project(renamed).features,structuredClone(project(message).features));
  const ownership=structuredClone(message);
  ownership.features[1].properties.parentId='ANOTHER_ROOT';
  assert.notDeepEqual(project(ownership).features,project(message).features);
  const owner=structuredClone(message);
  owner.features[1].boundaryRootId='ANOTHER_ROOT';
  assert.notDeepEqual(project(owner).features,project(message).features);
  const moved=structuredClone(message);
  moved.features[1].geometry.coordinates[0][0][0][0]+=1e-8;
  assert.notDeepEqual(project(moved).features,project(message).features);
});

test('P6-2 patch/removal and non-boundary messages preserve temporal control fields',()=>{
  const patch=project({...message,type:'patch',features:[child],removedIds:['ROOT']});
  assert.equal(patch.type,'patch');
  assert.deepEqual(patch.removedIds,['ROOT']);
  assert.equal(patch.features[0].boundaryRootId,'ROOT');
  assert.equal(patch.projectGeneration,2);
  const other={type:'close',features:[first]};
  assert.strictEqual(project(other),other);
  const empty=project({...message,features:[]});
  assert.equal(empty.features.length,0);
});
