import {createProjectSession} from "../../shared/frontend/js/modules/project-session.js";
import {createAtomicMapStateController} from "../../shared/frontend/js/modules/map-state-transition.js";
import {createTerritorialEntityStore} from "../../shared/frontend/js/modules/territorial-entity-store.js";
import {normalizeLayerPresentation} from "../../shared/frontend/js/modules/layer-presentation.js";
import {DISTRIBUTION_RENDER_MODES} from "../../shared/frontend/js/modules/distribution-model.js";
import {createObjectQuery} from "../../shared/frontend/js/modules/object-query.js";
import {normalizeObjectRef} from "../../shared/frontend/js/modules/object-selection-controller.js";

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
