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

export function buildPlaceSyncContract() {
  const fixtures = PLACE_SYNC_CASES.map(example => {
    const normalized = normalizePlace(example.record);
    const scenarios = example.scenarios.map(({ date, languages, rows }) => {
      const actual = labelRows(normalized, languages, date);
      if (JSON.stringify(actual) !== JSON.stringify(rows))
        throw new Error('Reviewed place-label fixture mismatch: ' + example.id);
      return { date, languages, rows,
        webEstimatedBox: placeLabelDimensions(actual.map(([, text]) => text)) };
    });
    return {
      id: example.id, input: example.record, normalized, scenarios,
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
