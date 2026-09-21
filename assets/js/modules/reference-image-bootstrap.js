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

function moveControlsToMapUi() {
  const mapElement = document.getElementById('map');
  const overlayLayer = mapElement?.closest('.map-wrap')?.querySelector('.map-overlay-layer');
  const commandToolbar = overlayLayer?.querySelector('.map-command-toolbar');
  if (!mapElement || !overlayLayer) return;
  const launcher = overlayLayer.querySelector('#referenceImageBtn') || mapElement.querySelector(':scope > .reference-image-launcher');
  const panel = mapElement.querySelector(':scope > .reference-image-panel');
  if (launcher && commandToolbar && !commandToolbar.contains(launcher)) {
    const resetViewButton = commandToolbar.querySelector('#resetViewBtn');
    if (resetViewButton) resetViewButton.before(launcher);
    else commandToolbar.appendChild(launcher);
  }
  if (panel) overlayLayer.appendChild(panel);
}

export async function installReferenceImageFeature({ revision = '', workspaceSurfaces, confirm, getGeneration, isBlocked } = {}) {
  for (const path of STYLE_PATHS) ensureStylesheet(path, revision);
  const controllerUrl = new URL('./reference-image-controller.js', import.meta.url);
  if (revision) controllerUrl.searchParams.set('v', revision);
  const { installReferenceImageController } = await import(controllerUrl.href);
  let lineRefiner, liveWire;
  const controller = installReferenceImageController({ workspaceSurfaces, confirm, getGeneration, isBlocked,
    cancelTools: () => { if (lineRefiner?.active()) lineRefiner.cancel(); if (liveWire?.active()) liveWire.cancel(); },
  });
  moveControlsToMapUi();

  const lineRefinerUrl = new URL('./reference-image-line-refine-controller.js', import.meta.url);
  if (revision) lineRefinerUrl.searchParams.set('v', revision);
  const { installReferenceImageLineRefiner } = await import(lineRefinerUrl.href);
  lineRefiner = installReferenceImageLineRefiner();

  const liveWireUrl = new URL('./reference-image-live-wire-controller.js', import.meta.url);
  if (revision) liveWireUrl.searchParams.set('v', revision);
  const { installReferenceImageLiveWire } = await import(liveWireUrl.href);
  liveWire = installReferenceImageLiveWire();

  return controller;
}
