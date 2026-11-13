import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createNodeCoreProject } from "../../helpers/core-project.mjs";

const expectations=JSON.parse(readFileSync(new URL('../../fixtures/label-gesture-contract.json',import.meta.url),'utf8'));
const labelId = '22000000-0000-4000-8000-000000000029';
function input() {
  const seed = JSON.parse(readFileSync(new URL("../../fixtures/portability/web-document-seed.json", import.meta.url), 'utf8'));
  seed.labels = [{ id: labelId, name: 'Movable', kind: 'custom', coordinates: [1.125, 2.25],
    notes: 'Kept notes', metadata: { compatibilitySource: { detail: [null, 'opaque'] } } }];
  seed.labelSettings = { [`label:${labelId}`]: { fontSize: 15, minZoom: 2, maxZoom: 19, visible: true, pinned: false, manualPosition: null } };
  return seed;
}
const observe = (label, settings, state, history) => ({
  label: structuredClone(label), settings: structuredClone(settings), stateRevision: state.stateRevision,
  documentDirty: state.documentDirty, presentationDirty: state.presentationDirty,
  canUndo: history.canUndo(), canRedo: history.canRedo(),
});
for (const [name, coordinates] of [['unmoved', null], ['moved', [15.125, 10.25]]]) {
  test(`actual label ${name} gesture retains one Core content history entry, settings and independent dirty clocks`, async t => {
    const seed = input(), expected = expectations.find(row=>JSON.stringify(row.coordinates)===JSON.stringify(coordinates)), owner = await createNodeCoreProject(seed);
    t.after(() => owner.dispose());
    const apply=async(action,coordinate)=>{
      const payload={action,id:labelId,...(coordinate?{coordinate}:{})};
      const reply=await owner.project.labelGestureApply(payload);
      assert.equal(reply.ok,true,action);
      return reply;
    };
    const capture = () => observe(owner.documentModel.list('label')[0], owner.documentModel.snapshot().labelSettings, owner.client.state(), owner.project);
    const rows=[capture()];
    await apply('begin');rows.push(capture());
    if(coordinates){await apply('move',coordinates);rows.push(capture());}
    await apply('finish');rows.push(capture());
    assert.equal(await owner.project.undo(), true); rows.push(capture()); assert.equal(owner.project.canUndo(), false);
    assert.equal(await owner.project.redo(), true); rows.push(capture());
    assert.deepEqual(rows,expected.rows);
    assert.deepEqual(owner.documentModel.snapshot().genericFeatures, seed.genericFeatures);
    assert.deepEqual(owner.documentModel.snapshot().hydroEdits, seed.hydroEdits);
    assert.deepEqual(owner.documentModel.snapshot().distributionEntries, seed.distributionEntries);
  });
}
