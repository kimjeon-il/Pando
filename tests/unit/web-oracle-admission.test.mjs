import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadWebOracle } from '../helpers/web-oracle.mjs';
import { createSelectionDomain } from "../../shared/frontend/js/modules/selection-domain.js";
import { createTerritorialEntityStore } from "../../shared/frontend/js/modules/territorial-entity-store.js";

const root = new URL('../fixtures/portability/web-9300609-oracle/', import.meta.url);

test('frozen Web oracle factories are independent of the production mutable owners', async () => {
  const selection = await loadWebOracle('assets/js/modules/selection-domain.js');
  const store = await loadWebOracle('assets/js/modules/territorial-entity-store.js');
  assert.notEqual(selection.createSelectionDomain, createSelectionDomain);
  assert.notEqual(store.createTerritorialEntityStore, createTerritorialEntityStore);
  await assert.rejects(loadWebOracle('assets/js/modules/core-document-client.js'), /not admitted/);
});

test('every original oracle import stays inside the admitted baseline module graph', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const files = new Set(manifest.files.map(row => new URL(row.path, root).href));
  const imports = /^\s*(?:import|export)\s+(?:[^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;
  const dynamicImports = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const row of manifest.files.filter(row => /\.(?:mjs|js)$/.test(row.path))) {
    const url = new URL(row.path, root), source = await readFile(url, 'utf8');
    for (const [,specifier] of [...source.matchAll(imports),...source.matchAll(dynamicImports)]) {
      if (specifier.startsWith('node:')) continue;
      assert.ok(specifier.startsWith('.'), `Unexpected external oracle dependency: ${row.path}: ${specifier}`);
      const dependency = new URL(specifier, url);
      assert.ok(dependency.href.startsWith(root.href), `${row.path} escapes the pinned original Web graph.`);
      assert.ok(files.has(dependency.href), `${row.path} imports an unpinned oracle module: ${specifier}`);
    }
    assert.doesNotMatch(source, /core-document-client|core-session-client|core-wasm-loader/,
      `${row.path} must not call the C++ facade used by the actual comparison.`);
  }
});
