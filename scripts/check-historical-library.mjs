import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { validateGeometry } from '../assets/js/modules/geometry-validation.js';
import { materializePilotEntities } from '../assets/js/modules/historical-library.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');

function loadClassic(relativePath, globalName) {
  const filePath = path.join(root, relativePath);
  vm.runInThisContext(fs.readFileSync(filePath, 'utf8'), { filename: filePath });
  if (!globalThis[globalName]) throw new Error(`Could not load ${globalName} from ${relativePath}`);
  return globalThis[globalName];
}

const polygonClipping = loadClassic(path.join('assets', 'js', 'vendor', 'polygon-clipping.min.js'), 'polygonClipping');
const countryGeometry = loadClassic(path.join('assets', 'js', 'modules', 'country-geometry.js'), 'PandoLabCountryGeometry');
const countries = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'data', 'countries-ne-5.1.1.geojson'), 'utf8'));
const library = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'data', 'historical-library-pilot.json'), 'utf8'));
const historicalCountries = library.entities.filter(item => item.type === 'country');
for (const historicalCountry of historicalCountries) {
  if (historicalCountry.instantiation?.mode !== 'territory-replacement') {
    throw new Error(`${historicalCountry.libraryId} must use the unified territory-replacement mode`);
  }
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const left = ring[index];
    const right = ring[previous];
    if ((left[1] > y) !== (right[1] > y)
      && x < (right[0] - left[0]) * (y - left[1]) / ((right[1] - left[1]) || Number.EPSILON) + left[0]) inside = !inside;
  }
  return inside;
}
function geometryCovers(point, geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(polygon => pointInRing(point, polygon[0]) && polygon.slice(1).every(ring => !pointInRing(point, ring)));
}
const combineGeometries = geometries => {
  const coordinates = geometries.length === 1
    ? (geometries[0].type === 'Polygon' ? [geometries[0].coordinates] : geometries[0].coordinates)
    : polygonClipping.union(...geometries.map(geometry => geometry.coordinates));
  return countryGeometry.normalizeCountryGeometry(coordinates);
};
const subtractGeometries = (geometry, excluded) => countryGeometry.normalizeCountryGeometry(
  polygonClipping.difference(geometry.coordinates, excluded.coordinates),
);
const materializedEntities = materializePilotEntities(
  library.entities,
  countries,
  combineGeometries,
  subtractGeometries,
);
const materializedById = new Map(materializedEntities.map(item => [item.libraryId, item]));
const supplementalHistoricalChecks = [
  {
    id: 'historical-country:east-prussia',
    version: 'ostpreussen-1878-1920-r3',
    points: [[20.51, 54.71], [21.13, 55.71], [21.48, 55.35], [21.91, 55.14], [21.00, 55.30], [20.18, 53.24]],
    outside: [[18.65, 54.35], [23.9, 54.9]],
  },
  {
    id: 'historical-country:north-schleswig',
    version: 'north-schleswig-1900-r3',
    points: [[9.417, 55.044], [9.483, 55.25], [8.867, 54.933]],
  },
  {
    id: 'historical-country:ukraine',
    version: 'historical-country:ukraine:1991-2014-r1',
    points: [[34.1, 44.95], [36.2, 45.3]],
  },
  {
    id: 'historical-country:yugoslavia',
    versions: [
      {
        id: 'historical-country:kingdom-of-yugoslavia:1918-1941-r1',
        points: [[20.46, 44.81], [15.98, 45.81], [18.41, 43.86], [21.43, 42.0], [21.17, 42.66], [19.26, 42.44]],
      },
      {
        id: 'historical-country:sfr-yugoslavia:1945-1992-r1',
        points: [[20.46, 44.81], [15.98, 45.81], [18.41, 43.86], [21.43, 42.0], [21.17, 42.66], [19.26, 42.44]],
      },
      {
        id: 'historical-country:federal-republic-of-yugoslavia:1992-2003-r1',
        points: [[20.46, 44.81], [21.17, 42.66], [19.26, 42.44]],
        outside: [[15.98, 45.81]],
      },
    ],
  },
  {
    id: 'historical-country:sudan',
    version: 'historical-country:sudan:1956-2011-r1',
    points: [[32.56, 15.5], [31.58, 4.85]],
  },
  {
    id: 'historical-country:indonesia',
    version: 'historical-country:indonesia:1945-2002-r1',
    points: [[106.82, -6.18], [125.57, -8.56]],
  },
];
for (const check of supplementalHistoricalChecks) {
  const definition = library.entities.find(item => item.libraryId === check.id);
  if (!definition) throw new Error(`Supplemental historical country is missing: ${check.id}`);
  if (definition.type !== 'country' || definition.instantiation?.mode !== 'territory-replacement') {
    throw new Error(`${check.id} must use the unified territory-replacement country mode`);
  }
  const materialized = materializedById.get(check.id);
  const versions = check.versions || [{ id: check.version, points: check.points, outside: check.outside }];
  for (const expectedVersion of versions) {
    const version = definition.geometryVersions?.find(item => item.id === expectedVersion.id);
    if (!version) throw new Error(`${check.id} geometry version is missing: ${expectedVersion.id}`);
    const geometry = materialized?.geometryVersions?.find(item => item.id === expectedVersion.id)?.geometry;
    if (!geometry) throw new Error(`${check.id} could not be materialized: ${expectedVersion.id}`);
    const issues = validateGeometry({
      type: 'Feature', id: check.id,
      properties: { name: definition.displayNames?.ko || definition.canonicalName },
      geometry,
    });
    if (issues.length) throw new Error(`${expectedVersion.id} fails app geometry validation: ${issues[0].message}`);
    for (const point of expectedVersion.points || []) {
      if (!geometryCovers(point, geometry)) throw new Error(`${expectedVersion.id} does not cover representative point ${point.join(',')}`);
    }
    for (const point of expectedVersion.outside || []) {
      if (geometryCovers(point, geometry)) throw new Error(`${expectedVersion.id} unexpectedly covers outside point ${point.join(',')}`);
    }
  }
}
const polygonArea = polygon => Math.max(0, Math.abs(countryGeometry.ringSignedArea(polygon[0] || []))
  - polygon.slice(1).reduce((sum, ring) => sum + Math.abs(countryGeometry.ringSignedArea(ring)), 0));
