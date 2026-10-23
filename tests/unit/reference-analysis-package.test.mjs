import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { referenceAnalysisAssetPlan } from '../../apps/web-shell/reference-analysis-plan.mjs';

test('pinned reference vendor assets retain their manifest byte identity after checkout', () => {
  const root = new URL('../../assets/vendor/reference-analysis/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  for (const [path, entry] of Object.entries(manifest.files)) {
    const bytes = readFileSync(new URL(path, root));
    assert.equal(bytes.length, entry.bytes, path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, path);
  }
});

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
