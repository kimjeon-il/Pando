import {createBuiltinSession} from './builtin-session.js';
import {createWorkspaceSurfaces} from './workspace-surfaces.js';
import {createProjectSession} from './project-session.js';
import {createRenderQuality} from './render-quality.js';
import {createPointerTargets} from './pointer-targets.js';
import {createCameraNavigation} from './camera-navigation.js';
import {createCountryIndex} from './country-index.js';
import {createSpatialIndex} from './spatial-index.js';
import {createMapProjection} from './map-projection.js';
import {createObjectPresentation} from './object-presentation.js';
import {createHydroSettings} from './physical-settings.js';
import {createObjectCatalog} from './object-catalog.js';
import {createTerritorialLabels} from './territorial-labels.js';
import {createPhysicalResources} from './physical-resources.js';
import {createGpuScene} from './gpu-scene.js';
import {createMapHost} from './map-workspace-host.js';
import {createObjectPicking} from './object-picking.js';

/** One owner graph; only the editor may register mutation and persistence hooks. */
export function createMapOwners({productMode,platform={},editing=null,isObjectAvailable,closeActiveOverlay=null}){
  if(!['viewer','editor'].includes(productMode))throw new TypeError('Map composition requires immutable product mode.');
  if(productMode==='viewer'&&editing)throw new TypeError('Read-only map composition cannot register editing hooks.');
  const builtinSession=createBuiltinSession({historicalWorldLoader:platform.historicalWorldLoader});
  const workspaceSurfaces=createWorkspaceSurfaces({productMode});
  const projectSession=createProjectSession({productMode});
  const renderQuality=createRenderQuality({beforeMeshRebuild:editing?.beforeMeshRebuild});
  const pointerTargets=createPointerTargets({isDraggingDraft:editing?.isDraggingDraft});
  const cameraNavigation=createCameraNavigation({persistView:editing?.persistView});
  const countryIndex=createCountryIndex();
  const spatialIndex=createSpatialIndex();
  const mapProjection=createMapProjection();
  const objectPresentation=createObjectPresentation();
  const hydroSettings=createHydroSettings();
  const objectCatalog=createObjectCatalog({isObjectAvailable});
  const territorialLabels=createTerritorialLabels({builtinPlacesEnabled:platform.builtinPlacesEnabled});
  const physicalResources=createPhysicalResources({enabled:platform.physicalResourcesEnabled});
  const gpuScene=createGpuScene({getEditPreview:editing?.getEditPreview});
  const mapHost=createMapHost();
  const objectPicking=createObjectPicking({openEditor:productMode==='editor',handleEditingClick:editing?.handleMapClick,onBackgroundClear:editing?.onBackgroundClear,performanceRecorder:editing?.performanceRecorder,closeActiveOverlay});
  return Object.freeze({builtinSession,workspaceSurfaces,projectSession,renderQuality,pointerTargets,cameraNavigation,countryIndex,spatialIndex,mapProjection,objectPresentation,hydroSettings,objectCatalog,territorialLabels,physicalResources,gpuScene,mapHost,objectPicking});
}
