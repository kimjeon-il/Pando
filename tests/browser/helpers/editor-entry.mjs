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
    await page.route('**/modules/app-composition.js*', async route => {
      const source = await (await route.fetch()).text();
      const anchor = 'if (onComposed) await onComposed(';
      if (!source.includes(anchor)) throw new Error('Editor composition test boundary is missing.');
      await route.fulfill({ contentType: 'text/javascript', body: source.replace(anchor,
        'window.__testEditorTimeline=Object.freeze({month:()=>domainAssembly.timelineMonth,setMonth:month=>domainAssembly.setTimelineMonth(month),state:()=>projectSession.state});' + anchor) });
    });
    timelinePages.add(page);
  }
  return page.goto(editorTestUrl(url), options);
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
