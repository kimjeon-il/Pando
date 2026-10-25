import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectSearchModel,visibleObjectSearchRows} from "../../shared/frontend/js/modules/object-search-model.js";
const model = data => createObjectSearchModel({items:group=>data[group]||[],groups:Object.keys(data),
  itemRef:(group,id)=>({key:`${group}:${id}`}),compare:(a,b)=>a.name.localeCompare(b.name)});
test('flat search preserves explicit object identity, name ordering, parent text and type matching without folder state',()=>{
  const result=model({objects:[{id:'same',name:'동명',searchText:'상위 객체'},{id:'child',name:'하위 객체',parentId:'same'}],labels:[{id:'same',name:'동명'}]});
  assert.equal(result.items.length,3);
  assert.deepEqual(visibleObjectSearchRows(result,'동명').map(row=>row.key),['labels:same','objects:same']);
  assert.deepEqual(visibleObjectSearchRows(result,'상위').map(row=>row.id),['same']);
  assert.deepEqual(visibleObjectSearchRows(result,'지명').map(row=>row.key),['labels:same']);
  assert.deepEqual(visibleObjectSearchRows(result,''),[]);
});
test('flat search deduplicates the same object across catalog groups and includes the full supplied global catalog',()=>{
  const rows=Array.from({length:1002},(_,id)=>({id:String(id),name:`객체 ${id}`}));
  const result=model({objects:rows});
  assert.equal(visibleObjectSearchRows(result,'객체').length,1002);
});

test('parent links do not create folders or hide cyclic entries in the flat result',()=>{
  const result=model({objects:[{id:'a',name:'객체 A',parentId:'b'},{id:'b',name:'객체 B',parentId:'a'}]});
  assert.deepEqual(visibleObjectSearchRows(result,'객체').map(row=>row.id),['a','b']);
});
