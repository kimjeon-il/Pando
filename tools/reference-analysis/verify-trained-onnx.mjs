// Actual trained-model ORT WASM/PyTorch parity, using only a local static server.
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
  base: { type: 'string' }, model: { type: 'string' }, diagnostics: { type: 'string' }, output: { type: 'string' },
} });
if (Object.values(values).length !== 4) throw Error('--base --model --diagnostics --output required');
const base = new URL(values.base);
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) throw Error('Local static server required');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const requests = new Set();
  const externalRequests = new Set();
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base.origin) {
      externalRequests.add(url.origin);
      await route.abort('blockedbyclient');
      return;
    }
    requests.add(url.pathname);
    await route.continue();
  });
  // Open inert same-origin module source instead of initializing the application.
  await page.goto(new URL('assets/vendor/reference-analysis/manifest.json', base).href);
  const result = await page.evaluate(async ({ base, model, diagnostics }) => {
    const ort = await import(new URL('assets/vendor/reference-analysis/ort.wasm.min.mjs', base).href);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('assets/vendor/reference-analysis/', base).href;
    async function bytes(relative) {
      const response = await fetch(new URL(relative, base));
      if (!response.ok) throw Error(`HTTP ${response.status}: ${relative}`);
      return response.arrayBuffer();
    }
    const manifest = JSON.parse(new TextDecoder().decode(await bytes(model.replace(/\.onnx$/, '.manifest.json'))));
    if (manifest.releaseApproved !== false || manifest.evaluationStatus !== 'pending' || manifest.trainingOnly !== true || !(manifest.optimizerUpdates > 0)) {
      throw Error('Actual pending training-only manifest required');
    }
    const modelBytes = await bytes(model);
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', modelBytes))].map(v => v.toString(16).padStart(2, '0')).join('');
    if (sha256 !== manifest.model.sha256 || modelBytes.byteLength !== manifest.model.bytes) throw Error('Trained ONNX identity mismatch');
    const inputs = {};
    for (const [name, shape] of [['tile', [1, 3, 512, 512]], ['overview', [1, 3, 256, 256]], ['position', [1, 4]]]) {
      inputs[name] = new ort.Tensor('float32', new Float32Array(await bytes(`${diagnostics}/${name}.f32`)), shape);
    }
    const expected = new Float32Array(await bytes(`${diagnostics}/expected-logits.f32`));
    const started = performance.now();
    const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'] });
    const loaded = performance.now();
    try {
      const { logits } = await session.run(inputs);
      const finished = performance.now();
      if (logits.dims.join(',') !== '1,7,512,512' || logits.data.length !== expected.length) throw Error('Incorrect trained output shape');
      let maximumAbsoluteError = 0, sum = 0, finite = true;
      for (let i = 0; i < expected.length; i++) {
        finite &&= Number.isFinite(logits.data[i]) && Number.isFinite(expected[i]);
        const error = Math.abs(logits.data[i] - expected[i]);
        maximumAbsoluteError = Math.max(maximumAbsoluteError, error);
        sum += error;
      }
      if (!finite || maximumAbsoluteError > .005) throw Error('Trained-model numerical parity failed: ' + maximumAbsoluteError);
      return { schemaVersion: 1, purpose: 'trained-model-execution-parity-only', releaseApproved: false,
        independentEvaluation: false, provider: 'onnxruntime-web-wasm-cpu', threads: 1,
        modelSha256: sha256, trainingBatches: manifest.trainingBatches, optimizerUpdates: manifest.optimizerUpdates, outputShape: logits.dims,
        finite, maximumAbsoluteError, meanAbsoluteError: sum / expected.length,
        loadMilliseconds: loaded - started, inferenceMilliseconds: finished - loaded,
        userAgent: navigator.userAgent };
    } finally { await session.release(); }
  }, { base: base.href, model: values.model, diagnostics: values.diagnostics });
  result.requests = [...requests].sort();
  if (externalRequests.size) throw Error('Unexpected external requests: ' + [...externalRequests].join(', '));
  result.externalRequests = 0;
  result.verifierSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
  writeFileSync(values.output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
