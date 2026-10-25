import {buildFrontendSnapshot,readFrontendInput,hasFrontendInput} from './lib/frontend-build.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { collectCssRules } from './lib/css-analysis.mjs';
import { buildUiBundles } from './build-ui-bundle.mjs';
import { parseJavaScript, walkJavaScript } from './lib/source-analysis.mjs';
import { UI_BUNDLE_SOURCES, UI_MODAL_SOURCES } from './lib/ui-source-catalog.mjs';

const root = process.cwd();
const frontend=await buildFrontendSnapshot({root});
const readInput=(file,encoding)=>readFrontendInput(frontend,file,encoding);
const inputExists=file=>hasFrontendInput(frontend,file);
const requiredLayeredFiles = UI_BUNDLE_SOURCES;
const bootstrapPath = path.join(root, 'apps/editor/frontend/js/bootstrap.js');
const appStylesheetPath = path.join(root, 'shared/frontend/css/app.css');
const bundlePath = path.join(root, 'assets/css/ui.bundle.css');
const viewerBundlePath = path.join(root, 'assets/css/ui-viewer.bundle.css');
const modalBundlePath = path.join(root, 'assets/css/ui-modal.bundle.css');
const modalSourceFiles = UI_MODAL_SOURCES;
const indexPath = path.join(root, '__editor/index.html');
const uiRuntimePath = path.join(root, 'apps/editor/frontend/js/modules/ui-runtime.js');
const componentDocPath = path.join(root, 'docs/architecture/ui-components.md');
const retiredArtifacts = Object.freeze([
  'assets/css/phase1-ui-cleanup.css',
  'assets/js/modules/phase1-ui-cleanup.js',
  'assets/js/modules/mobile-sheet-v2.js',
  'assets/js/modules/state-feedback-v2.js',
  'assets/js/modules/accessibility-qa-v2.js',
]);
const failures = [];

function collectModalDeclarationKeys(source) {
  const keys = new Set();
  for (const rule of collectCssRules(source)) {
    for (const selector of rule.selectors) {
      if (!/(?:modal|gis|historical|coast-reconciliation)/i.test(selector)) continue;
      for (const { property } of rule.declarations) keys.add(`${rule.context}\u0000${selector}\u0000${property}`);
    }
  }
  return keys;
}

for (const relativePath of requiredLayeredFiles) {
  if (!inputExists(path.join(root, relativePath))) {
    failures.push(`missing canonical layered stylesheet: ${relativePath}`);
  }
}
for (const relativePath of modalSourceFiles) {
  if (!inputExists(path.join(root, relativePath))) failures.push(`missing modal stylesheet source: ${relativePath}`);
}

if (!inputExists(componentDocPath)) {
  failures.push('missing UI component documentation: docs/architecture/ui-components.md');
}

if (!inputExists(bundlePath)) {
  failures.push('missing canonical UI bundle: assets/css/ui.bundle.css');
} else {
  const bundle = readInput(bundlePath, 'utf8').replace(/\r\n?/g, '\n');
  const { main: expectedBundle, modal: expectedModalBundle, viewer: expectedViewerBundle } = buildUiBundles(root,{readSource:path=>readInput(path,'utf8')});
  if (bundle !== expectedBundle) failures.push('UI bundle is stale; run pnpm build:ui-bundle');
  if (!inputExists(viewerBundlePath) || readInput(viewerBundlePath, 'utf8').replace(/\r\n?/g, '\n') !== expectedViewerBundle)
    failures.push('Viewer UI bundle is stale; run pnpm build:ui-bundle');
  if (!inputExists(modalBundlePath)) failures.push('missing lazy modal UI bundle: assets/css/ui-modal.bundle.css');
  else if (readInput(modalBundlePath, 'utf8').replace(/\r\n?/g, '\n') !== expectedModalBundle) failures.push('modal UI bundle is stale; run pnpm build:ui-bundle');

  if (inputExists(appStylesheetPath)) {
    const appModalDeclarations = collectModalDeclarationKeys(readInput(appStylesheetPath, 'utf8'));
    const modalDeclarations = collectModalDeclarationKeys(expectedModalBundle);
    const duplicateOwnership = [...appModalDeclarations].filter(key => modalDeclarations.has(key));
    if (duplicateOwnership.length) {
      failures.push(`app.css and modal bundle duplicate selector/property ownership: ${duplicateOwnership.slice(0, 5).map(key => key.replace('\u0000', ' / ')).join(', ')}`);
    }
  }
}

for (const relativePath of retiredArtifacts) {
  if (inputExists(path.join(root, relativePath))) {
    failures.push(`retired UI compatibility artifact returned: ${relativePath}`);
  }
}

if (!inputExists(bootstrapPath)) {
  failures.push('missing canonical bootstrap: assets/js/bootstrap.js');
} else {
  const bootstrap = readInput(bootstrapPath, 'utf8');
  const dependencyStrings = new Set();
  walkJavaScript(parseJavaScript(bootstrap, { filePath: bootstrapPath }), node => {
    if (node.type === 'Literal' && typeof node.value === 'string') dependencyStrings.add(node.value.split(/[?#]/)[0]);
  });
  if (dependencyStrings.has('../css/ui.bundle.css')) failures.push('bootstrap still installs ui.bundle.css dynamically');
  if (!dependencyStrings.has('../css/ui-modal.bundle.css')) failures.push('bootstrap does not expose lazy ui-modal.bundle.css loading');
  const individualLinks = requiredLayeredFiles
    .map(relativePath => relativePath.replace('assets/css/', '../css/'))
    .filter(runtimeRelative => dependencyStrings.has(runtimeRelative));
  if (individualLinks.length) failures.push(`bootstrap still installs individual UI stylesheets: ${individualLinks.join(', ')}`);
  if (!dependencyStrings.has('./modules/ui-runtime.js')) {
    failures.push('bootstrap does not initialize canonical ui-runtime.js');
  }
  if (/phase1-ui-cleanup|installPhaseOneUiCleanup|PL-UI-CLEANUP/.test(bootstrap)) {
    failures.push('bootstrap still contains retired phase cleanup wiring');
  }
}

if (!inputExists(indexPath) || !readInput(indexPath, 'utf8').includes('data-pandolab-ui="ui-bundle"')) {
  failures.push('__editor/index.html does not statically own ui.bundle.css');
}

if (!inputExists(uiRuntimePath)) {
  failures.push('missing canonical UI runtime: assets/js/modules/ui-runtime.js');
}

if (failures.length) {
  console.error(`UI layering audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`UI layering audit passed: ${requiredLayeredFiles.length} canonical layered stylesheets, no phase cleanup runtime.`);
}
