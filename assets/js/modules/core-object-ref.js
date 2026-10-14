import { normalizeObjectRef } from './object-selection-controller.js';
import { isBuiltinPlaceId } from './place-contract.js';

const invalid = () => { throw Object.assign(new Error('Object reference is not in the supported command identity domain.'), { code: 'PL-CORE-REF' }); };
const nativeDomain = Object.freeze({ territorial: 'territorial', generic: 'generic', distribution: 'distributionLayer', label: 'label', hydro: 'hydro' });

/** IDs remain literal; only the explicit domain/type boundary is converted. */
export function webObjectRefToCore(value) {
  const ref = normalizeObjectRef(value);
  if (!ref || (ref.domain === 'generic' && ref.type !== 'feature')
    || (ref.domain === 'distribution' && ref.type !== 'distribution')
    || (ref.domain === 'hydro' && !['river', 'lake'].includes(ref.type))) invalid();
  return Object.freeze({ domain: nativeDomain[ref.domain], id: ref.id });
}

/** Selection retains its captured type, independently of document ref identity. */
export function webSelectionRefToCore(value, { isStoredHydro } = {}) {
  const ref = normalizeObjectRef(value);
  if (!ref) invalid();
  let domain = nativeDomain[ref.domain];
  if (ref.domain === 'label' && isBuiltinPlaceId(ref.id)) domain = 'placeBuiltin';
  if (ref.domain === 'hydro') {
    if (typeof isStoredHydro !== 'function') throw new TypeError('The canonical edited-hydro identity lookup is required.');
    domain = isStoredHydro(ref.id) ? 'hydro' : 'hydroBuiltin';
  }
  return Object.freeze({ domain, type: ref.type, id: ref.id });
}

export function coreSelectionRefToWeb(value) {
  const domain = { territorial: 'territorial', generic: 'generic', distributionLayer: 'distribution',
    label: 'label', placeBuiltin: 'label', hydro: 'hydro', hydroBuiltin: 'hydro' }[value?.domain];
  const ref = domain && normalizeObjectRef({ domain, type: value.type, id: value.id });
  if (!ref) invalid();
  return ref;
}
