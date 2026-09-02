import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const requiredLayeredFiles = Object.freeze([
  'assets/css/tokens/ui-v2.css',
  'assets/css/primitives/controls.css',
  'assets/css/components/surface.css',
  'assets/css/components/content.css',
  'assets/css/layout/surfaces.css',
]);
const cleanupPath = path.join(root, 'assets/css/phase1-ui-cleanup.css');
const cleanupLoaderPath = path.join(root, 'assets/js/modules/phase1-ui-cleanup.js');
const componentDocPath = path.join(root, 'docs/architecture/ui-components-v2.md');
const failures = [];

for (const relativePath of requiredLayeredFiles) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    failures.push(`missing UI v2 layered stylesheet: ${relativePath}`);
  }
}

if (!fs.existsSync(componentDocPath)) {
  failures.push('missing UI v2 component documentation: docs/architecture/ui-components-v2.md');
}

if (!fs.existsSync(cleanupPath)) {
  failures.push('missing legacy UI cleanup stylesheet');
} else {
  const cleanupBytes = fs.statSync(cleanupPath).size;
  const cleanupBudget = 4525;
  if (cleanupBytes > cleanupBudget) {
    failures.push(`phase1 UI cleanup CSS regrew: ${cleanupBytes} > ${cleanupBudget} bytes`);
  }
  const cleanup = fs.readFileSync(cleanupPath, 'utf8');
  for (const migratedSelector of [
    '.editor-action-grid',
    '.editor-action-button',
    '.ui-info-list.editor-info-list',
    '.layer-category,',
    '.ui-empty-state,',
  ]) {
    if (cleanup.includes(migratedSelector)) {
      failures.push(`migrated component rule returned to phase1 cleanup CSS: ${migratedSelector}`);
    }
  }
}

if (!fs.existsSync(cleanupLoaderPath)) {
  failures.push('missing UI cleanup loader module');
} else {
  const loader = fs.readFileSync(cleanupLoaderPath, 'utf8');
  for (const relativePath of requiredLayeredFiles) {
    const moduleRelative = relativePath.replace('assets/css/', '../../css/');
    if (!loader.includes(moduleRelative)) {
      failures.push(`UI v2 stylesheet is not installed by the bootstrap cleanup module: ${relativePath}`);
    }
  }
}

if (failures.length) {
  console.error(`UI layering audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`UI layering audit passed: ${requiredLayeredFiles.length} canonical layered stylesheets, phase1 cleanup <= 4525 bytes.`);
}
