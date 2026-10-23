import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('every bundled OCR language can initialize and recognize sequentially without external requests', async ({ page }) => {
  test.setTimeout(180_000);
  const external = [], packs = new Set();
  page.on('request', request => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:')) external.push(url);
    const match = url.match(/\/([a-z_]+)\.traineddata\.gz$/);if (match) packs.add(match[1]);
  });
  await page.route('**/reference-language-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8">' }));
  await page.goto('/reference-language-harness');
  const languages = await page.evaluate(async () => {
    const { createReferenceOcrDetector, REFERENCE_OCR_LANGUAGES } = await import('/assets/js/modules/reference-image-ocr-runtime.js');
    const canvas = new OffscreenCanvas(320, 100), drawing = canvas.getContext('2d');
    drawing.fillStyle = '#fff';drawing.fillRect(0, 0, 320, 100);drawing.fillStyle = '#000';drawing.font = '28px sans-serif';drawing.fillText('Map 123 Αθήνα', 8, 58);
    // This verifies actual model loading/ABI/resource lifetime, not historical
    // OCR quality for these scripts. Workers are released between languages.
    await (await createReferenceOcrDetector(REFERENCE_OCR_LANGUAGES)).detect(canvas);
    return REFERENCE_OCR_LANGUAGES;
  });
  expect(languages).toHaveLength(29);
  expect([...packs].sort()).toEqual([...languages].sort());
  expect(external).toEqual([]);
});

test('bundled offline Tesseract reads the actual archived China-Korea map', async ({ page }) => {
  const original = await readFile(new URL('../../tools/historical-library/sources/korea/ibs017-1962-map.jpg', import.meta.url));
  const external = [];
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url());
  });
  await page.route('**/reference-ocr-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Offline OCR integration</title>' }));
  await page.goto('/reference-ocr-harness');
  const result = await page.evaluate(async bytes => {
    const { detectReferenceImageText } = await import('/assets/js/modules/reference-image-ocr.js');
    const image = new Image();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    try {
      image.src = url;
      await image.decode();
      return await detectReferenceImageText(image, { languages: ['eng'] });
    } finally { URL.revokeObjectURL(url); }
  }, [...original]);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(result.provider).toBe('tesseract');
  expect(result.detections.map(row => row.text).join(' ')).toMatch(/CHINA.?KOREA BORDER/i);
  expect(external).toEqual([]);
});

test('analysis corrects a rotated archived map and restores OCR boxes to its loaded source pixels', async ({ page }) => {
  const original = await readFile(new URL('../../tools/historical-library/sources/korea/ibs017-1962-map.jpg', import.meta.url));
  await page.route('**/reference-rotated-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/assets/js/build-meta.js"></script>' }));
  await page.goto('/reference-rotated-harness');
  const result = await page.evaluate(async bytes => {
    const { createReferenceAnalysisClient } = await import('/assets/js/modules/reference-image-analysis-client.js');
    const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    const canvas = new OffscreenCanvas(image.height, image.width), drawing = canvas.getContext('2d');
    drawing.translate(canvas.width, 0);drawing.rotate(Math.PI / 2);drawing.drawImage(image, 0, 0);image.close();
    const client = createReferenceAnalysisClient({ getGeneration: () => 1 });
    try { return await client.run('reference.ocr', { blob: await canvas.convertToBlob(), languages: ['eng'] }); }
    finally { client.dispose(); }
  }, [...original]);
  expect(result.orientation.clockwiseDegrees, JSON.stringify(result.orientation)).toBe(270);
  expect(result.detections.map(row => row.text).join(' ')).toMatch(/CHINA.?KOREA BORDER/i);
  const title = result.detections.find(row => /CHINA/i.test(row.text));
  expect(title.box[0]).toBeGreaterThan(.8);
  expect(title.box[0] + title.box[2]).toBeLessThanOrEqual(1);
});

test('analysis RPC executes real bundled OCR and reports missing weights when native assets return HTML', async ({ page }) => {
  const original = await readFile(new URL('../../tools/historical-library/sources/korea/ibs017-1962-map.jpg', import.meta.url));
  const external = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:')) external.push(request.url()); });
  await page.route('**/reference-worker-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/assets/js/build-meta.js"></script>' }));
  await page.route('**/reference-analysis/v1/boundary.manifest.json', route => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><title>PandoLab native entry</title>' }));
  await page.goto('/reference-worker-harness');
  const result = await page.evaluate(async bytes => {
    const { createReferenceAnalysisClient } = await import('/assets/js/modules/reference-image-analysis-client.js');
    const client = createReferenceAnalysisClient({ getGeneration: () => 1 });
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
    try {
      const ocr = await client.run('reference.ocr', { blob, languages: ['eng'] });
      let modelError;
      try { await client.run('reference.segment', { blob }); } catch (error) { modelError = error.code; }
      return { ocr, modelError };
    } finally { client.dispose(); }
  }, [...original]);
  expect(result.ocr.ok).toBe(true);
  expect(result.ocr.detections.map(row => row.text).join(' ')).toMatch(/CHINA.?KOREA BORDER/i);
  expect(result.modelError).toBe('PL-REF-MODEL-MISSING');
  expect(external).toEqual([]);
});
