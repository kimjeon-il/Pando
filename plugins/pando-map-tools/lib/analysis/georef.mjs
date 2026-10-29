import { calculateReferenceImage, calculateReferenceMesh, createReferenceWarp, createCalculatedReferenceWarp, referenceWarpDescriptor, freezeReferenceResult } from './core.mjs';

export const REFERENCE_IMAGE_GEOREF_SCHEMA_VERSION = 3;

export const REFERENCE_IMAGE_WARP_MODES = Object.freeze({
  AUTO: 'auto',
  SIMILARITY: 'similarity',
  AFFINE: 'affine',
  PROJECTIVE: 'projective',
  TPS: 'tps',
});

export function georeferenceQuality(points,mode,source,projection={kind:'geographic'}) {
  const rect=source.mapping?.rect || {x:0,y:0,width:source.width,height:source.height};
  return calculateReferenceImage('georefQuality',{
    points,mode,projection,sourceWidth:source.width,sourceHeight:source.height,
    validationDomain:[rect.x/(source.width-1),rect.y/(source.height-1),
      (rect.x+rect.width-1)/(source.width-1),(rect.y+rect.height-1)/(source.height-1)],
  });
}

export function selectReferenceImageGeoreference(points,source,{mode='auto',projection={kind:'geographic'}}={}) {
  const modes=['similarity','affine','projective','tps'];
  if(mode!=='auto'&&!modes.includes(mode))throw new Error('Unsupported georeference mode.');
  const candidates=(mode==='auto'?modes:[mode]).map(candidateMode=>{
    const warp=calculateReferenceImage('warp',{points,mode:candidateMode,projection});
    const quality=warp.ok?georeferenceQuality(warp.controlPoints,candidateMode,source,projection):null;
    const eligible=warp.ok&&!quality.folded&&!quality.invalidDomain&&(mode!=='auto'||candidateMode!=='tps'||quality.recommended);
    return {mode:candidateMode,warp,quality,eligible};
  });
  let selected;
  for(const candidate of candidates.filter(row=>row.eligible&&row.quality.recommended)) {
    const score=candidate.quality.crossValidationP95Pixels,best=selected?.quality.crossValidationP95Pixels;
    if(!selected||(score<best*.8&&best-score>=1))selected=candidate;
  }
  // A provisional manual fit is still useful with too few distributed controls,
  // but interpolation alone cannot admit a nonlinear automatic transform.
  if(!selected)for(const candidate of candidates.filter(row=>row.eligible)) {
    const score=candidate.quality.crossValidationP95Pixels,best=selected?.quality.crossValidationP95Pixels;
    if(!selected||(Number.isFinite(score)&&(!Number.isFinite(best)||(score<best*.8&&best-score>=1)))
      ||(!Number.isFinite(score)&&!Number.isFinite(best)&&candidate.warp.diagnostics.rmsMeters<selected.warp.diagnostics.rmsMeters*.8))selected=candidate;
  }
  selected??=candidates[0];
  const modelComparison=candidates.map(row=>({mode:row.mode,ok:row.warp.ok,eligible:row.eligible,
    rmsMeters:row.warp.diagnostics?.rmsMeters??null,crossValidationP95Pixels:row.quality?.crossValidationP95Pixels??null,
    recommended:row.quality?.recommended??false,folded:row.quality?.folded??false,reason:row.warp.reason||row.quality?.reason||''}));
  return {warp:selected.warp,quality:selected.quality?{...selected.quality,modelComparison}:null};
}

export function selectReferenceImageProjection(points,source,{candidates}={}) {
  if(!Array.isArray(candidates)||!candidates.length||candidates.length>64)throw new Error('One to64 typed projection candidates required.');
  const ids=new Set(),images=new Set(),coordinates=new Set();
  for(const point of points){
    if(!point.id||ids.has(point.id)||!Array.isArray(point.image)||point.image.length!==2||point.image.some(v=>!Number.isFinite(v)||v<0||v>1)
      ||!Array.isArray(point.coordinate)||point.coordinate.length!==2||point.coordinate.some((v,i)=>!Number.isFinite(v)||Math.abs(v)>(i?90:180)))throw new Error('Distinct valid original-image controls required.');
    ids.add(point.id);images.add(JSON.stringify(point.image));coordinates.add(JSON.stringify(point.coordinate));
  }
  if(Math.min(ids.size,images.size,coordinates.size)<18)return {ok:false,reason:'projection-selection-requires18-distinct-controls'};
  // Interleaved spatial order supplies separate evidence to fit, choose and confirm.
  const sorted=[...points].sort((a,b)=>a.image[1]-b.image[1]||a.image[0]-b.image[0]||a.id.localeCompare(b.id));
  const groups=[[],[],[]];sorted.forEach((point,index)=>groups[index%3].push(point));
  const [fitPoints,selectionPoints,confirmationPoints]=groups;
  const pixelErrors=(warp,checks)=>calculateReferenceImage('warpPixelErrors',{warp,points:checks,sourceWidth:source.width,sourceHeight:source.height});
  const attempts=candidates.map(input=>{
    const projection=calculateReferenceImage('normalizeProjection',input);
    const result=selectReferenceImageGeoreference(fitPoints,source,{projection});
    const selection=result.warp.ok?pixelErrors(result.warp,selectionPoints):{ok:false,p95Pixels:null};
    return {projection,...result,selection};
  }).filter(row=>row.selection.ok&&!row.quality.folded&&!row.quality.invalidDomain).sort((a,b)=>a.selection.p95Pixels-b.selection.p95Pixels);
  const best=attempts[0],second=attempts[1];
  if(!best)return {ok:false,reason:'no-stable-projection-candidate'};
  if(second&&!(best.selection.p95Pixels<second.selection.p95Pixels*.8&&second.selection.p95Pixels-best.selection.p95Pixels>=1))return {ok:false,reason:'ambiguous-projection-candidates'};
  // Refit only selection+training controls. Confirmation points NEVER enter this warp.
  const result=selectReferenceImageGeoreference([...fitPoints,...selectionPoints],source,{mode:best.warp.mode,projection:best.projection});
  const confirmation=pixelErrors(result.warp,confirmationPoints);
  const validation={method:'reserved-original-pixel-controls',pointIds:{fit:fitPoints.map(p=>p.id),selection:selectionPoints.map(p=>p.id),confirmation:confirmationPoints.map(p=>p.id)},
    selectionP95Pixels:best.selection.p95Pixels,confirmationP95Pixels:confirmation.p95Pixels,confirmationPoints:structuredClone(confirmationPoints)};
  if(!result.quality.recommended||!confirmation.ok||confirmation.p95Pixels>8)return {ok:false,reason:'projection-confirmation-failed',validation};
  return {ok:true,...result,projection:best.projection,validation,quality:{...result.quality,projectionValidation:validation}};
}

