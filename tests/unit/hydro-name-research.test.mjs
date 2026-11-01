import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  classifyEuropeanGeometry,
  collectMajorUnnamedEuropeanCandidates,
  rankGeometryCandidates,
  renderEuropeanReviewMarkdown,
  validateEuropeanReviewMarkdown,
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

test('review Markdown preserves the logical overlay filename', () => {
  const markdown = renderEuropeanReviewMarkdown(summaryFixture().review);
  assert.match(markdown, /\[GeoJSON 오버레이\]\(\.\/europe-major-rivers\.geojson\)/);
  assert.doesNotMatch(markdown, /\.variants|a{64}/);
});

test('review checks accept the edited historical summary without recreating the full report', () => {
  const { review, markdown } = summaryFixture();
  assert.doesNotThrow(() => validateEuropeanReviewMarkdown(markdown, review));
  assert.doesNotThrow(() => validateEuropeanReviewMarkdown(
    markdown.replace('## 당시 판정', '## 당시 판정\n\n편집 설명을 추가해도 연구 값과 정본 링크는 유지한다.'), review,
  ));
  assert.doesNotThrow(() => validateEuropeanReviewMarkdown(renderEuropeanReviewMarkdown(review), review));
});

test('review checks reject stale summary facts and missing canonical provenance', () => {
  const { review, markdown } = summaryFixture();
  for (const [from, to] of [
    ['2001-02-03', '2001-02-04'], ['fixture-v1', 'fixture-v2'],
    ['**2개**', '**3개**'], ['`accepted-candidate` **1개**', '`accepted-candidate` **2개**'],
    ['`out-of-scope` **1개**', '`out-of-scope` **0개**'], ['ambiguous·unresolved **0개**', 'ambiguous·unresolved **1개**'],
    ['(europe-major-rivers.json)', '(.variants/' + 'a'.repeat(64) + ')'],
    ['(europe-major-rivers.geojson)', '(.variants/' + 'a'.repeat(64) + ')'],
    ['/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/', '/main/'],
  ]) {
    assert.throws(() => validateEuropeanReviewMarkdown(markdown.replace(from, to), review),
      /europe-major-rivers\.md/, from);
  }
  assert.throws(() => validateEuropeanReviewMarkdown(
    markdown.replace('2001-02-03', '2001-02-04') + '\n원문 참고 날짜: 2001-02-03\n', review,
  ), /research date/);
  assert.throws(() => validateEuropeanReviewMarkdown(
    renderEuropeanReviewMarkdown(review).replace('Fixture evidence.', 'Changed evidence.'), review,
  ), /europe-major-rivers\.md/);
});

for (const [label, mutate] of [
  ['a changed detailed report followed by a valid summary', (markdown, review) =>
    renderEuropeanReviewMarkdown(review).replace('Fixture evidence.', 'Changed evidence.') + '\n' + markdown],
  ['a valid summary hidden in an HTML comment', markdown => '<!--\n' + markdown + '-->\nA different visible report.\n'],
  ['a conflicting count appended to the summary', markdown => markdown + '\n- `accepted-candidate` **99개**.\n'],
  ['a canonical attachment label duplicated with a cache path', markdown =>
    markdown + '\n- [ID별 정본 연구 값](.variants/' + 'a'.repeat(64) + ').\n'],
  ['a fabricated immutable original revision', markdown =>
    markdown.replace('6b0c501dd09029ef237e90c1ef55fdb82bdf315f', '0'.repeat(40))],
  ['summary facts hidden in a fenced code block', markdown => markdown.replace('## 당시 판정', '```\n## 당시 판정') + '\n```\n'],
  ['summary facts hidden by an HTML element', markdown => markdown.replace('## 당시 판정', '<div hidden>\n## 당시 판정') + '\n</div>\n'],
  ['a conflicting dataset version appended to the summary', markdown => markdown + '\nHydroRIVERS **fixture-v2**\n'],
  ['a canonical attachment duplicated with another label', markdown => markdown + '\n- [다른 JSON 링크](europe-major-rivers.json).\n'],
]) {
  test('review checks reject ' + label, () => {
    const { review, markdown } = summaryFixture();
    assert.throws(() => validateEuropeanReviewMarkdown(mutate(markdown, review), review), /europe-major-rivers\.md/);
  });
}

for (const count of ['-2', '2.2']) {
  test('review checks reject the entire invalid candidate count ' + count, () => {
    const { review, markdown } = summaryFixture();
    assert.throws(() => validateEuropeanReviewMarkdown(markdown.replace('**2개**', `**${count}개**`), review),
      /candidate count/);
  });
}

for (const [label, duplicate] of [
  ['candidate', '- 검토 대상: 주요 미명명 강 시스템 3개 (중요도 단계 0~1).'],
  ['accepted', '- `accepted-candidate` **-2개**.'],
  ['out-of-scope', '- `out-of-scope` **1.1개**.'],
  ['undecided', '- ambiguous·unresolved **unknown개**.'],
]) {
  test('review checks reject a malformed duplicate ' + label + ' count independently of number parsing', () => {
    const { review, markdown } = summaryFixture();
    const changed = markdown.replace('## 정본 자료 및 재현', `${duplicate}\n\n## 정본 자료 및 재현`);
    assert.throws(() => validateEuropeanReviewMarkdown(changed, review), /count/);
  });
}

test('checked-in European major river review matches all 33 current candidates', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const result = spawnSync(process.execPath, ['tools/research-hydro-names.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Validated 33 European HydroRIVERS name candidates/);
});

function summaryFixture() {
  const review = {
    datasetVersion: 'fixture-v1', researchedAt: '2001-02-03',
    entries: ['accepted-candidate', 'out-of-scope'].map((status, index) => ({
      ...reviewRow(String(2001 + index)), status, bounds: [0, 0, 1, 1],
      scope: { inScope: true, matchedCountries: ['노르웨이'] }, rationale: 'Fixture evidence.',
    })),
  };
  const markdown = `# 유럽 주요 미명명 강 — 2001-02-03 검토 요약

> 과거 HydroRIVERS **fixture-v1** 기준 조사.

## 당시 판정

- 검토 대상: 주요 미명명 강 시스템 **2개** (중요도 단계 0~1).
- \`accepted-candidate\` **1개**, \`out-of-scope\` **1개**, ambiguous·unresolved **0개**.

## 정본 자료 및 재현

- [ID별 정본 연구 값](europe-major-rivers.json).
- [검토 당시 지리적 오버레이](europe-major-rivers.geojson).
- [축약 이전 상세 근거](https://github.com/kimjeon-il/Pando/blob/6b0c501dd09029ef237e90c1ef55fdb82bdf315f/reports/hydro-names/europe-major-rivers.md).
`;
  return { review, markdown };
}

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
