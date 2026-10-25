import { distributionEntriesForLayer } from "../../../../../shared/frontend/js/modules/distribution-model.js";

const text = value => String(value ?? '').trim();
const fields = Object.freeze({ distributionLayer: 'distributionLayers', distributionEntry: 'distributionEntries' });
const responseError = message => Object.assign(new Error(message), { code: 'PL-CORE-RESPONSE' });
const operationError = result => Object.assign(new Error(result.error.message), result.error);

/** UI result adaptation only. C++ owns validation, mutation, history and dirty. */
export function createDistributionService({ documentModel, commandOwner } = {}) {
  if (typeof documentModel?.list !== 'function') {
    throw new TypeError('The accepted Core document read model is required.');
  }
  if (typeof commandOwner?.executeCommand !== 'function') throw new TypeError('The Core document command owner is required.');
  const layers = () => documentModel.list('distributionLayer');
  const entries = () => documentModel.list('distributionEntry');
  const layerById = id => layers().find(layer => layer.id === text(id)) || null;
  const ref = (domain, id) => ({ domain, id: text(id) });
  async function execute(commandId, targets, payload) {
    const result = await commandOwner.executeCommand({ commandId, targets, payload: structuredClone(payload) });
    if (typeof result?.ok !== 'boolean' || typeof result.changed !== 'boolean'
      || (!result.ok && (typeof result.error?.code !== 'string' || typeof result.error?.message !== 'string'))) {
      throw responseError('A complete Core command acknowledgement is required.');
    }
    return result;
  }
  function rows(result, side, domain) {
    const values = result[side]?.[fields[domain]];
    if (!Array.isArray(values)) throw responseError('The accepted Core operation projection is required.');
    return values;
  }
  function accepted(result, side, domain, id) {
    const value = rows(result, side, domain).find(row => row.id === text(id));
    if (!value) throw responseError('An accepted ' + domain + ' is missing: ' + id);
    return value;
  }
  // Read-model menu candidates; command admission and cycle validation stay in C++.
  function parentCandidates(id) {
    const layer = layerById(id);
    if (!layer) return [];
    const descendants = new Set(), queue = [layer.id];
    while (queue.length) {
      const parentId = queue.shift();
      for (const candidate of layers()) {
        if (candidate.parentId !== parentId || descendants.has(candidate.id)) continue;
        descendants.add(candidate.id); queue.push(candidate.id);
      }
    }
    return layers().filter(candidate => candidate.id !== layer.id && !descendants.has(candidate.id));
  }
  async function createLayer(options) {
    const target = ref('distributionLayer', options?.id);
    const result = await execute('distribution.layer.create', [target], { options });
    if (!result.ok) throw operationError(result);
    return accepted(result, 'after', 'distributionLayer', target.id);
  }
  async function updateLayer(id, field, value) {
    const result = await execute('distribution.layer.metadata', [ref('distributionLayer', id)], { id: text(id), field, value });
    if (!result.ok) {
      const code = result.error.code;
      if (code === 'not-found') return { ok: false, code };
      if (code === 'locked') return { ok: false, code, layer: accepted(result, 'before', 'distributionLayer', id) };
      if (code === 'invalid') return { ok: false, code, error: operationError(result), layer: accepted(result, 'before', 'distributionLayer', id) };
      throw operationError(result);
    }
    return { ok: true, changed: result.changed, layer: accepted(result, 'after', 'distributionLayer', id) };
  }
  async function addEntry(options) {
    const target = ref('distributionEntry', options?.id), layerId = text(options?.layerId);
    const result = await execute('distribution.entry.create', [target], { options });
    if (!result.ok) {
      const code = result.error.code;
      if (code === 'layer-not-found') return { ok: false, code };
      if (['locked', 'territorial-unit-not-found', 'invalid'].includes(code)) {
        const outcome = { ok: false, code, layer: accepted(result, 'before', 'distributionLayer', layerId) };
        if (code === 'invalid') outcome.error = operationError(result);
        return outcome;
      }
      throw operationError(result);
    }
    const entry = accepted(result, 'after', 'distributionEntry', target.id);
    return { ok: true, entry, layer: accepted(result, 'after', 'distributionLayer', entry.layerId) };
  }
  async function updateEntry(id, value) {
    const result = await execute('distribution.entry.value', [ref('distributionEntry', id)], { id: text(id), value });
    if (!result.ok) {
      const code = result.error.code;
      if (code === 'not-found' || code === 'locked') return { ok: false, code };
      if (code === 'invalid') return { ok: false, code, error: operationError(result) };
      throw operationError(result);
    }
    return result.changed ? { ok: true, changed: true, entry: accepted(result, 'after', 'distributionEntry', id) }
      : { ok: true, changed: false };
  }
  async function removeEntry(id) {
    const result = await execute('distribution.entry.remove', [ref('distributionEntry', id)], { id: text(id) });
    if (!result.ok && result.error.code === 'not-found') return { ok: false, code: 'not-found' };
    if (!result.ok && result.error.code !== 'locked') throw operationError(result);
    const entry = accepted(result, 'before', 'distributionEntry', id);
    const layer = accepted(result, 'before', 'distributionLayer', entry.layerId);
    return result.ok ? { ok: true, layer, entry } : { ok: false, code: 'locked', layer, entry };
  }
  async function deleteLayer(id) {
    const result = await execute('distribution.layer.remove', [ref('distributionLayer', id)], { id: text(id) });
    if (!result.ok && result.error.code === 'not-found') return { ok: false, code: 'not-found' };
    if (!result.ok && result.error.code !== 'locked') throw operationError(result);
    const layer = accepted(result, 'before', 'distributionLayer', id);
    if (!result.ok) return { ok: false, code: 'locked', layer };
    return { ok: true, layer, removedEntryCount: rows(result, 'before', 'distributionEntry').filter(entry => entry.layerId === layer.id).length };
  }
  async function append({ layers: newLayers = [], entries: newEntries = [] }) {
    const targets = [...newLayers.map(layer => ref('distributionLayer', layer.id)), ...newEntries.map(entry => ref('distributionEntry', entry.id))];
    const imported = { layers: newLayers.length, entries: newEntries.length };
    const result = await execute('distribution.import', targets, { layers: newLayers, entries: newEntries });
    if (!result.ok) throw operationError(result);
    return imported;
  }
  async function setRenderMode(value) {
    const result = await execute('distribution.render-mode', [], { value });
    if (!result.ok) throw operationError(result);
    if (typeof result.after?.distributionSettings?.renderMode !== 'string') throw responseError('The accepted distribution render mode is required.');
    return result.after.distributionSettings.renderMode;
  }
  async function setBoundaryVisible(value) {
    const result = await execute('distribution.boundary-visible', [], { value });
    if (!result.ok) throw operationError(result);
    if (typeof result.after?.distributionSettings?.boundaryVisible !== 'boolean') throw responseError('The accepted distribution boundary visibility is required.');
    return result.after.distributionSettings.boundaryVisible;
  }
  return Object.freeze({ getLayer: layerById, listLayers: layers,
    listEntries: layerId => distributionEntriesForLayer(entries(), layerId), parentCandidates,
    createLayer, updateLayer, addEntry, updateEntry, removeEntry, deleteLayer, append, setRenderMode, setBoundaryVisible });
}
