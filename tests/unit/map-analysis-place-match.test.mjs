import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferenceImagePlaceAutoGeoref,
  matchReferenceImagePlaceDetections,
  normalizeReferenceImagePlaceText,
  referenceImagePlaceNameSimilarity,
  referenceImagePlaceNames,
  referenceImagePlaceSearchQueries,
  resolveReferenceImagePlaceAutoGeoref,
  resolveReferenceImagePlaceDetections,
} from '../../plugins/pando-map-tools/lib/analysis/place-match.mjs';
import { REFERENCE_IMAGE_WARP_MODES } from '../../plugins/pando-map-tools/lib/analysis/georef.mjs';

const place = (id, name, coordinates, extra = {}) => ({
  id: 'builtin:place:test:' + id,
  name,
  coordinates,
  kind: 'city',
  priority: 70,
  population: 100000,
  ...extra,
});

test('place text normalization and similarity tolerate common OCR/diacritic errors', () => {
  assert.equal(normalizeReferenceImagePlaceText('  München—Altstadt  '), 'munchen altstadt');
  assert.ok(referenceImagePlaceNameSimilarity('Beriin', 'Berlin') > 0.8);
  assert.ok(referenceImagePlaceNameSimilarity('Munchen', 'München') > 0.99);
  assert.ok(referenceImagePlaceNameSimilarity('Praha', 'Prague') < 0.72);
});

test('search normalization matches Arabic Persian glyph variants and polytonic Greek without mutating source text', () => {
  assert.equal(referenceImagePlaceNameSimilarity('كاشان', 'کاشان'), 1);
  assert.equal(referenceImagePlaceNameSimilarity('طَهْرَان', 'طهران'), 1);
  assert.equal(referenceImagePlaceNameSimilarity('Ῥόδος', 'Ροδοσ'), 1);
});

test('global georeferencing retains competing names for spatial consensus', () => {
  const result = matchReferenceImagePlaceDetections([{ id: 'one', text: 'Springfield', image: [.2, .3], confidence: 1 }],
    [place('a', 'Springfield', [-90, 40]), place('b', 'Springfield', [-72, 42])], { allowAmbiguous: true });
  assert.equal(result.matches.length, 2);
  assert.equal(new Set(result.matches.map(row => row.detectionId)).size, 1);
  assert.equal(result.rejected.length, 0);
});

test('historical and native place names participate in matching', () => {
  const names = referenceImagePlaceNames({
    name: 'Prague',
    nameEn: 'Prague',
    nameNative: 'Praha',
    nameTimeline: [{ fromYear: 1900, en: 'Prag' }],
  }, { mapDate: '1914-01-01' });
  assert.ok(names.some(item => item.text === 'Praha'));
  assert.ok(names.some(item => item.text === 'Prag' && item.weight === 1));

  const matched = matchReferenceImagePlaceDetections(
    [{ id: 'ocr-prag', text: 'Prag', image: [0.5, 0.5], confidence: 0.95 }],
    [place('prague', 'Prague', [14.4378, 50.0755], {
      nameNative: 'Praha',
      nameTimeline: [{ fromYear: 1900, en: 'Prag' }],
    })],
    { mapDate: '1914-01-01' },
  );
  assert.equal(matched.matchCount, 1);
  assert.equal(matched.matches[0].matchedName, 'Prag');
});

test('anchor geography disambiguates duplicate city names', () => {
  const detections = [{ id: 'ocr-springfield', text: 'Springfield', image: [0.4, 0.6], confidence: 0.98 }];
  const places = [
    place('illinois', 'Springfield', [-89.6501, 39.7817], { population: 114000 }),
    place('massachusetts', 'Springfield', [-72.5898, 42.1015], { population: 155000 }),
  ];
  const matched = matchReferenceImagePlaceDetections(detections, places, {
    anchor: { coordinate: [-89.4, 40.0] },
    maxAnchorDistanceMeters: 500000,
  });
  assert.equal(matched.matchCount, 1);
  assert.equal(matched.matches[0].placeId, 'builtin:place:test:illinois');
});

test('ambiguous duplicate names are rejected without enough evidence', () => {
  const matched = matchReferenceImagePlaceDetections(
    [{ id: 'ocr-x', text: 'Springfield', image: [0.4, 0.6], confidence: 0.98 }],
    [
      place('a', 'Springfield', [-90, 40], { population: 100000, priority: 70 }),
      place('b', 'Springfield', [-72, 42], { population: 100000, priority: 70 }),
    ],
    { ambiguityMargin: 0.01 },
  );
  assert.equal(matched.matchCount, 0);
  assert.equal(matched.rejected[0].reason, 'ambiguous-place-match');
});

