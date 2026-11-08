import { describe as contractSuite } from 'node:test';
import * as __dep0 from "node:test";
import * as __dep1 from "node:assert/strict";
import * as __dep2 from "node:crypto";
import * as __dep3 from "node:fs";
import * as __dep4 from "../../src/data/world-bundle-manifest.js";
import * as __dep5 from "../../tools/gis/publication-label-anchors.mjs";
import * as __dep6 from "../../src/rendering/country-mesh-codec.js";
import * as __dep7 from "../../src/runtime/worker-asset-url.js";
import * as __dep8 from "../../tools/build/builtin-world-compiler.mjs";
import * as __dep9 from "../fixtures/historical-world-cases.mjs";
import * as __dep10 from "../helpers/builtin-world.mjs";

// Original feature contract: publication-world-integrity.test.mjs
contractSuite("publication-world-integrity", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { createHash }=__dep2;
const { readFileSync }=__dep3;
const { parseVerifiedWorldBundle }=__dep4;

const bytes = readFileSync(new URL('../../assets/data/world/current.json', import.meta.url));
const spec = { sha256: createHash('sha256').update(bytes).digest('hex'), compressedBytes: bytes.length,
  decodedBytes: bytes.length, encoding: 'identity' };

test('published world manifest is admitted only when its exact bytes match the release receipt', async () => {
  const admitted = await parseVerifiedWorldBundle(bytes, spec);
  assert.equal(admitted.countryCount, JSON.parse(bytes.toString('utf8')).source.countryCount);
  await assert.rejects(parseVerifiedWorldBundle(Buffer.concat([bytes, Buffer.from(' ')]), spec), /무결성|크기/);
});
});

// Original feature contract: publication-label-anchors.test.mjs
contractSuite("publication-label-anchors", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { retainedLabelAnchors }=__dep5;

const square = x => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
test('publication retains only label anchors for countries whose geometry is unchanged', () => {
  const before = { features: [{ id: 'A', geometry: square(0) }, { id: 'B', geometry: square(2) }] };
  const after = { features: [{ id: 'A', geometry: square(0) }, { id: 'B', geometry: square(3) }] };
  const anchors = { version: '0.10.1', anchors: { A: [0.5, 0.5], B: [2.5, 0.5] } };
  assert.deepEqual(retainedLabelAnchors({ before, after, anchors }).anchors, { A: [0.5, 0.5] });
});
});

// Original feature contract: publication-mesh-count.test.mjs
contractSuite("publication-mesh-count", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { decodeCountryMesh }=__dep6;

test('current snapshot mesh count follows its verified header and identity list', () => {
  const buffer = new ArrayBuffer(84);
  new Uint32Array(buffer, 0, 12).set([0x434d4731, 2, 1, 0, 0, 0, 1, 5, 2, 2, 4, 1]);
  assert.equal(decodeCountryMesh(buffer, ['A']).ids[0], 'A');
  assert.throws(() => decodeCountryMesh(buffer, ['A', 'B']), /국가|identity|count/i);
});
});

// Original feature contract: publication-worker-pin.test.mjs
contractSuite("publication-worker-pin", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { workerAssetUrl, workerBuildMeta, runtimeDataRoot, runtimeDataAssetUrl }=__dep7;

test('all viewer workers inherit the data identity from the pinned build metadata', () => {
  const input = new URL('https://example.test/Pando/assets/js/workers/gpu-mesh-worker.js?mode=preview');
  const meta = { assetRevision: 'code-1', dataRevision: 'a'.repeat(64),
    workerAssets: {
      'assets/js/workers/gpu-mesh-worker.js': {
        url: `assets/worker-runtime/${'c'.repeat(32)}/assets/js/workers/gpu-mesh-worker.js`,
      },
    } };
  const result = workerAssetUrl(input, meta);
  assert.equal(result.searchParams.get('dataRevision'), meta.dataRevision);
  assert.equal(result.searchParams.has('publicationRevision'), false);
  assert.equal(result.searchParams.has('publicationManifestSha256'), false);
  assert.equal(result.searchParams.get('mode'), 'preview');
});

test('a Worker rejects metadata from a different deployment or data pin', () => {
  const meta = { assetRevision: 'code-1', dataRevision: 'data-1' };
  const url = 'https://example.test/Pando/assets/worker-runtime/abc/assets/js/workers/a.js?v=code-1&dataRevision=data-1';
  assert.equal(workerBuildMeta(url, meta), meta);
  assert.throws(() => workerBuildMeta(url, { ...meta, dataRevision: 'other' }), /revision mismatch/);
  assert.throws(() => workerBuildMeta(url, { ...meta, assetRevision: 'other' }), /revision mismatch/);
  assert.throws(() => workerBuildMeta(url, {}), /revision mismatch/);
  assert.equal(runtimeDataRoot(url).href, 'https://example.test/Pando/');
  const asset = { url: 'assets/data/prepared-polygons/generated/v2/mesh.gz', sha256: 'a'.repeat(64) };
  assert.equal(runtimeDataAssetUrl(url, asset).href, `https://example.test/Pando/${asset.url}?sha256=${asset.sha256}`);
  for (const path of ['../private', 'assets/data/../private', 'assets/data/a?b', 'assets/data/a\\b']) {
    assert.throws(() => runtimeDataAssetUrl(url, { ...asset, url: path }), /Invalid/);
  }
});
});

// Original feature contract: publication-world-count.test.mjs
contractSuite("publication-world-count", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { readFileSync }=__dep3;
const { validateWorldBundle }=__dep4;

test('a published current snapshot may contain fewer countries after an explicit deletion', () => {
  const bundle = JSON.parse(readFileSync(new URL('../../assets/data/world/current.json', import.meta.url)));
  bundle.source.countryCount -= 1;
  assert.equal(validateWorldBundle(bundle).countryCount, bundle.source.countryCount);
});
});

// Original feature contract: publication-world-metadata.test.mjs
contractSuite("publication-world-metadata", () => {
const test=__dep0.default;
const assert=__dep1.default;
const { compileBuiltinWorldCatalog }=__dep8;
const { historicalWorldCases }=__dep9;
const { withExplicitView }=__dep10;
test('edited country names and flags reach independently published runtime identities',()=>{
 const input=withExplicitView(historicalWorldCases());
 const source=input.entities.find(row=>row.sourceInfo?.featureId==='KOR');source.names.ko='새 대한민국';
 const feature=input.currentWorld.features.find(row=>row.id==='KOR');feature.properties.name='새 대한민국';
 feature.properties.metadata={flagDataUrl:'assets/vendor/edited-kor.svg'};
 const compiled=compileBuiltinWorldCatalog(input);
 const country=compiled.countries.find(row=>row.entityId==='KOR');
 assert.equal(country.identity.properties.name,'새 대한민국');
 assert.equal(country.identity.properties.metadata.flagDataUrl,'assets/vendor/edited-kor.svg');
});
});
