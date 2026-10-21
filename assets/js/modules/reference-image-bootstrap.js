import { REFERENCE_IMAGE_STYLE_SOURCES } from './reference-image-style-sources.js';

function stylesheetHref(relativePath, revision) {
  const url = new URL(`../../${relativePath}`, import.meta.url);
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

export async function installReferenceImageFeature({ revision = '', workspaceSurfaces, confirm, getGeneration, isBlocked, searchPlaces = null, getPlaces = null, preparePlaces = null } = {}) {
  for (const path of REFERENCE_IMAGE_STYLE_SOURCES) ensureStylesheet(path, revision);
  const controllerUrl = new URL('./reference-image-controller.js', import.meta.url);
  if (revision) controllerUrl.searchParams.set('v', revision);
  const { installReferenceImageController } = await import(controllerUrl.href);
  let lineRefiner, liveWire;
  const controller = installReferenceImageController({ workspaceSurfaces, confirm, getGeneration, isBlocked, searchPlaces, getPlaces, preparePlaces,
    cancelTools: () => { if (lineRefiner?.active()) lineRefiner.cancel(); if (liveWire?.active()) liveWire.cancel(); },
    auxiliaryInputActive: () => !!lineRefiner?.active() || !!liveWire?.active(),
  });

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
