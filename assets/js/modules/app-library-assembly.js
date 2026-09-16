/** LibraryAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createLibraryAssembly() {
  let dependencies;
  let historicalLibraryService;
  let historicalLibraryController;
  let LIBRARY_TYPE_LABELS;
  let batchPreparation = null;
  function connect(ports) {
    if (dependencies) throw new Error('library-assembly already connected');
    dependencies = ports;
  }

  function combineHistoricalLibraryGeometries(geometries) {
    const valid = geometries.filter(geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type));
    const coordinates = valid.map(geometry => geometry.coordinates);
    if (!coordinates.length) return null;
    const union = coordinates.length === 1
      ? (valid[0].type === 'Polygon' ? [coordinates[0]] : coordinates[0])
      : window.polygonClipping.union(...coordinates);
    return (0, dependencies.cutGeometry.normalizeClippedLandGeometry)(union);
  }

  function subtractHistoricalLibraryGeometry(geometry, excludedGeometry) {
    if (!geometry?.coordinates || !excludedGeometry?.coordinates) return null;
    return (0, dependencies.cutGeometry.normalizeClippedLandGeometry)(window.polygonClipping.difference(
      geometry.coordinates,
      excludedGeometry.coordinates,
    ));
  }

  function historicalLibraryPreviewSvg(entity, version) {
    const wrapper = document.createElement('div');
    wrapper.className = 'historical-library-preview-map';
    const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgNode.setAttribute('viewBox', '0 0 420 190');
    svgNode.setAttribute('aria-label', `${entity.displayNames?.ko || entity.canonicalName} 경계 미리보기`);
    const projection = dependencies.platform.d3.geo.equirectangular().scale(1).translate([0, 0]);
    const previewPath = dependencies.platform.d3.geo.path().projection(projection);
    const feature = { type: 'Feature', properties: {}, geometry: version.geometry };
    const bounds = previewPath.bounds(feature);
    const width = Math.max(1, bounds[1][0] - bounds[0][0]);
    const height = Math.max(1, bounds[1][1] - bounds[0][1]);
    const scale = 0.86 / Math.max(width / 420, height / 190);
    const center = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    projection.scale(scale).translate([210 - scale * center[0], 95 - scale * center[1]]);
    const pathNode = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathNode.setAttribute('d', previewPath(feature) || '');
    pathNode.setAttribute('fill', 'var(--accent-surface)');
    pathNode.setAttribute('stroke', 'var(--accent-border)');
    pathNode.setAttribute('stroke-width', '1.5');
    pathNode.setAttribute('vector-effect', 'non-scaling-stroke');
    svgNode.appendChild(pathNode);
    wrapper.appendChild(svgNode);
    return wrapper;
  }

  function libraryInstanceId(libraryId) {
    if (!libraryId) return '';
    const entity = historicalLibraryService.get(libraryId);
    const currentCountryId = String(entity?.metadata?.currentCountryId || '');
    if (currentCountryId && (0, dependencies.countries.countryFeatureById)(currentCountryId)) return currentCountryId;
    if ((0, dependencies.countries.countryFeatureById)(libraryId)) return String(libraryId);
    const unit = dependencies.projectState.state.territorialUnits.find(feature => String(feature.properties?.sourceLibraryId || '') === String(libraryId));
    return unit ? String(unit.id) : '';
  }

  async function instantiateHistoricalLibraryEntities(rootIds, referenceDate, childDepth = 'none', versionOverrides = {}, options = {}) {
    const revision = dependencies.projectState.state.stateRevision;
    const landRevision = dependencies.countries.countryLandRevision;
    const currentCountries = dependencies.projectState.state.countriesData;
    const assertCurrent = () => {
      if (options.isCurrent?.() === false || dependencies.projectState.state.stateRevision !== revision || dependencies.countries.countryLandRevision !== landRevision || dependencies.projectState.state.countriesData !== currentCountries) {
        throw new Error('프로젝트 또는 선택이 변경되었습니다. 항목과 소속을 다시 확인하세요.');
      }
    };
    for (const [id, versionId] of Object.entries(versionOverrides)) {
      if (!historicalLibraryService.get(id)?.geometryVersions?.some(version => version.id === versionId)) {
        throw new Error('선택한 경계 버전을 찾을 수 없습니다.');
      }
    }
    const preparationKey = JSON.stringify([revision, landRevision, rootIds, referenceDate, childDepth, versionOverrides, options.ownership || {}]);
    if (batchPreparation?.key !== preparationKey || batchPreparation.project !== currentCountries) {
      const entry = { key: preparationKey, project: currentCountries, promise: null };
      batchPreparation = entry;
      entry.promise = (async () => {
        const descriptors = historicalLibraryService.instantiateDescriptors(rootIds, referenceDate, childDepth, versionOverrides);
        const prepared = (0, dependencies.libraryServices.prepareLibraryOwnership)({
          descriptors, resolve: libraryInstanceId, countries: dependencies.projectState.state.countriesData.features,
          units: dependencies.projectState.state.territorialUnits, choices: options.ownership || {},
          allocateId: type => (0, dependencies.surfaces.uid)(`library_${type}`),
          // Exact containment is checked in the batch Worker before applying anything.
          contains: null,
        });
        if (!prepared.length) return { prepared };
        const countryFeatures = prepared.filter(item => item.type === 'country').map(item => {
          const feature = (0, dependencies.objectPicking.createCountryFeature)(item.name, [], null, item.geometry);
          feature.id = item.id;
          if (item.validFrom) feature.properties.validFrom = item.validFrom;
          if (item.validTo) feature.properties.validTo = item.validTo;
          return feature;
        });
        const units = prepared.filter(item => item.type !== 'country').map(item => (0, dependencies.territorialServicesA.createTerritorialFeature)({
          id: item.id, unitType: item.type, name: item.name, geometry: item.geometry,
          parentId: item.parentId, sovereignId: item.sovereignId,
          coverageMode: item.type === 'region' ? dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.EXPLICIT : dependencies.territorialModel.TERRITORIAL_COVERAGE_MODES.PARTITION,
          validFrom: item.validFrom, validTo: item.validTo,
          color: item.metadata?.defaultColor || '',
          metadata: item.metadata, sourceLibraryId: item.libraryId, sourceGeometryVersion: item.geometryVersionId,
        }));
        const response = await dependencies.spatialQuery.mapEditClient.execute('territorial-library-batch', { payload: { countries: countryFeatures, units } });
        return { descriptors, prepared, countryFeatures, units, batch: response.result, sourceRevision: response.sourceRevision };

      })().catch(error => { if (batchPreparation === entry) batchPreparation = null; throw error; });
    }
    const { descriptors, prepared, countryFeatures, units, batch, sourceRevision } = await batchPreparation.promise;
    assertCurrent();
    if (!prepared.length) return { added: 0, subtracted: 0, deleted: 0, affectedIds: [] };
    if (!dependencies.spatialQuery.mapEditClient.sourcesCurrent(sourceRevision)) {
      batchPreparation = null;
      throw new Error('프로젝트가 변경되었습니다. 추가할 항목을 다시 준비하세요.');
    }
    const patches = new Map(batch.features.map(feature => [String(feature.id), feature]));
    const removed = new Set(batch.removedIds);
    const existingIds = new Set(currentCountries.features.map(feature => String(feature.id)));
    const draft = { type: 'FeatureCollection', features: currentCountries.features.filter(feature => !removed.has(String(feature.id)))
      .map(feature => patches.get(String(feature.id)) || feature).concat(batch.features.filter(feature => !existingIds.has(String(feature.id)))) };
    const affectedIds = new Set(batch.affectedIds), donorIds = new Set(batch.donorIds);
    const transfers = batch.transfers, deleted = batch.deleted;
    const impacts = batch.impacts.map(impact => impact.expansion ? `${impact.name}: 소속 하위단위의 경계까지 국가 영토 확장`
      : `${impact.name}: ${impact.area.toLocaleString('ko', { maximumFractionDigits: 3 })} km² 이전${impact.deleted ? ' · 전체 영토 이전' : ''}`);
    const impactKey = JSON.stringify([revision, landRevision, rootIds, referenceDate, childDepth, versionOverrides, options.ownership || {}, impacts]);
    if (impacts.length && options.confirmedImpact !== impactKey) return { confirmationRequired: true, impactKey, impacts };
    assertCurrent();
    const countryOverrides = {};
    for (const item of prepared.filter(item => item.type === 'country')) {
      const override = {};
      if (item.metadata?.defaultColor) override.color = item.metadata.defaultColor;
      if (item.metadata?.defaultFlagDataUrl) override.flagDataUrl = item.metadata.defaultFlagDataUrl;
      countryOverrides[item.id] = override;
    }
    // Library entries usually merge through the GIS transaction, which also
    // handles replacements and territorial units.  A country-add can update
    // its donor boundaries, but it must not remove a country or add another
    // object kind.  Those cases keep the normal invalidation path so stale
    // boundaries cannot be retained.
    const preserveExistingScene = countryFeatures.length > 0
      && countryFeatures.length === prepared.length
      && !units.length
      && !deleted;
    const committer = await (0, dependencies.gisRuntime.getGisImportCommitter)();
    assertCurrent();
    const result = await committer.commitGisMerge({
      countriesData: { type: 'FeatureCollection', features: countryFeatures },
      preparedTerritorialUnits: units, landTransfers: transfers, assertCurrent,
      countryUpdates: Object.assign({}, ...prepared.map(item => item.instantiation?.countryUpdates || {})),
      atlasMetadata: { projectState: { countryOverrides } },
      sourceInfo: { imports: prepared.map(item => ({
        ...(item.metadata?.librarySourceInfo || {}), kind: 'library', sourceId: item.libraryId,
        objectId: item.id, sourceType: descriptors.find(original => original.libraryId === item.libraryId)?.type,
        geometryVersionId: item.geometryVersionId, referenceDate,
        originalParentLibraryId: item.parentLibraryId, originalSovereignLibraryId: item.sovereignLibraryId,
      })) },
      commitStatus: '라이브러리 항목과 소속 관계를 한 번의 작업으로 추가했습니다.',
    }, {
      countriesData: draft, affectedIds: [...affectedIds],
      counts: { added: prepared.length, subtracted: donorIds.size, deleted },
      countryPatchPresentation: preserveExistingScene ? 'preserve-existing-scene' : 'replace-scene',
    });
    (0, dependencies.layers.markLayerTreeDirty)();
    (0, dependencies.spatialRecords.scheduleMapObjectSpatialIndexRebuild)();
    if (!preserveExistingScene) dependencies.domains.renderingDomain?.invalidateProject?.('historical-library-import');
    dependencies.projectSession.saveState.markNewProject('content:0');
    batchPreparation = null;
    return result;
  }

  async function getHistoricalLibraryController() {
    if (historicalLibraryController) return historicalLibraryController;
    await Promise.all([(0, dependencies.libraryServices.ensureHistoricalRuntime)(), dependencies.gisRuntime.gisWorkflow.ensure(), (0, dependencies.applicationServicesA.ensureModalRuntime)()]);
    const { createHistoricalLibraryService } = dependencies.libraryServices.historicalLibraryServiceModule;
    const { createHistoricalLibraryController } = dependencies.libraryServices.historicalLibraryControllerModule;
    historicalLibraryService = createHistoricalLibraryService({
      dataUrl: dependencies.platformConfigurationA.HISTORICAL_LIBRARY_DATA_URL,
      fetchJson: async url => {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`라이브러리 HTTP ${response.status}`);
        return response.json();
      },
      getCountriesData: () => dependencies.projectState.state.countriesData,
      getMaterializationCountriesData: () => (0, dependencies.builtinCountries.materializePristineCountriesSync)(),
      displayName: dependencies.presentation.countryName,
      combineGeometries: combineHistoricalLibraryGeometries,
      subtractGeometries: subtractHistoricalLibraryGeometry,
    });
    LIBRARY_TYPE_LABELS = Object.freeze({
      [dependencies.applicationConstantsA.LIBRARY_ENTITY_TYPES.COUNTRY]: dependencies.objectCatalog.MAP_OBJECT_TYPES.country.label,
      [dependencies.applicationConstantsA.LIBRARY_ENTITY_TYPES.SUBUNIT]: dependencies.objectCatalog.MAP_OBJECT_TYPES.subunit.label,
      [dependencies.applicationConstantsA.LIBRARY_ENTITY_TYPES.REGION]: dependencies.objectCatalog.MAP_OBJECT_TYPES.region.label,
    });
    historicalLibraryController = createHistoricalLibraryController({
      document,
      elements: {
        open: null,
        modal: (0, dependencies.platform.$)('historicalLibraryModal'),
        card: document.querySelector('.historical-library-card'),
        close: (0, dependencies.platform.$)('historicalLibraryCloseBtn'),
        backdrop: (0, dependencies.platform.$)('historicalLibraryModal').querySelector('.ui-dialog-backdrop'),
        search: (0, dependencies.platform.$)('historicalLibrarySearchInput'),
        clearSearch: (0, dependencies.platform.$)('historicalLibrarySearchClearBtn'),
        type: (0, dependencies.platform.$)('historicalLibraryTypeInput'),
        status: (0, dependencies.platform.$)('historicalLibraryStatusInput'),
        year: (0, dependencies.platform.$)('historicalLibraryYearInput'),
        geographicRegion: (0, dependencies.platform.$)('historicalLibraryGeographicRegionInput'),
        results: (0, dependencies.platform.$)('historicalLibraryResults'),
        preview: (0, dependencies.platform.$)('historicalLibraryPreview'),
        snapshot: (0, dependencies.platform.$)('historicalLibrarySnapshotInput'),
        snapshotButton: (0, dependencies.platform.$)('historicalLibrarySnapshotBtn'),
        childDepth: (0, dependencies.platform.$)('historicalLibraryChildDepthInput'),
        add: (0, dependencies.platform.$)('historicalLibraryAddBtn'),
        addOptions: (0, dependencies.platform.$)('historicalLibraryAddOptions'),
        optionsBack: (0, dependencies.platform.$)('historicalLibraryOptionsBackBtn'),
        ownership: (0, dependencies.platform.$)('historicalLibraryOwnership'),
      },
      service: historicalLibraryService,
      typeLabels: LIBRARY_TYPE_LABELS,
      selectGeometryVersion: dependencies.applicationServicesB.selectGeometryVersion,
      renderMapPreview: historicalLibraryPreviewSvg,
      createEmptyState: dependencies.platformConfigurationB.createEmptyState,
      replaceSelectOptions: dependencies.propertyEditingB.replaceSelectOptions,
      shouldShowTerritorialParentChoice: dependencies.territorialServicesA.shouldShowTerritorialParentChoice,
      collator: dependencies.objectModelA.layerNameCollator,
      isMobile: dependencies.surfaces.isMobile,
      closeSurface: dependencies.workspaceUiA.closeSurface,
      focusSurfaceTrigger: dependencies.workspaceUiB.focusSurfaceTrigger,
      instantiate: instantiateHistoricalLibraryEntities,
      ownershipContext: (ids, year, depth, versions) => ({
        missing: (0, dependencies.libraryServices.missingLibraryOwnership)(historicalLibraryService.instantiateDescriptors(ids, year, depth, versions), libraryInstanceId, dependencies.projectState.state.countriesData.features, dependencies.projectState.state.territorialUnits),
        countries: (0, dependencies.propertyEditingB.territorialUnitCountryOptions)().filter(option => option.value),
        parents: id => (0, dependencies.territorialServicesA.subunitParentChoices)(id, dependencies.projectState.state.countriesData.features, dependencies.projectState.state.territorialUnits, { name: feature => feature.properties?.unitType ? (0, dependencies.objectPresentation.territorialUnitName)(feature) : (0, dependencies.presentation.countryName)(feature) }),
      }),
      confirm: dependencies.projectRestore.openConfirmModal,
      setStatus: dependencies.feedback.setActionStatus,
      reportError: dependencies.feedback.reportOperationError,
    });
    historicalLibraryController.connect();
    return historicalLibraryController;
  }

  function initializeHistoricalLibraryService() {
    (historicalLibraryService = null);

    (historicalLibraryController = null);

    (LIBRARY_TYPE_LABELS = Object.freeze({}));

    window.PANDOLAB_HISTORICAL_LIBRARY = Object.freeze({
      load: async () => { await getHistoricalLibraryController(); return historicalLibraryService.load(); },
      get: async id => { await getHistoricalLibraryController(); return historicalLibraryService.get(id); },
      list: async () => { await getHistoricalLibraryController(); return historicalLibraryService.list(); },
      search: async options => { await getHistoricalLibraryController(); return historicalLibraryService.search(options); },
      snapshots: async () => { await getHistoricalLibraryController(); return historicalLibraryService.snapshots(); },
      instantiate: async (id, referenceDate = '', childDepth = 'none', versionOverrides = {}) => {
        await getHistoricalLibraryController();
        return instantiateHistoricalLibraryEntities([id], referenceDate, childDepth, versionOverrides);
      },
    });
  }

  return Object.freeze({
    connect,
    initializeHistoricalLibraryService,
    get getHistoricalLibraryController() { return getHistoricalLibraryController; },
    get historicalLibraryController() { return historicalLibraryController; },
  });
}
