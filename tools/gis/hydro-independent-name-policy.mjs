/** Canonical read-only independent hydronym evidence gate.
 * An OSM relation match is not independent identification; no geometry is written.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.length > 0;
const coverageBetween = (value, lo, hi, upperInclusive = false) =>
  numeric(value) && value >= lo && (upperInclusive ? value <= hi : value < hi);
const atLeast = (value, minimum) => numeric(value) && value >= minimum;
const includes = (set, ...names) => names.every(name => set.has(name));
const ensure = (condition, message) => { if (!condition) throw new Error(message); };

export function validateIndependentHydronyms(document) {
  ensure(isObject(document) && document.schemaVersion === 1 && Array.isArray(document.replacements),
    'Invalid independent hydronym verification schema');
  const verified = {};
  for (const item of document.replacements) {
    ensure(isObject(item), 'Independent hydronym entry must be an object');
    const id = String(item.systemId || '');
    ensure(/^[1-9][0-9]+$/.test(id) && !Object.hasOwn(verified, id),
      'Invalid or repeated independent hydronym system ID');
    const name = item.nameKo;
    ensure(text(name) && /[가-힣]/u.test(name), 'Missing verified Korean name for system ' + id);
    for (const key of ['aliases', 'tributaryNames']) {
      ensure(Array.isArray(item[key]) && item[key].every(value =>
        text(value) && value.trim() && value !== name),
      'Invalid verified ' + key + ' for system ' + id);
    }
    const geom = item.naturalEarth, rate = geom?.sampleCoverage;
    const namedNe = isObject(geom) && text(geom.name);
    const neValid = namedNe && coverageBetween(rate, 0.85, 1, true);

    const station = item.officialStationEvidence;
    const stationIds = station?.stationIds;
    const stationValid = isObject(station) && station.agency === 'USGS' &&
      Array.isArray(stationIds) && stationIds.length >= 3 &&
      new Set(stationIds).size === stationIds.length &&
      stationIds.every(idValue => text(idValue) && idValue.startsWith('USGS-')) &&
      coverageBetween(station.maximumMatchingStationDistanceKm, 0, 1, true) &&
      atLeast(station.nearestDifferentBasinStationKm, 20) &&
      text(station.checkedAgainstSystemId) && station.checkedAgainstSystemId !== id;

    const conservative = item.conservativeMainstemReview;
    const conservativeValid = isObject(conservative) &&
      conservative.method === 'official-corroborated-original-name' &&
      item.previousNameKo === name && namedNe && coverageBetween(rate, 0.70, 0.85) &&
      coverageBetween(conservative.otherNamedNECoverage, 0, 0.15) &&
      text(conservative.reason) && conservative.reason.length >= 24;

    const basin = item.basinConfluenceReview;
    const basinValid = isObject(basin) &&
      basin.method === 'official-basin-named-confluence' &&
      item.previousNameKo === name && namedNe && coverageBetween(rate, 0.35, 0.85) &&
      text(basin.namedTributaryNE) && basin.namedTributaryNE !== geom.name &&
      coverageBetween(basin.tributarySampleCoverage, 0.19, 1) &&
      rate + basin.tributarySampleCoverage >= 0.75 &&
      text(basin.reason) && basin.reason.length >= 40;

    const rename = item.independentBasinRename;
    const renameValid = isObject(rename) &&
      rename.method === 'independent-government-basin-rename' &&
      item.previousNameKo !== name && namedNe && atLeast(rate, 0.5) &&
      text(rename.namedTributaryNE) && rename.namedTributaryNE !== geom.name &&
      atLeast(rename.tributarySampleCoverage, 0.3) &&
      rate + rename.tributarySampleCoverage >= 0.9 &&
      text(rename.sourceErroneousTributaryName) &&
      rename.sourceErroneousTributaryName.length >= 3 &&
      text(rename.reason) && rename.reason.length >= 100;

    const partial = item.partialExistingNameReview;
    const partialValid = isObject(partial) &&
      partial.method === 'government-confirmed-existing-mainstem-no-independent-rival' &&
      item.previousNameKo === name && namedNe && coverageBetween(rate, 0.45, 0.70) &&
      coverageBetween(partial.strongestOtherNENameCoverage, 0, 0.05, true) &&
      text(partial.reason) && partial.reason.length >= 100;

    const government = item.officialGovernmentVectorEvidence;
    const govValid = isObject(government) &&
      government.method === 'official-government-polyline-confirmation' &&
      item.previousNameKo === name &&
      text(government.namedFeature) && text(government.referenceLayer) &&
      government.referenceLayer.startsWith('https://') &&
      /^[0-9a-f]{64}$/.test(government.sourceGeoJSONSha256 || '') &&
      Number.isInteger(government.hydroMainstemSamples) &&
      government.hydroMainstemSamples >= 100 &&
      coverageBetween(government.within1kmHydroToGovernment, 0.95, 1, true) &&
      coverageBetween(government.within1kmGovernmentToHydro, 0.85, 1, true) &&
      coverageBetween(government.p90DistanceKm, 0, 0.75, true);

    const border = item.crossBorderNameReview;
    const borderValid = isObject(border) &&
      border.method === 'bulgarian-greek-institutional-mainstem-confirmation' &&
      item.previousNameKo === name && namedNe && coverageBetween(rate, 0.35, 0.45) &&
      coverageBetween(border.strongestOtherNENameCoverage, 0, 0.05, true) &&
      text(border.reason) && border.reason.length >= 160;

    ensure([neValid, stationValid, conservativeValid, basinValid, renameValid, partialValid,
      govValid, borderValid].some(Boolean), 'Missing independent mainstem evidence for system ' + id);

    const references = item.independentSources;
    ensure(Array.isArray(references) && references.length >= 2,
      'Missing multiple independent references for system ' + id);
    const kinds = new Set();
    for (const source of references) {
      ensure(isObject(source), 'Invalid independent source for system ' + id);
      const url = source.url, kind = source.kind;
      ensure(text(url) && url.startsWith('https://') && text(kind),
        'Invalid independent source URL for system ' + id);
      ensure(!/openstreetmap|overpass/i.test(url) && kind.toLowerCase() !== 'osm',
        'OSM cannot be a replacement source for system ' + id);
      kinds.add(kind);
    }
    const vector = kinds.has('public-domain-vector') && kinds.size >= 2;
    const gauges = stationValid && includes(kinds, 'government-hydrology', 'government-gauging');
    if (conservativeValid) ensure(includes(kinds, 'government-hydrology', 'public-domain-vector'),
      'Official river authority needed for conservative mainstem ' + id);
    if (basinValid) ensure(kinds.has('public-domain-vector') &&
      (kinds.has('government-hydrology') || kinds.has('multilateral-basin-agency')),
    'Government river basin authority needed for ' + id);
    if (renameValid) ensure(includes(kinds, 'public-domain-vector', 'government-hydrology',
      'government-ministry-geography', 'government-river-identification'),
    'Multiple independent government sources needed for river rename ' + id);
    if (partialValid) ensure(includes(kinds, 'public-domain-vector', 'government-hydrology') &&
      (kinds.has('government-river-monitoring') || kinds.has('government-river-atlas')),
    'Two official references needed for partial mainstem ' + id);
    if (govValid) ensure(includes(kinds, 'government-river-vector', 'government-river-authority',
      'government-open-data-license'), 'Government vector/authority/license missing for ' + id);
    if (borderValid) ensure(includes(kinds, 'public-domain-vector', 'government-hydrology',
      'government-crossborder-hydrology', 'international-crossborder-programme'),
    'Two adjacent governments and separate regional source required for ' + id);
    ensure(vector || gauges || govValid,
      'Independent geodata and named hydrology evidence required for ' + id);
    ensure([neValid, gauges, conservativeValid, basinValid, renameValid, partialValid,
      govValid, borderValid].some(Boolean), 'Missing verified mainstem corroboration for ' + id);
    verified[id] = item;
  }
  return verified;
}
export function loadIndependentHydronyms(path) {
  return validateIndependentHydronyms(JSON.parse(readFileSync(path, 'utf8')));
}
const close=(a,b,tolerance)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<tolerance;
export function verifyStationEvidence(stations,review){
  for(const id of ['70816878','70819626']){
    const measured=stations.candidateSystems[id],recorded=review[id].officialStationEvidence;
    const own=new Set(stations.stationRows.filter(row=>row.independentHydrography===measured.candidateName).map(row=>row.station));
    const expected=new Set(recorded.stationIds);
    ensure(measured.criteriaSatisfied,'Station criteria failed: '+id);
    ensure(own.size===expected.size&&[...own].every(station=>expected.has(station)),'Station identity mismatch: '+id);
    ensure(close(recorded.maximumMatchingStationDistanceKm,measured.maxMatchingStationDistanceKm,.002)&&
      close(recorded.nearestDifferentBasinStationKm,measured.nearestDifferentBasinStationKm,.002),'Station distance mismatch: '+id);
  }
}
export function verifyNaturalEarthEvidence(review,evidence){
  const byId=new Map(evidence.items.map(row=>[String(row.systemId),row]));
  ensure(byId.size===evidence.items.length,'Repeated Natural Earth system ID');
  for(const entry of review.replacements){
    if(entry.naturalEarth==null)continue;
    const id=entry.systemId,candidates=byId.get(id)?.naturalEarthCandidates;
    ensure(Array.isArray(candidates),'Missing Natural Earth system: '+id);
    const match=candidates.find(row=>row.name===entry.naturalEarth.name);
    ensure(match&&close(match.sampleCoverage,entry.naturalEarth.sampleCoverage,.001),'Natural Earth candidate mismatch: '+id);
    const competing=Math.max(0,...candidates.filter(row=>row.name!==match.name&&row.nameKo).map(row=>row.sampleCoverage));
    if(entry.conservativeMainstemReview){
      ensure(candidates[0].name===match.name&&close(competing,entry.conservativeMainstemReview.otherNamedNECoverage,.001)&&match.meanDistanceDegrees<=.04,'Conservative competing candidate mismatch: '+id);
    }
    if(entry.crossBorderNameReview){
      ensure(close(competing,entry.crossBorderNameReview.strongestOtherNENameCoverage,.001)&&match.sampleCoverage>=.35&&match.sampleCoverage<.45&&match.meanDistanceDegrees<.06,'Cross-border competing candidate mismatch: '+id);
    }
    if(entry.partialExistingNameReview){
      ensure(candidates[0].name===match.name&&close(competing,entry.partialExistingNameReview.strongestOtherNENameCoverage,.001)&&competing<=.05&&match.meanDistanceDegrees<=.025,'Partial competing candidate mismatch: '+id);
    }
    const confluence=entry.basinConfluenceReview||entry.independentBasinRename;
    if(confluence){
      const trib=candidates.find(row=>row.name===confluence.namedTributaryNE),threshold=entry.independentBasinRename ? .90 : .75;
      ensure(trib&&close(trib.sampleCoverage,confluence.tributarySampleCoverage,.001)&&match.sampleCoverage+trib.sampleCoverage>=threshold&&match.meanDistanceDegrees<=.05&&trib.meanDistanceDegrees<=.05,'Confluence candidate mismatch: '+id);
    }
  }
}
export function verifyYarraEvidence(match,review){
  const recorded=review.replacements.find(row=>row.systemId==='50798885').officialGovernmentVectorEvidence;
  ensure(match.source.sourceGeoJSONSha256===recorded.sourceGeoJSONSha256,'Yarra source hash mismatch');
  ensure(match.hydroSamplesToNamedGovernmentRiver.samples===recorded.hydroMainstemSamples,'Yarra sample count mismatch');
  ensure(close(match.hydroSamplesToNamedGovernmentRiver.within1km,recorded.within1kmHydroToGovernment,.0002)&&
    close(match.governmentSamplesToHydroMainstem.within1km,recorded.within1kmGovernmentToHydro,.0002)&&
    close(match.hydroSamplesToNamedGovernmentRiver.p90DistanceKm,recorded.p90DistanceKm,.01),'Yarra distance mismatch');
  ensure(match.source.license==='CC BY 4.0','Yarra license mismatch');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--input')
      throw new Error('Usage: node hydro-independent-name-policy.mjs --input FILE');
    process.stdout.write(JSON.stringify(loadIndependentHydronyms(resolve(process.argv[3]))) + '\n');
  } catch (error) {
    console.error('hydro-independent-names: ' + error.message);
    process.exitCode = 1;
  }
}
