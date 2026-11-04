import test from 'node:test';
import assert from 'node:assert/strict';
import {countryMeshContentKey} from '../../shared/frontend/js/modules/country-mesh-content-key.js';
import {resourceUpdate} from '../../shared/frontend/js/modules/resource-update-policy.js';
import {createGeometryVersionStore} from '../../shared/frontend/js/modules/geometry-version-store.js';

const square=(x=0)=>({type:'Polygon',coordinates:[[[x,0],[x+2,0],[x+2,2],[x,2],[x,0]]]});
const country=(id,geometry)=>({id,geometry,properties:{color:'#123456',name:id}});
const key=features=>countryMeshContentKey(features);

test('P3-2 a structurally identical new country geometry object reuses one content identity',async()=>{
 const a=[country('A',square()),country('B',square(4))];
 const b=structuredClone(a);
 b[0].properties.color='#ffffff';
 const ka=await key(a),kb=await key(b);
 assert.equal(ka,kb);
 assert.ok(Object.keys(a[0].geometry).length===2);
 assert.notStrictEqual(a[0].geometry,b[0].geometry);
});
test('P3-2 different coordinates, topology, country ID or ordering never share a canonical key',async()=>{
 const original=[country('A',square()),country('B',square(4))],k=await key(original);
 const moved=structuredClone(original);moved[0].geometry.coordinates[0][1][0]+=0.00000001;
 const hole=structuredClone(original);hole[0].geometry.coordinates.push([[0.2,0.2],[1,0.2],[1,1],[0.2,1],[0.2,0.2]]);
 const renamed=structuredClone(original);renamed[0].id='X';
 const swapped=structuredClone(original).reverse();
 for(const changed of [moved,hole,renamed,swapped])assert.notEqual(await key(changed),k);
});
test('P3-2 live mutable geometry changes never reuse an earlier digest',async()=>{
 const rows=[country('A',square())],previous=await key(rows);
 rows[0].geometry.coordinates[0][2][0]+=0.125;
 assert.notEqual(await key(rows),previous);
});
test('P3-2 superseded canonical fingerprint can never be admitted',async()=>{
 const features=[country('A',square()),country('B',square(4))];
 let checks=0;
 const result=await countryMeshContentKey(features,{isCurrent:()=>++checks<2});
 assert.equal(result,null);
});
test('P3-2 GPU context changes still require upload even if prepared geometry matches',async()=>{
 const a=await key([country('A',square())]),ctxA={},ctxB={};
 const previous={source:'country-mesh',content:a,preparation:'mesh-v7',context:[ctxA,1],presentation:'countries'};
 const same={...previous},otherGpu={...previous,context:[ctxB,2]},newPrep={...previous,preparation:'mesh-v8'};
 assert.equal(resourceUpdate(previous,same).prepare,false);
 assert.equal(resourceUpdate(previous,otherGpu).prepare,false);
 assert.equal(resourceUpdate(previous,otherGpu).upload,true);
 assert.equal(resourceUpdate(previous,newPrep).prepare,true);
});

test('verified immutable country geometries reuse their digest while mutable inputs are rechecked',async t=>{
 const store=createGeometryVersionStore([{id:'geom',version:1,geojson:square()}]);
 const immutable=store.get({id:'geom',version:1}),mutable=square(4);
 const subtle=globalThis.crypto.subtle,previous=Object.getOwnPropertyDescriptor(subtle,'digest'),digest=subtle.digest.bind(subtle);let calls=0;
 Object.defineProperty(subtle,'digest',{configurable:true,value:(...args)=>{calls++;return digest(...args);}});
 t.after(()=>{if(previous)Object.defineProperty(subtle,'digest',previous);else delete subtle.digest;});
 const first=await key([country('A',immutable),country('B',mutable)]);
 assert.equal(await key([country('A',immutable),country('B',mutable)]),first);
 assert.equal(calls,3,'only the structurally validated immutable geometry can skip a second hash');
 mutable.coordinates[0][1][0]+=0.125;
 assert.notEqual(await key([country('A',immutable),country('B',mutable)]),first);
 assert.equal(calls,4);
});

test('immutable digest failures are retried and stale requests cannot admit a key',async t=>{
 const store=createGeometryVersionStore([{id:'retry-geometry',version:1,geojson:square(9)}]);
 const immutable=store.get({id:'retry-geometry',version:1}),rows=[country('A',immutable)];
 const subtle=globalThis.crypto.subtle,previous=Object.getOwnPropertyDescriptor(subtle,'digest'),digest=subtle.digest.bind(subtle);let calls=0;
 Object.defineProperty(subtle,'digest',{configurable:true,value:(...args)=>{calls++;return calls===1?Promise.reject(Error('digest failed')):digest(...args);}});
 t.after(()=>{if(previous)Object.defineProperty(subtle,'digest',previous);else delete subtle.digest;});
 await assert.rejects(key(rows),/digest failed/);
 let checks=0;assert.equal(await countryMeshContentKey(rows,{isCurrent:()=>++checks<2}),null);
 assert.equal(typeof await key(rows),'string');assert.equal(calls,2);
});
