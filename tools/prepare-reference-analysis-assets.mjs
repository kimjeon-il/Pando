import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE_OCR_LANGUAGES } from '../assets/js/modules/reference-image-ocr-runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = resolve(root, 'assets/vendor/reference-analysis');
const data = resolve(root, 'assets/data/reference-analysis/v1');
const commit = '87416418657359cb625c412a48b6e1d6d41c29bd';
const require = createRequire(import.meta.url);
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core'));
const ort = dirname(require.resolve('onnxruntime-web/wasm'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const check = process.argv.includes('--check');
const manifest = { schemaVersion: 1, tesseractVersion: '7.0.0', tesseractPatch: 'raw-worker-lifecycle-v1', onnxVersion: '1.30.0', files: {}, languages: {}, tessdataRevision: commit };
async function put(relative, bytes) {
  const path = resolve(vendor, relative);
  if (check) {
    if (hash(await readFile(path)) !== hash(bytes)) throw Error('Stale reference runtime asset: ' + relative);
  } else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
  manifest.files[relative] = { sha256: hash(bytes), bytes: bytes.length };
}
// The pinned factory exposes its facade only after initialization, which can
// remain pending after a language-load rejection. Give our operation owner the
// raw Worker immediately so cancellation can terminate it during startup too.
const upstreamTesseract = await readFile(join(tesseract, 'dist/tesseract.esm.min.js'), 'utf8');
const workerHookAnchor = '(D=w(P)).onerror=R,S+=1';
if (upstreamTesseract.split(workerHookAnchor).length !== 2) throw Error('Pinned Tesseract Worker lifecycle patch no longer matches.');
await put('tesseract.mjs', Buffer.from(upstreamTesseract.replace(workerHookAnchor, '(D=w(P)).onerror=R,P.onWorker&&P.onWorker(D),S+=1')));
await put('worker.min.js', await readFile(join(tesseract, 'dist/worker.min.js')));
await put('TESSERACT-LICENSE', await readFile(join(tesseract, 'LICENSE.md')));
await put('WORKER-LICENSE', await readFile(join(tesseract, 'dist/worker.min.js.LICENSE.txt')));
for (const name of (await readdir(core)).filter(name => /^tesseract-core[\w-]*\.wasm\.js$/.test(name)).sort()) {
  const bytes = await readFile(join(core, name));
  const embedded = bytes.toString().match(/["'](AGFzbQE[A-Za-z0-9+/=]+)["']/);
  if (!embedded || !Buffer.from(embedded[1], 'base64').equals(await readFile(join(core, name.slice(0, -3))))) {
    throw Error('Pinned OCR execution variant must embed its complete WASM: ' + name);
  }
  await put('core/' + name, bytes);
}
for (const name of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  await put(name, await readFile(join(ort, name)));
}
const licenseResponse = check ? null : await globalThis.fetch('https://raw.githubusercontent.com/microsoft/onnxruntime/v1.30.0/LICENSE');
if (licenseResponse && !licenseResponse.ok) throw Error('Pinned ONNX license is unavailable.');
await put('ONNX-LICENSE', check ? await readFile(join(vendor, 'ONNX-LICENSE')) : Buffer.from(await licenseResponse.text()));
const tessdataLicense = check ? null : await globalThis.fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${commit}/LICENSE`);
if (tessdataLicense && !tessdataLicense.ok) throw Error('Pinned tessdata license is unavailable.');
await put('TESSDATA-LICENSE', check ? await readFile(join(vendor, 'TESSDATA-LICENSE')) : Buffer.from(await tessdataLicense.text()));
for (const language of ['osd', ...REFERENCE_OCR_LANGUAGES]) {
  const name = language + '.traineddata.gz';
  const path = join(data, 'ocr', name);
  let bytes;
  try { await access(path); bytes = await readFile(path); }
  catch (error) {
    if (check || error.code !== 'ENOENT') throw error;
    const response = await globalThis.fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${commit}/${language}.traineddata`);
    if (!response.ok) throw Error('OCR language download failed: ' + language + ' HTTP ' + response.status, { cause: error });
    const { gzipSync } = await import('node:zlib');
    bytes = gzipSync(Buffer.from(await response.arrayBuffer()));
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
  }
  manifest.languages[language] = { url: name, sha256: hash(bytes), bytes: bytes.length };
}
const json = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
if (check) {
  if (hash(await readFile(join(vendor, 'manifest.json'))) !== hash(json)) throw Error('Stale reference analysis manifest.');
} else {
  await writeFile(join(vendor, 'manifest.json'), json);
  await writeFile(join(data, 'ocr', 'manifest.json'), JSON.stringify({ schemaVersion: 1, source: `https://github.com/tesseract-ocr/tessdata_fast/tree/${commit}`, languages: manifest.languages }, null, 2) + '\n');
}
console.log(`Reference analysis runtime ${check ? 'verified' : 'prepared'}: ${Object.keys(manifest.files).length} assets, ${Object.keys(manifest.languages).length} offline language packs.`);
