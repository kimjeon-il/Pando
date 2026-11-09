import { describe as contractSuite } from 'node:test';
import * as __unit_dep0 from "node:assert/strict";
import * as __unit_dep1 from "node:test";
import * as __unit_dep2 from "../../../src/ui/surface-controller.js";
import * as __unit_dep3 from "node:fs";
import * as __unit_dep4 from "../../../scripts/lib/product-html.mjs";
import * as __unit_dep5 from "../../../src/runtime/resource-capabilities.js";
import * as __unit_dep6 from "../../../src/document/object-query.js";
import * as __unit_dep7 from "../../../src/document/object-ref-identity.js";
import * as __unit_dep8 from "../../../src/document/place-contract.js";
import * as __unit_dep9 from "../../../src/ui/workspace-layout.js";
contractSuite("surface-controller", () => {
const assert = __unit_dep0.default;
const test = __unit_dep1.default;
const { createSurfaceController } = __unit_dep2;

function element(id = '') {
  const attributes = new Map(), classes = new Set();
  return { id, inert: false,
    classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); } },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); } };
}
function fixture(initialLayout) {
  let layout = initialLayout;
  const elements = Object.fromEntries(['objectSearchSurface','mapDisplaySurface','objectSearchBtn',
    'mapDisplayBtn','mobileSearchBtn','mobileDisplayBtn','mobileFileBtn','mobileBackdrop'].map(id => [id, element(id)]));
  const workspace = element('workspace'), body = element('body');
  const document = { body, activeElement: null, querySelector: selector => selector === '.workspace' ? workspace : null };
  return { controller: createSurfaceController({ getElement: id => elements[id], getLayout: () => layout, document }),
    elements, body, workspace, setLayout: value => { layout = value; } };
}

test('retired editor and creation surfaces cannot replace current search', () => {
  const { controller } = fixture('wide');
  controller.open('search');
  for (const surface of ['editor','create','layers','reference']) assert.equal(controller.open(surface), false);
  assert.equal(controller.isOpen('search'), true);
  assert.equal(controller.isOpen('display'), false);
});

test('search and display replace each other and synchronize triggers', () => {
  for (const layout of ['wide','compact','mobile','phone-landscape']) {
    const { controller, elements } = fixture(layout);
    controller.open('search'); controller.render();
    assert.equal(elements.objectSearchBtn.getAttribute('aria-expanded'), 'true');
    assert.equal(elements.objectSearchSurface.inert, false);
    controller.open('display'); controller.render();
    assert.equal(controller.isOpen('search'), false);
    assert.equal(controller.isOpen('display'), true);
    assert.equal(elements.mobileSearchBtn.getAttribute('aria-expanded'), 'false');
    assert.equal(elements.mobileDisplayBtn.getAttribute('aria-expanded'), 'true');
    controller.close('display'); controller.render();
    assert.equal(controller.isOpen('display'), false);
    assert.equal(elements.mobileDisplayBtn.getAttribute('aria-expanded'), 'false');
  }
});

test('mobile sheets expose dialog state and keep one active surface', () => {
  const { controller, elements, body } = fixture('mobile');
  controller.open('search'); controller.render();
  assert.equal(controller.activeMobileSheet, 'search');
  assert.equal(elements.objectSearchSurface.getAttribute('role'), 'dialog');
  assert.equal(elements.objectSearchSurface.getAttribute('aria-hidden'), 'false');
  assert.equal(elements.mapDisplaySurface.inert, true);
  assert.equal(body.classList.contains('map-sheet-open'), true);
  controller.open('display'); controller.render();
  assert.equal(elements.objectSearchSurface.inert, true);
  assert.equal(elements.mapDisplaySurface.inert, false);
  controller.close('display'); controller.render();
  assert.equal(controller.activeMobileSheet, null);
  assert.equal(body.classList.contains('map-sheet-open'), false);
});

