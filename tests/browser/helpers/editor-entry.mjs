/** Existing editor regressions must never silently exercise the public viewer. */
export function editorTestUrl(input = '/') {
  const url = new URL(input, 'https://editor-test.invalid/');
  if (!['http:', 'https:'].includes(url.protocol) || !['/', '/index.html'].includes(url.pathname)) return input;
  url.pathname = '/apps/web-shell/editor.html';
  return /^[a-z]+:\/\//i.test(input) ? url.href : `${url.pathname}${url.search}${url.hash}`;
}

export function gotoEditor(page, url, options) {
  return page.goto(editorTestUrl(url), options);
}