test('search queries include a short prefix so one-character OCR errors can recover candidates', () => {
  const queries = referenceImagePlaceSearchQueries('Beriin');
  assert.ok(queries.includes('beriin'));
  assert.ok(queries.includes('be'));
});

test('global search honors the full OCR detection budget and shares query passes across labels', async () => {
  const detections = Array.from({ length: 70 }, (_, index) => ({ id: 'd' + index, text: 'City' + index, image: [index / 70, .5], confidence: .9 }));
  const result = await resolveReferenceImagePlaceDetections(detections, { search: async () => [], maxDetections: 70, maxSearchQueries: 512 });
  assert.ok(result.queries.includes('city69'));
  const small = await resolveReferenceImagePlaceDetections(['Alpha', 'Beta', 'Gamma', 'Delta'].map((text, index) => ({ id: String(index), text, image: [.1 * index, .5] })),
    { search: async () => [], maxSearchQueries: 4 });
  assert.deepEqual(small.queries, ['alpha', 'beta', 'gamma', 'delta']);
});

test('search-backed matching recovers an OCR typo and robust georeferencing rejects a spatial outlier', async () => {
  const affine = ([u, v]) => [10 + 2 * u + 0.1 * v, 50 + 0.2 * u + 2 * v];
  const specs = [
    ['Berlin', [0, 0]],
    ['Bremen', [1, 0]],
    ['Prag', [0, 1]],
    ['Wien', [1, 1]],
    ['Leipzig', [0.2, 0.7]],
    ['Dresden', [0.75, 0.35]],
  ];
  const places = specs.map(([name, image], index) => place(String(index), name, affine(image), {
    kind: index === 0 ? 'capital' : 'city',
    population: 200000 + index * 10000,
  }));
  places.push(place('wrong', 'Hamburg', [35, 65], { population: 1800000 }));

  const detections = [
    { id: 'd0', text: 'Beriin', image: [0, 0], confidence: 0.94 },
    ...specs.slice(1).map(([name, image], index) => ({
      id: 'd' + (index + 1),
      text: name,
      image,
      confidence: 0.96,
    })),
    { id: 'bad', text: 'Hamburg', image: [0.8, 0.2], confidence: 0.99 },
  ];

  const search = async query => {
    const normalized = normalizeReferenceImagePlaceText(query);
    const prefix = [...normalized].slice(0, 2).join('');
    return { records: places.filter(candidate => normalizeReferenceImagePlaceText(candidate.name).startsWith(prefix)) };
  };
  const anchorImage = [0.5, 0.5];
  const anchor = { image: anchorImage, coordinate: affine(anchorImage) };
  const result = await resolveReferenceImagePlaceAutoGeoref(detections, {
    search,
    anchor,
    mode: REFERENCE_IMAGE_WARP_MODES.AFFINE,
    matching: {
      maxAnchorDistanceMeters: 7000000,
      ambiguityMargin: 0.01,
    },
    georef: {
      inlierThresholdMeters: 2500,
      maxTrials: 128,
      seed: 991,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.matching.matchCount, 7);
  assert.equal(result.georef.inlierCount, 6);
  assert.equal(result.georef.rejectedCount, 1);
  assert.ok(result.georef.rejectedIds.some(id => id.includes('wrong')));
  assert.ok(result.georef.diagnostics.hardMaxMeters < 0.01);
});

test('direct place matching feeds the auto-georef core', () => {
  const affine = ([u, v]) => [20 + 3 * u, 40 + 2 * v];
  const specs = [
    ['A', [0, 0]], ['B', [1, 0]], ['C', [0, 1]], ['D', [1, 1]],
  ];
  const result = buildReferenceImagePlaceAutoGeoref({
    detections: specs.map(([name, image], index) => ({ id: 'd' + index, text: name + 'stadt', image, confidence: 1 })),
    places: specs.map(([name, image], index) => place('p' + index, name + 'stadt', affine(image))),
    mode: REFERENCE_IMAGE_WARP_MODES.PROJECTIVE,
    georef: { inlierThresholdMeters: 1000, seed: 12 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.matching.matchCount, 4);
  assert.equal(result.georef.inlierCount, 4);
});
