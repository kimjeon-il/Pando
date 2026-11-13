#!/usr/bin/env node

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { reportPath } from "../data/report-paths.mjs";

import {
  collectMajorUnnamedEuropeanCandidates,
  renderEuropeanReviewMarkdown,
  validateEuropeanReviewMarkdown,
  selectResearchMainstemFeatures,
  validateReviewEntries,
} from "../lib/hydro-name-research.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkOnly = process.argv.includes('--check');
const decodedPath = optionValue('--decoded');
const reviewPath = reportPath('reports/hydro/names/europe-major-rivers.json', { access: 'read' });
const markdownPath = reportPath('reports/hydro/names/europe-major-rivers.md', { access: checkOnly ? 'read' : 'write' });
const overlayPath = reportPath('reports/hydro/names/europe-major-rivers.geojson', { access: !checkOnly && decodedPath ? 'write' : 'read' });
// Default research validation reconstructs the historical unnamed candidate view
// from the exact current two-file v0.13.2 metadata. For independent archival
// reproduction pass --archive-core with immutable v0.13.0 metadata-core.json.gz.
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const coreMetadataPath = optionValue('--archive-core');
let sourceFeatures;
if (coreMetadataPath) {
  const bytes = fs.readFileSync(path.resolve(coreMetadataPath));
  const pinnedSha = '796ab937222bfa4d123d6fda210f9e96bb90ce9e251c73274dcb0342decc1828';
  if (createHash('sha256').update(bytes).digest('hex') !== pinnedSha)
    throw new Error('Historical hydro name research core does not match pinned SHA-256');
  sourceFeatures = JSON.parse(gunzipSync(bytes)).features;
} else {
  const directory = path.join(root, 'assets', 'data', 'hydro', 'v0.13.2');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const bundle = fs.readFileSync(path.join(directory, 'hydro.bin'));
  const part = manifest.metadata.core;
  if (manifest.version !== '0.13.2' ||
      manifest.container.bytes !== bundle.length ||
      createHash('sha256').update(bundle).digest('hex') !== manifest.container.sha256 ||
      part.url !== 'hydro.bin' || !Number.isSafeInteger(part.offset) ||
      part.offset < 0 || part.offset + part.bytes > bundle.length)
    throw new Error('Invalid current two-file hydro package');
  const compressed = bundle.subarray(part.offset, part.offset + part.bytes);
  if (createHash('sha256').update(compressed).digest('hex') !== part.sha256)
    throw new Error('Current hydro core digest mismatch');
  const approved = new Set(review.entries.filter(x => x.status === 'accepted-candidate')
    .map(x => String(x.systemId)));
  // v0.13.1 promoted only the two name fields on these 23 reviewed systems.
  // Reverting that promotion solely in memory allows the original 33 candidate
  // boundaries/stages to remain independently checked against the report.
  sourceFeatures = JSON.parse(gunzipSync(compressed)).features.map(feature => {
    const id = String(feature.systemId || '');
    return approved.has(id) ? { ...feature, name: '미명명 수계 ' + id } : feature;
  });
}
const currentCandidates = collectMajorUnnamedEuropeanCandidates(sourceFeatures.map(feature => ({
  ...feature,
  bounds: feature.bounds.map(value => Number(value) / 1e6),
})));

validateReviewEntries(review.entries, { expectedCount: 33 });
validateCurrentCandidateSet(currentCandidates, review.entries);
if (!checkOnly && decodedPath) {
  writeOverlay(decodedPath, optionValues('--osm-cache'), review.entries);
}
validateOverlay(JSON.parse(fs.readFileSync(overlayPath, 'utf8')), review.entries);

if (checkOnly) {
  // The historical report is an edited summary with immutable original evidence.
  // Check its research facts and links; do not restore the retired full table.
  validateEuropeanReviewMarkdown(fs.readFileSync(markdownPath, 'utf8'), review);
  console.log('Validated 33 European HydroRIVERS name candidates');
} else {
  fs.writeFileSync(markdownPath, renderEuropeanReviewMarkdown(review));
  console.log(`Wrote ${path.relative(root, markdownPath)} for ${review.entries.length} candidates`);
}

function validateCurrentCandidateSet(candidates, entries) {
  const actual = candidates.map(candidate => candidate.systemId).sort();
  const reviewed = entries.map(entry => String(entry.systemId)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(reviewed)) {
    throw new Error('review system IDs do not match the current v0.13.0 unnamed stage 0/1 candidate set');
  }
  const byId = new Map(candidates.map(candidate => [candidate.systemId, candidate]));
  for (const entry of entries) {
    const candidate = byId.get(String(entry.systemId));
    if (Number(entry.stage) !== candidate.stage) throw new Error(`${entry.systemId} stage is stale`);
    if (JSON.stringify(entry.bounds) !== JSON.stringify(candidate.bounds)) {
      throw new Error(`${entry.systemId} bounds are stale`);
    }
  }
}

function validateOverlay(overlay, entries) {
  if (overlay?.type !== 'FeatureCollection' || !Array.isArray(overlay.features)) {
    throw new Error('hydro name overlay must be a GeoJSON FeatureCollection');
  }
  const reviewed = new Set(entries.map(entry => String(entry.systemId)));
  const hydroIds = new Set(overlay.features
    .filter(feature => feature.properties?.role === 'hydro-mainstem')
    .map(feature => String(feature.properties.systemId)));
  for (const systemId of reviewed) {
    if (!hydroIds.has(systemId)) throw new Error(`overlay is missing Hydro geometry for ${systemId}`);
  }
}

function writeOverlay(decodedFile, cacheFiles, entries) {
  const decoded = JSON.parse(fs.readFileSync(path.resolve(decodedFile), 'utf8'));
  const reviewById = new Map(entries.map(entry => [String(entry.systemId), entry]));
  const features = selectResearchMainstemFeatures(decoded.features, new Set(reviewById.keys()))
    .map(feature => ({
      type: 'Feature',
      properties: {
        systemId: String(feature.metadata.systemId),
        stage: Number(feature.metadata.stage),
        role: 'hydro-mainstem',
        status: reviewById.get(String(feature.metadata.systemId)).status,
        recommendedNameKo: reviewById.get(String(feature.metadata.systemId)).recommendedNameKo || null,
      },
      geometry: feature.geometry,
    }));
  for (const cacheFile of cacheFiles) {
    const records = JSON.parse(fs.readFileSync(path.resolve(cacheFile), 'utf8'));
    for (const record of records) {
      if (!reviewById.has(String(record.id)) || !record.osm) continue;
      features.push({
        type: 'Feature',
        properties: {
          systemId: String(record.id),
          role: 'name-candidate',
          osmId: String(record.rel || record.relationId || record.wayIds?.join(',') || ''),
          recommendedNameKo: reviewById.get(String(record.id)).recommendedNameKo || null,
        },
        geometry: record.osm,
      });
    }
  }
  fs.mkdirSync(path.dirname(overlayPath), { recursive: true });
  fs.writeFileSync(overlayPath, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`);
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function optionValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}