const geometryArea = geometry => (geometry?.type === 'Polygon' ? [geometry.coordinates] : (geometry?.coordinates || []))
  .reduce((sum, polygon) => sum + polygonArea(polygon), 0);
const entity = library.entities.find(item => item.libraryId === 'historical-country:deutsche-demokratische-republik');
if (!entity) throw new Error('East Germany historical library entity is missing');
const nagornoEntity = library.entities.find(item => item.libraryId === 'historical-country:nagorno-karabakh');
if (!nagornoEntity) throw new Error('Nagorno-Karabakh historical library entity is missing');
if (nagornoEntity.geometryVersions?.length !== 2) throw new Error('Nagorno-Karabakh must have two date-specific geometry versions');
if (nagornoEntity.instantiation?.mode !== 'territory-replacement') throw new Error('Nagorno-Karabakh must use territory-replacement');
if (!String(nagornoEntity.metadata?.defaultFlagDataUrl || '').startsWith('data:image/svg+xml;base64,')) throw new Error('Nagorno-Karabakh flag asset is missing');
for (const versionId of ['historical-country:nagorno-karabakh:1991-2020-r1', 'historical-country:nagorno-karabakh:2020-2023-r1']) {
  const version = nagornoEntity.geometryVersions.find(candidate => candidate.id === versionId);
  if (!version) throw new Error(`Nagorno-Karabakh geometry version is missing: ${versionId}`);
  const feature = { type: 'Feature', id: 'historical-country:nagorno-karabakh', properties: { name: nagornoEntity.displayNames?.ko || nagornoEntity.canonicalName }, geometry: version.geometry };
  const issues = validateGeometry(feature);
  if (issues.length) throw new Error(`${versionId} fails app geometry validation: ${issues[0].message}`);
}
const sovietEntity = library.entities.find(item => item.libraryId === 'historical-country:soviet-union');
const sovietGeometry = sovietEntity?.geometryVersions?.[0]?.geometry;
if (!sovietGeometry) throw new Error('Soviet Union must have an inline geometry for the Baikonur lease area');
const sovietIssues = validateGeometry({ type: 'Feature', id: 'historical-country:soviet-union', properties: { name: '소련' }, geometry: sovietGeometry });
if (sovietIssues.length) throw new Error(`Soviet Union fails app geometry validation: ${sovietIssues[0].message}`);
if (!geometryCovers([63.3, 45.92], sovietGeometry)) throw new Error('Soviet Union geometry does not include Baikonur');
if (!String(sovietEntity.metadata?.defaultFlagDataUrl || '').startsWith('data:image/svg+xml;base64,')) {
  throw new Error('Soviet Union flag asset is missing');
}
const sovietChildren = library.entities.filter(item => item.parentLibraryId === 'historical-country:soviet-union');
if (sovietChildren.length !== 15) throw new Error(`Soviet Union must have 15 constituent republics, found ${sovietChildren.length}`);
const sovietChildGeometries = [];
for (const child of sovietChildren) {
  if (child.type !== 'subunit' || child.sovereignLibraryId !== 'historical-country:soviet-union' || Object.hasOwn(child, 'adminLevel')) {
    throw new Error(`${child.libraryId} has an invalid Soviet constituent hierarchy`);
  }
  const flag = String(child.metadata?.defaultFlagDataUrl || '');
  if (!flag.startsWith('data:image/svg+xml;base64,') || !Buffer.from(flag.slice(flag.indexOf(',') + 1), 'base64').toString('utf8').includes('<svg')) {
    throw new Error(`${child.libraryId} flag asset is missing or invalid`);
  }
  const materialized = materializedById.get(child.libraryId);
  if (!materialized?.geometryVersions?.[0]?.geometry) throw new Error(`${child.libraryId} could not be materialized`);
  sovietChildGeometries.push([child.libraryId, materialized.geometryVersions[0].geometry]);
  const issues = validateGeometry({
    type: 'Feature', id: child.libraryId, properties: { name: child.displayNames?.ko || child.canonicalName },
    geometry: materialized.geometryVersions[0].geometry,
  });
  if (issues.length) throw new Error(`${child.libraryId} fails app geometry validation: ${issues[0].message}`);
}
for (let leftIndex = 0; leftIndex < sovietChildGeometries.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < sovietChildGeometries.length; rightIndex += 1) {
    const [leftId, leftGeometry] = sovietChildGeometries[leftIndex];
    const [rightId, rightGeometry] = sovietChildGeometries[rightIndex];
    const overlap = countryGeometry.normalizeCountryGeometry(polygonClipping.intersection(
      leftGeometry.coordinates,
      rightGeometry.coordinates,
    ));
    if (geometryArea(overlap) > 1e-10) throw new Error(`Soviet republics overlap: ${leftId} / ${rightId}`);
  }
}
const sovietChildrenUnion = combineGeometries(sovietChildGeometries.map(([, geometry]) => geometry));
const missingFromChildren = subtractGeometries(sovietGeometry, sovietChildrenUnion);
const outsideParent = subtractGeometries(sovietChildrenUnion, sovietGeometry);
if (geometryArea(missingFromChildren) > 1e-10 || geometryArea(outsideParent) > 1e-10) {
  throw new Error('Soviet republic children do not form the same territory as the Soviet Union parent');
}
const russianRepublic = materializedById.get('historical-subunit:soviet-union:russian-sfsr').geometryVersions[0].geometry;
const ukrainianRepublic = materializedById.get('historical-subunit:soviet-union:ukrainian-ssr').geometryVersions[0].geometry;
const kazakhRepublic = materializedById.get('historical-subunit:soviet-union:kazakh-ssr').geometryVersions[0].geometry;
if (!geometryCovers([34.1, 44.95], ukrainianRepublic) || geometryCovers([34.1, 44.95], russianRepublic)) {
  throw new Error('Crimea must belong to the Ukrainian SSR and be excluded from the Russian SFSR');
}
if (!geometryCovers([63.3, 45.92], kazakhRepublic)) throw new Error('Kazakh SSR geometry does not include Baikonur');
const geometry = entity.geometryVersions?.[0]?.geometry;
const eastGermany = { type: 'Feature', id: 'HIST_GDR', properties: { name: '동독' }, geometry };
const germany = countries.features.find(feature => feature.id === 'DEU');
if (!germany) throw new Error('Canonical DEU feature is missing');

