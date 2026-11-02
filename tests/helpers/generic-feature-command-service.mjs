// Historic editor/GeoPackage Core command adapter retained only for regression tests.
// No production GIS CLI or public Viewer imports this module.
const text = value => String(value ?? '').trim();

export function createGenericFeatureService({ documentModel, commandOwner } = {}) {
  if (typeof documentModel?.list !== 'function') throw new TypeError('The accepted Core document read model is required.');
  if (typeof commandOwner?.executeCommand !== 'function') throw new TypeError('The Core document command owner is required.');
  const genericFeatures = () => documentModel.list('generic');
  const get = id => genericFeatures().find(feature => text(feature.id) === text(id)) || null;
  const ref = id => ({ domain: 'generic', id: String(id ?? '') });
  const failure = result => Object.assign(new Error(result.error.message), result.error);
  async function execute(commandId, targets, payload) {
    const result = await commandOwner.executeCommand({ commandId, targets, payload: structuredClone(payload) });
    if (typeof result?.ok !== 'boolean' || typeof result.changed !== 'boolean'
      || (!result.ok && (typeof result.error?.code !== 'string' || typeof result.error?.message !== 'string'))) {
      throw Object.assign(new Error('A complete Core command acknowledgement is required.'), { code: 'PL-CORE-RESPONSE' });
    }
    return result;
  }
  function accepted(result, side, id) {
    const rows = result[side]?.genericFeatures;
    if (!Array.isArray(rows)) throw Object.assign(new Error('The accepted Core operation projection is required.'), { code: 'PL-CORE-RESPONSE' });
    const feature = rows.find(feature => text(feature.id) === text(id));
    if (!feature) throw Object.assign(new Error(`The accepted generic feature is missing from the read model: ${id}`), { code: 'PL-CORE-RESPONSE' });
    return feature;
  }
  async function add(feature) {
    const target = ref(feature?.id);
    const result = await execute('generic.create', [target], { feature });
    if (!result.ok) throw failure(result);
    return accepted(result, 'after', target.id);
  }
  async function addMany(features) {
    const ids = Array.isArray(features) ? features.map(feature => feature?.id) : [];
    const result = await execute('generic.import', ids.map(ref), { features });
    if (!result.ok) throw failure(result);
    return ids.map(id => accepted(result, 'after', id));
  }
  async function updateMetadata(id, field, value) {
    const current = get(id);
    const target = current?.id ?? text(id);
    const result = await execute('generic.metadata', [ref(target)], { id: target, field, value });
    if (!result.ok) {
      if (result.error.code === 'not-found') return { ok: false, code: 'not-found' };
      if (result.error.code === 'unsupported-field') throw new Error(result.error.message, { cause: failure(result) });
      throw failure(result);
    }
    return { ok: true, changed: result.changed, feature: accepted(result, 'after', target) };
  }
  async function remove(id) {
    const feature = get(id);
    const target = feature?.id ?? text(id);
    const result = await execute('generic.remove', [ref(target)], { id: target });
    if (!result.ok) {
      if (result.error.code === 'not-found') return { ok: false, code: 'not-found' };
      throw failure(result);
    }
    return { ok: true, feature: accepted(result, 'before', target) };
  }

  return Object.freeze({ get, list: () => genericFeatures(), add, addMany, updateMetadata, remove });
}
