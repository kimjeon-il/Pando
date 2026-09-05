import { createDocumentMutationRunner } from './document-mutation-runner.js';
import {
  DISTRIBUTION_MODES,
  DISTRIBUTION_RENDER_MODES,
  createDistributionEntry,
  createDistributionLayer,
  distributionEntriesForLayer,
  normalizeDistributionEntries,
  normalizeDistributionLayers,
} from './distribution-model.js';

const text = value => String(value ?? '').trim();

export function createDistributionService({
  documentStore,
  presentationStore,
  commandPipeline,
  writeLayerColor,
  territorialExists = () => true,
}) {
  const mutateDocument = createDocumentMutationRunner({ commandPipeline });
  const layers = () => documentStore.readLayers();
  const entries = () => documentStore.readEntries();
  const layerById = id => layers().find(layer => layer.id === text(id)) || null;

  function listLayers(type) {
    return layers().filter(layer => !type || layer.type === type);
  }

  function listEntries(layerId) {
    return distributionEntriesForLayer(entries(), layerId);
  }

  function parentCandidates(id) {
    const layer = layerById(id);
    if (!layer) return [];
    const descendants = new Set();
    const queue = [layer.id];
    while (queue.length) {
      const parentId = queue.shift();
      for (const candidate of layers()) {
        if (candidate.parentId !== parentId || descendants.has(candidate.id)) continue;
        descendants.add(candidate.id);
        queue.push(candidate.id);
      }
    }
    return layers().filter(candidate => candidate.type === layer.type
      && candidate.id !== layer.id
      && !descendants.has(candidate.id));
  }

  function createLayer(options) {
    const layer = createDistributionLayer(options);
    if (layerById(layer.id)) throw new Error(`분포 레이어 ID가 중복되었습니다: ${layer.id}`);
    mutateDocument({ type: 'distribution-create', affectedIds: [layer.id] }, () => {
      documentStore.replaceLayers(normalizeDistributionLayers([...layers(), layer]));
    }, { renderDirty: { domain: 'distribution', change: 'structure' } });
    return layerById(layer.id);
  }

  function updateLayer(id, field, value) {
    const current = layerById(id);
    if (!current) return { ok: false, code: 'not-found' };
    if (current.locked && field !== 'locked') return { ok: false, code: 'locked', layer: current };
    const nextLayers = structuredClone(layers());
    const layer = nextLayers.find(candidate => candidate.id === current.id);
    if (field === 'color') writeLayerColor(layer, value);
    else layer[field] = value;
    let normalized;
    try {
      normalized = normalizeDistributionLayers(nextLayers);
    } catch (error) {
      return { ok: false, code: 'invalid', error, layer: current };
    }
    const normalizedCurrent = normalized.find(candidate => candidate.id === current.id);
    if (JSON.stringify(normalizedCurrent) === JSON.stringify(current)) {
      return { ok: true, changed: false, layer: current };
    }
    mutateDocument({ type: 'distribution-metadata', affectedIds: [current.id] }, () => {
      documentStore.replaceLayers(normalized);
    }, { renderDirty: { domain: 'distribution', change: 'metadata' } });
    return { ok: true, changed: true, layer: layerById(current.id) };
  }

  function addEntry(options) {
    const layer = layerById(options?.layerId);
    if (!layer) return { ok: false, code: 'layer-not-found' };
    if (layer.locked) return { ok: false, code: 'locked', layer };
    if (options?.mode === DISTRIBUTION_MODES.TERRITORIAL && !territorialExists(options.territorialUnitId)) {
      return { ok: false, code: 'territorial-unit-not-found', layer };
    }
    let entry;
    try {
      entry = createDistributionEntry(options);
      const nextEntries = normalizeDistributionEntries([...entries(), entry], { layerExists: id => !!layerById(id) });
      mutateDocument({ type: 'distribution-entry-create', affectedIds: [entry.id, layer.id] }, () => {
        documentStore.replaceEntries(nextEntries);
      }, { renderDirty: { domain: 'distribution', change: 'geometry' } });
    } catch (error) {
      return { ok: false, code: 'invalid', error, layer };
    }
    return { ok: true, entry: entries().find(candidate => candidate.id === entry.id), layer };
  }

  function removeEntry(id) {
    const entry = entries().find(candidate => candidate.id === text(id));
    const layer = entry ? layerById(entry.layerId) : null;
    if (!entry || !layer) return { ok: false, code: 'not-found' };
    if (layer.locked) return { ok: false, code: 'locked', layer, entry };
    mutateDocument({ type: 'distribution-entry-delete', affectedIds: [entry.id, layer.id] }, () => {
      documentStore.replaceEntries(entries().filter(candidate => candidate.id !== entry.id));
    }, { renderDirty: { domain: 'distribution', change: 'geometry' } });
    return { ok: true, layer, entry };
  }

  function deleteLayer(id) {
    const current = layerById(id);
    if (!current) return { ok: false, code: 'not-found' };
    if (current.locked) return { ok: false, code: 'locked', layer: current };
    const removedEntries = listEntries(current.id);
    mutateDocument({
      type: 'distribution-delete',
      affectedIds: [current.id, ...removedEntries.map(entry => entry.id)],
    }, () => {
      const nextLayers = layers().filter(candidate => candidate.id !== current.id)
        .map(candidate => candidate.parentId === current.id ? { ...candidate, parentId: '' } : candidate);
      documentStore.replaceLayers(normalizeDistributionLayers(nextLayers));
      documentStore.replaceEntries(entries().filter(entry => entry.layerId !== current.id));
    }, { renderDirty: { domain: 'distribution', change: 'structure' } });
    return { ok: true, layer: current, removedEntryCount: removedEntries.length };
  }

  function append({ layers: newLayers = [], entries: newEntries = [] }) {
    const nextLayers = normalizeDistributionLayers([...layers(), ...newLayers]);
    const layerIds = new Set(nextLayers.map(layer => layer.id));
    const nextEntries = normalizeDistributionEntries([...entries(), ...newEntries], { layerExists: id => layerIds.has(text(id)) });
    mutateDocument({
      type: 'distribution-import',
      affectedIds: [...newLayers, ...newEntries].map(item => text(item.id)).filter(Boolean),
    }, () => {
      documentStore.replaceLayers(nextLayers);
      documentStore.replaceEntries(nextEntries);
    }, { renderDirty: { domain: 'distribution', change: 'structure' } });
    return { layers: newLayers.length, entries: newEntries.length };
  }

  function setRenderMode(value) {
    const mode = value === DISTRIBUTION_RENDER_MODES.INTENSITY
      ? DISTRIBUTION_RENDER_MODES.INTENSITY
      : DISTRIBUTION_RENDER_MODES.DOMINANT;
    presentationStore.setRenderMode(mode);
    return mode;
  }

  function setBoundaryVisible(value) {
    const visible = value !== false;
    presentationStore.setBoundaryVisible(visible);
    return visible;
  }

  return Object.freeze({
    getLayer: layerById,
    listLayers,
    listEntries,
    parentCandidates,
    createLayer,
    updateLayer,
    addEntry,
    removeEntry,
    deleteLayer,
    append,
    setRenderMode,
    setBoundaryVisible,
  });
}
