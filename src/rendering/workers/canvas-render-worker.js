'use strict';
const assetRevision = new URL(self.location.href).searchParams.get('v') || '';
importScripts(...['../vendor/d3.min.js', './geographic-boundary-core.js', './canvas-scene-composition-core.js', './canvas-terrain-dem-core.js', './terrain-tile-selection-core.js', './resource-update-policy-core.js', './canvas-render-core.js']
  .map(path => { const url = new URL(path, self.location.href); url.searchParams.set('v', assetRevision); return url.href; }));
self.PandoLabCanvasRenderer.install(self);
