import {distributionValueRange,distributionValueAlpha} from '../../assets/js/modules/distribution-model.js';

// Calculation observations only. Editing, history and visible rendering remain
// separate obligations; this adapter never manufactures those states.
export function distributionTrace(input) {
  const ranges=Object.fromEntries(input.layers.map(layer=>[layer.id,
    distributionValueRange(layer,input.entries.filter(entry=>entry.layerId===layer.id))]));
  const alpha=Object.fromEntries(input.entries.map(entry=>[entry.id,
    distributionValueAlpha(entry.value,ranges[entry.layerId],input.opacity??1)]));
  return {ranges,alpha};
}
