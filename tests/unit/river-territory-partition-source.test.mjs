import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const app = fs.readFileSync(new URL('assets/js/app.js', root), 'utf8');
const renderer = fs.readFileSync(new URL('assets/js/modules/gpu-map-renderer.js', root), 'utf8');
const worker = fs.readFileSync(new URL('assets/js/workers/river-territory-partition-worker.js', root), 'utf8');

test('river partition flow uses current display hydro geometry', () => {
  assert.match(app, /queryHydroLogicalFeatures\(bounds, \{ category: 'river' \}\)/);
  assert.match(app, /loadHydroLogicalFeature\(logicalId\)/);
  assert.match(app, /RIVER_TERRITORY_PARTITION_ALGORITHM_REVISION/);
  assert.match(app, /river-territory-partition-worker\.js/);
  assert.doesNotMatch(app, /geometryRole:\s*'source'/);
  assert.doesNotMatch(renderer, /hydroAnnexSource/);
  assert.doesNotMatch(renderer, /geometryRole/);
  assert.match(worker, /buildRiverTerritoryPartitions/);
});

test('river partition candidates are rewound before D3 renders their spherical paths', () => {
  assert.match(
    app,
    /const candidates = \(result\.candidates \|\| \[\]\)\.map\(candidate => \(\{[\s\S]*?geometry: normalizeClippedLandGeometry\(candidate\?\.geometry\),[\s\S]*?\}\)\)\.filter\(candidate => candidate\.geometry && candidate\.donorCountryId\)/,
  );
});

test('river boundaries extend the shared territory component selection flow', () => {
  assert.match(app, /annexUseRiverBoundaries: false/);
  assert.match(app, /composeRiverBoundaryTerritoryComponents/);
  assert.match(app, /state\.annexSelectedComponentKeys/);
  assert.doesNotMatch(app, /annexSelectedRiverPartitionKeys/);
  assert.doesNotMatch(app, /annexRiverPartitionPreviewGeometry/);
  assert.doesNotMatch(app, /annexPhase === 'river-partitions'/);
});

test('frontier pocket implementation and companion assets are completely removed', () => {
  for (const relative of [
    'assets/js/modules/river-annex-metric.js',
    'assets/js/workers/river-annex-worker.js',
    'assets/js/workers/hydro-annex-source-worker.js',
    'assets/data/hydro/annex-source-v1/manifest.json',
    'assets/data/hydro/annex-source-v1/source.json.gz',
    'tools/build-river-annex-source.py',
  ]) assert.equal(fs.existsSync(new URL(relative, root)), false, relative);
});
