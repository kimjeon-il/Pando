import test from 'node:test';
import assert from 'node:assert/strict';
import {countryMeshContentKey} from '../../shared/frontend/js/modules/country-mesh-content-key.js';
import {resourceUpdate} from '../../shared/frontend/js/modules/resource-update-policy.js';

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
