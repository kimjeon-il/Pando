import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceAnalysisAssetPlan } from '../../apps/web-shell/reference-analysis-plan.mjs';

test('reference packaging owns exactly manifest-listed runtime and local OCR weights', () => {
  const languages = { eng: { url: 'eng.traineddata.gz', sha256: 'a'.repeat(64), bytes: 42 } };
  const plan = referenceAnalysisAssetPlan({ schemaVersion: 1, files: { 'core/tesseract-core.wasm': { sha256: 'b'.repeat(64), bytes: 32 } }, languages },
    { schemaVersion: 1, languages }, null);
  assert.equal(plan.entries.length, 2);
  assert.equal(plan.bytes, 74);
  assert.equal(plan.entries[1].path, 'assets/data/reference-analysis/v1/ocr/eng.traineddata.gz');
  assert.throws(() => referenceAnalysisAssetPlan({ schemaVersion: 1, files: { '../escape': { sha256: 'b'.repeat(64), bytes: 1 } }, languages }, { schemaVersion: 1, languages }), /path/);
  assert.throws(() => referenceAnalysisAssetPlan({ schemaVersion: 1, files: {}, languages }, { schemaVersion: 1, languages: {} }), /language/);
});
