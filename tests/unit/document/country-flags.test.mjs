import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildFrontendIndex, emitFrontendModule, frontendAsset } from '../../../scripts/lib/frontend-layout.mjs';

const root = fileURLToPath(new URL("../../..", import.meta.url));
const frontendIndex = buildFrontendIndex(root);
const flagEntry = frontendAsset(root, 'assets/js/modules/country-flags.js', { index: frontendIndex });
const publicModuleUrl = new URL(flagEntry.publicPath, 'https://flags.test/').href;
// Execute the emitted module at its public identity; repository owners do not
// share the deployed modules/vendor directory layout.
const emittedFlags = emitFrontendModule(flagEntry.bytes.toString('utf8'), flagEntry.sourcePath, frontendIndex);
const { currentCountryFlagUrl, effectiveTerritorialFlagUrl } = await import(
  'data:text/javascript;base64,' + Buffer.from(emittedFlags.replaceAll('import.meta.url', JSON.stringify(publicModuleUrl))).toString('base64'));

// Test precedence and URL behavior, not a frozen geopolitical inventory or asset hash.
test('flag overrides distinguish custom, explicit-none and inherited values', () => {
  const custom = 'data:image/svg+xml;base64,PHN2Zy8+';
  const feature = metadata => ({id:'KOR', properties:{entityKind:'general', metadata}});
  assert.equal(effectiveTerritorialFlagUrl(feature({flagDataUrl:custom})), custom);
  assert.equal(effectiveTerritorialFlagUrl(feature({flagDataUrl:null})), null);
  assert.equal(effectiveTerritorialFlagUrl(feature({})), currentCountryFlagUrl('KOR'));
  assert.equal(effectiveTerritorialFlagUrl({id:'unmapped-fixture', properties:{entityKind:'general'}}), null);
  const region = metadata => ({id:'fixture', properties:{entityKind:'regional', metadata}});
  assert.equal(effectiveTerritorialFlagUrl(region({defaultFlagDataUrl:custom})), custom);
  assert.equal(effectiveTerritorialFlagUrl(region({flagDataUrl:null, defaultFlagDataUrl:custom})), null);
});

test('bundled flags resolve under the public asset origin and carry the requested revision', () => {
  const plain = new URL(currentCountryFlagUrl('KOR'));
  const versioned = new URL(currentCountryFlagUrl('KOR', {assetRevision:'fixture-build'}));
  assert.equal(versioned.origin, new URL(publicModuleUrl).origin);
  assert.equal(versioned.pathname, plain.pathname);
  assert.equal(versioned.searchParams.get('v'), 'fixture-build');
  assert.ok(frontendAsset(root, plain.pathname.slice(1), {index:frontendIndex}).bytes.length);
});
