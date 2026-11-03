import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectDomain } from "../../shared/frontend/js/modules/project-domain.js";

import { createSaveStateController } from "../helpers/core-command-services/save-state-controller.mjs";
import {createNodeCoreProject} from '../helpers/core-project.mjs';
import {createCoreStartupState,startupBaseline,startupDocument} from '../helpers/core-startup.mjs';

test('project autosave rejects a receipt completed after project replacement', async () => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let exportStarted;
  const started = new Promise(resolve=>{exportStarted=resolve;});
  const domain = createProjectDomain({ productMode:'editor', appVersion: 'fixture',commandOwner: {
    exportSnapshot: async () => { exportStarted();await held;return { storageJson: '{"format":"pandolab-autosave-full"}',state: { epoch: 1,checkpoint: 0,presentationCheckpoint: 0 } }; },
    validateImport: async bytes => JSON.parse(bytes),captureReplacement: async () => 7,load: async () => {},releaseReplacement: async () => true,
  },documentModel: { snapshot: () => ({}) },readBuiltinSelectionCatalogs: () => [],replaceSnapshot: () => true });
  const pending = domain.buildAutosave();
  await started;
  await domain.load({}); release();
  await assert.rejects(pending, { code: 'PL-PERSISTENCE-STALE' });
});
