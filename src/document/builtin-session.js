import {createProjectSourceRuntime} from "./project-source-runtime.js";
import {createTerritorialSceneRuntime} from "../rendering/territorial-scene-runtime.js";

// Compatibility composition until Viewer consumers migrate to the shared
// ProjectSourceRuntime and TerritorialSceneRuntime ports. Do not remove this
// bridge while map rendering, labels, initial preview or GPU geometry use it.
export function createBuiltinSession({builtinWorldLoader=null,buildMeta}={}){
  let dependencies=null;
  const getDependencies=()=>dependencies;
  const sourceRuntime=createProjectSourceRuntime({builtinWorldLoader,buildMeta,getDependencies});
  const sceneRuntime=createTerritorialSceneRuntime({getDependencies});
  function connect(ports){
    if(dependencies)throw new Error('builtin-session already connected');
    dependencies=ports;
  }
  return Object.freeze({
    connect,
    initializePristineCountriesFallback:sceneRuntime.initializePristineCountriesFallback,
    get PRISTINE_LABEL_ANCHORS(){return sceneRuntime.PRISTINE_LABEL_ANCHORS;},
    get builtinCountryIds(){return sceneRuntime.builtinCountryIds;},
    get builtinTerritorialScene(){return sceneRuntime.builtinTerritorialScene;},
    get canonicalCountryStore(){return sceneRuntime.canonicalCountryStore;},
    get territorialLabelFeatureById(){return sceneRuntime.territorialLabelFeatureById;},
    get freshPristineCountries(){return sceneRuntime.freshPristineCountries;},
    get installCanonicalCountryStore(){return sceneRuntime.installCanonicalCountryStore;},
    get isNativeBuiltinSubunit(){return sceneRuntime.isNativeBuiltinSubunit;},
    get isRenderCountryVisible(){return sceneRuntime.isRenderCountryVisible;},
    get renderCountryBoundaryStyle(){return sceneRuntime.renderCountryBoundaryStyle;},
    get materializePristineCountries(){return sceneRuntime.materializePristineCountries;},
    get materializePristineCountriesSync(){return sceneRuntime.materializePristineCountriesSync;},
    dispose:sourceRuntime.dispose,
    prepareProjectSource:sourceRuntime.prepareProjectSource,
    loadGeometryResources:sourceRuntime.loadGeometryResources,
    prepareProjectCandidate:sourceRuntime.prepareProjectCandidate,
    admitPreparedProjectSource:sourceRuntime.admitPreparedProjectSource,
    prepareProjectBaseline:sourceRuntime.prepareProjectBaseline,
    get projectBaseline(){return sourceRuntime.projectBaseline;},
    get pristineCountriesFallback(){return sceneRuntime.pristineCountriesFallback;},
    get baseSceneFeatureById(){return sceneRuntime.baseSceneFeatureById;},
    get syncBuiltinPalette(){return sceneRuntime.syncBuiltinPalette;},
  });
}
