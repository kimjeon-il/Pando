/**
 * Reproducible publisher for all reviewed place batches.
 * The review JSONs remain the only source of historical name decisions.
 * Outputs: a portable catalog, one PLAC v3 shard, and a hashed search/viewport manifest.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { withLibraryOutputs } from './library-data.mjs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { encodePlaceTile, decodePlaceTile } from "../shared/frontend/js/modules/place-codec.js";
import { normalizePlace, normalizePlaceQuery, PLACE_LIMITS } from "../shared/frontend/js/modules/place-contract.js";
import { reportPath } from './report-paths.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUTPUT_DIR = join(ROOT, 'assets/data/places');
const REVIEW_FILE = /^tier1-major-cities-batch\d{2}[-a-z0-9]*\.json$/u;

const hash = (name, bytes) => createHash(name).update(bytes).digest('hex');
const sortedJson = value => JSON.stringify(value, null, 2) + '\n';
const title = record => record.defaultDisplayNameKo || '(unnamed)';

/** Git stores these text files with LF even when a Windows checkout has CRLF. */
export function canonicalPlaceTextBytes(bytes) {
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/gu, '\n'), 'utf8');
}

export function projectReviewedPlace(record, reviewFile, batchStatus) {
  const id = record?.geonameId;
  if (!Number.isInteger(id) || id < 1 || typeof record.defaultDisplayNameKo !== 'string'
    || !record.defaultDisplayNameKo.trim() || !Number.isFinite(record.longitude)
    || !Number.isFinite(record.latitude) || Math.abs(record.latitude) > 90 || Math.abs(record.longitude) > 180)
    throw new Error('Invalid reviewed place identity: ' + reviewFile + ' ' + id);
  const timeline = (record.displayTimeline || []).map(entry => {
    const when = entry.fromDate ? { fromDate: entry.fromDate } : { fromYear: entry.fromYear };
    const converted = { ...when };
    if (entry.nameKo) converted.ko = entry.nameKo;
    if (entry.nameEn) converted.en = entry.nameEn;
    if (entry.nameNative || entry.nativeNames?.length) {
      converted.native = entry.nameNative || entry.nativeNames[0].text;
      converted.nativeExtras = (entry.nativeNames || []).slice(1).map(name => name.text);
    }
    if (!['ko', 'en', 'native'].some(key => Object.hasOwn(converted, key)))
      throw new Error('Historical name period has no selected names: ' + title(record));
    return converted;
  });
  // PLAC v3 serializes names, not temporalEligibility. Shift the first name
  // coverage boundary forward for a source-verified modern city foundation;
  // otherwise the historic map falsely displays a city before it existed.
  // The original staged name-era decision remains unchanged in the review JSON.
  const eligibility = record.temporalEligibility;
  if (eligibility?.beforeCityEstablished === 'suppress-city-label' && timeline.length) {
    const first = timeline[0], start = eligibility.cityEstablishedFromDate
      || (eligibility.cityEstablishedFromYear != null
        ? String(eligibility.cityEstablishedFromYear).padStart(4, '0') + '-01-01' : null);
    const firstDate = first.fromDate
      || String(first.fromYear).padStart(4, '0') + '-01-01';
    if (start && firstDate < start) {
      if (eligibility.cityEstablishedFromDate) {
        delete first.fromYear;
        first.fromDate = eligibility.cityEstablishedFromDate;
      } else {
        delete first.fromDate;
        first.fromYear = eligibility.cityEstablishedFromYear;
      }
    }
  }
  if (timeline.length > PLACE_LIMITS.tileRecords)
    throw new Error('Invalid name timeline size for ' + id);
  const kind = record.urbanIdentityReview?.autoTierApproved === false
    || record.candidatePolicyException?.autoPromoted === false ? 'town' : 'city';
  const raw = {
    source: 'geonames', sourceId: String(id),
    name: record.defaultDisplayNameKo, nameEn: record.defaultDisplayNameEn || '',
    nameNative: record.defaultDisplayNameNative || '',
    nameNativeExtras: (record.defaultNativeNames || []).slice(1).map(name => name.text),
    nameTimeline: timeline, coordinates: [record.longitude, record.latitude],
    countryCode: record.sourceCountryCode || '', featureCode: record.featureCode || '',
    population: 0, kind, priority: kind === 'town' ? 40 : 70,
    minZoom: kind === 'town' ? 2.5 : 1.25,
    reviewFile, historicalDisplayCoverage: record.historicalDisplayCoverage || 'unknown',
    reviewStatus: record.reviewStatus || batchStatus || 'unknown',
    ...(record.temporalEligibility ? { temporalEligibility: record.temporalEligibility } : {}),
    ...(record.urbanIdentityReview ? { urbanIdentityReview: record.urbanIdentityReview } : {}),
  };
  // The codec is the canonical runtime validator. Never invent a substitute name.
  normalizePlace(raw);
  return raw;
}