const eastIssues = validateGeometry(eastGermany);
if (eastIssues.length) throw new Error(`East Germany fails app geometry validation: ${eastIssues[0].message}`);
const remainderCoordinates = polygonClipping.difference(germany.geometry.coordinates, geometry.coordinates);
const remainderGeometry = countryGeometry.normalizeCountryGeometry(remainderCoordinates);
const remainder = { type: 'Feature', id: 'DEU', properties: { name: '독일' }, geometry: remainderGeometry };
const remainderIssues = validateGeometry(remainder);
if (remainderIssues.length) throw new Error(`Subtracted Germany fails app geometry validation: ${remainderIssues[0].message}`);
const overlap = polygonClipping.intersection(geometry.coordinates, remainderGeometry.coordinates);
if (overlap.length) throw new Error('East Germany and subtracted Germany retain polygon overlap');

const aliases = new Set([entity.canonicalName, ...Object.values(entity.displayNames || {}), ...(entity.alternateNames || [])]);
for (const required of ['동독', '독일 민주공화국', 'East Germany', 'DDR', 'GDR', 'Ostdeutschland']) {
  if (!aliases.has(required)) throw new Error(`East Germany search alias is missing: ${required}`);
}
if (entity.instantiation?.mode !== 'territory-replacement'
  || entity.instantiation?.countryUpdates?.DEU?.name !== '독일 연방공화국') {
  throw new Error('East Germany territory-replacement instantiation policy is missing');
}

console.log(`Historical library OK: ${library.entities.length} entries; 15 Soviet republics, flags, Crimea/Baikonur adjustments, East Germany, Nagorno-Karabakh, and DEU remainder pass app validation.`);
