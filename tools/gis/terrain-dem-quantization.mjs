// Shared DEM quantization for representative and production candidates.
export function roundHalfEven(value) {
  if (!Number.isFinite(value)) throw new RangeError('Finite value required');
  const lower=Math.floor(value),fraction=value-lower;
  return fraction>0.5 || (fraction===0.5 && lower%2!==0) ? lower+1 : lower;
}

export function quantizationStep(value, policy='Q1') {
  if (!Number.isFinite(value)) throw new RangeError('Finite elevation required');
  if (!['Q1','Q2','Q3'].includes(policy)) throw new RangeError('Unknown quantization policy');
  const magnitude=Math.abs(value);
  if (value<0) return magnitude<256?16:magnitude<1024?64:128;
  if (policy==='Q1') return magnitude<512?4:magnitude<2560?8:16;
  if (policy==='Q2') return magnitude<512?8:16;
  return magnitude<512?4:8;
}

export function quantizeHeight(value, policy='Q1') {
  const step=quantizationStep(value,policy), result=roundHalfEven(Math.abs(value)/step)*step;
  return value<0 && result!==0 ? -result : result;
}
