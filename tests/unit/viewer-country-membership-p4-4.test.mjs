import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectSearchController} from '../../shared/frontend/js/modules/object-search-controller.js';
import {normalizeObjectRef} from '../../shared/frontend/js/modules/object-selection-controller.js';
import {territorialMembershipDelta,createTerritorialEntityStore}
  from '../../shared/frontend/js/modules/territorial-entity-store.js';

function node() {
  const events=new Map(),classes=new Set();
  return {
    children:[],events,dataset:{},attributes:{},inert:false,
    classList:{toggle:(key,enabled)=>enabled?classes.add(key):classes.delete(key)},
    setAttribute(key,value){this.attributes[key]=value;},
    addEventListener(key,handler){events.set(key,handler);},
    append(...children){this.children.push(...children);},
    prepend(...children){this.children.unshift(...children);},
    replaceChildren(...children){this.children=children;},
    querySelectorAll(){return this.children.filter(child=>child.dataset.objectKey);},
    closest(selector){
      if(selector==='[data-object-search-select]'&&this.dataset.objectSearchSelect)return this;
      if(selector==='[data-object-search-focus]'&&this.dataset.objectSearchFocus)return this;
      return null;
    },
    contains(other){return this===other;},
  };
}
function searchFixture(){
  let rows=[{id:'OLD',name:'이전 국가'},{id:'REMAIN',name:'기존 국가'}];
  const state={search:'국가',searchActive:false,searchSurfaceOpen:true};
  const results=node(),input=node(),sections=node(),selected=[],focused=[],hovered=[],closed=[];
  const itemRef=(_group,id)=>normalizeObjectRef({domain:'territorial',type:'entity',id});
  const controller=createObjectSearchController({
    window:{setTimeout,clearTimeout},document:{createElement:node},
    elements:{searchResults:results,search:input,section:sections},
    groups:{search:['objects']},
    model:{snapshot:()=>state,items:()=>rows,itemRef,compare:(a,b)=>a.name.localeCompare(b.name),
      selectionSnapshot:()=>({selection:{items:[],primaryKey:null}})},
    createEmptyState:node,
    commands:{selectItem:({id})=>{selected.push(id);return true;},
      focusItem:(_group,id)=>focused.push(id),hoverItem:(_group,id)=>hovered.push(id),
      closeAfterSingleSelection:()=>closed.push(true)},
  });
  controller.bind();controller.render();
  const button=(id,action='select')=>{
    const row=results.children.find(child=>child.children[0]?.dataset.itemId===id);
    return row?.children[action==='focus'?1:0]||null;
  };
  const click=target=>results.events.get('click')({target,preventDefault(){},
    ctrlKey:false,metaKey:false,shiftKey:false});
  return {controller,results,state,selected,focused,hovered,closed,button,click,
    replace(next){rows=next;}};
}
const country=(id)=>({id,properties:{entityKind:'general',parentId:''},
  geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}});

test('P4-4 membership delta proves births and deaths without interpreting names as country IDs',()=>{
  const a=[country('OLD'),country('REMAIN')],b=[country('REMAIN'),country('NEW')];
  assert.deepEqual(territorialMembershipDelta(a,b),
    {addedIds:['NEW'],removedIds:['OLD'],changed:true});
  const renamed=structuredClone(a);renamed[0].properties.name='renamed';
  assert.deepEqual(territorialMembershipDelta(a,renamed),
    {addedIds:[],removedIds:[],changed:false});
});

test('P4-4 a C++ membership transition reports new and extinct country IDs for downstream renderers',()=>{
  let rows=[country('OLD'),country('REMAIN')],notify;
  const updates=[];
  const owner=createTerritorialEntityStore({
    documentModel:{territorialViews:()=>rows,list:()=>[],world:()=>({}),projectWorld:()=>({})},
    commandOwner:{state:()=>({}),resolveWorld:async()=>({}),
      setTimelineCursor:async()=>({state:{timelineCursor:'2006-12'}}),
      subscribeTransitions:callback=>{notify=callback;return ()=>{};}},
    onEntitiesReplaced:(_rows,change)=>updates.push(change),
  });
  const previous=rows;
  rows=[country('REMAIN'),country('NEW')];notify();
  // The accepted Core projection may rematerialize an unchanged row wrapper.
  // changedIds is a conservative render invalidation; membership is the
  // actual set difference and must not misclassify that surviving country.
  assert.ok(updates[0].changedIds.has('OLD'));
  assert.ok(updates[0].changedIds.has('NEW'));
  assert.deepEqual(territorialMembershipDelta(previous,rows),
    {addedIds:['NEW'],removedIds:['OLD'],changed:true});
  assert.equal(updates[0].rootGeometryChanged,true);
  assert.equal(updates[0].propertyOnly,false);
  assert.deepEqual(owner.snapshot().map(feature=>feature.id),['REMAIN','NEW']);
  owner.dispose();
});

test('P4-4 pending project keeps old search visible but inert and makes old actions no-ops',()=>{
  const f=searchFixture(),old=f.button('OLD'),oldFocus=f.button('OLD','focus');
  assert.ok(old&&oldFocus);
  const ticket=f.controller.beginProjectTransition();
  assert.equal(f.results.inert,true);
  assert.equal(f.results.attributes['aria-busy'],'true');
  assert.equal(f.controller.render(),false);
  f.click(old);f.click(oldFocus);
  assert.deepEqual(f.selected,[]);
  assert.deepEqual(f.focused,[]);
  f.replace([{id:'REMAIN',name:'기존 국가'},{id:'NEW',name:'신규 국가'}]);
  assert.equal(f.controller.endProjectTransition(ticket),true);
  assert.equal(f.results.inert,false);
  assert.equal(f.results.attributes['aria-busy'],'false');
  assert.equal(f.button('OLD'),null);
  assert.ok(f.button('NEW'));
  f.click(old);f.click(oldFocus);
  assert.deepEqual(f.selected,[],'removed row handlers stay inert even after new rows are mounted');
  assert.deepEqual(f.focused,[]);
  f.click(f.button('NEW'));
  assert.deepEqual(f.selected,['NEW']);
  assert.equal(f.closed.length,1);
  f.controller.dispose();
});

test('P4-4 superseded projects cannot unlock or publish previous search results',()=>{
  const f=searchFixture();
  const first=f.controller.beginProjectTransition();
  const next=f.controller.beginProjectTransition();
  f.replace([{id:'NEW',name:'신규 국가'}]);
  assert.equal(f.controller.endProjectTransition(first),false);
  assert.equal(f.results.inert,true);
  assert.ok(f.button('OLD'));
  assert.equal(f.controller.endProjectTransition(next),true);
  assert.equal(f.button('OLD'),null);
  assert.ok(f.button('NEW'));
  f.controller.dispose();
});

test('P4-4 aborted project restores the old country rows without resetting the active query',()=>{
  const f=searchFixture();
  const before=f.button('OLD');
  const request=f.controller.beginProjectTransition();
  assert.equal(f.controller.endProjectTransition(request),true);
  const after=f.button('OLD');
  assert.ok(after);
  assert.notEqual(before,after);
  assert.equal(f.state.search,'국가');
  f.click(before);assert.deepEqual(f.selected,[]);
  f.click(after);assert.deepEqual(f.selected,['OLD']);
  f.controller.dispose();
});
