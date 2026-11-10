import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openReadyViewer } from '../helpers/viewer-acceptance.mjs';

test.use({ viewport: { width: 1280, height: 800 }, trace: 'off' });
const requestedBackend = process.env.PANDOLAB_REGION_RENDERER || 'webgl2';
const backendNames = { webgl2: 'webgl2', webgl1: 'webgl1', canvas: 'canvas-worker', canvas2d: 'canvas2d' };
if (!Object.hasOwn(backendNames, requestedBackend)) throw new Error('Unsupported regional LOD renderer');
const expectedBackend = backendNames[requestedBackend];
const regions = [
  { id: 'DEU', bounds: { west: 5, east: 16, south: 47, north: 55.5 }, center: [10.5, 51.25] },
  { id: 'KOR', bounds: { west: 124, east: 132, south: 33, north: 39.5 }, center: [128, 36.25] },
];
const zooms = [1, 2, 4, 4.5, 8, 16, 32];

async function read(page) {
  return page.evaluate(() => {
    const viewer = globalThis.__PANDOLAB_VIEWER__, project = viewer?.documentSnapshot();
    return { documentId: project?.documentId, setup: project?.projectSetup,
      month: viewer?.builtinMonth()?.month, countries: viewer?.visibleTerritorialCount(),
      camera: globalThis.__PANDOLAB_MAP_HOST__?.getViewState(), stats: viewer?.rendererStats(),
      boundary: viewer?.interactionBoundary() };
  });
}
async function accepted(page, { documentId, projection, zoom } = {}) {
  let acceptedState;
  await expect.poll(async () => {
    const state = await read(page), s = state.stats;
    acceptedState = state;
    return Boolean(s?.renderer === expectedBackend && !s.projectRenderBlocked
      && s.mapReadiness?.mapReady && s.countriesPublishedGeneration === s.projectGeneration
      && Math.abs(s.screenScale - state.camera?.scale) < 1e-7
      && state.boundary.revision.includes(`display-interaction:lod:${s.screenLodTargetKey}:`)
      && s.activeMeshQuality === 'lod' && (expectedBackend.startsWith('webgl')
        ? s.surfaceDraw?.countryIndexCount > 0
        : s.triangleCount > 0 && s.canvasDisplayedStyleRevision === s.canvasStyleRevision
          && !s.canvasWorkerBusy && !s.canvasWorkerHasPendingFrame)
      && s.screenLodBucket && s.screenLodLatest?.key === s.screenLodBucket
      && !s.screenLodLatest?.fallback && !s.screenLodPreparingKey && !s.screenLodFailure
      && (!documentId || state.documentId === documentId)
      && (!projection || state.camera?.projection === projection)
      && (zoom == null || Math.abs(state.camera?.zoom - zoom) < 1e-8));
  }, { timeout: 90_000, message: 'The actual regional project LOD must be painted on its own accepted frame' }).toBe(true);
  const state = acceptedState;
  expect(state.stats.canvasWorkerLastError || '').toBe('');
  return state;
}
async function camera(page, region, projection, zoom) {
  await page.evaluate(({ center, projection, zoom }) => {
    const host = globalThis.__PANDOLAB_MAP_HOST__;
    host.setViewState({ projection, view: { flatCenter: center, flatZoom: zoom,
      globeRotation: [-center[0], -center[1], 0], globeZoom: zoom } });
    host.requestRepaint('project-common-lod-region');
  }, { center: region.center, projection, zoom });
}

async function regionalPackage(page, region) {
  // This is the current production reader's actual project-state GPKG path,
  // also exercised by runtime/project-runtime-roundtrip.spec.mjs.
  await page.addScriptTag({ url: '/assets/js/vendor/sql/sql-wasm.js' });
  return page.evaluate(async region => {
    const viewer = globalThis.__PANDOLAB_VIEWER__, current = viewer.documentSnapshot();
    const world = viewer.resolvedWorld();
    const row = world.entities.find(entity => entity.id === region.id);
    if (!row?.identity || !['Polygon', 'MultiPolygon'].includes(row.geometry?.type))
      throw new Error(`Current canonical ${region.id} geometry is unavailable`);
    const { createInitialDocument } = await import('/assets/js/modules/initial-document.js');
    const { TIMELINE_RECORD_SCHEMA_VERSION } = await import('/assets/js/modules/timeline-records.js');
    const month = viewer.builtinMonth().month;
    const source = createInitialDocument({ appVersion: globalThis.PANDOLAB_BUILD_META.appVersion,
      baseDataset: current.baseDataset,
      state: { projectSetup: { initialMonth: month, timelineRange: null,
        initialMapBounds: region.bounds, sourceMode: 'empty' } } });
    source.mapProjectIdentity = structuredClone(current.mapProjectIdentity);
    source.territorialEntities = [structuredClone(row.identity)];
    const geometryId = `regional-render-fixture:${region.id}`;
    source.geometries = [{ id: geometryId, version: 1, geojson: structuredClone(row.geometry) }];
    const objectRef = { domain: 'territorial', id: row.id };
    // A static rendering fixture of the resolved current shape, not a claim
    // about historical ownership. No lazy builtin geometry references remain.
    source.timelineRecords = { schemaVersion: TIMELINE_RECORD_SCHEMA_VERSION,
      lifetimes: [{ id: `life:${row.id}`, objectRef, validFrom: null, validTo: null }],
      geometryBindings: [{ id: `shape:${row.id}`, objectRef, validFrom: null, validTo: null,
        geometryRef: { id: geometryId, version: 1 } }],
      parentRelations: [{ id: `parent:${row.id}`, objectRef, validFrom: null, validTo: null,
        parentId: '', coverageMode: 'explicit' }], propertyBindings: [] };
    const SQL = await globalThis.initSqlJs({ locateFile: file => '/assets/js/vendor/sql/' + file });
    const database = new SQL.Database();
    try {
      database.run('CREATE TABLE pandolab_project_settings (setting_key TEXT PRIMARY KEY, json_value TEXT NOT NULL)');
      database.run('INSERT INTO pandolab_project_settings (setting_key, json_value) VALUES (?, ?)',
        ['project_state', JSON.stringify(source)]);
      return { bytes: Array.from(database.export()), documentId: source.documentId, geometryId, month,
        sourceGeometryJson: JSON.stringify(row.geometry), sourceIdentity: row.identity,
        sourceCommit: globalThis.PANDOLAB_BUILD_META.sourceCommit,
        dataRevision: globalThis.PANDOLAB_BUILD_META.dataRevision };
    } finally { database.close(); }
  }, region);
}

