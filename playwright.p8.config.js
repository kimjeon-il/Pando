// Keep screenshots from successful P8 visual checks as GitHub Actions artifacts.
// The application/browser configuration itself is inherited unchanged.
import base from './playwright.config.js';

export default {
  ...base,
  preserveOutput: 'always',
};
