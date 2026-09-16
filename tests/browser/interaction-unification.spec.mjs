import { test, expect } from '@playwright/test';

test.use({ channel: 'chromium', viewport: { width: 1440, height: 900 } });

test('Canvas ownership keeps overlap pixels equal to a single highest grade', async ({ page }) => {
  await page.goto('/assets/js/workers/canvas-scene-composition-core.js');
  const pixels = await page.evaluate(async () => {
    await import('/assets/js/workers/canvas-scene-composition-core.js');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
    const context = canvas.getContext('2d');
    const background = () => { context.globalAlpha = 1; context.fillStyle = '#789abc'; context.fillRect(0, 0, 80, 80); };
    const path = geometry => context.rect(...geometry.rect);
    const primary = { key: 'primary', priority: 4, geometry: { rect: [10, 10, 50, 50] }, style: { color: '#1267ad', fillAlpha: 0.24 } };
    const secondary = { key: 'secondary', priority: 3, geometry: { rect: [20, 20, 50, 50] }, style: { color: '#1267ad', fillAlpha: 0.14 } };
    const draw = entries => { background(); window.PandoLabCanvasSceneComposition.drawEmphasis(context, path, entries, 1); return [...context.getImageData(30, 30, 1, 1).data]; };
    const result = [draw([primary]), draw([secondary, primary]), draw([primary, secondary]), draw([primary, { ...primary, key: 'duplicate' }])];
    background();
    window.PandoLabCanvasSceneComposition.drawEmphasis(context, path, [primary, secondary], 1, { key: 'lake', draw: mask => { mask.fillStyle = '#fff'; mask.fillRect(25, 25, 15, 15); } });
    return { result, water: [...context.getImageData(30, 30, 1, 1).data] };
  });
  for (const pixel of pixels.result.slice(1)) for (let i = 0; i < 4; i++) expect(Math.abs(pixel[i] - pixels.result[0][i])).toBeLessThanOrEqual(2);
  expect(pixels.water).toEqual([120, 154, 188, 255]);
});

test('unified emphasis boots and selects a country with the configured style', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
    appearance: { theme: 'light' }, selection: { color: '#1267ad', outlineVisible: true, fillStrength: 0 } })));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__?.hover.fillAlpha)).toBe(0);
  try {
    await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection.gpuCoverage?.primary?.renderedKeys || []), { timeout: 30000 }).toContain('country:DEU');
  } catch (error) {
    console.log(JSON.stringify(await page.evaluate(() => {
      const s = window.__PANDOLAB_RENDER_DEBUG__.snapshot();
      return { selection: s.selection, gpuSelection: s.gpuSelection, errors: document.querySelector('#fatalError')?.textContent };
    })));
    throw error;
  }
  expect(errors).toEqual([]);
});

test('adjacent countries share prepared boundaries and list hover never adds a selected hover channel', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await page.locator('#objectSearchBtn').click();
  for (const [name, id] of [['프랑스', 'FRA'], ['오스트리아', 'AUT']]) {
    await page.locator('#layerSearchInput').fill(name);
    const row = page.locator(`[data-object-search-select="countries"][data-item-id="${id}"]`);
    await row.click({ modifiers: ['Control'] });
  }
  await expect.poll(() => page.evaluate(() => {
    const coverage = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage;
    return [...(coverage?.primary?.renderedKeys || []), ...(coverage?.secondary?.renderedKeys || [])].sort();
  }), { timeout: 30000 }).toEqual(['country:AUT', 'country:DEU', 'country:FRA']).catch(async error => {
    console.log(await page.evaluate(() => ({ selection: window.__PANDOLAB_RENDER_DEBUG__.snapshot().selection, gpu: window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage }))); throw error;
  });
  await page.locator('[data-object-search-select="countries"][data-item-id="AUT"]').hover();
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage.hover.renderedKeys)).toEqual([]);
  expect(errors).toEqual([]);
});

