import assert from 'node:assert/strict';
import test from 'node:test';
import {buildHydroGenerationManifest} from '../../tools/gis/hydro-generation-manifest.mjs';

test('Hydro generation manifest combines only supplied source receipts and pack identities',()=>{
  const hash='a'.repeat(64),layout={index:{sha256:hash},metadata:{version:5},shards:[]},stats={featureCount:2},
    sourceRows=[{datasetCode:'eu',files:[],seedReachCount:2,selectedReachCount:3,continuityReachCount:1,
      terminalClassCounts:{sea:1},borderAlignedLengthKm:3.14,systemCount:1,nameMatches:1,osmMatches:0}],
    source={naturalEarthNameReference:[{file:'rivers_base.geojson',sha256:hash}],drainageFreeWaterMask:{file:'mask.tif',sha256:hash},
      naturalEarthLakes:{file:'lakes_base.geojson',sha256:hash,selected:1},osmWaterways:{file:null,matchedSystems:0,license:'ODbL'},
      hydronymOverrides:{file:'overrides.json',sha256:hash},independentHydronymReplacements:{file:'independent.json',sha256:hash,replacedSystems:0,geometryChanged:false}};
  const manifest=buildHydroGenerationManifest({layout,stats,sourceRows,source,namedSystems:1,unnamedSystems:0,osmMatches:0});
  assert.equal(manifest.schema,'pandolab-water-shards-v5');assert.equal(manifest.cache.name,'pandolab-water-v0.13.1-aaaaaaaaaaaa');
  assert.equal(manifest.stats.seedReachCount,2);assert.equal(manifest.stats.borderAlignedLengthKm,3.1);
  assert.deepEqual(manifest.stats.terminalClassCounts,{sea:1});assert.deepEqual(manifest.sources.hydroRivers,sourceRows);
});
