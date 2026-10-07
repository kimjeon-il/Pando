import { createEditingDomain } from '../../assets/js/modules/editing-domain.js';

// Headless platform adapter. Tests that inspect scheduling supply their own pair.
export function createTestEditingDomain(options = {}) {
  return createEditingDomain({
    ...options,
    draftServices: {
      requestFrame: callback => setTimeout(callback, 0),
      cancelFrame: handle => clearTimeout(handle),
      ...options.draftServices,
    },
  });
}
