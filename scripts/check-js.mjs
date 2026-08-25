import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['assets/js', 'scripts', 'tests/browser', 'tests/unit'];
const files = [];

function collect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const item = join(path, entry.name);
    if (entry.isDirectory()) collect(item);
    else if (['.js', '.mjs'].includes(extname(entry.name)) && !item.includes(`${join('assets', 'js', 'vendor')}`)) files.push(item);
  }
}

for (const root of roots) collect(root);
files.push('eslint.config.js', 'playwright.config.js');

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Checked ${files.length} JavaScript files.`);