for (const renderer of ['webgl2', 'webgl1', 'canvas']) test(`Russia parent-child fills do not accumulate and repeated selected hover reuses prepared geometry (${renderer})`, async ({ page }) => {
  test.setTimeout(150000);
  await page.addInitScript(() => {
    const getContext = window.HTMLCanvasElement.prototype.getContext;
    window.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (type === 'webgl' || type === 'webgl2') return getContext.call(this, type, { ...(args[0] || {}), preserveDrawingBuffer: true });
      return getContext.call(this, type, ...args);
    };
    const NativeWorker = Worker;
    window.__highlightPreparations = 0;
    window.Worker = class extends NativeWorker {
      postMessage(message, ...rest) {
        if (message.operation === 'territorial-display' && message.payload?.kind === 'highlight') window.__highlightPreparations++;
        return super.postMessage(message, ...rest);
      }
    };
  });
  await page.goto(`/?debug=1&renderer=${renderer}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  if (renderer === 'canvas') await page.locator('#terrainVisible').evaluate(input => { if (input.checked) input.click(); });
  const add = async (type, parentId, name, coords) => {
    await page.evaluate(({ type, parentId }) => window.PANDOLAB_TERRITORIAL.select(type, parentId), { type, parentId });
    await page.locator(type === 'country' ? '#addCountrySubunitBtn' : '#addSubunitChildBtn').evaluate(button => button.click());
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#territorialCreateNameInput').fill(name);
    await page.locator('#modePrimaryBtn').click();
    await page.locator('#modePolygonMethodInput').check();
    const map = await page.locator('#map').boundingBox();
    const points = await page.evaluate(coords => coords.map(coord => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen(coord)), coords);
    await page.mouse.move(map.x + points[0][0], map.y + points[0][1]);
    await page.mouse.down();
    for (const point of [...points.slice(1), points[0]]) await page.mouse.move(map.x + point[0], map.y + point[1], { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#modeDraftDoneBtn')).toBeEnabled({ timeout: 30000 });
    await page.locator('#modeDraftDoneBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    await expect(page.locator('#modePrimaryBtn')).toContainText('생성');
    await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60000 });
    await page.locator('#modePrimaryBtn').click();
    await expect.poll(() => page.evaluate(name => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' }).some(item => item.properties.name === name), name)).toBe(true);
    return page.evaluate(name => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' }).find(item => item.properties.name === name).id, name);
  };

  const id = await add('country', 'RUS', '강조 중첩 시험', [[45, 56], [57, 56], [51, 63]]);
  const country = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('RUS').geometry);
  expect(country.coordinates).toHaveLength(214);
  const pixels = async () => {
    if (renderer === 'canvas') await expect.poll(() => page.evaluate(() => { const gpu = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu; return gpu.canvasDisplayedStyleRevision > 0 && gpu.canvasDisplayedStyleRevision === gpu.canvasStyleRevision; }), { timeout: 45000 }).toBe(true);
    return page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      const source = document.querySelector('.gpu-map-canvas');
      const point = window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([51, 58]);
      const ratio = source.width / source.getBoundingClientRect().width;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.drawImage(source, Math.round(point[0] * ratio), Math.round(point[1] * ratio), 1, 1, 0, 0, 1, 1);
      const pixel = [...context.getImageData(0, 0, 1, 1).data];
      if (!pixel[3]) throw new Error(JSON.stringify({ pixel, point, size: [source.width, source.height], rect: [source.getBoundingClientRect().width, source.getBoundingClientRect().height], gpu: (() => { const gpu = window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu; return { renderer: gpu.renderer, style: gpu.canvasStyleRevision, displayed: gpu.canvasDisplayedStyleRevision, displayedFrame: gpu.displayedRevision, messages: gpu.canvasWorkerMessagesByType }; })() }));
      return pixel;
    });
  };
  await page.evaluate(id => window.PANDOLAB_TERRITORIAL.select('subunit', id), id);
  if (renderer !== 'canvas') await expect.poll(() => page.evaluate(id => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.primary?.renderedKeys || [], id)).toContain(`territorial:subunit:${encodeURIComponent(id)}`);
  if (renderer !== 'canvas') await expect.poll(() => page.evaluate(id => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpu.interactionFillCoverage?.renderedKeys?.some(key => key.includes(id)), id), { timeout: 30000 }).toBe(true);
  await expect(page.locator('.map-selection-fill')).toHaveCount(0);
  const single = await pixels();
  expect(single[3]).toBe(255);
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('러시아');
  await page.locator('[data-object-search-select="countries"][data-item-id="RUS"]').click({ modifiers: ['Control'] });
  if (renderer !== 'canvas') await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.secondary?.drawSucceeded), { timeout: 30000 }).toBe(true);
  const overlap = await pixels();
  console.log('interior-pixels', single, overlap);
  for (let i = 0; i < 4; i++) expect(Math.abs(single[i] - overlap[i])).toBeLessThanOrEqual(2);
  const before = await page.evaluate(() => ({ preparations: window.__highlightPreparations, builds: window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.bufferBuildCount }));
  await page.locator('[data-object-search-select="countries"][data-item-id="RUS"]').hover();
  await page.locator('#layerSearchInput').hover();
  await page.locator('[data-object-search-select="countries"][data-item-id="RUS"]').hover();
  const after = await page.evaluate(() => ({ preparations: window.__highlightPreparations, builds: window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.bufferBuildCount }));
  expect(after).toEqual(before);
});


test('SVG temporary fills obey priority, holes and water exclusion', async ({ page }) => {
  await page.goto('/assets/js/modules/interaction-svg-mask.js');
  const result = await page.evaluate(async () => {
    const { applySvgInteractionMasks } = await import('/assets/js/modules/interaction-svg-mask.js');
    const NS = 'http://www.w3.org/2000/svg';
    const draw = async overlap => {
      const root = document.createElementNS(NS, 'svg'); root.setAttribute('width', '80'); root.setAttribute('height', '80');
      const make = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); root.appendChild(n); return n; };
      make('rect', { width: 80, height: 80, fill: '#789abc' });
      const entries = [{ key: 'parent', priority: 4, fillAlpha: .24, path: 'M10,10H60V60H10Z M40,40H50V50H40Z' }];
      if (overlap) entries.push({ key: 'child', priority: 3, fillAlpha: .14, path: 'M20,20H70V70H20Z' });
      const nodes = entries.map(entry => make('path', { d: entry.path, 'fill-rule': 'evenodd', fill: '#1267ad', 'fill-opacity': entry.fillAlpha, 'data-object-key': entry.key }));
      applySvgInteractionMasks(root, nodes, entries, { waterPaths: [{ key: 'lake', path: 'M25,25H35V35H25Z' }] });
      const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 80;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return [[22, 22], [30, 30], [45, 45]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
    };
    return { single: await draw(false), overlap: await draw(true) };
  });
  for (let i = 0; i < 4; i++) expect(Math.abs(result.single[0][i] - result.overlap[0][i])).toBeLessThanOrEqual(2);
  expect(result.overlap[1]).toEqual([120, 154, 188, 255]);
  expect(result.single[2]).toEqual([120, 154, 188, 255]);
  expect(result.overlap[2]).not.toEqual(result.single[2]);
});


test('custom color, zero fill and disabled selected outlines preserve unselected hover', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
    appearance: { theme: 'dark' }, selection: { color: '#8f249b', outlineVisible: false, fillStrength: 0 } })));
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await page.locator('#objectSearchBtn').click();
  await page.locator('#layerSearchInput').fill('프랑스');
  await page.locator('[data-object-search-select="countries"][data-item-id="FRA"]').hover();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.hover?.renderedKeys || []), { timeout: 30000 }).toContain('country:FRA');
  const style = await page.evaluate(() => window.__PANDOLAB_INTERACTION_STYLE__);
  expect(style.selection.color).toBe('#8f249b'); expect(style.hover.color).toBe('#8f249b');
  expect(style.selection.primary.innerWidth).toBe(0); expect(style.hover.width).toBe(1.5);
  expect(style.selection.primary.fillAlpha).toBe(0); expect(style.hover.fillAlpha).toBe(0);
  expect(await page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage.primary.renderedKeys)).toEqual([]);
  await expect(page.locator('.map-selection-fill, .map-hover-fill')).toHaveCount(0);
  await page.locator('#layerSearchInput').hover();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage.hover.renderedKeys)).toEqual([]);
});


test('GPU context recovery hands fill and stroke coverage back from SVG once', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.primary?.renderedKeys || [])).toContain('country:DEU');
  const supported = await page.evaluate(() => {
    const gl = document.querySelector('.gpu-map-canvas').getContext('webgl2');
    window.__lossExtension = gl.getExtension('WEBGL_lose_context');
    window.__lossExtension?.loseContext(); return !!window.__lossExtension;
  });
  test.skip(!supported, 'Context loss extension unavailable');
  await expect(page.locator('.map-selection-outline.is-primary')).toHaveCount(1);
  await expect(page.locator('.map-selection-fill')).toHaveCount(1);
  await page.evaluate(() => window.__lossExtension.restoreContext());
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_RENDER_DEBUG__.snapshot().gpuSelection.drawCoverage?.primary?.renderedKeys || []), { timeout: 30000 }).toContain('country:DEU');
  await expect(page.locator('.map-selection-outline, .map-selection-fill')).toHaveCount(0);
});


for (const renderer of ['webgl2', 'canvas']) test(`direct coastline gesture uses the shared color and a single renderer (${renderer})`, async ({ page }) => {
  test.setTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('pandolab-user-preferences', JSON.stringify({ version: 2,
    appearance: { theme: 'light' }, selection: { color: '#1267ad', outlineVisible: false, fillStrength: 0 } })));
  await page.goto(`/?debug=1&renderer=${renderer}`);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90000 });
  await page.locator('#flatBtn').evaluate(button => button.click());
  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'DEU'));
  const mapBox = await page.locator('#map').boundingBox();
  const center = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.geoToScreen([10, 54]));
  await page.mouse.move(mapBox.x + center[0], mapBox.y + center[1]);
  await page.mouse.wheel(0, -1500);
  await page.locator('#editCoastBtn').evaluate(button => button.click());
  const handles = page.locator('.country-vertex:not(.fixed-boundary-vertex)');
  await expect.poll(() => handles.count(), { timeout: 45000 }).toBeGreaterThan(0);
  const point = await handles.evaluateAll(nodes => nodes.map(node => ({ node, rect: node.getBoundingClientRect() })).find(({ node, rect }) => rect.width && rect.x > 50 && rect.x < 1100 && rect.y > 100 && rect.y < 750 && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node)?.rect.toJSON());
  expect(point).toBeTruthy();
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + 2, point.y + point.height / 2, { steps: 2 });
  // Pointer capture defers new GPU uploads; the same temporary stroke owns this channel.
  await expect(page.locator('.map-direct-preview')).toHaveCount(1);
  await expect(page.locator('.map-direct-preview')).toHaveAttribute('stroke', '#1267ad');
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.up();
  await expect(page.locator('.map-direct-preview')).toHaveCount(0);
  expect(errors).toEqual([]);
});
