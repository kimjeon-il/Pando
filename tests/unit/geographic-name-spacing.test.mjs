import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { normalizeCountryFeature } from '../../assets/js/modules/country-feature.js';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';

const data = new URL('../../assets/data/', import.meta.url);
const version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url))).version;
const canonical = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson', data)));
const preview = JSON.parse(gunzipSync(fs.readFileSync(new URL(`countries-preview-v${version}.geojson.gz`, data))));

test('default compound geographic names are compact in source, preview and current library', () => {
  const library = readTerritorialSources();
  for (const [id, name] of [
    ['MHL', '마셜제도'], ['TCA', '터크스케이커스제도'], ['HMD', '허드맥도널드제도'],
    ['SGS', '사우스조지아사우스샌드위치제도'], ['UMI', '미국령군소제도'],
    ['BJN', '바호누에보환초'], ['SER', '세라니야환초'], ['SCR', '스카버러암초'],
    ['KAS', '시아첸빙하'], ['SPI', '남부파타고니아빙원'],
    ['BIH', '보스니아헤르체고비나'], ['GNQ', '적도기니'], ['BRT', '비르타윌'],
    ['TUR', '튀르키예'], ['ESP', '에스파냐'],
  ]) {
    for (const collection of [canonical, preview]) {
      const feature = collection.features.find(item => item.id === id);
      assert.equal(feature.properties.name, name, `${id} asset`);
      assert.equal(normalizeCountryFeature(feature).properties.name, name, `${id} runtime`);
    }
    assert.equal(library.find(item => item.metadata.sourceFeatureId === id).names.ko, name, `${id} library`);
  }
});

test('GIS and user-assigned names are literal even when they resemble retired display defaults', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  for (const [id, name] of [['ALD', '올란드 제도'], ['TUR', '터키'], ['custom', '내가 만든 제도']]) {
    assert.equal(normalizeCountryFeature({ type: 'Feature', id, properties: { name }, geometry }).properties.name, name);
  }
});

test('built-in Korean hydronyms use compact names in every render fragment', () => {
  const core = JSON.parse(gunzipSync(fs.readFileSync(new URL('hydro/v0.13.1/metadata-core.json.gz', data))));
  for (const feature of core.features) {
    for (const key of ['name', 'mainstemNameKo']) {
      const name = feature[key];
      if (!name || !/[가-힣]/.test(name) || /^미명명/.test(name)) continue;
      assert.equal(/\s/.test(name), false, `${feature.awId} ${key}: ${name}`);
    }
  }
});

test('reusable hydro source names are compact without altering source-language names', () => {
  for (const filename of ['rivers_base.geojson', 'lakes_base.geojson']) {
    const collection = JSON.parse(fs.readFileSync(new URL(`hydro/${filename}`, data)));
    for (const feature of collection.features) {
      for (const key of ['name', 'name_ko']) {
        const name = feature.properties[key];
        if (!name || !/[가-힣]/.test(name) || /^미명명/.test(name)) continue;
        assert.equal(/\s/.test(name), false, `${filename} ${feature.properties.pandolab_id} ${key}: ${name}`);
      }
    }
  }
});
