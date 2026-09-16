import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  classifyEuropeanGeometry,
  collectMajorUnnamedEuropeanCandidates,
  rankGeometryCandidates,
  osmXmlToGeometry,
  selectResearchMainstemFeatures,
  scoreGeometryCandidate,
  validateReviewEntries,
} from '../../tools/lib/hydro-name-research.mjs';

test('collects one row per unnamed stage 0 or 1 HydroRIVERS Europe system', () => {
  const features = [
    { category: 'river', systemId: '2001', stage: 1, name: '미명명 수계 2001', bounds: [0, 0, 1, 1], fid: 1 },
    { category: 'river', systemId: '2001', stage: 0, name: '미명명 수계 2001', bounds: [-1, -2, 2, 3], fid: 2 },
    { category: 'river', systemId: '2002', stage: 2, name: '미명명 수계 2002', bounds: [0, 0, 1, 1], fid: 3 },
    { category: 'river', systemId: '2003', stage: 1, name: '기존 이름', bounds: [0, 0, 1, 1], fid: 4 },
    { category: 'river', systemId: '3001', stage: 1, name: '미명명 수계 3001', bounds: [0, 0, 1, 1], fid: 5 },
    { category: 'lake', systemId: '2004', stage: 1, name: '미명명 수계 2004', bounds: [0, 0, 1, 1], fid: 6 },
  ];

  assert.deepEqual(collectMajorUnnamedEuropeanCandidates(features), [{
    systemId: '2001',
    stage: 0,
    bounds: [-1, -2, 2, 3],
    featureIds: [1, 2],
  }]);
});

test('classifies geometry from allowed European countries and clips Russia at 60 east', () => {
  const countries = [
    squareCountry('노르웨이', 5, 55, 30, 72),
    squareCountry('러시아', 20, 45, 180, 80),
    squareCountry('터키', 25, 35, 45, 43),
  ];

  assert.deepEqual(
    classifyEuropeanGeometry(line([[10, 60], [12, 61]]), countries),
    { inScope: true, matchedCountries: ['노르웨이'], reason: 'geographic-europe' },
  );
  assert.deepEqual(
    classifyEuropeanGeometry(line([[58, 55], [59, 56]]), countries),
    { inScope: true, matchedCountries: ['러시아'], reason: 'european-russia-west-of-60e' },
  );
  assert.deepEqual(
    classifyEuropeanGeometry(line([[64, 68], [65, 69]]), countries),
    { inScope: false, matchedCountries: ['러시아'], reason: 'russia-east-of-60e' },
  );
  assert.deepEqual(
    classifyEuropeanGeometry(line([[30, 40], [31, 41]]), countries),
    { inScope: false, matchedCountries: ['터키'], reason: 'excluded-country' },
  );
});

test('geometry score rewards parallel coverage and rejects a nearby crossing', () => {
  const hydro = line([[0, 0], [1, 0]]);
  const parallel = line([[0, 0.006], [1, 0.006]]);
  const crossing = line([[0.5, -0.5], [0.5, 0.5]]);
  const far = line([[0, 1], [1, 1]]);

  const parallelScore = scoreGeometryCandidate(hydro, parallel, { matchDistanceKm: 2, sampleCount: 21 });
  const crossingScore = scoreGeometryCandidate(hydro, crossing, { matchDistanceKm: 2, sampleCount: 21 });
  const farScore = scoreGeometryCandidate(hydro, far, { matchDistanceKm: 2, sampleCount: 21 });

  assert.equal(parallelScore.coverage, 1);
  assert.ok(parallelScore.medianDistanceKm < 1);
  assert.ok(parallelScore.endpointMatches >= 1);
  assert.ok(crossingScore.coverage < 0.15);
  assert.equal(farScore.coverage, 0);
});

test('ranking accepts a clear geometry winner and preserves close ties as ambiguous', () => {
  const accepted = rankGeometryCandidates([
    { id: 'right', coverage: 0.9, medianDistanceKm: 0.4, endpointMatches: 2 },
    { id: 'nearby', coverage: 0.4, medianDistanceKm: 1.2, endpointMatches: 0 },
  ]);
  assert.equal(accepted.status, 'accepted-candidate');
  assert.equal(accepted.candidate.id, 'right');

  const tied = rankGeometryCandidates([
    { id: 'left-name', coverage: 0.84, medianDistanceKm: 0.5, endpointMatches: 1 },
    { id: 'right-name', coverage: 0.8, medianDistanceKm: 0.55, endpointMatches: 1 },
  ]);
  assert.equal(tied.status, 'ambiguous');
  assert.equal(tied.reason, 'candidate-score-gap');
});