/** Only explicitly approved city identities may enter either viewport tiles or search. */
export function validateRuntimeApproval(record, batchNumber) {
  if (record.featureClass !== 'P' || !Number.isInteger(record.geonameId) || record.geonameId <= 0)
    throw new Error('Approved record must be a stable P-class GeoNames settlement');
  if (record.urbanIdentityReview?.autoTierApproved === false
    || record.candidatePolicyException?.autoPromoted === false)
    throw new Error('Unresolved city identity/candidate review cannot enter runtime: ' + record.geonameId);
  if (record.temporalEligibility?.activeIntervals?.length)
    throw new Error('Multi-episode urban eligibility not supported by PLAC v3: ' + record.geonameId);
  if (batchNumber <= 15) {
    // First 15 batches were individually researched before A/B/C triage was introduced.
    // Historical Pest has a verified 1873 end date but the current PLAC v3 codec does
    // not serialize activeIntervals; it must stay out until interval gating is wired.
    if (record.geonameId === 3046446)
      throw new Error('Former Pest city requires urban active-interval rendering');
    return;
  }
  const periodWithIndependentEvidence = (record.displayTimeline || []).some(period =>
    typeof period.sourceUrl === 'string'
    && period.sourceUrl.startsWith('https://')
    && !/^https:\/\/(?:www\.)?geonames\.org\//u.test(period.sourceUrl));
  if (!['B', 'C'].includes(record.researchDifficulty)
    || /provisional|unverified/iu.test(record.reviewStatus || '')
    || !periodWithIndependentEvidence)
    throw new Error('Unverified historical city staging cannot enter runtime: ' + record.geonameId);
}

export function deriveReleaseCatalog(directory = reportPath('reports/places', { access: 'read' }), approvalsPath = join(directory, 'runtime-release-approvals-v1.json')) {
  const files = readdirSync(directory).filter(name => REVIEW_FILE.test(name)).sort();
  if (!files.length) throw new Error('No reviewed place batches');
  const approvalBytes = canonicalPlaceTextBytes(readFileSync(approvalsPath));
  const approvals = JSON.parse(approvalBytes.toString('utf8'));
  const approvedIds = approvals?.approvedSourceIds;
  if (approvals?.schema !== 'pando-place-runtime-approval-v1'
    || !Array.isArray(approvedIds) || !approvedIds.length
    || approvedIds.some((id, i) => !Number.isInteger(id) || id <= 0 || (i && id <= approvedIds[i - 1])))
    throw new Error('Invalid or unsorted explicit runtime approvals');
  const approved = new Set(approvedIds), published = new Set();
  if (approvals.hardExclusionIds?.some(id => approved.has(id)))
    throw new Error('Approved ID conflicts with explicit hard exclusion');
  const result = { schema: 'pando-builtin-place-release-v1',
    dataContract: 'PLAC-v3',
    generatedFrom: 'reports/places/tier1-major-cities-batch*.json',
    approval: { file: 'reports/places/runtime-release-approvals-v1.json',
      sha256: hash('sha256', approvalBytes), approvedIds: approvedIds.length },
    status: 'curated-verified-city-runtime-input', reviewBatches: [], records: [] };
  const seen = new Set();
  for (const name of files) {
    const reviewFile = 'reports/places/' + name;
    const content = canonicalPlaceTextBytes(readFileSync(join(directory, name)));
    const data = JSON.parse(content.toString('utf8'));
    if (data.schema !== 'pando-places-tier1-review-v6' || !Array.isArray(data.records))
      throw new Error('Unexpected review format: ' + reviewFile);
    const sourceBlobSha = hash('sha1', Buffer.concat([
      Buffer.from('blob ' + content.byteLength + '\0'), content,
    ]));
    const batchNumber = Number(/^tier1-major-cities-batch(\d{2})/u.exec(name)?.[1]);
    if (!Number.isInteger(batchNumber)) throw new Error('Invalid batch name: ' + name);
    const reviewSummary = { batch: data.batch || name.replace(/^tier1-major-cities-/u, '').replace(/\.json$/u, ''), file: reviewFile,
      cityCount: data.records.length, publishedCount: 0, sourceBlobSha };
    result.reviewBatches.push(reviewSummary);
    for (const row of data.records) {
      if (seen.has(row.geonameId)) throw new Error('Duplicate GeoNames ID ' + row.geonameId);
      seen.add(row.geonameId);
      if (!approved.has(row.geonameId)) continue;
      validateRuntimeApproval(row, batchNumber);
      published.add(row.geonameId);
      reviewSummary.publishedCount++;
      result.records.push(projectReviewedPlace(row, reviewFile, data.status));
    }
  }
  const missing = approvedIds.filter(id => !published.has(id));
  if (missing.length) throw new Error('Approved GeoNames IDs missing from source batches: ' + missing.join(','));
  result.records.sort((a, b) => Number(a.sourceId) - Number(b.sourceId));
  const timelineEntries = result.records.reduce((sum, place) => sum + place.nameTimeline.length, 0);
  result.stats = { cityCount: result.records.length, timelineEntries,
    stagedCount: seen.size, withheldCount: seen.size - result.records.length,
    sourceBatchCount: files.length, unrankedCount: result.records.length,
    urbanIdentityFlagged: result.records.filter(place => place.kind === 'town').length };
  if (result.records.length > PLACE_LIMITS.tileRecords)
    throw new Error('Single tile has reached the 512-record limit: implement spatial sharding before publishing more cities');
  return result;
}

function allSelectedNames(record) {
  return [record.name, record.nameEn, record.nameNative, ...record.nameNativeExtras,
    ...record.nameTimeline.flatMap(entry => [entry.ko, entry.en, entry.native, ...(entry.nativeExtras || [])])]
    .filter(value => typeof value === 'string' && value.trim());
}

export function generatePlaceRelease() {
  const catalog = deriveReleaseCatalog();
  const catalogText = sortedJson(catalog);
  const records = catalog.records.map(normalizePlace);
  const bytes = Buffer.from(encodePlaceTile(records));
  const decoded = decodePlaceTile(bytes);
  if (JSON.stringify(decoded) !== JSON.stringify(records)) throw new Error('PLAC v3 round-trip failed');
  const sum = hash('sha256', bytes);
  const shard = 'places-v1';
  const row = { shard, offset: 0, length: bytes.length, sha256: sum };
  const prefixes = new Set();
  for (const record of catalog.records) for (const value of allSelectedNames(record)) {
    const query = normalizePlaceQuery(value);
    if ([...query].length >= 2) prefixes.add([...query].slice(0, 2).join(''));
  }
  const search = Object.fromEntries([...prefixes].sort().map(prefix => [
    prefix, [{ ...row, first: prefix, last: prefix + '\uffff' }],
  ]));
  const manifest = { version: 1,
    revision: 'approved-places-' + hash('sha256', catalogText).slice(0, 16),
    stages: [{ id: 0, minZoom: 0, columns: 1, rows: 1 }],
    tiles: { '0/0-0': row },
    shards: { [shard]: { url: 'places-v1.bin', bytes: bytes.length, sha256: sum } },
    search,
  };
  if (bytes.length > PLACE_LIMITS.shardBytes) throw new Error('Place shard size exceeded');
  return { catalogText, bytes, manifestText: sortedJson(manifest), manifest, recordCount: records.length };
}

export function publishPlaceRelease({ check = false } = {}) {
  const generated = generatePlaceRelease();
  const outputs = [
    ['reviewed-records-v1.json', Buffer.from(generated.catalogText)],
    ['places-v1.bin', generated.bytes],
    ['manifest.json', Buffer.from(generated.manifestText)],
  ];
  const publish = () => { for (const [name, bytes] of outputs) {
    const filename = join(OUTPUT_DIR, name);
    if (check) {
      let existing;
      try { existing = readFileSync(filename); }
      catch { throw new Error('Missing published asset ' + filename); }
      const checked = name.endsWith('.json') ? canonicalPlaceTextBytes(existing) : existing;
      if (!checked.equals(bytes)) throw new Error('Place release asset drift: ' + filename);
    } else writeFileSync(filename, bytes);
  } };
  if (check) publish();
  else withLibraryOutputs({ root: ROOT, paths: outputs.map(([name]) => join(OUTPUT_DIR, name)) }, publish);
  return { records: generated.recordCount, bytes: generated.bytes.length,
    searchPrefixes: Object.keys(generated.manifest.search).length, check };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(JSON.stringify(publishPlaceRelease({ check: process.argv.includes('--check') })));
}
