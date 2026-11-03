import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapDisplayMenuState} from '../../shared/frontend/js/modules/map-display-menu-state.js';

test('desktop menu state owns its path and focus without sharing domain settings',()=>{
  const menu=createMapDisplayMenuState();
  assert.deepEqual(menu.path,[]);
  menu.setPath(['objects','labels']);
  assert.deepEqual(menu.path,['objects','labels']);
  assert.equal(menu.popPath(),'labels');
  assert.deepEqual(menu.path,['objects']);
  const focus={id:'row'};menu.rememberFocus(focus);
  assert.equal(menu.focusedControl,focus);
  menu.rememberFocus(null);
  assert.equal(menu.focusedControl,null);
});

test('a new pointer gesture cancels pending menu open and close',async()=>{
  const menu=createMapDisplayMenuState();
  let opened=0,closed=0;
  menu.scheduleOpen(()=>opened++,5);
  menu.scheduleClose(()=>closed++,5);
  menu.beginGesture(7);
  assert.equal(menu.gesture,7);
  assert.equal(menu.endGesture(8),false);
  assert.equal(menu.endGesture(7),true);
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(opened,0);assert.equal(closed,0);
});
