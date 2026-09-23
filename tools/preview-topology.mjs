import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { feature as topologyFeature } from 'topojson-client';
import { topology } from 'topojson-server';
import { presimplify, quantile } from 'topojson-simplify';

import { validateGeometry } from '../assets/js/modules/geometry-validation.js';
import { buildTopologyPreview as buildSharedTopologyPreview } from '../assets/js/modules/project-preview-topology.js';

function inspectCandidate(candidate) {
  const collection = topologyFeature(candidate, candidate.objects.countries);
  const inspector = fileURLToPath(new URL('./inspect-preview-topology.py', import.meta.url));
  const inspection = spawnSync(process.env.PANDOLAB_PYTHON || 'python', [inspector], {
    input: JSON.stringify(collection),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (inspection.error || inspection.status !== 0) {
    const error = new Error(`미리보기 정밀 형상 검사를 실행하지 못했습니다: ${inspection.stderr || inspection.error?.message || inspection.status}`);
    error.code = 'PREVIEW_VALIDATOR_UNAVAILABLE';
    throw error;
  }
  return JSON.parse(inspection.stdout);
}

export function buildTopologyPreview(canonicalFeatures, options) {
  return buildSharedTopologyPreview(canonicalFeatures, {
    ...options, topology, presimplify, quantile, topologyFeature, validateGeometry, inspectCandidate,
  });
}
