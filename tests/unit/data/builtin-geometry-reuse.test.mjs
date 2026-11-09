import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeBuiltinCountries,finalizeBuiltinWorldFiles} from '../../../tools/data/builtin-country-bytes.mjs';

const geometry={type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,0]]]};
const country=name=>({schemaVersion:2,entityId:'state:A',identity:{id:'state:A'},
  names:{ko:name},geometries:[{id:'state:A:boundary',version:1,geojson:geometry}]});
const index=()=>({schema:'pandolab-builtin-world',schemaVersion:2,entities:[{entityId:'state:A'}],geometryAssets:[]});

test('full country metadata regeneration reuses immutable geometry payload by content SHA',()=>{
 const initial=index(),firstFiles=encodeBuiltinCountries(initial,[country('기존 이름')],new Map());
 const geometryAsset=structuredClone(initial.geometryAssets[0]);
 assert.ok(geometryAsset);
 assert.equal([...firstFiles.keys()].filter(name=>name.startsWith('geometries/')).length,1);
 const changed=index();changed.geometryAssets=structuredClone(initial.geometryAssets);
 const secondFiles=encodeBuiltinCountries(changed,[country('새 이름')],new Map());
 assert.deepEqual([...secondFiles.keys()].filter(name=>name.startsWith('geometries/')),[],
   'metadata-only generation must never gzip or copy any source coordinate payload');
 assert.deepEqual(changed.geometryAssets,[geometryAsset]);
 assert.notEqual(changed.entities[0].sha256,initial.entities[0].sha256);
 assert.equal(changed.entities[0].geometryRefs[0].id,'state:A:boundary');
});

test('a genuinely different polygon cannot reuse the old geometry hash',()=>{
 const before=index();encodeBuiltinCountries(before,[country('same')],new Map());
 const next=index();next.geometryAssets=structuredClone(before.geometryAssets);
 const changed={...country('same'),geometries:[{id:'state:A:boundary-v2',version:1,
   geojson:{type:'Polygon',coordinates:[[[0,0],[3,0],[3,3],[0,0]]]}}]};
 const files=encodeBuiltinCountries(next,[changed],new Map());
 assert.equal([...files.keys()].filter(name=>name.startsWith('geometries/')).length,1);
 assert.notEqual(next.geometryAssets[0].sha256,before.geometryAssets[0].sha256);
});
