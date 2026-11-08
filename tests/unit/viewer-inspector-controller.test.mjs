import { describe as contractSuite } from 'node:test';
import * as __contract_dep0 from "node:assert/strict";
import * as __contract_dep1 from "node:test";
import * as __contract_dep2 from "../../apps/viewer/js/modules/viewer-inspector-controller.js";
import * as __contract_dep3 from "../../apps/viewer/js/modules/viewer-review-panel.js";
import * as __contract_dep4 from "node:assert/strict";
import * as __contract_dep5 from "node:test";
import * as __contract_dep6 from "../../apps/viewer/js/modules/viewer-inspector-state.js";
import * as __contract_dep7 from "node:fs";
contractSuite("viewer-inspector-controller", () => {
const assert = __contract_dep0.default;
const test = __contract_dep1.default;
const { createViewerInspectorController } = __contract_dep2;
const { createViewerReviewPanel } = __contract_dep3;

function harness(options={}) {
  class Element extends EventTarget {
    constructor(id){super();this.id=id;this.hidden=true;}
  }
  const elements=new Map(['reviewPanel','reviewPanelBtn','mobileReviewBtn'].map(id=>[id,new Element(id)]));
  const document=new EventTarget();
  document.getElementById=id=>elements.get(id)||null;
  const window=new EventTarget();
  const calls={factory:0,opens:[],closes:0,disposes:0,selections:[],mobile:0,errors:[]};
  let deferredFactory=null;
  const panel=()=>({
    open(source,{tab}){elements.get('reviewPanel').hidden=false;calls.opens.push({id:source.id,tab});},
    close(){elements.get('reviewPanel').hidden=true;calls.closes++;},
    dispose(){elements.get('reviewPanel').hidden=true;calls.disposes++;},
    syncMapSelection(snapshot){calls.selections.push(snapshot);},
  });
  const controller=createViewerInspectorController({
    document,window,readOnly:options.readOnly??true,
    inspectRequested:options.inspectRequested??false,
    debugEnabled:options.debugEnabled??false,
    createPanel:()=>{
      calls.factory++;
      return options.createPanel?.({panel,deferredFactory})??panel();
    },
    closeMobileSheets:()=>calls.mobile++,
    onError:(e,msg,code)=>calls.errors.push({e,msg,code}),
  });
  const key=({repeat=false,ctrl=true,shift=true,code='Period'}={})=>{
    const event=new Event('keydown',{cancelable:true});
    Object.defineProperties(event,{
      ctrlKey:{value:ctrl},metaKey:{value:false},
      shiftKey:{value:shift},code:{value:code},repeat:{value:repeat},
    });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const click=id=>elements.get(id).dispatchEvent(new Event('click'));
  return {document,window,elements,calls,controller,key,click,panel};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  return {promise,resolve,reject};
};

test('P5 ordinary Viewer has zero inspection imports until requested; shortcut toggles one owner',async()=>{
 const f=harness();
 assert.equal(f.elements.get('reviewPanelBtn').hidden,true);
 assert.equal(f.elements.get('mobileReviewBtn').hidden,true);
 assert.equal(f.controller.isLoaded,false);
 assert.equal(f.calls.factory,0);
 assert.equal(f.key({repeat:true}),false,'repeated shortcuts cannot create duplicate requests');
 assert.equal(f.key({ctrl:false}),false);
 assert.equal(f.key({code:'KeyP'}),false);
 assert.equal(f.calls.factory,0);
 assert.equal(f.key(),true);
 await flush();
 assert.equal(f.calls.factory,1);
 assert.deepEqual(f.calls.opens,[{id:'reviewPanelBtn',tab:'map'}]);
 assert.equal(f.elements.get('reviewPanel').hidden,false);
 assert.equal(f.key(),true);
 assert.equal(f.calls.closes,1);
 assert.equal(f.elements.get('reviewPanel').hidden,true);
 f.key();
 await flush();
 assert.equal(f.calls.factory,1,'the lazy panel must be reused');
 assert.equal(f.calls.opens.length,2);
 assert.equal(f.calls.opens[1].tab,'map');
 f.controller.dispose();
 assert.equal(f.calls.disposes,1);
 assert.equal(f.key(),false,'removed shortcuts do not intercept keyboard input');
});

test('P5 ?debug=1 only reveals inspector actions while ?inspect=1 opens the same map tab after startup',async()=>{
 const debug=harness({debugEnabled:true});
 assert.equal(debug.elements.get('reviewPanelBtn').hidden,false);
 assert.equal(debug.elements.get('mobileReviewBtn').hidden,false);
 assert.equal(debug.calls.factory,0);
 assert.equal(await debug.controller.openAfterStartup(),false);
 assert.equal(debug.calls.factory,0);
 debug.controller.dispose();
 const inspect=harness({inspectRequested:true});
 assert.equal(inspect.elements.get('reviewPanelBtn').hidden,false);
 assert.equal(inspect.calls.factory,0);
 assert.equal(await inspect.controller.openAfterStartup(),true);
 assert.deepEqual(inspect.calls.opens,[{id:'reviewPanelBtn',tab:'map'}]);
 inspect.controller.dispose();
});

test('P5 two shortcuts during an unresolved dynamic import cannot reopen a cancelled inspector',async()=>{
 const gate=deferred();
 const f=harness({createPanel:()=>gate.promise});
 f.key();
 await flush();
 assert.equal(f.calls.factory,1);
 assert.equal(f.key(),true);
 assert.equal(f.elements.get('reviewPanel').hidden,true);
 gate.resolve(f.panel());
 await flush();
 assert.equal(f.calls.opens.length,0);
 assert.equal(f.controller.isLoaded,true);
 assert.equal(f.elements.get('reviewPanel').hidden,true);
 f.key();
 await flush();
 assert.deepEqual(f.calls.opens,[{id:'reviewPanelBtn',tab:'map'}]);
 assert.equal(f.calls.factory,1,'pending imports must never duplicate the review panel');
 f.controller.dispose();
});

test('P5 late import after Viewer disposal cannot attach or open the review panel',async()=>{
 const gate=deferred();
 const f=harness({createPanel:()=>gate.promise});
 const pending=f.controller.open();
 await flush();
 assert.equal(f.calls.factory,1);
 f.controller.dispose();
 gate.resolve(f.panel());
 assert.equal(await pending,false);
 assert.equal(f.calls.opens.length,0);
 assert.equal(f.calls.disposes,1,'detached candidate must be disposed');
 assert.equal(f.controller.isLoaded,false);
 assert.equal(f.elements.get('reviewPanel').hidden,true);
});

test('P5 mobile/desktop, single import, selection updates and focus origin retain the shared panel',async()=>{
 const f=harness({debugEnabled:true});
 f.click('mobileReviewBtn');
 await flush();
 assert.deepEqual(f.calls.opens,[{id:'mobileReviewBtn',tab:'changes'}]);
 assert.equal(f.calls.mobile,1);
 f.controller.syncMapSelection({selection:{primaryKey:'A'}});
 assert.equal(f.calls.selections.length,1);
 assert.equal(f.controller.close(),true);
 f.click('reviewPanelBtn');
 await flush();
 assert.deepEqual(f.calls.opens.at(-1),{id:'reviewPanelBtn',tab:'changes'});
 assert.equal(f.calls.factory,1);
 assert.equal(f.calls.mobile,1);
 f.controller.dispose();
 f.controller.syncMapSelection({selection:{primaryKey:'B'}});
 assert.equal(f.calls.selections.length,1);
});

test('P5 failed review module import reports the error and permits an explicit retry',async()=>{
 let attempts=0;
 const f=harness({createPanel:({panel})=>{
  if(++attempts===1)throw Object.assign(new Error('network'),{code:'PL-TEST-NETWORK'});
  return panel();
 }});
 f.key();
 await flush();
 assert.equal(f.calls.errors.length,1);
 assert.equal(f.calls.errors[0].code,'PL-VIEWER-INSPECTOR-START');
 assert.equal(f.controller.isLoaded,false);
 f.key();
 await flush();
 assert.equal(f.calls.factory,2);
 assert.equal(f.calls.opens.length,1);
 f.controller.dispose();
});

test('P5 inspector and review panel both reject a mutable document owner',()=>{
 assert.throws(()=>harness({readOnly:false}),/read-only document/);
 assert.throws(()=>createViewerReviewPanel({
  document:{getElementById:()=>null},window:{},map:{},documentSession:{readOnly:false},isBuiltinMap:()=>true,
 }),/read-only map and document session/);
});
});
contractSuite("viewer-inspector", () => {
const assert = __contract_dep4.default;
const test = __contract_dep5.default;
const { collectViewerInspection } = __contract_dep6;
const { readFileSync } = __contract_dep7;

test('viewer diagnostics are bounded and preserve actual renderer pending states',()=>{
  const evidence=collectViewerInspection({
    rendererStats:{renderer:'canvas-worker',mapReadiness:{status:'terrain'},
      canonicalMeshReady:true,terrainReady:false,countryVisibleCount:253,
      projectGeneration:4,countriesPublishedGeneration:4,
      requestedRevision:9,displayedRevision:8,
      committedGeometryRevision:6,displayedGeometryRevision:5,
      projectRenderBlocked:false},
    documentSnapshot:{documentId:'pando-fixture',territorialEntities:[{},{}]},territorialCount:2,
    meta:{dataRevision:'a'.repeat(40)},month:'2026-10',readOnly:true,
    capturedAt:'2026-11-05T00:00:00Z'
  });
  assert.equal(evidence.schema,'pando-viewer-inspection-v1');
  assert.equal(evidence.map.presentation,'terrain');
  assert.equal(evidence.map.terrainReady,false);
  assert.equal(evidence.map.frameAcknowledged,false);
  assert.equal(evidence.map.countryCount,253);
  assert.equal(evidence.data.documentEntities,2);
  assert.doesNotMatch(readFileSync(new URL('../../apps/viewer/js/modules/viewer-inspector-state.js',import.meta.url),'utf8'),/\.territorialEntities/);
  assert.equal(evidence.data.readOnly,true);
  assert.match(evidence.data.topologyValidation,/미실행/);
  assert.equal(evidence.performance.available,false);
  assert.equal(evidence.performance.longTaskCount,null);
  assert.equal(evidence.errors.length,0);
});
test('inspection does not copy entire documents, sensitive stacks or unbounded errors',()=>{
  const events=Array.from({length:90},(_,i)=>({
    category:'renderer',errorCode:'PL-TEST-'+i,
    technicalMessage:'x'.repeat(900),stack:'SECRET_STACK',
    privateToken:'SECRET_TOKEN'
  }));
  const info=collectViewerInspection({
    documentSnapshot:{documentId:'doc-id',territorialEntities:[{secret:'NEVER_EXPORT'}],
      sourceToken:'SECRET_DOCUMENT'},
    rendererStats:{displayedRevision:3,requestedRevision:3,
      displayedGeometryRevision:6,committedGeometryRevision:6},
    diagnosticEvents:events,
    performanceReport:{browser:{navigation:{domInteractiveMs:421}},
      longTasks:{count:3,totalMs:111},memory:[{},{}]},
  });
  assert.equal(info.map.frameAcknowledged,true);
  assert.equal(info.errors.length,20);
  assert.equal(info.errors[0].errorCode,'PL-TEST-89');
  assert.equal(info.errors[0].message.length,300);
  assert.equal(info.performance.available,true);
  assert.equal(info.performance.domInteractiveMs,421);
  assert.equal(info.performance.memorySamples,2);
  assert.doesNotMatch(JSON.stringify(info),/SECRET_STACK|SECRET_TOKEN|NEVER_EXPORT|SECRET_DOCUMENT/);
});
});
