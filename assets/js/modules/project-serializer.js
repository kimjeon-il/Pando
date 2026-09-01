function cloneCountryFeature(feature, clone) {
  return clone(feature);
}

function modelContracts({ genericFeatureSchemaVersion, distributionSchemaVersion, distributionTypes, distributionModes }, compact = false) {
  return {
    landObjectModel: {
      schemaVersion: genericFeatureSchemaVersion,
      coastlineAuthority: 'countries',
      ...(compact ? {} : { roles: ['hydro', 'thematic', 'generic'] }),
    },
    territorialModel: {
      schemaVersion: 1,
      coastlineAuthority: 'countriesData',
      countryStorage: 'countriesData-adapter',
      types: ['country', 'territory', 'admin', 'region'],
      coverageModes: ['partition', 'explicit'],
    },
    distributionModel: {
      schemaVersion: distributionSchemaVersion,
      types: [...distributionTypes],
      sourceModes: [...distributionModes],
      shareRange: [0, 100],
      sharesAreIndependent: true,
    },
  };
}

export function createProjectSerializer({
  schemaVersion,
  appVersion,
  baseDataset,
  genericFeatureSchemaVersion,
  distributionSchemaVersion,
  distributionTypes,
  distributionModes,
  terrainDataset,
  hydroDataset,
  readSnapshot,
  now = () => new Date(),
}) {
  const contracts = { genericFeatureSchemaVersion, distributionSchemaVersion, distributionTypes, distributionModes };

  function buildProject(snapshot = readSnapshot()) {
    return {
      format: 'pandolab-project-state',
      schemaVersion,
      version: appVersion,
      savedAt: now().toISOString(),
      countriesData: snapshot.countriesData,
      ...snapshot.projectFields,
      baseDataset,
      ...modelContracts(contracts),
      physicalSourceInfo: {
        terrain: {
          dataset: snapshot.terrainManifest?.dataset || terrainDataset,
          version: snapshot.terrainManifest?.version || '0.12.6',
        },
        hydro: {
          dataset: snapshot.hydroManifest?.dataset || hydroDataset,
          version: snapshot.hydroManifest?.version || appVersion,
          coordinatePolicy: snapshot.hydroManifest?.coordinatePolicy || 'selected source coordinates retained without simplification',
          selection: structuredClone(snapshot.hydroManifest?.selection || {}),
        },
      },
    };
  }

  function buildAutosave() {
    const snapshot = readSnapshot();
    if (snapshot.fullAutosave) return { ...buildProject(snapshot), format: 'pandolab-autosave-full' };
    return {
      format: 'pandolab-autosave-delta',
      schemaVersion,
      version: appVersion,
      savedAt: now().toISOString(),
      countryDelta: snapshot.countryDelta,
      ...snapshot.projectFields,
      baseDataset,
      ...modelContracts(contracts, true),
    };
  }

  return Object.freeze({ buildProject, buildAutosave });
}

export function restoreCountriesFromDelta(project, {
  base,
  clone = structuredClone,
  reindex,
  applyPristineLabelAnchors,
}) {
  const delta = project?.countryDelta || { changed: [], removedIds: [] };
  const changed = new Map((delta.changed || []).map(feature => [String(feature.properties?.editor_id || feature.properties?.iso_a3 || ''), feature]));
  const removed = new Set((delta.removedIds || []).map(String));
  const seen = new Set();
  base.features = (base.features || []).filter(feature => {
    const id = String(feature.properties?.editor_id || feature.properties?.iso_a3 || '');
    return !removed.has(id);
  }).map(feature => {
    const id = String(feature.properties?.editor_id || feature.properties?.iso_a3 || '');
    if (!changed.has(id)) return feature;
    seen.add(id);
    return cloneCountryFeature(changed.get(id), clone);
  });
  for (const [id, feature] of changed) if (!seen.has(id) && !removed.has(id)) base.features.push(cloneCountryFeature(feature, clone));
  const result = reindex(base);
  const unchangedIds = (result.features || []).map(feature => String(feature.properties?.editor_id || '')).filter(id => !changed.has(id));
  applyPristineLabelAnchors(result, unchangedIds);
  return result;
}
