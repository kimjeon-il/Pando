import { createPlaceRuntime } from './place-runtime.js';
import { resolvePlaceLabelRows } from './place-name-display.js';
import { DEFAULT_PLACE_LANGUAGES } from './place-contract.js';
import { automaticLabelSettings, labelKey, placeLabelDimensions } from './label-layout.js';
import { layerStyle } from './layer-presentation.js';
import { temporalMonthEnd } from './temporal.js';

const stale = () => Object.assign(new Error('The place result belongs to another document.'), { code: 'PL-CORE-STALE' });
const mapDate = month => month.startsWith('-') ? null : temporalMonthEnd(month).canonical;

/** Read-only viewer adapter. The shared runtime owns records and catalog publication. */
export function createViewerPlaces({ getSession, assetRevision, onChange, onError,
  createWorker = () => {
    const url = new URL('../workers/place-worker.js', import.meta.url);
    url.searchParams.set('v', assetRevision);
    return new Worker(url, { type: 'module', name: 'pandolab-viewer-places' });
  } }) {
  if (typeof getSession !== 'function' || typeof onChange !== 'function' || typeof onError !== 'function' || !assetRevision)
    throw new TypeError('Viewer places require their session, deployment revision and publication callbacks.');
  const manifest = new URL('../../data/places/manifest.json', import.meta.url);
  manifest.searchParams.set('v', assetRevision);
  let acceptedSession = null, runtime = null, disposed = false;
  function currentRuntime() {
    const session = disposed ? null : getSession();
    if (session !== acceptedSession) {
      runtime?.dispose(); runtime = null; acceptedSession = session;
      if (session) {
        if (typeof session.commandOwner.selectionCatalogLoad !== 'function')
          throw new TypeError('Canonical C++ place identity admission is required.');
        const isCurrent = () => !disposed && getSession() === session;
        runtime = createPlaceRuntime({ manifestUrl: manifest.href, createWorker,
          admitReferences: async producer => {
            if (!isCurrent()) throw stale();
            await session.commandOwner.selectionCatalogLoad('placeBuiltin', producer(), undefined, { isCurrent });
            if (!isCurrent()) throw stale();
          },
          onSnapshot: () => { if (isCurrent()) onChange(); },
          onError: error => { if (isCurrent()) onError(error); },
        });
      }
    }
    return runtime;
  }
  function toFeature(record, month, languages = DEFAULT_PLACE_LANGUAGES) {
    const rows = resolvePlaceLabelRows(record, languages, mapDate(month));
    return { type: 'Feature', id: record.id, geometry: { type: 'Point', coordinates: record.coordinates },
      properties: { name: rows.map(row => row.text).join(' · '), kind: record.kind,
        countryCode: record.countryCode, notes: record.notes },
      objectKey: `placeBuiltin:${record.kind}:${record.id}`, group: 'labels', place: record,
      selectionRef: { domain: 'placeBuiltin', type: record.kind, id: record.id } };
  }
  return Object.freeze({
    prepare(frame, { zoom, month }) {
      const owner = currentRuntime();
      if (!owner) return Promise.resolve(false);
      if (month.startsWith('-')) { owner.cancelViewport(); return Promise.resolve(false); }
      const projectionFrame = { mode: frame.mode, cssTranslate: frame.cssTranslate, cssScale: frame.cssScale,
        cssViewport: frame.cssViewport, safeInset: frame.safeInset, flatCenter: frame.flatCenter,
        worldOffsets: frame.worldOffsets, rows: { rowX: frame.rowX, rowY: frame.rowY, rowZ: frame.rowZ } };
      return owner.prepare({ projection: frame.projection, threshold: zoom, mapDate: mapDate(month),
        width: frame.cssViewport[0], height: frame.cssViewport[1], scale: frame.cssScale,
        flatCenter: frame.viewState.flatCenter, rotation: frame.viewState.globeRotation, projectionFrame });
    },
    async search(query, { languages = DEFAULT_PLACE_LANGUAGES } = {}) {
      const owner = currentRuntime(), session = acceptedSession;
      if (!owner || session.commandOwner.state().timelineCursor.startsWith('-')) return [];
      const result = await owner.search(query);
      if (getSession() !== session || disposed) throw stale();
      return result.records.map(record => toFeature(record, session.commandOwner.state().timelineCursor, languages));
    },
    records: () => currentRuntime()?.snapshot().records || [],
    labels({ state, month, languages = DEFAULT_PLACE_LANGUAGES }) {
      const owner = currentRuntime();
      if (!owner || month.startsWith('-') || state.layerVisibility.labels === false) return [];
      const copied = new Set(state.labels.map(label => label.sourcePlaceId).filter(Boolean));
      return owner.snapshot().records.flatMap(record => {
        const feature = toFeature(record, month, languages), objectKey = feature.objectKey;
        const style = layerStyle(state.layerPresentation, 'labels', objectKey);
        if (copied.has(record.id) || state.itemVisibility.labels?.[record.id] === false || !style.labelsVisible) return [];
        const settings = automaticLabelSettings(record.kind, state.labelSettings[labelKey('label', record.id)]);
        const rows = resolvePlaceLabelRows(record, languages, mapDate(month));
        if (!rows.length) return [];
        return [{ key: labelKey('label', record.id), objectKey, id: record.id, source: record, feature,
          coordinate: settings.pinned && settings.manualPosition ? settings.manualPosition : record.coordinates,
          text: rows.map(row => row.text).join(' · '), rows, ...placeLabelDimensions(rows), ...settings,
          minZoom: Math.max(settings.minZoom, record.minZoom), style }];
      });
    },
    dispose() { disposed = true; runtime?.dispose(); runtime = null; acceptedSession = null; },
  });
}
