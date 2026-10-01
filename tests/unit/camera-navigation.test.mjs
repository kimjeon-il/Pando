import assert from 'node:assert/strict';
import test from 'node:test';
import { createCameraNavigation } from '../../assets/js/modules/app-camera-navigation.js';

test('continuous zoom can defer Worker settle and view persistence until the gesture ends', () => {
  const events = [];
  const owner = createCameraNavigation();
  owner.connect({
    projectState: { state: { projection: 'flat', view: { flatZoom: 1, globeZoom: 1 } } },
    platform: { clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)) },
    mapNavigation: {
      ZOOM_LIMITS: {
        flat: { min: 0.5, max: 32 },
        globe: { min: 0.5, max: 32 },
      },
    },
    domains: {
      renderingDomain: { endInteraction: reason => events.push(['settle', reason]) },
      projectDomain: { queueViewAutosave: () => events.push(['persist']) },
    },
  });

  assert.equal(owner.zoomBy(1.1, false, { settle: false, persist: false }), true);
  assert.deepEqual(events, []);
  assert.equal(owner.zoomBy(1.1, false), true);
  assert.deepEqual(events, [['settle', 'zoom-control-settle'], ['persist']]);
});