export function normalizeReferenceControlPoints(values = []) {
  return freezeReferenceResult(calculateReferenceImage('normalize', values));
}

export function buildReferenceImageWarp(values = [], { mode = REFERENCE_IMAGE_WARP_MODES.AUTO, projection={kind:'geographic'} } = {}) {
  return createCalculatedReferenceWarp('warp', { points: values, mode, projection });
}

export function buildReferenceImageAutoGeoref(values = [], options = {}) {
  const result = calculateReferenceImage('autoGeoref', { ...options, points: values });
  if (!result.ok) return Object.freeze(result);
  const warp = createReferenceWarp(result.warp);
  return Object.freeze({ ...result, warp, project: warp.project });
}

export function buildReferenceImageLinearConstraintPoints(linearConstraints = [], {
  baseWarp = null, samplesPerConstraint = 4, maximumSamples = 24,
} = {}) {
  return freezeReferenceResult(calculateReferenceImage('linearPoints', {
    constraints: linearConstraints, baseWarp: referenceWarpDescriptor(baseWarp),
    samplesPerConstraint, maximumSamples,
  }));
}

export function buildReferenceImageLinearRefinement({
  controlPoints = [],
  anchor = null,
  linearConstraints = [],
  baseMode = REFERENCE_IMAGE_WARP_MODES.AUTO,
  samplesPerConstraint = 4,
  maximumSamples = 24,
} = {}) {
  const basePoints = Array.isArray(controlPoints) ? controlPoints : [];
  const baseWarp = buildReferenceImageWarp([
    ...(anchor ? [{
      id: 'anchor',
      image: anchor.image,
      coordinate: anchor.coordinate,
      pinned: true,
    }] : []),
    ...basePoints.map(point => ({ ...point, pinned: false })),
  ], { mode: baseMode });
  if (!baseWarp.ok) {
    return Object.freeze({
      ok: false,
      reason: 'linear-refinement-base-warp-unavailable',
      baseWarp,
      linePointCount: 0,
    });
  }
  const linePoints = buildReferenceImageLinearConstraintPoints(linearConstraints, {
    baseWarp,
    samplesPerConstraint,
    maximumSamples,
  });
  if (!linePoints.length) {
    return Object.freeze({
      ok: false,
      reason: 'no-linear-constraints',
      baseWarp,
      linePointCount: 0,
    });
  }
  const points = [
    ...(anchor ? [{
      id: 'anchor',
      image: anchor.image,
      coordinate: anchor.coordinate,
      pinned: true,
    }] : []),
    ...basePoints.map(point => ({ ...point, pinned: false })),
    ...linePoints,
  ];
  const refinedWarp = buildReferenceImageWarp(points, { mode: REFERENCE_IMAGE_WARP_MODES.TPS });
  if (!refinedWarp.ok) {
    return Object.freeze({
      ok: false,
      reason: refinedWarp.reason || 'linear-refinement-failed',
      baseWarp,
      linePointCount: linePoints.length,
    });
  }
  return Object.freeze({
    ok: true,
    mode: REFERENCE_IMAGE_WARP_MODES.TPS,
    baseWarp,
    warp: refinedWarp,
    project: refinedWarp.project,
    controlPoints: refinedWarp.controlPoints,
    linePoints,
    linePointCount: linePoints.length,
    diagnostics: Object.freeze({
      ...refinedWarp.diagnostics,
      linearConstraintCount: new Set(linePoints.map(point => point.linearConstraintId)).size,
      linearConstraintPointCount: linePoints.length,
      baseRmsMeters: baseWarp.diagnostics?.rmsMeters ?? null,
    }),
  });
}

export function referenceImageWarpQuad(warp) {
  if (!warp?.ok || typeof warp.project !== 'function') return null;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]]
    .map(image => warp.project(image));
  return corners.every(coordinate => coordinate?.every(Number.isFinite))
    ? corners.map(coordinate => [...coordinate])
    : null;
}

export function buildReferenceImageCalibrationWarp(record = {}) {
  return createCalculatedReferenceWarp('calibrationWarp', record);
}

export function buildReferenceImageProjectiveWarpFromQuad(mapQuad) {
  return createCalculatedReferenceWarp('projective', mapQuad);
}

export function buildReferenceImageMesh(warp, { columns = 24, rows = 16 } = {}) {
  if (!warp?.ok || typeof warp.project !== 'function') return null;
  return calculateReferenceMesh(warp, columns, rows);
}
