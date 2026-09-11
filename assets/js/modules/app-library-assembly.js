/** LibraryAssembly: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createLibraryAssembly() {
  let dependencies;
  let historicalLibraryService;
  let historicalLibraryController;
  let LIBRARY_TYPE_LABELS;
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
    return (0, dependencies.normalizeClippedLandGeometry)(union);
  }

  function subtractHistoricalLibraryGeometry(geometry, excludedGeometry) {
    if (!geometry?.coordinates || !excludedGeometry?.coordinates) return null;
    return (0, dependencies.normalizeClippedLandGeometry)(window.polygonClipping.difference(
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
    const projection = dependencies.d3.geo.equirectangular().scale(1).translate([0, 0]);
    const previewPath = dependencies.d3.geo.path().projection(projection);
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
    if (currentCountryId && (0, dependencies.countryFeatureById)(currentCountryId)) return currentCountryId;
    if ((0, dependencies.countryFeatureById)(libraryId)) return String(libraryId);
    const unit = dependencies.state.territorialUnits.find(feature => String(feature.properties?.sourceLibraryId || '') === String(libraryId));
    return unit ? String(unit.id) : '';
  }

  async function instantiateHistoricalLibraryEntities(rootIds, referenceDate, childDepth = 'none', versionOverrides = {}, options = {}) {
    const revision = dependencies.state.stateRevision;
    const landRevision = dependencies.countryLandRevision;
    const currentCountries = dependencies.state.countriesData;
    const assertCurrent = () => {
      if (options.isCurrent?.() === false || dependencies.state.stateRevision !== revision || dependencies.countryLandRevision !== landRevision || dependencies.state.countriesData !== currentCountries) {
        throw new Error('프로젝트 또는 선택이 변경되었습니다. 항목과 소속을 다시 확인하세요.');
      }
    };
    for (const [id, versionId] of Object.entries(versionOverrides)) {
      if (!historicalLibraryService.get(id)?.geometryVersions?.some(version => version.id === versionId)) {
        throw new Error('선택한 경계 버전을 찾을 수 없습니다.');
      }
    }
    const descriptors = historicalLibraryService.instantiateDescriptors(rootIds, referenceDate, childDepth, versionOverrides);
    const prepared = (0, dependencies.prepareLibraryOwnership)({
      descriptors, resolve: libraryInstanceId, countries: dependencies.state.countriesData.features,
      units: dependencies.state.territorialUnits, choices: options.ownership || {},
      allocateId: type => (0, dependencies.uid)(`library_${type}`),
      contains: (geometry, container) => (0, dependencies.territorialUnitInsideContainer)({ geometry }, { geometry: container }),
    });
    if (!prepared.length) return { added: 0, subtracted: 0, deleted: 0, affectedIds: [] };
    const countryFeatures = prepared.filter(item => item.type === 'country').map(item => {
      const feature = (0, dependencies.createCountryFeature)(item.name, [], null, item.geometry);
      feature.id = item.id;
      if (item.validFrom) feature.properties.validFrom = item.validFrom;
      if (item.validTo) feature.properties.validTo = item.validTo;
      return feature;
    });
    const units = prepared.filter(item => item.type !== 'country').map(item => (0, dependencies.createTerritorialFeature)({
      id: item.id, unitType: item.type, name: item.name, geometry: item.geometry,
      parentId: item.parentId, sovereignId: item.sovereignId, adminLevel: item.adminLevel,
      coverageMode: item.type === 'region' ? dependencies.TERRITORIAL_COVERAGE_MODES.EXPLICIT : dependencies.TERRITORIAL_COVERAGE_MODES.PARTITION,
      isRemainder: false, validFrom: item.validFrom, validTo: item.validTo,
      color: item.metadata?.defaultColor || '',
      metadata: item.metadata, sourceLibraryId: item.libraryId, sourceGeometryVersion: item.geometryVersionId,
    }));
    let draft = (0, dependencies.deepClone)(dependencies.state.countriesData);
    const affectedIds = new Set();
    const transfers = [];
    const impacts = [];
    const donorIds = new Set();
    let deleted = 0;
    async function merge(incoming, targetId, geometry) {
      const plan = await dependencies.gisWorkflow.planMerge(draft, { type: 'FeatureCollection', features: incoming }, 'territory-replacement');
      assertCurrent();
      if (!plan.canCommit) throw new Error('영토 변경 후 국가 간 중첩이 남아 추가할 수 없습니다.');
      for (const id of plan.affectedIds || []) {
        if ((0, dependencies.isCountryLocked)(id)) throw new Error(`${(0, dependencies.countryName)((0, dependencies.countryFeatureById)(id))}이(가) 잠겨 있어 영토를 변경할 수 없습니다.`);
        affectedIds.add(id);
      }
      for (const id of plan.donorIds || []) {
        donorIds.add(id);
        const before = draft.features.find(feature => String(feature.id) === id);
        const after = plan.countriesData.features.find(feature => String(feature.id) === id);
        const area = (0, dependencies.sphericalGeometryAreaKm2)(before.geometry) - (after ? (0, dependencies.sphericalGeometryAreaKm2)(after.geometry) : 0);
        impacts.push(`${(0, dependencies.countryName)(before)}: ${area.toLocaleString('ko', { maximumFractionDigits: 3 })} km² 이전${after ? '' : ' · 전체 영토 이전'}`);
      }
      deleted += Number(plan.counts?.deleted || 0);
      transfers.push({ targetId, geometry, donorIds: plan.donorIds || [] });
      draft = plan.countriesData;
    }
    // Prepare every country and child before committing any of them.
    for (const feature of countryFeatures) await merge([feature], String(feature.id), feature.geometry);
    const unitIds = new Set(units.map(unit => String(unit.id)));
    const roots = units.filter(unit => unit.properties.unitType === 'subunit' && !unitIds.has(String(unit.properties.parentId)));
    const groups = new Map();
    for (const unit of roots) {
      const id = String(unit.properties.sovereignId);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(unit.geometry);
    }
    for (const [id, geometries] of groups) {
      const owner = draft.features.find(feature => String(feature.id) === id);
      if (!owner) throw new Error('소속 국가가 영토 변경으로 사라집니다. 소속을 다시 선택하세요.');
      const geometry = combineHistoricalLibraryGeometries(geometries);
      if ((0, dependencies.territorialUnitInsideContainer)({ geometry }, owner)) continue;
      const expanded = { ...owner, geometry: combineHistoricalLibraryGeometries([owner.geometry, geometry]) };
      impacts.push(`${(0, dependencies.countryName)(owner)}: 소속 하위단위의 경계까지 국가 영토 확장`);
      await merge([expanded], id, geometry);
    }
    const draftById = new Map([...draft.features, ...dependencies.state.territorialUnits, ...units].map(feature => [String(feature.id), feature]));
    for (const unit of units.filter(feature => feature.properties.unitType === 'subunit')) {
      const parent = draftById.get(String(unit.properties.parentId));
      if (!parent || !draft.features.some(feature => String(feature.id) === String(unit.properties.sovereignId))) throw new Error('추가 후 소속 관계가 유효하지 않습니다.');
      if (!(0, dependencies.territorialUnitInsideContainer)(unit, parent)) throw new Error(`${unit.properties.name}의 경계가 상위 소속 안에 포함되지 않습니다. 적합한 상위 소속을 선택하세요.`);
    }
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
    const committer = await (0, dependencies.getGisImportCommitter)();
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
    });
    (0, dependencies.markLayerTreeDirty)();
    (0, dependencies.scheduleMapObjectSpatialIndexRebuild)();
    dependencies.renderingDomain?.invalidateProject?.('historical-library-import');
    dependencies.saveState.markNewProject('content:0');
    return result;
  }

  async function getHistoricalLibraryController() {
    if (historicalLibraryController) return historicalLibraryController;
    await Promise.all([(0, dependencies.ensureHistoricalRuntime)(), dependencies.gisWorkflow.ensure(), (0, dependencies.ensureModalRuntime)()]);
    const { createHistoricalLibraryService } = dependencies.historicalLibraryServiceModule;
    const { createHistoricalLibraryController } = dependencies.historicalLibraryControllerModule;
    historicalLibraryService = createHistoricalLibraryService({
      dataUrl: dependencies.HISTORICAL_LIBRARY_DATA_URL,
      fetchJson: async url => {
        const response = await fetch(url, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`라이브러리 HTTP ${response.status}`);
        return response.json();
      },
      getCountriesData: () => dependencies.state.countriesData,
      getMaterializationCountriesData: () => (0, dependencies.materializePristineCountriesSync)(),
      displayName: dependencies.countryName,
      combineGeometries: combineHistoricalLibraryGeometries,
      subtractGeometries: subtractHistoricalLibraryGeometry,
    });
    LIBRARY_TYPE_LABELS = Object.freeze({
      [dependencies.LIBRARY_ENTITY_TYPES.COUNTRY]: dependencies.MAP_OBJECT_TYPES.country.label,
      [dependencies.LIBRARY_ENTITY_TYPES.SUBUNIT]: dependencies.MAP_OBJECT_TYPES.subunit.label,
      [dependencies.LIBRARY_ENTITY_TYPES.REGION]: dependencies.MAP_OBJECT_TYPES.region.label,
    });
    historicalLibraryController = createHistoricalLibraryController({
      document,
      elements: {
        open: null,
        modal: (0, dependencies.$)('historicalLibraryModal'),
        card: document.querySelector('.historical-library-card'),
        close: (0, dependencies.$)('historicalLibraryCloseBtn'),
        backdrop: (0, dependencies.$)('historicalLibraryModal').querySelector('.ui-dialog-backdrop'),
        search: (0, dependencies.$)('historicalLibrarySearchInput'),
        clearSearch: (0, dependencies.$)('historicalLibrarySearchClearBtn'),
        type: (0, dependencies.$)('historicalLibraryTypeInput'),
        status: (0, dependencies.$)('historicalLibraryStatusInput'),
        year: (0, dependencies.$)('historicalLibraryYearInput'),
        geographicRegion: (0, dependencies.$)('historicalLibraryGeographicRegionInput'),
        results: (0, dependencies.$)('historicalLibraryResults'),
        preview: (0, dependencies.$)('historicalLibraryPreview'),
        snapshot: (0, dependencies.$)('historicalLibrarySnapshotInput'),
        snapshotButton: (0, dependencies.$)('historicalLibrarySnapshotBtn'),
        childDepth: (0, dependencies.$)('historicalLibraryChildDepthInput'),
        add: (0, dependencies.$)('historicalLibraryAddBtn'),
        addOptions: (0, dependencies.$)('historicalLibraryAddOptions'),
        optionsBack: (0, dependencies.$)('historicalLibraryOptionsBackBtn'),
        ownership: (0, dependencies.$)('historicalLibraryOwnership'),
      },
      service: historicalLibraryService,
      typeLabels: LIBRARY_TYPE_LABELS,
      selectGeometryVersion: dependencies.selectGeometryVersion,
      renderMapPreview: historicalLibraryPreviewSvg,
      createEmptyState: dependencies.createEmptyState,
      replaceSelectOptions: dependencies.replaceSelectOptions,
      collator: dependencies.layerNameCollator,
      isMobile: dependencies.isMobile,
      closeCreateMenu: dependencies.closeCreateMenu,
      instantiate: instantiateHistoricalLibraryEntities,
      ownershipContext: (ids, year, depth, versions) => ({
        missing: (0, dependencies.missingLibraryOwnership)(historicalLibraryService.instantiateDescriptors(ids, year, depth, versions), libraryInstanceId, dependencies.state.countriesData.features, dependencies.state.territorialUnits),
        countries: (0, dependencies.territorialUnitCountryOptions)().filter(option => option.value),
        parents: id => (0, dependencies.subunitParentChoices)(id, dependencies.state.countriesData.features, dependencies.state.territorialUnits, { name: feature => feature.properties?.unitType ? (0, dependencies.territorialUnitName)(feature) : (0, dependencies.countryName)(feature) }),
      }),
      confirm: dependencies.openConfirmModal,
      setStatus: dependencies.setActionStatus,
      reportError: dependencies.reportOperationError,
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
