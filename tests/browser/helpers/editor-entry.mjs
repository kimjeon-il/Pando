/** Existing editor regressions must never silently exercise the public viewer. */
const timelinePages = new WeakSet();
export function editorTestUrl(input = '/') {
  const url = new URL(input, 'https://editor-test.invalid/');
  if (!['http:', 'https:'].includes(url.protocol) || !['/', '/index.html'].includes(url.pathname)) return input;
  url.pathname = '/__editor/index.html';
  return /^[a-z]+:\/\//i.test(input) ? url.href : `${url.pathname}${url.search}${url.hash}`;
}

export async function gotoEditor(page, url, options) {
  if (!timelinePages.has(page)) {
    await page.route('**/modules/gpu-scene.js*', async route => {
      const response = await route.fetch(), source = await response.text();
      const anchor = '  function initializeGpuSceneDomains() {';
      if (!source.includes(anchor)) throw new Error('Map scene test boundary is missing.');
      await route.fulfill({ response, body: source.replace(anchor, anchor + '\n    window.__testMapSceneDomain = name => gpuSceneDomains.get(name);') });
    });
    await page.route('**/modules/app-composition.js*', async route => {
      const source = await (await route.fetch()).text();
      const anchor = 'if (onComposed) await onComposed(';
      if (!source.includes(anchor)) throw new Error('Editor composition test boundary is missing.');
      await route.fulfill({ contentType: 'text/javascript', body: source.replace(anchor,
        'window.__testEditorTimeline=Object.freeze({month:()=>domainAssembly.timelineMonth,setMonth:month=>domainAssembly.setTimelineMonth(month),state:()=>projectSession.state,editing:()=>domainAssembly.editingDomain.snapshot()});' + anchor) });
    });
    timelinePages.add(page);
  }
  return page.goto(editorTestUrl(url), options);
}

/** Inspect scene inputs instead of removed transparent SVG paths. */
export async function sceneItems(page, domain) {
  return page.evaluate(name => {
    const scene = window.__testMapSceneDomain?.(name);
    return [...(scene?.polygons || []), ...(scene?.strokes || [])];
  }, domain);
}

export async function projectMapPoint(page, coordinate) {
  const point = await page.evaluate(value => window.__PANDOLAB_MAP_HOST__.project(value), coordinate);
  const bounds = await page.locator('#map').boundingBox();
  return { x: bounds.x + point[0], y: bounds.y + point[1] };
}

export async function territorialCenter(page, id) {
  const coordinate = await page.evaluate(value => {
    const geometry = window.PANDOLAB_TERRITORIAL.get(value).geometry;
    const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0][0];
    return [(Math.min(...ring.map(p => p[0])) + Math.max(...ring.map(p => p[0]))) / 2,
      (Math.min(...ring.map(p => p[1])) + Math.max(...ring.map(p => p[1]))) / 2];
  }, id);
  return projectMapPoint(page, coordinate);
}

/** Temporal model regressions use the real command owner after app navigation UI removal. */
export async function setEditorMonth(page, month) {
  await page.waitForFunction(() => window.__testEditorTimeline
    && !window.__testEditorTimeline.state().projectReplacing
    && !window.__testEditorTimeline.state().modeProcessing, null, { timeout: 90000 });
  await page.evaluate(value => window.__testEditorTimeline.setMonth(value), month);
  const actual = await page.evaluate(() => window.__testEditorTimeline.month());
  if (actual !== month) throw new Error(`Editor month did not commit: ${actual} != ${month}`);
}
