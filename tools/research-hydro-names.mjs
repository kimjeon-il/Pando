#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  collectMajorUnnamedEuropeanCandidates,
  selectResearchMainstemFeatures,
  validateReviewEntries,
} from './lib/hydro-name-research.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = path.join(root, 'reports', 'hydro-names');
const reviewPath = path.join(reportDirectory, 'europe-major-rivers.json');
const markdownPath = path.join(reportDirectory, 'europe-major-rivers.md');
const overlayPath = path.join(reportDirectory, 'europe-major-rivers.geojson');
const coreMetadataPath = path.join(root, 'assets', 'data', 'hydro', 'v0.13.0', 'metadata-core.json.gz');

const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const core = JSON.parse(gunzipSync(fs.readFileSync(coreMetadataPath)));
const currentCandidates = collectMajorUnnamedEuropeanCandidates(core.features.map(feature => ({
  ...feature,
  bounds: feature.bounds.map(value => Number(value) / 1e6),
})));

validateReviewEntries(review.entries, { expectedCount: 33 });
validateCurrentCandidateSet(currentCandidates, review.entries);
const decodedPath = optionValue('--decoded');
if (!process.argv.includes('--check') && decodedPath) {
  writeOverlay(decodedPath, optionValues('--osm-cache'), review.entries);
}
validateOverlay(JSON.parse(fs.readFileSync(overlayPath, 'utf8')), review.entries);

const generatedMarkdown = renderMarkdown(review);
if (process.argv.includes('--check')) {
  if (normalizeNewlines(fs.readFileSync(markdownPath, 'utf8')) !== normalizeNewlines(generatedMarkdown)) {
    throw new Error('europe-major-rivers.md is stale; run tools/research-hydro-names.mjs');
  }
  console.log('Validated 33 European HydroRIVERS name candidates');
} else {
  fs.writeFileSync(markdownPath, generatedMarkdown);
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
  fs.mkdirSync(reportDirectory, { recursive: true });
  fs.writeFileSync(overlayPath, `${JSON.stringify({ type: 'FeatureCollection', features })}\n`);
}

function renderMarkdown(document) {
  const counts = Object.fromEntries(['accepted-candidate', 'ambiguous', 'unresolved', 'out-of-scope']
    .map(status => [status, document.entries.filter(entry => entry.status === status).length]));
  const lines = [
    '# 유럽 주요 미명명 강 검증표',
    '',
    `- 기준 데이터: HydroRIVERS ${document.datasetVersion}`,
    `- 조사일: ${document.researchedAt}`,
    `- 원시 후보: ${document.entries.length}개 (accepted-candidate ${counts['accepted-candidate']}, ambiguous ${counts.ambiguous}, unresolved ${counts.unresolved}, out-of-scope ${counts['out-of-scope']})`,
    '- `accepted-candidate` 23개는 사용자 승인 후 hydronym override와 v0.13.1 메타데이터에 반영했다.',
    `- 지도 대조: [GeoJSON 오버레이](./${path.basename(overlayPath)})`,
    '',
    '## 판정 요약',
    '',
    '| systemId | 단계 | 범위 | 상태 | 현지어 원명 | 추천 한글명 | 지오메트리 |',
    '|---|---:|---|---|---|---|---|',
  ];
  for (const entry of document.entries) {
    const scope = entry.scope.inScope ? entry.scope.matchedCountries.join('·') : `제외: ${entry.scope.reason}`;
    const geometry = entry.geometryMatch
      ? `중첩 ${formatNumber(entry.geometryMatch.coverage)}, 중앙 ${formatNumber(entry.geometryMatch.medianDistanceKm)} km, 끝점 ${entry.geometryMatch.endpointMatches}`
      : '-';
    lines.push(`| ${entry.systemId} | ${entry.stage} | ${scope} | ${entry.status} | ${escapeCell(entry.localName || '-')} | ${escapeCell(entry.recommendedNameKo || '-')} | ${geometry} |`);
  }
  lines.push('', '## 상세 근거', '');
  for (const entry of document.entries) {
    lines.push(`### ${entry.systemId} · ${entry.recommendedNameKo || entry.localName || '미확정'}`, '');
    lines.push(`- 판정: **${entry.status}** — ${entry.rationale}`);
    lines.push(`- 경계: ${entry.bounds.join(', ')}`);
    if (entry.aliases?.length) lines.push(`- 별칭: ${entry.aliases.join(', ')}`);
    if (entry.geometryMatch) {
      const gap = entry.geometryMatch.scoreGap == null ? '단일 유효 후보' : entry.geometryMatch.scoreGap;
      lines.push(`- 대조: 중첩률 ${formatNumber(entry.geometryMatch.coverage)}, 평균 ${formatNumber(entry.geometryMatch.meanDistanceKm)} km, 중앙 ${formatNumber(entry.geometryMatch.medianDistanceKm)} km, 하구/끝점 ${entry.geometryMatch.endpointMatches}, 차순위 차이 ${gap}`);
    }
    if (entry.officialSystemMatch) {
      lines.push(`- 공식 수계 대조: ${entry.officialSystemMatch.authority} ${entry.officialSystemMatch.identifier} — ${entry.officialSystemMatch.rationale}`);
    }
    if (entry.hangulize) {
      lines.push(`- 한글라이즈: \`${entry.hangulize.language}\` / \`${entry.hangulize.input}\` → \`${entry.hangulize.output}\` ([재현 URL](${entry.hangulize.url}))`);
    }
    for (const source of entry.sources || []) lines.push(`- ${source.kind}: [${source.label || source.url}](${source.url})${source.id ? ` (ID ${source.id})` : ''}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function formatNumber(value) {
  return value == null || !Number.isFinite(Number(value)) ? '-' : String(value);
}

function escapeCell(value) {
  return String(value).replaceAll('|', '\\|');
}

function normalizeNewlines(value) {
  return String(value).replaceAll('\r\n', '\n');
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
