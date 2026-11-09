import {resourceCapabilities} from "../runtime/resource-capabilities.js";
import {createProjectSourceRuntime} from "../document/project-source-runtime.js";
import {createTerritorialSceneRuntime} from "../rendering/territorial-scene-runtime.js";
import {createWorkspaceSurfaces} from "../ui/workspace-surfaces.js";
import {createProjectSession} from "../document/project-session.js";
import {createRenderQuality} from "../rendering/render-quality.js";
import {createPointerTargets} from "../map/pointer-targets.js";
import {createCameraNavigation} from "../map/camera-navigation.js";
import {createCountryIndex} from "../map/country-index.js";
import {createSpatialIndex} from "../geometry/spatial-index.js";
import {createMapProjection} from "../map/map-projection.js";
import {createObjectPresentation} from "../ui/object-presentation.js";
import {createHydroSettings} from "../ui/physical-settings.js";
import {createObjectCatalog} from "../document/object-catalog.js";
import {createTerritorialLabels} from "../rendering/territorial-labels.js";
import {createPhysicalResources} from "../rendering/physical-map-controller.js";
import {createGpuScene} from "../rendering/gpu-scene.js";
import {createMapHost} from "../ui/map-workspace-host.js";
import {createObjectPicking} from "../map/object-picking.js";
import {mapProjectResourcePath} from "../data/map-project-manifest.js";

// Phases retain late-bound dependencies without changing product startup policy.
const READ_INITIALIZATION=Object.freeze({
  queries:[['objectPresentation','initializeTerritorialScope'],['objectPresentation','initializeObjectPresentationModel']],
  spatial:[['spatialIndex','initializeGeometryBoundsCache'],['spatialIndex','initializeMapObjectSpatialIndex'],['spatialIndex','initializeViewportCullingMetrics']],
  labels:[['territorialLabels','initializeCountryOutlineCache'],['territorialLabels','initializeLabelLayoutMetrics'],['territorialLabels','initializeTerritorialLabelScreenAreas']],
  anchors:[['countryIndex','initializeCountryLandRevision'],['countryIndex','initializeCountryLabelAnchorWorker'],['countryIndex','initializeLabelFallbackQueue']],
  projection:[['mapProjection','initializeMapLayoutMetricsSnapshot'],['mapProjection','initializeProjections']],
});
export function initializeMapReadOwners(owners,phase){
  const stages=READ_INITIALIZATION[phase];
  if(!stages)throw new TypeError('Unknown map initialization phase: '+phase);
  for(const [owner,method]of stages)owners[owner][method]();
}

/** One read-only map owner graph for the Web Viewer. */
export function createMapOwners({productMode,readOnly=productMode==='viewer',projection=productMode==='viewer'?'globe':'flat',platform=null,buildMeta,editing=null,isObjectVisible,resolveVisibilityGroup,closeActiveOverlay=null,onViewingChange=null}){
  if(productMode!=='viewer')throw new TypeError('Map composition requires viewer product mode.');
  if(readOnly!==true||editing)throw new TypeError('Read-only map composition cannot register editing hooks.');
  const capabilities=resourceCapabilities(productMode,platform,{projection});
  // One read-port admission, two existing responsibility owners. No combined
  // builtin session, second document model or duplicated mutable cache.
  let projectResourceDependencies=null;
  const projectResourcePorts=Object.freeze({connect(ports){
    if(projectResourceDependencies)throw new Error('Project resource ports already connected');
    projectResourceDependencies=ports;
  }});
  const getDependencies=()=>projectResourceDependencies;
  const projectSourceRuntime=createProjectSourceRuntime({
    builtinWorldLoader:platform?.world?.builtinLoader,buildMeta,getDependencies,
  });
  const territorialSceneRuntime=createTerritorialSceneRuntime({getDependencies});
  const workspaceSurfaces=createWorkspaceSurfaces();
  const projectSession=createProjectSession({productMode,readOnly,projection,capabilities,resolveVisibilityGroup,onViewingChange});
  const renderQuality=createRenderQuality();
  const pointerTargets=createPointerTargets();
  const cameraNavigation=createCameraNavigation();
  const countryIndex=createCountryIndex();
  const spatialIndex=createSpatialIndex();
  const mapProjection=createMapProjection({capabilities});
  const objectPresentation=createObjectPresentation();
  const hydroSettings=createHydroSettings();
  const objectCatalog=createObjectCatalog({isObjectVisible});
  const territorialLabels=createTerritorialLabels({capabilities,
    placeCatalog:buildMeta?.mapProject?mapProjectResourcePath(buildMeta.mapProject,'places'):null,
    placeLifetimesCatalog:buildMeta?.mapProject?mapProjectResourcePath(buildMeta.mapProject,'placeLifetimes'):null});
  const physicalResources=createPhysicalResources({capabilities,buildMeta});
  const gpuScene=createGpuScene({getPhysicalLand:()=>physicalResources.physicalLand});
  const mapHost=createMapHost({productMode,readOnly,projection});
  const objectPicking=createObjectPicking({closeActiveOverlay});
  return Object.freeze({capabilities,projectResourcePorts,projectSourceRuntime,territorialSceneRuntime,workspaceSurfaces,projectSession,renderQuality,pointerTargets,cameraNavigation,countryIndex,spatialIndex,mapProjection,objectPresentation,hydroSettings,objectCatalog,territorialLabels,physicalResources,gpuScene,mapHost,objectPicking});
}
