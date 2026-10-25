import { feature as topologyFeature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, quantile } from 'topojson-simplify';
import { validateGeometry } from "../shared/frontend/js/modules/geometry-validation.js";
import { buildTopologyPreview as buildSharedTopologyPreview, inspectTopologyPreviewFeatures } from "../shared/frontend/js/modules/project-preview-topology.js";

function inspectCandidate(candidate) {
  const core=globalThis.PandoLabSphericalCore;
  if(typeof core?.polygonOperation!=='function')throw Object.assign(new Error('Shared C++ polygon calculation is required for preview generation'),{code:'PREVIEW_VALIDATOR_UNAVAILABLE'});
  const clipper={intersection:(...inputs)=>core.polygonOperation('intersection',inputs,false)};
  return inspectTopologyPreviewFeatures(topologyFeature(candidate,candidate.objects.countries).features,{validateGeometry,clipper});
}
export function buildTopologyPreview(canonicalFeatures, options) {
  return buildSharedTopologyPreview(canonicalFeatures, {
    ...options, topology, presimplify, quantile, topologyFeature, validateGeometry, inspectCandidate,
  });
}
