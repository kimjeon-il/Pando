import {createProjectSession} from "../../src/document/project-session.js";
import {createAtomicMapStateController} from "../../src/app/map-state-transition.js";
import {createTerritorialEntityStore} from "../../src/document/territorial-entity-store.js";
import {normalizeLayerPresentation} from "../../src/ui/layer-presentation.js";
import {DISTRIBUTION_RENDER_MODES} from "../../src/document/distribution-model.js";
import {createObjectQuery} from "../../src/document/object-query.js";
import {normalizeObjectRef} from "../../src/ui/object-selection-controller.js";

/** Real shared viewing owner over an accepted Core document; no model implementation in tests. */
export function createTestViewingSession(owner){
 const session=createProjectSession({productMode:'viewer',resolveVisibilityGroup:createObjectQuery({selectionServices:{normalizeObjectRef}}).layerGroupForObjectRef});
 session.connect({readiness:{DATA_READINESS:{PREVIEW:'preview'}},applicationConstantsA:{DISTRIBUTION_RENDER_MODES},
  uiFactoriesA:{createAtomicMapStateController},modelValidation:{normalizeLayerPresentation},physicalConfig:{PHYSICAL_DATASET:'fixture'},domains:{}});
 session.initializeMapWorkScheduler();
 const store=createTerritorialEntityStore({documentModel:owner.documentModel,commandOwner:owner.client});
 session.installDocumentProjection({documentModel:owner.documentModel,commandOwner:owner.client,entityStore:store});
 return {session,dispose:store.dispose};
}
