import assert from 'node:assert/strict';
import {builtinProject} from '../helpers/builtin-world.mjs';
import fs from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { normalizeCountryFeature } from "../../shared/frontend/js/modules/country-feature.js";
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
import { createCanonicalCountryStore } from "../../shared/frontend/js/modules/canonical-country-packet.js";

const data = new URL('../../assets/data/', import.meta.url);
const canonical = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson', data)));
const worldBundle = JSON.parse(fs.readFileSync(new URL('world/current.json', data)));
const preview = JSON.parse(gunzipSync(fs.readFileSync(new URL(worldBundle.assets.previewCountries.url, data))));

test('canonical geographic names are consistent in source, preview and current library', () => {
  const library = readTerritorialSources();
  for (const [id, name] of [
    ['MHL', '마셜제도'], ['TCA', '터크스케이커스제도'], ['HMD', '허드맥도널드제도'],
    ['SGS', '사우스조지아사우스샌드위치제도'], ['UMI', '미국령 군소제도'],
    ['BJN', '바호누에보환초'], ['SER', '세라니야환초'], ['SCR', '스카버러암초'],
    ['KAS', '시아첸빙하'], ['SPI', '남부파타고니아빙원'],
    ['BIH', '보스니아헤르체고비나'], ['GNQ', '적도기니'], ['BRT', '비르타윌'],
    ['TUR', '튀르키예'], ['ESP', '에스파냐'], ['ASM', '미국령 사모아'],
    ['PYF', '프랑스령 폴리네시아'], ['VIR', '미국령 버진아일랜드'], ['VGB', '영국령 버진아일랜드'],
  ]) {
    for (const collection of [canonical, preview]) {
      const feature = collection.features.find(item => item.id === id);
      assert.equal(feature.properties.name, name, `${id} asset`);
      assert.equal(normalizeCountryFeature(feature).properties.name, name, `${id} runtime`);
    }
    assert.equal(library.find(item => item.metadata.sourceFeatureId === id).names.ko, name, `${id} library`);
  }
});

test('Dhekelia uses its canonical name in source, lineage, library chunks and active world assets', () => {
  const source = JSON.parse(fs.readFileSync(new URL('territorial-entities/source/countries/state-ESB.json', data)));
  assert.equal(source.names.ko, '데켈리아');
  assert.equal(source.entityId, 'state:ESB');
  assert.equal(source.names.ko, '데켈리아');
  assert.equal(source.sourceInfo.featureProperties.name, '데켈리아');
  const index = JSON.parse(fs.readFileSync(new URL('territorial-entities/generated/v2/index.json', data)));
  assert.equal(index.lineages.find(row => row.lineageId === 'esb').names.ko, '데켈리아');
  const entry = index.entities.find(row => row.entityId === 'state:ESB');
  assert.equal(entry.names.ko, '데켈리아');
  const chunk = JSON.parse(gunzipSync(fs.readFileSync(new URL(`territorial-entities/generated/v2/${entry.file}`, data))));
  assert.equal(chunk.names.ko, '데켈리아');
  assert.equal(chunk.sourceInfo.featureProperties.name, '데켈리아');
  const world = JSON.parse(fs.readFileSync(new URL('world/current.json', data)));
  const current = JSON.parse(fs.readFileSync(new URL(world.source.url, data)));
  const activePreview = JSON.parse(gunzipSync(fs.readFileSync(new URL(world.assets.previewCountries.url, data))));
  for (const collection of [canonical, current, activePreview]) {
    assert.equal(collection.features.find(feature => feature.id === 'ESB').properties.name, '데켈리아');
  }
  const bytes = gunzipSync(fs.readFileSync(new URL(world.assets.canonicalCountryPacket.url, data)));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.equal(createCanonicalCountryStore(buffer).materializeFeature('ESB').properties.name, '데켈리아');
  const historical = JSON.stringify(builtinProject('2026-10'));
  assert.doesNotMatch(historical, /데켈리아 지역/u);
  assert.match(historical, /데켈리아/u);
});

test('territorial prefixes are spaced in canonical lineage, entity and source names', () => {
  const index = JSON.parse(fs.readFileSync(new URL('territorial-entities/generated/v2/index.json', data)));
  for (const [id, name] of [
    ['ASM', '미국령 사모아'], ['PYF', '프랑스령 폴리네시아'], ['UMI', '미국령 군소제도'],
    ['VIR', '미국령 버진아일랜드'], ['VGB', '영국령 버진아일랜드'],
  ]) {
    const source = JSON.parse(fs.readFileSync(new URL(`territorial-entities/source/countries/state-${id}.json`, data)));
    assert.equal(source.names.ko, name, `${id} lineage`);
    assert.equal(source.names.ko, name, `${id} entity`);
    assert.equal(source.sourceInfo.featureProperties.name, name, `${id} source metadata`);
    assert.equal(index.lineages.find(row => row.lineageId === source.lineageId).names.ko, name);
    const entry = index.entities.find(row => row.entityId === `state:${id}`);
    assert.equal(entry.names.ko, name);
    const chunk = JSON.parse(gunzipSync(fs.readFileSync(new URL(`territorial-entities/generated/v2/${entry.file}`, data))));
    assert.equal(chunk.names.ko, name);
    assert.equal(chunk.sourceInfo.featureProperties.name, name);
  }
  for (const entity of readTerritorialSources()) assert.doesNotMatch(entity.names.ko, /령\S/u);
});

test('GIS and user-assigned names are literal even when they resemble retired display defaults', () => {
  const geometry = { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]] };
  for (const [id, name] of [['ALD', '올란드 제도'], ['TUR', '터키'], ['custom', '내가 만든 제도']]) {
    assert.equal(normalizeCountryFeature({ type: 'Feature', id, properties: { name }, geometry }).properties.name, name);
  }
});

test('built-in Korean hydronyms use compact names in every render fragment', () => {
  const bundleManifest = JSON.parse(fs.readFileSync(new URL('hydro/v0.13.2/manifest.json', data)));
  const spec = bundleManifest.metadata.core;
  const combined = fs.readFileSync(new URL('hydro/v0.13.2/hydro.bin', data));
  const core = JSON.parse(gunzipSync(combined.subarray(spec.offset, spec.offset + spec.bytes)));
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
