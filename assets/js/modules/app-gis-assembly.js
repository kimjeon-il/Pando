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
      (0, dependencies.gisServicesA.ensureGisRuntime)(),
      import((0, dependencies.applicationServicesB.versionedModuleUrl)('./modules/gis-import-transaction.js')),
    ]).then(([, module]) => module.createGisImportTransactionCommitter({
      state: dependencies.projectState.state,
      TERRITORIAL_UNIT_TYPES: dependencies.territorialModel.TERRITORIAL_UNIT_TYPES,
      TERRITORIAL_COVERAGE_MODES: dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES,
      DISTRIBUTION_TYPES: dependencies.objectCatalog.DISTRIBUTION_TYPES,
      DISTRIBUTION_MODES: dependencies.territorialModel.DISTRIBUTION_MODES,
      DISTRIBUTION_TYPE_LABELS: dependencies.objectModelA.DISTRIBUTION_TYPE_LABELS,
      GENERIC_FEATURE_SCHEMA_VERSION: dependencies.applicationConstantsA.GENERIC_FEATURE_SCHEMA_VERSION,
      DEFAULT_GENERIC_FEATURE_COLOR: dependencies.colorModel.DEFAULT_GENERIC_FEATURE_COLOR,
      polygonClipping: window.polygonClipping,
      uid: dependencies.surfaces.uid,
      deepClone: dependencies.platform.deepClone,
      countryFeatureById: dependencies.countries.countryFeatureById,
      countryName: dependencies.presentation.countryName,
      territorialUnitName: dependencies.objectPresentation.territorialUnitName,
      territorialRepository: dependencies.presentation.territorialRepository,
      distributionService: dependencies.objectModelA.distributionService,
      genericFeatureService: dependencies.objectModelA.genericFeatureService,
      resolveImportedCountryId: dependencies.gisServicesA.resolveImportedCountryId,
      normalizeCountryGeometry: dependencies.geometryModel.normalizeCountryGeometry,
      normalizeClippedLandGeometry: dependencies.cutGeometry.normalizeClippedLandGeometry,
      createTerritorialFeature: dependencies.territorialServicesA.createTerritorialFeature,
      createPartitionTerritorialFeature: dependencies.territorialModel.createPartitionTerritorialFeature,
      normalizeTerritorialUnits: dependencies.territorialModel.normalizeTerritorialUnits,
      reconcileTerritorialUnitCompleteness: dependencies.landRelations.reconcileTerritorialUnitCompleteness,
      partitionGroupMatches: dependencies.landRelations.partitionGroupMatches,
      multiPolygonPlanarArea: dependencies.territoryGeometry.multiPolygonPlanarArea,
      createGisImportError: dependencies.readinessUi.createGisImportError,
      RELIABILITY_ERROR_CATEGORIES: dependencies.readiness.RELIABILITY_ERROR_CATEGORIES,
      recordHistory: (...args) => dependencies.domains.projectDomain.recordHistory(...args),
      snapshotEditable: dependencies.snapshots.snapshotEditable,
      markCountryGeometriesChanged: dependencies.spatialQuery.markCountryGeometriesChanged,
      refreshCountryCentroids: dependencies.countryValidation.refreshCountryCentroids,
      normalizeProjectObjects: dependencies.snapshots.normalizeProjectObjects,
      markLayerTreeDirty: dependencies.layers.markLayerTreeDirty,
      applyTerritorialUnitSelectionIntent: dependencies.propertyEditingA.applyTerritorialUnitSelectionIntent,
      renderingDomain: dependencies.domains.renderingDomain,
      queueAutosave: (...args) => dependencies.domains.projectDomain.queueAutosave(...args),
      setActionStatus: dependencies.feedback.setActionStatus,
      createDistributionLayer: dependencies.distributionServices.createDistributionLayer,
      createDistributionEntry: dependencies.distributionServices.createDistributionEntry,
      activeLayerFolderKeys: dependencies.hydroPresentation.activeLayerFolderKeys,
      normalizeGenericFeatureSemantics: dependencies.modelValidation.normalizeGenericFeatureSemantics,
      validateStructuredGeometry: dependencies.geometryModel.validateStructuredGeometry,
      territorialTypeLabel: dependencies.territorialServicesB.territorialTypeLabel,
      sphericalGeometryAreaKm2: dependencies.applicationServicesB.sphericalGeometryAreaKm2,
      buildTerritorialImportTransactionPlan: dependencies.gisServicesA.buildTerritorialImportTransactionPlan,
      mapEditClient: dependencies.spatialQuery.mapEditClient,
      validateGisCountryCollection: (...args) => gisWorkflow.validateCountries(...args),
      reindexCountries: dependencies.geometryMutation.reindexCountries,
      transferLandDependents: dependencies.landRelations.transferLandDependents,
      assertCurrentProjectReferences: dependencies.geometryOperations.assertCurrentProjectReferences,
      commitHistorySnapshot: (...args) => dependencies.domains.projectDomain.commitHistorySnapshot(...args),
      restoreCountryEditSnapshot: dependencies.validation.restoreCountryEditSnapshot,
      createCancellationError: dependencies.applicationFactories.createCancellationError,
      buildSharedBoundaryTopology: dependencies.territorialModel.buildSharedBoundaryTopology,
      analyzeAdminCountryCoast: dependencies.gisServicesA.analyzeAdminCountryCoast,
      ensureGisRuntime: dependencies.gisServicesA.ensureGisRuntime,
      getCoastReconciliationController: dependencies.projectRestore.getCoastReconciliationController,
      normalizeCoastDecision: dependencies.gisServicesA.normalizeCoastDecision,
      planCoastReconciliations: dependencies.gisServicesA.planCoastReconciliations,
      validateCoastReplacement: dependencies.gisServicesB.validateCoastReplacement,
      importedCountryOverrides: dependencies.gisServicesA.importedCountryOverrides,
      applyImportedPackageAssets: dependencies.gisServicesA.applyImportedPackageAssets,
      projectDomain: dependencies.domains.projectDomain,
      appendImportedSourceInfo: dependencies.gisServicesA.appendImportedSourceInfo,
      assertProjectReferenceIntegrity: dependencies.territorialModel.assertProjectReferenceIntegrity,
      pruneLayerItemVisibility: dependencies.layerTree.pruneLayerItemVisibility,
      scheduleCountryLabelAnchors: dependencies.countries.scheduleCountryLabelAnchors,
      selectionUiController: dependencies.domains.selectionUiController,
    })).catch(error => {
      gisImportCommitterPromise = null;
      throw error;
    });
    return gisImportCommitterPromise;
  }

  function getGisFileController() {
    if (gisFileControllerPromise) return gisFileControllerPromise;
    gisFileControllerPromise = Promise.resolve().then(() => {
        const controller = (0, dependencies.uiFactoriesA.createGisFileController)({
          elements: { open: (0, dependencies.platform.$)('openGisBtn'), input: (0, dependencies.platform.$)('gisFileInput'), save: (0, dependencies.platform.$)('saveProjectBtn'), projectOpen: (0, dependencies.platform.$)('openProjectBtn'), projectInput: (0, dependencies.platform.$)('projectFileInput') },
          setTarget: target => { requestedVectorTarget = target; },
          onFiles: openGisFiles,
          requireCanonicalData: dependencies.readinessUi.requireCanonicalData,
          projectDomain: dependencies.domains.projectDomain,
          setActionStatus: dependencies.feedback.setActionStatus,
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
    (0, dependencies.feedback.setActionStatus)('파일 확인 중…', 'working', 0);
    try {
      const outcome = await dependencies.domainControllers.gisDomain.planImport(files, { targetType: requestedTarget, sourceKind });
      if (outcome?.status === 'planned') await dependencies.domains.editingDomain.commitImport(outcome.plan);
    } catch (error) {
      if ((0, dependencies.readiness.isAbortError)(error)) {
        dependencies.readiness.reliabilityDiagnostic.push({ category: 'gis', operation: 'gis-import', result: 'cancelled' });
        (0, dependencies.feedback.setActionStatus)('파일 불러오기를 취소했습니다.', 'ready');
        return;
      }
      (0, dependencies.readinessUi.reportGisImportError)(error, { rollback: 'not-started-or-transaction-owned' });
    }
  }

  function getGisExportController() {
    if (dependencies.gisServicesA.gisExportControllerPromise) return dependencies.gisServicesA.gisExportControllerPromise;
    const controllerPromise = import((0, dependencies.applicationServicesB.versionedModuleUrl)('./modules/gis-export-controller.js')).then(({ createGisExportController }) => {
      const units = () => dependencies.projectState.state.territorialUnits || [];
      const controller = createGisExportController({
        window,
        document,
        elements: {
          trigger: (0, dependencies.platform.$)('dataExportBtn'),
          modal: (0, dependencies.platform.$)('gisExportModal'),
          form: (0, dependencies.platform.$)('gisExportForm'),
          error: (0, dependencies.platform.$)('gisExportError'),
          summary: (0, dependencies.platform.$)('gisExportSummary'),
          format: (0, dependencies.platform.$)('gisExportFormat'),
          cancel: (0, dependencies.platform.$)('gisExportCancelBtn'),
          backdrop: (0, dependencies.platform.$)('gisExportModal').querySelector('.ui-dialog-backdrop'),
          confirm: (0, dependencies.platform.$)('gisExportConfirmBtn'),
        },
        ensureRuntime: () => Promise.all([(0, dependencies.gisServicesA.ensureGisIoRuntime)(), (0, dependencies.applicationServicesA.ensureModalRuntime)()]),
        requireReady: dependencies.readinessUi.requireCanonicalData,
        getProject: () => dependencies.domains.projectDomain.buildProject(),
        getCounts: () => ({
          countries: dependencies.projectState.state.countriesData?.features?.length || 0,
          subunits: units().filter(feature => feature.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.SUBUNIT).length,
          regions: units().filter(feature => feature.properties?.unitType === dependencies.territorialModel.TERRITORIAL_UNIT_TYPES.REGION).length,
          genericFeatures: dependencies.projectState.state.genericFeatures.length,
          distributions: dependencies.projectState.state.distributionEntries.length,
          labels: dependencies.projectState.state.labels.length,
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
        setStatus: dependencies.feedback.setActionStatus,
        reportError: error => (0, dependencies.feedback.reportOperationError)(error, 'GIS 데이터를 내보내지 못했습니다.', 'PL-GIS-EXPORT-001', 4200),
      });
      controller.bind();
      dependencies.gisRuntimeCommands.setExportController(controller);
      return controller;
    }).catch(error => {
      dependencies.gisRuntimeCommands.setExportControllerPromise(null);
      throw error;
    });
    dependencies.gisRuntimeCommands.setExportControllerPromise(controllerPromise);
    return dependencies.gisServicesA.gisExportControllerPromise;
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
