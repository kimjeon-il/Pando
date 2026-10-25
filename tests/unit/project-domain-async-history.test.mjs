import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";

test('project history publishes lifecycle effects after the canonical Worker history acknowledgement', async () => {
  let resolve;
  const acknowledgement = new Promise(accept => { resolve = accept; });
  const effects = [];
  const project = createProjectDomain({ productMode:'editor', commandOwner: { undo: () => acknowledgement },publishCommand() {},
    onProjectChanged: event => effects.push(event.reason),
    invalidateHistory: reason => effects.push(reason),
    persistence: { queueProject: () => effects.push('autosave') } });
  const pending = project.undo();
  assert.deepEqual(effects, []);
  resolve({ ok: true,changed: true }); assert.equal(await pending, true);
  assert.deepEqual(effects, ['project-undo','project-undo','autosave']);
});

test('rejected and no-op canonical Worker history responses have no success effects', async () => {
  const effects = [], error = Object.assign(new Error('History worker failed'), { code: 'PL-CORE-LOAD' });
  const project = createProjectDomain({ productMode:'editor', commandOwner: { undo: async () => ({ ok: true,changed: false }), redo: async () => { throw error; } },publishCommand() {},
    onProjectChanged: () => effects.push('event'), invalidateHistory: () => effects.push('render'),
    persistence: { queueProject: () => effects.push('autosave') } });
  assert.equal(await project.undo(), false);
  await assert.rejects(project.redo(), failure => failure === error);
  assert.deepEqual(effects, []);
});
