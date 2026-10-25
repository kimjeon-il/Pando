import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasCountryGeometrySignature } from '../../assets/js/modules/gpu-map-renderer.js';
import { touchGeometry } from '../../assets/js/modules/geometry-versions.js';

const feature = id => ({ id, geometry: { type:'Polygon', coordinates:[[[0,0],[0,1],[1,1],[1,0],[0,0]]] },
  properties: { entityKind:'general', style:{} } });

test('Canvas country data identity ignores presentation wrappers but follows geometry and membership', () => {
  const root=feature('CHN'), child=feature('HKG');
  child.boundaryRootId='CHN';child.boundaryPristine=true;
  const rows=[root,child], key=canvasCountryGeometrySignature(rows);
  assert.equal(canvasCountryGeometrySignature(rows.map(row=>({...row,properties:{...row.properties,style:{color:'#ff0000'}}}))),key);
  assert.notEqual(canvasCountryGeometrySignature([root]),key);
  assert.notEqual(canvasCountryGeometrySignature([child,root]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,id:'MAC'}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,geometry:structuredClone(child.geometry)}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,boundaryRootId:'OTHER'}]),key);
  assert.notEqual(canvasCountryGeometrySignature([root,{...child,boundaryPristine:false}]),key);
  touchGeometry(child.geometry);
  assert.notEqual(canvasCountryGeometrySignature(rows),key);
});
