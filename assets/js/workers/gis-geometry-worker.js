'use strict';

importScripts('../vendor/polygon-clipping.min.js');

self.onmessage = async event => {
  const { id, action, collection, affectedIds } = event.data || {};
  try {
    const { validateCollection } = await import('../modules/gis-geometry-validation.js');
    if (action !== 'validate') throw new Error('알 수 없는 GIS 지오메트리 작업입니다.');
    self.postMessage({ id, ok: true, ...validateCollection(collection, affectedIds) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
