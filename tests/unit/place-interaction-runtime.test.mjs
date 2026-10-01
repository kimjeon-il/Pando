import assert from 'node:assert/strict';
import test from 'node:test';
import { createRenderingDomain } from '../../assets/js/modules/rendering-domain.js';

test('render interaction allows view invalidation without preparing builtin places until settle', () => {
  let prepared = 0;
  let began = 0;
  const frames = [];
  const domain = createRenderingDomain({
    requestFrame: callback => { frames.push(callback); return frames.length; },
    labelResources: {
      preparePlaces: () => { prepared += 1; },
      beginPlaceInteraction: () => { began += 1; },
    },
  });

  domain.beginInteraction('hold-zoom');
  assert.equal(began, 1);
  domain.invalidateView('hold-zoom-frame');
  assert.equal(prepared, 0);

  domain.endInteraction('hold-zoom-settle');
  assert.equal(prepared, 1);
});