test('OSM full XML becomes candidate lines limited to relation member ways', () => {
  const xml = `<?xml version="1.0"?>
    <osm>
      <node id="1" lat="60" lon="10"/>
      <node id="2" lat="61" lon="11"/>
      <node id="3" lat="62" lon="12"/>
      <way id="7"><nd ref="1"/><nd ref="2"/><tag k="waterway" v="river"/><tag k="name" v="Right"/></way>
      <way id="8"><nd ref="2"/><nd ref="3"/><tag k="waterway" v="stream"/><tag k="name" v="Other"/></way>
      <relation id="9"><member type="way" ref="7" role="main_stream"/><tag k="type" v="waterway"/><tag k="name" v="Right"/></relation>
    </osm>`;

  assert.deepEqual(osmXmlToGeometry(xml, { relationId: '9' }), {
    type: 'MultiLineString',
    coordinates: [[[10, 60], [11, 61]]],
  });
  assert.deepEqual(osmXmlToGeometry(xml, { wayIds: ['8'] }), {
    type: 'MultiLineString',
    coordinates: [[[11, 61], [12, 62]]],
  });
});

test('review validation rejects duplicate systems and incomplete transliteration evidence', () => {
  const valid = reviewRow('2001');
  assert.doesNotThrow(() => validateReviewEntries([valid], { expectedCount: 1 }));

  assert.throws(
    () => validateReviewEntries([valid, valid], { expectedCount: 2 }),
    /duplicate systemId 2001/,
  );
  assert.throws(
    () => validateReviewEntries([{ ...valid, hangulize: { language: 'fin', input: 'Iijoki' } }], { expectedCount: 1 }),
    /complete Hangulize evidence/,
  );
});

test('research geometry uses only decoded mainstem features', () => {
  const features = [
    { metadata: { systemId: '2001', stage: 1, role: 'mainstem' }, geometry: line([[0, 0], [1, 0]]) },
    { metadata: { systemId: '2001', stage: 1, role: 'tributary' }, geometry: line([[0.5, 0], [0.5, 1]]) },
    { metadata: { systemId: '2001', stage: 2, role: 'mainstem' }, geometry: line([[1, 0], [2, 0]]) },
  ];

  assert.deepEqual(selectResearchMainstemFeatures(features, new Set(['2001'])), [features[0]]);
});

test('official system identity is valid evidence when one river relation cannot cover the Hydro system', () => {
  const row = {
    ...reviewRow('2001'),
    geometryMatch: undefined,
    officialSystemMatch: {
      authority: 'SMHI',
      identifier: '61000',
      rationale: 'Official basin identity matches the Hydro outlet system.',
    },
  };
  assert.doesNotThrow(() => validateReviewEntries([row], { expectedCount: 1 }));
});

test('checked-in European major river review matches all 33 current candidates', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const result = spawnSync(process.execPath, ['tools/research-hydro-names.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Validated 33 European HydroRIVERS name candidates/);
});

function line(coordinates) {
  return { type: 'LineString', coordinates };
}

function squareCountry(name, minX, minY, maxX, maxY) {
  return {
    type: 'Feature',
    properties: { name },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
      ]],
    },
  };
}

function reviewRow(systemId) {
  return {
    systemId,
    stage: 1,
    status: 'accepted-candidate',
    localName: 'Iijoki',
    language: 'fin',
    recommendedNameKo: '이요키강',
    geometryMatch: { coverage: 0.9, medianDistanceKm: 0.2, endpointMatches: 1, scoreGap: 0.5 },
    sources: [
      { kind: 'osm', url: 'https://www.openstreetmap.org/relation/8546148' },
      { kind: 'wikidata', url: 'https://www.wikidata.org/wiki/Q1472085' },
    ],
    hangulize: {
      language: 'fin',
      input: 'Iijoki',
      output: '이요키',
      url: 'https://hangulize.org/?lang=fin&word=Iijoki',
    },
  };
}
