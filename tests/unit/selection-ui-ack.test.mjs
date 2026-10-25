import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionUiController } from "../../shared/frontend/js/modules/selection-ui-controller.js";
import { normalizeObjectRef } from "../../shared/frontend/js/modules/object-selection-controller.js";

const ref=normalizeObjectRef({ domain: 'generic',type: 'feature',id: 'G' });
function fixture() {
  let generation=1,current={ items: [],keys: [],primaryKey: null },resolve,reject;
  const events=[];
  const domain={ snapshot: () => ({ projectGeneration: generation,selection: current }),
    replace: () => new Promise((yes,no) => { resolve=yes;reject=no; }),toggle() {},selectRange() {},setMany() {},clear() {},
    has: value => current.keys.includes(value.key) };
  const ui=createSelectionUiController({ selectionDomain: domain,resolveRef: normalizeObjectRef,
    presenters: { default: () => events.push('present') },
    uiActions: { openEditor: () => events.push('open'),focusObject: () => events.push('focus'),closeChooser: () => events.push('close') } });
  return { ui,events,reject: error => reject(error),complete() { current={ items: [ref],keys: [ref.key],primaryKey: ref.key };resolve(); },
    switchProject() { generation+=1; } };
}
test('selection focus and editor opening wait for the accepted selection ACK', async () => {
  const f=fixture(),pending=f.ui.applyIntent(ref);
  assert.deepEqual(f.events,[]);f.complete();assert.equal(await pending,true);
  assert.deepEqual(f.events,['present','open','focus','close']);f.ui.dispose();
});
for (const reason of ['disposed','replaced']) test(`late selection ACK after ${reason} cannot focus or open an old object`,async () => {
  const f=fixture(),pending=f.ui.applyIntent(ref);
  if(reason==='disposed')f.ui.dispose();else f.switchProject();
  f.complete();assert.equal(await pending,false);assert.deepEqual(f.events,[]);f.ui.dispose();
});
test('selection operation failures reach the owning UI boundary with the original cause',async () => {
  const f=fixture(),pending=f.ui.applyIntent(ref),error=Object.assign(new Error('worker rejected selection'),{ code: 'STALE_REVISION' });
  f.reject(error);await assert.rejects(pending,value => value===error);assert.deepEqual(f.events,[]);f.ui.dispose();
});
