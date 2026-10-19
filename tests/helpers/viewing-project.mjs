import {createProjectSession} from '../../assets/js/modules/project-session.js';
import {createAtomicMapStateController} from '../../assets/js/modules/map-state-transition.js';
import {createTerritorialEntityStore} from '../../assets/js/modules/territorial-entity-store.js';
import {normalizeLayerPresentation} from '../../assets/js/modules/layer-presentation.js';
import {DISTRIBUTION_RENDER_MODES} from '../../assets/js/modules/distribution-model.js';
import {createObjectQuery} from '../../assets/js/modules/object-query.js';
import {normalizeObjectRef} from '../../assets/js/modules/object-selection-controller.js';

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
