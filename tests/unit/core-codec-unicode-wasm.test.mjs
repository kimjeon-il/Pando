import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createOriginalFullDocumentFixture } from '../helpers/web-full-document-fixture.mjs';

const runtimePath = resolve(process.env.PANDOEDITOR_WASM_MODULE ?? fileURLToPath(new URL("../../shared/frontend/static/wasm/pandoeditor-core.js",import.meta.url)));
const [runtimeBytes, wasmBytes, seedBytes] = await Promise.all([
  readFile(runtimePath), readFile(runtimePath.replace(/\.js$/, '.wasm')),
  readFile(new URL('../fixtures/portability/web-document-seed.json', import.meta.url)),
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { default: createCore } = await import(pathToFileURL(runtimePath));
const core = await createCore({ wasmBinary: wasmBytes });
const seed = JSON.parse(seedBytes);
const identity = {
  baseline: '930060923889d17134e36e152c29f4adbb2e60a9',
  sourceSha256: core.coreSourceSha256,
  compilerVersion: core.coreCompilerVersion,
  jsSha256: sha256(runtimeBytes), wasmSha256: sha256(wasmBytes),
  methods: ['documentLoad', 'storageSnapshot', 'exportSnapshot'],
};

// Each JSON snapshot is a real current-format small full document. No command,
// cursor, batch, selection, renderer or current Worker protocol is involved.
const cases = [
  ['short high lone surrogate', 'n\ud800x'],
  ['short low lone surrogate', 'n\udfff x'],
  ['long high lone surrogate', `long-${'x'.repeat(64)}\ud800-tail`],
  ['long low lone surrogate', `long-${'x'.repeat(64)}\udfff-tail`],
  ['short emoji', 'n😀x'],
  ['long emoji and lone surrogates', `long-${'x'.repeat(64)}\ud800😀\udfff-tail`],
];

for (const [label, value] of cases) {
  test(`actual WASM typed name/notes preserve ${label} against frozen Web storage`, t => {
    const input = structuredClone(seed);
    for (const id of ['A', 'R']) {
      const properties = input.territorialEntities.find(row => row.id === id).properties;
      properties.name = value;
      properties.notes = `${value}-notes`;
    }
    const oracle = createOriginalFullDocumentFixture(input);
    const expected = oracle.fullSnapshot();
    const session = new core.DocumentSession({ validateFlagDataUrl() {} });
    try {
      for (const method of identity.methods) assert.equal(typeof session[method], 'function', method);
      const state = session.documentLoad(JSON.stringify(oracle.project), '2026-10');
      assert.deepEqual(JSON.parse(session.storageSnapshot()), expected);
      const exportContext = {
        expectedEpoch: state.epoch, version: '0.99.0',
        savedAt: '2026-10-13T00:00:00.000Z', format: 'pandolab-autosave-full',
      };
      const exported = session.exportSnapshot(exportContext);
      assert.deepEqual(JSON.parse(exported.storageJson), {
        ...expected, version: exportContext.version,
        savedAt: exportContext.savedAt, format: exportContext.format,
      });
      assert.deepEqual(JSON.parse(session.storageSnapshot()), expected, 'Export must preserve the loaded document.');
      t.diagnostic(JSON.stringify(identity));
    } finally { session.delete(); }
  });
}
