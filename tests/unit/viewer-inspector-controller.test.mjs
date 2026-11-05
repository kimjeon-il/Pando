import assert from 'node:assert/strict';
import test from 'node:test';
import {createViewerInspectorController} from '../../apps/viewer/js/modules/viewer-inspector-controller.js';
import {createViewerReviewPanel} from '../../apps/viewer/js/modules/viewer-review-panel.js';

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