for (const region of regions) {
  test(`project-common-lod region ${region.id} ${requestedBackend}: actual GeoPackage bounds and relative zoom`, async ({ page, baseURL }, info) => {
    test.setTimeout(360_000);
    const observations = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let packageEvidence = null;
    try {
      const url = new URL(`?debug=1&renderer=${requestedBackend}`, process.env.PANDOLAB_TEST_SITE_URL || `${baseURL}/`);
      await openReadyViewer(page, { url: url.href, timeout: 120_000 });
      const world = await accepted(page), worldScale32 = {};
      for (const projection of ['flat', 'globe']) {
        await camera(page, region, projection, 32);
        const state = await accepted(page, { projection, zoom: 32 });
        worldScale32[projection] = state.camera.scale;
        observations.push({ stage: 'world-reference', projection, scale32: state.camera.scale,
          sourceKey: state.stats.screenLodSourceKey, lod: state.stats.screenLodLatest });
      }
      const fixture = await regionalPackage(page, region), path = info.outputPath(`${region.id}-current.gpkg`);
      const bytes = Buffer.from(fixture.bytes), hash = value => createHash('sha256').update(value).digest('hex');
      await writeFile(path, bytes);
      packageEvidence = { file: path, bytes: bytes.length, sha256: hash(bytes), documentId: fixture.documentId,
        geometryId: fixture.geometryId, sourceGeometrySha256: hash(fixture.sourceGeometryJson),
        sourceCommit: fixture.sourceCommit, dataRevision: fixture.dataRevision, month: fixture.month };
      await page.locator('#projectFileInput').setInputFiles(path);
      const opened = await accepted(page, { documentId: fixture.documentId });
      expect(opened.stats.projectGeneration).toBeGreaterThan(world.stats.projectGeneration);
      expect(opened.setup.initialMapBounds).toEqual(region.bounds);
      expect(opened.setup.sourceMode).toBe('empty');
      expect(opened.camera.zoom, 'Opening uses the saved project fit as relative 1x').toBe(1);
      expect(opened.countries).toBe(1);
      expect(opened.month).toBe(fixture.month);
      const stored = await page.evaluate(({ id, geometryId }) => {
        const viewer = globalThis.__PANDOLAB_VIEWER__, document = viewer.documentSnapshot();
        return { identity: document.territorialEntities.find(row => row.id === id),
          geometryJson: JSON.stringify(document.geometries.find(row => row.id === geometryId && row.version === 1)?.geojson),
          currentGeometryJson: JSON.stringify(viewer.resolvedWorld().entities.find(row => row.id === id)?.geometry) };
      }, { id: region.id, geometryId: fixture.geometryId });
      expect(stored.identity).toEqual(fixture.sourceIdentity);
      expect(hash(stored.geometryJson)).toBe(packageEvidence.sourceGeometrySha256);
      expect(hash(stored.currentGeometryJson)).toBe(packageEvidence.sourceGeometrySha256);
      observations.push({ stage: 'opened', ...opened });

      for (const projection of ['flat', 'globe']) {
        let projectBaseScale = null;
        const keys = new Set();
        for (const zoom of zooms) {
          await camera(page, region, projection, zoom);
          const state = await accepted(page, { documentId: fixture.documentId, projection, zoom });
          if (zoom === 1) projectBaseScale = state.camera.scale;
          expect(state.camera.scale / projectBaseScale).toBeCloseTo(zoom, 7);
          expect(state.boundary.revision).toContain(`display-interaction:lod:${state.stats.screenLodTargetKey}:`);
          keys.add(state.stats.screenLodBucket);
          if (zoom === 32) {
            expect(state.camera.scale).toBeGreaterThan(worldScale32[projection]);
            await page.locator('#map .gpu-map-canvas').screenshot({ path: info.outputPath(`${region.id}-${projection}-32.png`), timeout: 30_000 });
          }
          observations.push({ stage: 'regional-zoom', projection, zoom, ...state });
        }
        expect(keys.size).toBeGreaterThan(1);
      }
      expect(errors).toEqual([]);
    } finally {
      const last = await read(page).catch(error => ({ unavailable: error.message }));
      await writeFile(info.outputPath('regional-lod.json'), JSON.stringify({ region, requestedBackend,
        packageEvidence, observations, last, errors, fixtureKind: 'current-canonical-static-region',
        lsibCalibrationPerformed: false }, null, 2));
    }
  });
}
