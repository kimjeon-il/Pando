import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { classifyBuiltinCountries } from '../../assets/js/modules/builtin-subunits.js';
import { matchesDefaultPreview, previewCountriesWithProjectProperties, previewSourceForProject, projectPreviewGeometryRows, PROJECT_PREVIEW_ALGORITHM_REVISION } from '../../assets/js/modules/project-preview-policy.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const canonical = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/world-preview-v0.33.0.json'), 'utf8'));
const baseline = { sourceSha256: manifest.sourceSha256, defaultClassification: manifest.defaultClassification };
const classified = classifyBuiltinCountries(canonical);
const changed = classified.countries.features.filter(feature => manifest.defaultClassification.changed[String(feature.id)]);
const removedIds = manifest.defaultClassification.removedIds;

function defaultProject() {
  return { format: 'pandolab-autosave-delta', countryDelta: { changed: structuredClone(changed), removedIds: [...removedIds] },
    territorialUnits: structuredClone(classified.subunits) };
}

test('built-in classification and display-only changes keep the shipped preview', () => {
  const project = defaultProject();
  assert.equal(matchesDefaultPreview(project, baseline), true);
  project.countryDelta.changed[0].properties.color = '#123456';
  project.territorialUnits[0].properties.name = 'Renamed';
  assert.equal(matchesDefaultPreview(project, baseline), true);
  project.countryDelta.changed.push(structuredClone(classified.countries.features.find(feature => feature.id === 'DEU')));
  project.countryDelta.changed.at(-1).properties.color = '#345678';
  assert.equal(matchesDefaultPreview(project, baseline), true);
  assert.equal(previewSourceForProject(project, baseline, null).kind, 'default');
});

test('edited borders, ownership, country creation and deletion cannot use shipped geometry', () => {
  const border = defaultProject();
  border.countryDelta.changed[0].geometry.coordinates[0][0][0][0] += 0.1;
  assert.equal(matchesDefaultPreview(border, baseline), false);
  const parent = defaultProject();
  parent.territorialUnits[0].properties.parentId = 'RUS';
  assert.equal(matchesDefaultPreview(parent, baseline), false);
  const removal = defaultProject();
  removal.countryDelta.removedIds.push('RUS');
  assert.equal(matchesDefaultPreview(removal, baseline), false);
  const addition = defaultProject();
  addition.countryDelta.changed.push({ type: 'Feature', id: 'NEW', geometry: changed[0].geometry });
  assert.equal(matchesDefaultPreview(addition, baseline), false);
});

test('full saved geometry uses the shipped preview only when it is exactly the default classification', () => {
  const project = { countriesData: classified.countries, territorialUnits: classified.subunits };
  assert.equal(matchesDefaultPreview(project, baseline), true);
  project.countriesData.features.pop();
  assert.equal(matchesDefaultPreview(project, baseline), false);
});

test('custom geometry uses a matching project cache, otherwise waits for exact restoration', () => {
  const project = defaultProject();
  project.countryDelta.changed[0].geometry.coordinates[0][0][0][0] += 0.1;
  assert.equal(previewSourceForProject(project, baseline, null).kind, 'restore');
  const cache = { algorithmRevision: PROJECT_PREVIEW_ALGORITHM_REVISION,
    baseSourceSha256: baseline.sourceSha256, geometryKey: 'key',
    countries: { features: [] }, territorialUnits: [], mesh: { positions: new Int32Array() } };
  assert.equal(previewSourceForProject(project, baseline, cache).kind, 'project');
  cache.baseSourceSha256 = 'old';
  assert.equal(previewSourceForProject(project, baseline, cache).kind, 'restore');
});

test('geometry cache identity ignores presentation but changes with shapes and ownership', () => {
  const original = defaultProject();
  const rows = JSON.stringify(projectPreviewGeometryRows(original));
  const presentation = structuredClone(original);
  presentation.countryDelta.changed[0].properties.name = 'Color only';
  presentation.territorialUnits[0].properties.color = '#123456';
  presentation.view = { zoom: 99 };
  assert.equal(JSON.stringify(projectPreviewGeometryRows(presentation)), rows);
  presentation.territorialUnits[0].properties.parentId = 'RUS';
  assert.notEqual(JSON.stringify(projectPreviewGeometryRows(presentation)), rows);
  presentation.territorialUnits[0].properties.parentId = original.territorialUnits[0].properties.parentId;
  presentation.countryDelta.changed[0].geometry.coordinates[0][0][0][0] += 0.1;
  assert.notEqual(JSON.stringify(projectPreviewGeometryRows(presentation)), rows);
});

test('saved country properties replace cache properties without replacing its geometry', () => {
  const project = defaultProject();
  const country = project.countryDelta.changed[0];
  country.properties.color = '#123456';
  const preview = { type: 'FeatureCollection', features: [{ ...country,
    properties: { color: '#abcdef' }, geometry: { type: 'Polygon', coordinates: [] } }] };
  const result = previewCountriesWithProjectProperties(preview, project);
  assert.equal(result.features[0].properties.color, '#123456');
  assert.equal(result.features[0].geometry, preview.features[0].geometry);
});
