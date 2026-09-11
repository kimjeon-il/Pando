/** GisAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createGisAssembly() {
  let dependencies;
  let gisWorkflow;
  let gisImportCommitterPromise;
  let requestedVectorTarget;
  let gisFileControllerPromise;
  function connect(ports) {
    if (dependencies) throw new Error('gis-assembly already connected');
    dependencies = ports;
  }

  function getGisImportCommitter() {
    if (gisImportCommitterPromise) return gisImportCommitterPromise;
    gisImportCommitterPromise = Promise.all([
      (0, dependencies.ensureGisRuntime)(),
      import((0, dependencies.versionedModuleUrl)('./modules/gis-import-transaction.js')),
    ]).then(([, module]) => module.createGisImportTransactionCommitter({
      state: dependencies.state,
      TERRITORIAL_UNIT_TYPES: dependencies.TERRITORIAL_UNIT_TYPES,
      TERRITORIAL_COVERAGE_MODES: dependencies.TERRITORIAL_COVERAGE_MODES,
      DISTRIBUTION_TYPES: dependencies.DISTRIBUTION_TYPES,
      DISTRIBUTION_MODES: dependencies.DISTRIBUTION_MODES,
      DISTRIBUTION_TYPE_LABELS: dependencies.DISTRIBUTION_TYPE_LABELS,
      GENERIC_FEATURE_SCHEMA_VERSION: dependencies.GENERIC_FEATURE_SCHEMA_VERSION,
      DEFAULT_GENERIC_FEATURE_COLOR: dependencies.DEFAULT_GENERIC_FEATURE_COLOR,
      polygonClipping: window.polygonClipping,
      uid: dependencies.uid,
      deepClone: dependencies.deepClone,
      countryFeatureById: dependencies.countryFeatureById,
      countryName: dependencies.countryName,
      territorialUnitName: dependencies.territorialUnitName,
      territorialRepository: dependencies.territorialRepository,
      distributionService: dependencies.distributionService,
      genericFeatureService: dependencies.genericFeatureService,
      resolveImportedCountryId: dependencies.resolveImportedCountryId,
      normalizeCountryGeometry: dependencies.normalizeCountryGeometry,
      normalizeClippedLandGeometry: dependencies.normalizeClippedLandGeometry,
      createTerritorialFeature: dependencies.createTerritorialFeature,
      createPartitionTerritorialFeature: dependencies.createPartitionTerritorialFeature,
      normalizeTerritorialUnits: dependencies.normalizeTerritorialUnits,
      reconcileTerritorialUnitCompleteness: dependencies.reconcileTerritorialUnitCompleteness,
      partitionGroupMatches: dependencies.partitionGroupMatches,
      multiPolygonPlanarArea: dependencies.multiPolygonPlanarArea,
      createGisImportError: dependencies.createGisImportError,
      RELIABILITY_ERROR_CATEGORIES: dependencies.RELIABILITY_ERROR_CATEGORIES,
      recordHistory: (...args) => dependencies.projectDomain.recordHistory(...args),
      snapshotEditable: dependencies.snapshotEditable,
      markCountryGeometriesChanged: dependencies.markCountryGeometriesChanged,
      refreshCountryCentroids: dependencies.refreshCountryCentroids,
      normalizeProjectObjects: dependencies.normalizeProjectObjects,
      markLayerTreeDirty: dependencies.markLayerTreeDirty,
      applyTerritorialUnitSelectionIntent: dependencies.applyTerritorialUnitSelectionIntent,
      renderingDomain: dependencies.renderingDomain,
      queueAutosave: (...args) => dependencies.projectDomain.queueAutosave(...args),
      setActionStatus: dependencies.setActionStatus,
      createDistributionLayer: dependencies.createDistributionLayer,
      createDistributionEntry: dependencies.createDistributionEntry,
      activeLayerFolderKeys: dependencies.activeLayerFolderKeys,
      normalizeGenericFeatureSemantics: dependencies.normalizeGenericFeatureSemantics,
      validateStructuredGeometry: dependencies.validateStructuredGeometry,
      territorialTypeLabel: dependencies.territorialTypeLabel,
      sphericalGeometryAreaKm2: dependencies.sphericalGeometryAreaKm2,
      buildTerritorialImportTransactionPlan: dependencies.buildTerritorialImportTransactionPlan,
      mapEditClient: dependencies.mapEditClient,
      validateGisCountryCollection: (...args) => gisWorkflow.validateCountries(...args),
      reindexCountries: dependencies.reindexCountries,
      transferLandDependents: dependencies.transferLandDependents,
      assertCurrentProjectReferences: dependencies.assertCurrentProjectReferences,
      commitHistorySnapshot: (...args) => dependencies.projectDomain.commitHistorySnapshot(...args),
      restoreCountryEditSnapshot: dependencies.restoreCountryEditSnapshot,
      createCancellationError: dependencies.createCancellationError,
      buildSharedBoundaryTopology: dependencies.buildSharedBoundaryTopology,
      analyzeAdminCountryCoast: dependencies.analyzeAdminCountryCoast,
      ensureGisRuntime: dependencies.ensureGisRuntime,
      getCoastReconciliationController: dependencies.getCoastReconciliationController,
      normalizeCoastDecision: dependencies.normalizeCoastDecision,
      planCoastReconciliations: dependencies.planCoastReconciliations,
      validateCoastReplacement: dependencies.validateCoastReplacement,
      importedCountryOverrides: dependencies.importedCountryOverrides,
      applyImportedPackageAssets: dependencies.applyImportedPackageAssets,
      projectDomain: dependencies.projectDomain,
      appendImportedSourceInfo: dependencies.appendImportedSourceInfo,
      assertProjectReferenceIntegrity: dependencies.assertProjectReferenceIntegrity,
      pruneLayerItemVisibility: dependencies.pruneLayerItemVisibility,
      scheduleCountryLabelAnchors: dependencies.scheduleCountryLabelAnchors,
      selectionUiController: dependencies.selectionUiController,
    })).catch(error => {
      gisImportCommitterPromise = null;
      throw error;
    });
    return gisImportCommitterPromise;
  }

  function getGisFileController() {
    if (gisFileControllerPromise) return gisFileControllerPromise;
    gisFileControllerPromise = Promise.resolve().then(() => {
        const controller = (0, dependencies.createGisFileController)({
          elements: { open: (0, dependencies.$)('openGisBtn'), input: (0, dependencies.$)('gisFileInput'), save: (0, dependencies.$)('saveProjectBtn'), projectOpen: (0, dependencies.$)('openProjectBtn'), projectInput: (0, dependencies.$)('projectFileInput') },
          setTarget: target => { requestedVectorTarget = target; },
          onFiles: openGisFiles,
          requireCanonicalData: dependencies.requireCanonicalData,
          projectDomain: dependencies.projectDomain,
          setActionStatus: dependencies.setActionStatus,
          window,
          document,
        });
        controller.bind();
        return controller;
      })
      .catch(error => {
        gisFileControllerPromise = null;
        throw error;
      });
    return gisFileControllerPromise;
  }

  async function openGisFiles(files, { sourceKind = '' } = {}) {
    if (!files?.length) return;
    const requestedTarget = requestedVectorTarget;
    requestedVectorTarget = '';
    (0, dependencies.setActionStatus)('파일 확인 중…', 'working', 0);
    try {
      const outcome = await dependencies.gisDomain.planImport(files, { targetType: requestedTarget, sourceKind });
      if (outcome?.status === 'planned') await dependencies.editingDomain.commitImport(outcome.plan);
    } catch (error) {
      if ((0, dependencies.isAbortError)(error)) {
        dependencies.reliabilityDiagnostic.push({ category: 'gis', operation: 'gis-import', result: 'cancelled' });
        (0, dependencies.setActionStatus)('파일 불러오기를 취소했습니다.', 'ready');
        return;
      }
      (0, dependencies.reportGisImportError)(error, { rollback: 'not-started-or-transaction-owned' });
    }
  }

  function getGisExportController() {
    if (dependencies.gisExportControllerPromise) return dependencies.gisExportControllerPromise;
    dependencies.gisExportControllerPromise = import((0, dependencies.versionedModuleUrl)('./modules/gis-export-controller.js')).then(({ createGisExportController }) => {
      const units = () => dependencies.state.territorialUnits || [];
      const controller = createGisExportController({
        window,
        document,
        elements: {
          trigger: (0, dependencies.$)('dataExportBtn'),
          modal: (0, dependencies.$)('gisExportModal'),
          form: (0, dependencies.$)('gisExportForm'),
          error: (0, dependencies.$)('gisExportError'),
          summary: (0, dependencies.$)('gisExportSummary'),
          format: (0, dependencies.$)('gisExportFormat'),
          close: (0, dependencies.$)('gisExportCloseBtn'),
          cancel: (0, dependencies.$)('gisExportCancelBtn'),
          backdrop: (0, dependencies.$)('gisExportModal').querySelector('.ui-dialog-backdrop'),
          confirm: (0, dependencies.$)('gisExportConfirmBtn'),
        },
        ensureRuntime: () => Promise.all([(0, dependencies.ensureGisIoRuntime)(), (0, dependencies.ensureModalRuntime)()]),
        requireReady: dependencies.requireCanonicalData,
        getProject: () => dependencies.projectDomain.buildProject(),
        getCounts: () => ({
          countries: dependencies.state.countriesData?.features?.length || 0,
          subunits: units().filter(feature => feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.SUBUNIT).length,
          regions: units().filter(feature => feature.properties?.unitType === dependencies.TERRITORIAL_UNIT_TYPES.REGION).length,
          genericFeatures: dependencies.state.genericFeatures.length,
          distributions: dependencies.state.distributionEntries.length,
          labels: dependencies.state.labels.length,
        }),
        download: (filename, blob) => {
          const url = window.URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        },
        setStatus: dependencies.setActionStatus,
        reportError: error => (0, dependencies.reportOperationError)(error, 'GIS 데이터를 내보내지 못했습니다.', 'PL-GIS-EXPORT-001', 4200),
      });
      controller.bind();
      dependencies.gisExportController = controller;
      return controller;
    }).catch(error => {
      dependencies.gisExportControllerPromise = null;
      throw error;
    });
    return dependencies.gisExportControllerPromise;
  }

  function initializeGisWorkflow() {

  }

  function initializeGisImportCommitterPromise() {
    (gisImportCommitterPromise = null);

    (requestedVectorTarget = '');

    (gisFileControllerPromise = null);
  }

  return Object.freeze({
    connect,
    initializeGisWorkflow,
    initializeGisImportCommitterPromise,
    get getGisExportController() { return getGisExportController; },
    get getGisFileController() { return getGisFileController; },
    get getGisImportCommitter() { return getGisImportCommitter; },
    get gisWorkflow() { return gisWorkflow; },
    set gisWorkflow(value) { gisWorkflow = value; },
  });
}
