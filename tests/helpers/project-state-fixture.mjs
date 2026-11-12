import {createInitialDocument} from '../../src/document/initial-document.js';

// One fresh, current-schema project per invocation; no copied schema constants.
// Overrides belong to the test, not to a parallel project model.
export function createProjectStateFixture({
  initialMonth = null, sourceMode = 'empty',
  documentId = null, state = {}, appVersion = 'test-fixture', baseDataset = undefined,
} = {}) {
  const projectSetup = initialMonth == null ? {} : {
    projectSetup: {initialMonth, timelineRange: null, initialMapBounds: null, sourceMode},
  };
  return createInitialDocument({
    appVersion, ...(baseDataset ? {baseDataset} : {}),
    state: {...projectSetup, ...(documentId ? {documentId} : {}), ...state},
  });
}
