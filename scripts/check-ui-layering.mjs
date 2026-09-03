import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const requiredLayeredFiles = Object.freeze([
  'assets/css/tokens/ui-v2.css',
  'assets/css/primitives/controls.css',
  'assets/css/components/surface.css',
  'assets/css/components/content.css',
  'assets/css/components/command-row.css',
  'assets/css/components/workflow.css',
  'assets/css/components/workspace-refinements.css',
  'assets/css/components/editor-shell.css',
  'assets/css/components/map-create-panel.css',
  'assets/css/components/edit-workflow.css',
  'assets/css/components/library-gis-file.css',
  'assets/css/components/mobile-sheets.css',
  'assets/css/components/feedback.css',
  'assets/css/layout/surfaces.css',
  'assets/css/features/layer-panel.css',
  'assets/css/utilities/accessibility.css',
]);
const bootstrapPath = path.join(root, 'assets/js/bootstrap.js');
const uiRuntimePath = path.join(root, 'assets/js/modules/ui-runtime.js');
const componentDocPath = path.join(root, 'docs/architecture/ui-components-v2.md');
const retiredArtifacts = Object.freeze([
  'assets/css/phase1-ui-cleanup.css',
  'assets/js/modules/phase1-ui-cleanup.js',
  'assets/js/modules/mobile-sheet-v2.js',
  'assets/js/modules/state-feedback-v2.js',
  'assets/js/modules/accessibility-qa-v2.js',
]);
const failures = [];

for (const relativePath of requiredLayeredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`missing canonical layered stylesheet: ${relativePath}`);
  }
}

if (!fs.existsSync(componentDocPath)) {
  failures.push('missing UI v2 component documentation: docs/architecture/ui-components-v2.md');
}

for (const relativePath of retiredArtifacts) {
  if (fs.existsSync(path.join(root, relativePath))) {
    failures.push(`retired UI compatibility artifact returned: ${relativePath}`);
  }
}

if (!fs.existsSync(bootstrapPath)) {
  failures.push('missing canonical bootstrap: assets/js/bootstrap.js');
} else {
  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
  for (const relativePath of requiredLayeredFiles) {
    const runtimeRelative = relativePath.replace('assets/css/', '../css/');
    if (!bootstrap.includes(runtimeRelative)) {
      failures.push(`canonical stylesheet is not installed by bootstrap: ${relativePath}`);
    }
  }
  if (!bootstrap.includes("./modules/ui-runtime.js")) {
    failures.push('bootstrap does not initialize canonical ui-runtime.js');
  }
  if (/phase1-ui-cleanup|installPhaseOneUiCleanup|PL-UI-CLEANUP/.test(bootstrap)) {
    failures.push('bootstrap still contains retired phase cleanup wiring');
  }
}

if (!fs.existsSync(uiRuntimePath)) {
  failures.push('missing canonical UI runtime: assets/js/modules/ui-runtime.js');
}

if (failures.length) {
  console.error(`UI layering audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`UI layering audit passed: ${requiredLayeredFiles.length} canonical layered stylesheets, no phase cleanup runtime.`);
}
