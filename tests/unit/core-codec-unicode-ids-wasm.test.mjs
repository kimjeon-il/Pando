import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createOriginalFullDocumentFixture } from '../helpers/web-full-document-fixture.mjs';
import { loadWebOracle } from '../helpers/web-oracle.mjs';

const { resolveWorld } = await loadWebOracle('assets/js/modules/timeline-resolver.js');
const { createSelectionDomain } = await loadWebOracle('assets/js/modules/selection-domain.js');
const runtimePath = resolve(process.env.PANDOEDITOR_WASM_MODULE ?? fileURLToPath(new URL("../../shared/frontend/static/wasm/pandoeditor-core.js",import.meta.url)));
const [jsBytes, wasmBytes, seedBytes] = await Promise.all([
  readFile(runtimePath), readFile(runtimePath.replace(/\.js$/, '.wasm')),
  readFile(new URL('../fixtures/portability/web-document-seed.json', import.meta.url)),
]);
const { default: createCore } = await import(pathToFileURL(runtimePath));
const core = await createCore({ wasmBinary: wasmBytes });
const seed = JSON.parse(seedBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = { sourceSha256: core.coreSourceSha256, compilerVersion: core.coreCompilerVersion,
  jsSha256: hash(jsBytes), wasmSha256: hash(wasmBytes),
  baseline: '930060923889d17134e36e152c29f4adbb2e60a9' };
const cases = [
  ['existing ASCII ID', 'A'],
  ['long ordinary emoji ID', `territory-${'x'.repeat(64)}😀-tail`],
  ['short high lone surrogate ID', 'n\ud800x'],
  ['short low lone surrogate ID', 'n\udfff x'],
  ['long high lone surrogate ID', `territory-${'x'.repeat(64)}\ud800-tail`],
  ['long low lone surrogate ID', `territory-${'x'.repeat(64)}\udfff-tail`],
];
const utf16 = text => Array.from({ length: text.length }, (_, index) =>
  text.charCodeAt(index).toString(16).padStart(4, '0'));

function seedWithIds(id) {
  const geometryId = id === 'A' ? 'shape' : `geometry:${id}`;
  const replacements = new Map([
    ['A', id], ['shape', geometryId], ['territorial:entity:A', `territorial:entity:${id}`],
    ['life:A', `life:${id}`], ['shape:A', `shape:${id}`], ['parent:A', `parent:${id}`],
  ]);
  const convert = value => {
    if (typeof value === 'string') return replacements.get(value) ?? value;
    if (Array.isArray(value)) return value.map(convert);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
      .map(([key, child]) => [replacements.get(key) ?? key, convert(child)]));
    return value;
  };
  return convert(seed);
}
const worldDto = world => ({ month: world.month, entities: world.entities.map(row => ({
  id: row.id, geometryRef: structuredClone(row.geometryRef), parentId: row.parentId,
  coverageMode: row.coverageMode, rootId: row.rootId, ancestors: [...row.ancestors],
  validFrom: row.validFrom, validTo: row.validTo,
})) });
const refDto = value => value && ({ domain: value.domain, type: value.type, id: value.id });

for (const [label, id] of cases) {
  test(`actual WASM preserves ${label} in snapshots and typed ID outputs`, async t => {
    const oracle = createOriginalFullDocumentFixture(seedWithIds(id));
    const expected = oracle.fullSnapshot();
    const document = new core.DocumentSession({ validateFlagDataUrl() {} });
    const selected = createSelectionDomain({ refExists: ref => ref.id === id });
    try {
      const state = document.documentLoad(JSON.stringify(oracle.project), '2026-10');
      assert.equal(Object.hasOwn(core,'CoreSession'),false);
      const loadedTimeline = document.documentSnapshot().timelineRecords;
      const actualWorld = document.resolveWorld('2026-10', state.epoch);
      const expectedWorld = worldDto(resolveWorld(oracle.store.identities(), oracle.state.timelineRecords,
        oracle.state.geometries, '2026-10'));
      const ref = { domain: 'territorial', type: 'entity', id };
      let oracleSelectionError = null;
      try { selected.replace(ref); } catch (error) { oracleSelectionError = error; }
      let actualSelectionError = null, actualSelection = null;
      try { actualSelection = document.selectionApply({ action: 'replace', ref, expectedEpoch: state.epoch }).selection; }
      catch (error) { actualSelectionError = error; }
      const readSelection = document.selectionSnapshot();
      if (id === 'A') t.diagnostic(JSON.stringify(identity));
      t.diagnostic(JSON.stringify({ idUtf16Length: id.length, idUtf16Tail: utf16(id).slice(-8),
        oracleSelectionError: oracleSelectionError?.name ?? null,
        actualSelectionError: actualSelectionError?.name ?? null,
        actualSelectedIdUtf16Tail: actualSelection?.primary ? utf16(actualSelection.primary.id).slice(-8) : null,
        readSelectedIdUtf16Tail: readSelection.primary ? utf16(readSelection.primary.id).slice(-8) : null }));

      await t.test('full storage and file export preserve exact UTF-16 IDs', () => {
        assert.deepEqual(JSON.parse(document.storageSnapshot()), expected);
        const context = { expectedEpoch: state.epoch, version: '0.99.0',
          savedAt: '2026-10-13T00:00:00.000Z', format: 'pandolab-project-state' };
        const exported = document.exportSnapshot(context);
        assert.deepEqual(JSON.parse(exported.storageJson), { ...expected,
          version: context.version, savedAt: context.savedAt, format: context.format });
      });
      await t.test('the whole-document projection preserves original Web timeline record IDs', () => {
        assert.deepEqual(loadedTimeline,expected.timelineRecords);
      });
      await t.test('typed resolveWorld IDs, parent/root/ancestor IDs and geometry refs match original Web', () => {
        assert.deepEqual(worldDto(actualWorld), expectedWorld);
      });
      await t.test('typed selection follows original Web admission and exact ID values', () => {
        if (oracleSelectionError) {
          assert.equal(oracleSelectionError.name, 'URIError');
          assert.ok(actualSelectionError, 'Original Web rejects lone-surrogate selection; actual WASM must reject it too.');
        } else {
          assert.equal(actualSelectionError, null);
          const snapshot = selected.snapshot();
          assert.deepEqual(actualSelection.items, snapshot.selection.items.map(refDto));
          assert.deepEqual(actualSelection.primary, refDto(snapshot.selection.items[0]));
          assert.deepEqual(readSelection, actualSelection);
        }
      });
    } finally { selected.dispose(); document.delete(); }
  });
}
