const STYLE_PATHS = Object.freeze([
  '../../css/tokens/reference-images.css',
  '../../css/components/reference-images.css',
  '../../css/layout/reference-images.css',
  '../../css/features/reference-images.css',
]);

function stylesheetHref(relativePath, revision) {
  const url = new URL(relativePath, import.meta.url);
  if (revision) url.searchParams.set('v', revision);
  return url.href;
}

function ensureStylesheet(relativePath, revision) {
  const href = stylesheetHref(relativePath, revision);
  const existing = [...document.querySelectorAll('link[rel="stylesheet"][data-pandolab-reference-image-style]')]
    .find(link => link.href === href);
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.pandolabReferenceImageStyle = relativePath;
  document.head.appendChild(link);
  return link;
}

export async function installReferenceImageFeature({ revision = '' } = {}) {
  for (const path of STYLE_PATHS) ensureStylesheet(path, revision);
  const controllerUrl = new URL('./reference-image-controller.js', import.meta.url);
  if (revision) controllerUrl.searchParams.set('v', revision);
  const { installReferenceImageController } = await import(controllerUrl.href);
  return installReferenceImageController();
}
