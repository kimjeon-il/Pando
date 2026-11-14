
const sourceEntries = Object.freeze([
  Object.freeze({ role: 'application-tokens', path: 'assets/css/tokens/application-tokens.css' }),
  Object.freeze({ role: 'component-tokens', path: 'assets/css/tokens/component-tokens.css' }),
  Object.freeze({ role: 'tokens', path: 'assets/css/tokens/design-tokens.css' }),
  Object.freeze({ role: 'controls', path: 'assets/css/primitives/controls.css' }),
  Object.freeze({ role: 'select', path: 'assets/css/primitives/select.css' }),
  Object.freeze({ role: 'surface', path: 'assets/css/components/surface.css' }),
  Object.freeze({ role: 'content', path: 'assets/css/components/content.css' }),
  Object.freeze({ role: 'dialogs', path: 'assets/css/components/dialogs.css' }),
  Object.freeze({ role: 'surface-layout', path: 'assets/css/layout/surfaces.css' }),
  Object.freeze({ role: 'topbar', path: 'assets/css/components/topbar.css' }),
  Object.freeze({ role: 'panels', path: 'assets/css/components/panels.css' }),
  Object.freeze({ role: 'menus', path: 'assets/css/components/menus.css' }),
  Object.freeze({ role: 'mobile-sheets', path: 'assets/css/components/mobile-sheets.css' }),
  Object.freeze({ role: 'feedback', path: 'assets/css/components/feedback.css' }),
  Object.freeze({ role: 'map-search', path: 'assets/css/components/map-search.css' }),
  Object.freeze({ role: 'map-viewport', path: 'assets/css/components/map-viewport.css' }),
  Object.freeze({ role: 'accessibility', path: 'assets/css/utilities/accessibility.css' }),
  Object.freeze({ role: 'map-rendering', path: 'assets/css/features/map-rendering.css' }),
]);

export const UI_VIEWER_SOURCES = Object.freeze(sourceEntries.map(entry => entry.path));
