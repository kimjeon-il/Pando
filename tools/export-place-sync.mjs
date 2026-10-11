/**
 * Deterministic, versioned Web/native place interchange artifact.
 * --check fails on drift instead of silently rewriting a fixture.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLACE_LIMITS, PLACE_KINDS, PLACE_LANGUAGES, DEFAULT_PLACE_LANGUAGES,
  PLACE_TILE_FORMAT, PLACE_NAME_TRANSITION_LIMIT, normalizePlace, resolvePlaceLabelRows } from '../assets/js/modules/place-contract.js';
import { PLACE_LABEL_METRICS, placeLabelDimensions } from '../assets/js/modules/label-layout.js';
import { encodePlaceTile } from '../assets/js/modules/place-codec.js';
import { PLACE_SYNC_CASES } from './place-sync-cases.mjs';

const path = fileURLToPath(new URL('../contracts/places/v2.json', import.meta.url));
const labelRows = (place, languages, date) => resolvePlaceLabelRows(place, languages, date)
  .map(row => [row.language, row.text]);

const reviewCache = new Map();
function verifyReviewedSource(example) {
  const reviewFile = example.reviewFile;
  if (!/^reports\/places\/tier1-major-cities-batch[\w.-]+\.json$/u.test(reviewFile))
    throw new Error('Unapproved place review path: ' + reviewFile);
  let review = reviewCache.get(reviewFile);
  if (!review) {
    review = JSON.parse(readFileSync(new URL('../' + reviewFile, import.meta.url), 'utf8'));
    reviewCache.set(reviewFile, review);
  }
  const geonameId = Number(example.record.sourceId);
  const matching = (review.records || []).filter(row => row.geonameId === geonameId);
  if (matching.length !== 1) throw new Error('Missing or duplicated reviewed place: ' + geonameId);
  const source = matching[0];
  if (source.defaultDisplayNameKo !== example.record.name
    || source.longitude !== example.record.coordinates[0]
    || source.latitude !== example.record.coordinates[1])
    throw new Error('Place source name or coordinate drift: ' + geonameId);
  const verifiedEnglish = (source.names || []).filter(row => row.language === 'en' && row.usage === 'standard');
  if (verifiedEnglish.length && !verifiedEnglish.some(row => row.text === example.record.nameEn))
    throw new Error('Reviewed English name drift: ' + geonameId);
  if (!(source.names || []).some(row => row.text === example.record.nameNative
      && !['ko', 'en'].includes(row.language) && row.usage !== 'historical'))
    throw new Error('Selected native name is not in reviewed source: ' + geonameId);
  for (const transition of example.record.nameTimeline || []) {
    if (!(source.displayTimeline || []).some(row => row.nameKo === transition.ko
      && (transition.fromDate ? row.fromDate === transition.fromDate : row.fromYear === transition.fromYear)))
      throw new Error('Reviewed Korean historical name drift: ' + geonameId);
  }
  return { reviewFile, geonameId };
}


export function buildPlaceSyncContract() {
  const fixtures = PLACE_SYNC_CASES.map(example => {
    const sourceReview = verifyReviewedSource(example);
    const normalized = normalizePlace(example.record);
    const scenarios = example.scenarios.map(({ date, languages, rows }) => {
      const actual = labelRows(normalized, languages, date);
      if (JSON.stringify(actual) !== JSON.stringify(rows))
        throw new Error('Reviewed place-label fixture mismatch: ' + example.id);
      return { date, languages, rows,
        webEstimatedBox: placeLabelDimensions(actual.map(([, text]) => text)) };
    });
    return {
      id: example.id, sourceReview, input: example.record, normalized, scenarios,
      tileHex: Buffer.from(encodePlaceTile([example.record])).toString('hex'),
    };
  });
  return {
    schema: 'pando-place-sync-v2',
    dataContractVersion: PLACE_TILE_FORMAT.version,
    wire: {
      magicAscii: 'PLAC', littleEndian: true, ...PLACE_TILE_FORMAT,
      stringFieldOffsets: PLACE_TILE_FORMAT.stringFields.map((field, index) => ({
        field, byteOffset: PLACE_TILE_FORMAT.stringOffsetBase + index * PLACE_TILE_FORMAT.stringOffsetStride,
      })),
      longitudeOffset: 0, latitudeOffset: 8, populationOffset: 16,
      priorityOffset: 24, minZoomOffset: 28, kindOffset: 32,
      timelineSerialization: 'UTF-8 JSON string in the shared pool',
    },
    domain: {
      builtinIdFormat: 'builtin:place:{source}:{sourceId}',
      placeKinds: PLACE_KINDS,
      languageOrder: PLACE_LANGUAGES,
      defaultLanguages: DEFAULT_PLACE_LANGUAGES,
      maxNameTransitions: PLACE_NAME_TRANSITION_LIMIT,
      timelineDateFormats: ['fromYear integer', 'fromDate YYYY-MM-DD'],
      duplicateNameComparison: 'trim -> NFKC -> lower-case; first enabled language wins',
      missingLanguagePolicy: 'omit missing translation; never fabricate names from source country code',
      languageTogglePolicy: 'at least one enabled; reject an unchanged or all-disabled request',
      nameFields: { ko: 'name', en: 'nameEn', native: 'nameNative' },
    },
    display: {
      webEstimatedBox: PLACE_LABEL_METRICS,
      geometryNotice: 'CSS-pixel heuristic, not native Qt font measurements',
      collisionPolicy: 'one atomic collision box per place, regardless of language count',
    },
    limits: PLACE_LIMITS,
    fixtures,
  };
}
const generated = JSON.stringify(buildPlaceSyncContract(), null, 2) + '\n';
if (process.argv.includes('--check')) {
  let committed;
  try { committed = readFileSync(path, 'utf8'); }
  catch { throw new Error('Missing committed place contract: ' + path); }
  if (committed !== generated)
    throw new Error('Place sync contract drift: run node tools/export-place-sync.mjs and review changes.');
  console.log('Place sync contract up to date:', path);
} else {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generated, 'utf8');
  console.log('Wrote place sync contract:', path);
}
