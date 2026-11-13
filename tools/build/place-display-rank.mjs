/**
 * Population-first, neighbourhood-adjusted visual ranking.
 * Coefficients are a documented reconstruction, NOT a recovered historical
 * five-tier specification.  This does not select or approve city identities.
 */
import { candidate } from '../lib/geonames-policy.mjs';

export const PLACE_RANK_MODEL = Object.freeze({
  schema: 'pando-place-population-spatial-display-v1',
  neighbourhoodKm: 200,
  distanceDecayKm: 65,
  peerMinPopulation: 50000,
  peerPopulationFraction: 0.25,
  isolationScaleKm: 220,
  isolationWeight: 0.62,
  crowdingWeight: 0.24,
  // The five population thresholds were recalled by the user. Spatial bonuses
  // and penalties operate on the log-population scale, so the actual label tier
  // is determined from the adjusted score, not the modern population alone.
  populationTierThresholds: Object.freeze([1000000, 500000, 200000, 100000, 50000]),
  tierMinZoom: Object.freeze([1, 1.4, 2, 3, 5]),
});

const radians = Math.PI / 180;
export function placeDistanceKm(a, b) {
  const dLat = (b[1] - a[1]) * radians;
  const dLon = (b[0] - a[0]) * radians;
  const sinLat = Math.sin(dLat / 2), sinLon = Math.sin(dLon / 2);
  const h = sinLat ** 2 + Math.cos(a[1] * radians) *
    Math.cos(b[1] * radians) * sinLon ** 2;
  return 12742.016 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

/** Keep current GeoNames discovery criteria unchanged; use nonzero population only as a ranking signal. */
export function displayNeighbourhoodCandidates(sourceRows) {
  return sourceRows.filter(row => Number.isFinite(row.population) && row.population > 0 &&
    candidate({ ...row, featureClass: 'P' }) !== null);
}

/**
 * Modern source population is not historical urban population. The displayed
 * date/official naming and approved ID remain controlled by their own ledgers.
 */
export function scorePlacePopulationAndSpacing(place, candidates, model = PLACE_RANK_MODEL) {
  const population = Number(place.population);
  if (!Number.isFinite(population) || population < 0 || !Array.isArray(place.coordinates) ||
    !place.coordinates.every(Number.isFinite)) throw new TypeError('Invalid display rank source');
  let crowding = 0, nearestPeerKm = Infinity;
  const peerFloor = Math.max(model.peerMinPopulation, population * model.peerPopulationFraction);
  for (const other of candidates) {
    if (String(other.id) === String(place.id)) continue;
    const distance = placeDistanceKm(place.coordinates, other.coordinates);
    if (other.population >= peerFloor) nearestPeerKm = Math.min(nearestPeerKm, distance);
    if (distance > model.neighbourhoodKm) continue;
    crowding += Math.exp(-distance / model.distanceDecayKm)
      * Math.min(1, Math.sqrt(other.population / Math.max(1, population)));
  }
  const populationScore = Math.log10(1 + population);
  const crowdingPenalty = model.crowdingWeight * Math.log2(1 + crowding);
  const isolationBonus = model.isolationWeight *
    Math.min(1, nearestPeerKm / model.isolationScaleKm);
  const score = populationScore + isolationBonus - crowdingPenalty;
  const thresholds = model.populationTierThresholds;
  // Approved administrative seats below 50k remain in the source and may be
  // shown in the least prominent band; this does not widen candidate selection.
  const populationTier = population < thresholds[4] ? null
    : 1 + thresholds.slice(0, 4).filter(minimum => population < minimum).length;
  const tier = 1 + thresholds.slice(0, 4).filter(minimum =>
    score < Math.log10(1 + minimum)).length;
  return {
    population, populationTier, tier, priority: Math.min(99, Math.max(1, Math.round(score * 12))),
    minZoom: model.tierMinZoom[tier - 1],
    score: Number(score.toFixed(6)),
    populationScore: Number(populationScore.toFixed(6)),
    crowdingPenalty: Number(crowdingPenalty.toFixed(6)),
    isolationBonus: Number(isolationBonus.toFixed(6)),
  };
}

/** A single evidence snapshot supplies both subject populations and surrounding candidate spacing. */
export function generateApprovedPlaceDisplayRanks(approvedRecords, sourceRows, sourceSha256) {
  if (!Array.isArray(approvedRecords) || !Array.isArray(sourceRows) ||
    !/^[a-f0-9]{64}$/.test(String(sourceSha256))) throw new TypeError('Invalid population ranking inputs');
  const sources = new Map(sourceRows.map(row => [String(row.id), row]));
  const neighbours = displayNeighbourhoodCandidates(sourceRows);
  const entries = {};
  for (const item of approvedRecords) {
    const id = 'geonames:' + item.sourceId;
    const source = sources.get(id);
    if (!source) throw new Error('No source population for approved city ' + item.sourceId);
    entries[item.sourceId] = scorePlacePopulationAndSpacing(source, neighbours);
  }
  return {
    schema: PLACE_RANK_MODEL.schema,
    source: 'GeoNames cities500 via archived analysis gazetteer',
    sourceSha256, sourceDate: '2026-10-29',
    populationNotice: 'Modern GeoNames population (not historical, and may mix administrative/urban boundaries)',
    provisionalWeights: true,
    model: PLACE_RANK_MODEL,
    approvedCount: approvedRecords.length,
    neighbourhoodCandidateCount: neighbours.length,
    entries,
  };
}
