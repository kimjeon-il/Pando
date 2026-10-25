import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectSession } from "../../shared/frontend/js/modules/project-session.js";
import { normalizeLayerPresentation } from "../../shared/frontend/js/modules/layer-presentation.js";
import { createNodeCoreDocument } from '../helpers/core-session.mjs';
import { createCoreDocumentReadModel } from "../../shared/frontend/js/modules/core-document-read-model.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";

test('the application startup seed is a complete empty current-format input accepted by the same C++ document owner',async () => {
  const session=createProjectSession();session.connect({ readiness: { DATA_READINESS: { PREVIEW: 'preview' } },
    applicationConstantsA: { DISTRIBUTION_RENDER_MODES: { OVERLAP: 'overlap' } },modelValidation: { normalizeLayerPresentation },
    physicalConfig: { PHYSICAL_DATASET: 'fixture' },domains: {},applicationFactories: { createGeometryPreviewState: () => ({}) },
    uiFactoriesA: { createAtomicMapStateController: () => ({}) },uiFactoriesB: { createSaveStateController: () => ({}) },
    platformConfigurationA: { APP_VERSION: '0.34.0',BASE_DATASET: 'fixture',HYDRO_DATASET: 'fixture-hydro' },
    platformConfigurationB: { TERRAIN_DATASET: 'fixture-terrain' } });
  session.initializeMapWorkScheduler();
  const input=session.initialDocument(),model=createCoreDocumentReadModel(input),client=createNodeCoreDocument({
    onTransition: (result,operation) => model.acceptTransition(result,operation),
  });
  const store=createTerritorialEntityStore({ documentModel: model,commandOwner: client });
  try {
    const accepted=await client.load(JSON.stringify(input));
    assert.deepEqual(JSON.parse(await client.storageSnapshot()),input);assert.deepEqual(accepted.world.entities,[]);
    assert.deepEqual(accepted.selection.items,[]);assert.equal(accepted.draft.active,false);
    assert.equal(accepted.state.dirty,false);assert.equal(accepted.state.canUndo,false);assert.equal(accepted.state.stateRevision,0);
    assert.equal(Object.hasOwn(input,'projection'),false);assert.equal(Object.hasOwn(input,'view'),false);
    assert.notEqual(input.labels,session.state.labels);assert.notEqual(input.layerVisibility,session.state.layerVisibility);
    session.installDocumentProjection({ documentModel: model,commandOwner: client,entityStore: store });
    assert.equal(session.state.labels,model.list('label'));assert.equal(session.state.territorialEntities,model.territorialViews());
    assert.equal(session.state.geometries.snapshot(),model.snapshot().geometries);
    assert.equal(Object.hasOwn(session.state.geometries,'insert'),false);
    assert.throws(() => { session.state.labels=[]; },TypeError);
    session.applyViewingPresentation({action:'visibility',key:'objects',visible:false});
    assert.equal(session.state.layerVisibility.objects,false);assert.deepEqual(JSON.parse(await client.storageSnapshot()),input);assert.equal(client.state().dirty,false);
    assert.throws(() => { session.state.stateRevision=9; },TypeError);
    assert.equal(session.state.stateRevision,client.state().stateRevision);
    assert.equal(session.state.timelineCursor,client.state().timelineCursor);
    assert.throws(() => session.installDocumentProjection({ documentModel: model,commandOwner: client,entityStore: store }),/already installed/);
  } finally { store.dispose();client.dispose(); }
});