test('the active search panel survives desktop, portrait and landscape transitions', () => {
  const { controller, setLayout, elements } = fixture('wide');
  controller.open('search'); controller.render();
  for (const [previous, next] of [['wide','compact'],['compact','mobile'],['mobile','phone-landscape'],['phone-landscape','wide']]) {
    setLayout(next); controller.syncLayout(previous); controller.render();
    assert.equal(controller.isOpen('search'), true, next);
    assert.equal(elements.objectSearchBtn.getAttribute('aria-expanded'), 'true', next);
    assert.equal(controller.activeMobileSheet, ['mobile','phone-landscape'].includes(next) ? 'search' : null, next);
  }
});
});
contractSuite("viewing-ui-contract", () => {
const { test } = __unit_dep1;
const assert = __unit_dep0.default;
const { readFileSync } = __unit_dep3;
const { renderProductHtml } = __unit_dep4;
const { resourceCapabilities } = __unit_dep5;

const read=path=>readFileSync(new URL(`../../../${path}`,import.meta.url),'utf8').replaceAll('\r\n','\n');
test('read-only Web Viewer owns current viewing controls and platform capabilities',()=>{
 const {web}=renderProductHtml(read);
 for(const id of ['mapDisplaySurface','objectSearchSurface','preferencesModal','preferencesApplyBtn','timelineControls'])
  assert.match(web,new RegExp(`id="${id}"`));
 assert.match(web,/data-map-display-group="terrain"/);
 assert.match(web,/data-map-background="graticule"/);
 assert.doesNotMatch(web,/src=["'][^"']*apps\/editor\//,'retired Windows stage must not enter Web Viewer');
 assert.doesNotMatch(web,/id=["']editorSurface["']/,'retired editor DOM must remain absent');
 assert.equal(resourceCapabilities('viewer',null,{projection:'flat'}).terrain,false);
 assert.equal(resourceCapabilities('viewer',null,{projection:'globe'}).terrain,true);
});
});
contractSuite("viewing-visibility", () => {
const test = __unit_dep1.default;
const assert = __unit_dep0.default;
const { createObjectQuery } = __unit_dep6;
const { normalizeObjectRef } = __unit_dep7;
const { normalizePlace } = __unit_dep8;
test('one category visibility controls searchable objects regardless of their source',()=>{
 const builtin=normalizePlace({source:'test',sourceId:'one',name:'Place',coordinates:[0,0]});
 const labels=[builtin,{id:'authored-place',name:'Authored place',validFrom:null,validTo:null}];
 const state={timelineCursor:'2026-10',genericFeatures:[{id:'A',properties:{validFrom:null,validTo:null}}],
   layerVisibility:{genericFeatures:false,labels:true,rivers:true},itemVisibility:{hydro:{}},physicalSettings:{}};
 const query=createObjectQuery({selectionServices:{normalizeObjectRef},projectState:{state},
   layerPresentation:{isLayerItemVisible:()=>true},labelPresentation:{labelById:id=>labels.find(label=>label.id===id)||null},
   hydroPresentation:{hydroEditById:()=>null},hydroModel:{hydroFeatureById:()=>({id:'river-a'})}});
 assert.equal(query.objectRefVisible({domain:'generic',type:'feature',id:'A'}),false);
 state.layerVisibility.genericFeatures=true;
 assert.equal(query.objectRefVisible({domain:'generic',type:'feature',id:'A'}),true);
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),true);
 state.layerVisibility.rivers=false;
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
 state.layerVisibility.rivers=true;
 state.resourceCapabilities={builtinHydro:false};
 assert.equal(query.objectRefVisible({domain:'hydro',type:'river',id:'river-a'}),false);
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'builtin:place:test:one'}),true);
 state.resourceCapabilities.builtinPlaces=false;
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'builtin:place:test:one'}),false);
 assert.equal(query.objectRefVisible({domain:'label',type:'label',id:'authored-place'}),true);
});
});
contractSuite("workspace-layout", () => {
const assert = __unit_dep0.default;
const test = __unit_dep1.default;
const { createWorkspaceLayoutDetector } = __unit_dep9;

test('phone landscape requires coarse input, landscape and layout height below 600', () => {
  const detect = createWorkspaceLayoutDetector();
  assert.equal(detect({ width: 844, height: 390, coarse: true }), 'phone-landscape');
  assert.equal(detect({ width: 844, height: 390, coarse: false }), 'compact');
  assert.equal(detect({ width: 1024, height: 768, coarse: true }), 'compact');
  assert.equal(detect({ width: 390, height: 844, coarse: true }), 'mobile');
  assert.equal(detect({ width: 1440, height: 900, coarse: false }), 'wide');
});

test('keyboard height changes do not turn portrait or tablet editing into phone landscape', () => {
  const detect = createWorkspaceLayoutDetector();
  assert.equal(detect({ width: 390, height: 844, coarse: true }), 'mobile');
  assert.equal(detect({ width: 390, height: 300, coarse: true, editingText: true }), 'mobile');
  assert.equal(detect({ width: 844, height: 390, coarse: true, editingText: true }), 'phone-landscape');
  assert.equal(detect({ width: 1024, height: 768, coarse: true }), 'compact');
  assert.equal(detect({ width: 1024, height: 400, coarse: true, editingText: true }), 'compact');
});
});
