import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'scripts', 'tests/browser', 'tests/unit', 'tests/helpers', 'tools'];
const files = [];

function collect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const item = join(path, entry.name);
    if (entry.isDirectory()) collect(item);
    else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(item);
  }
}

for (const root of roots) if (existsSync(root)) collect(root);
files.push('eslint.config.js', 'playwright.config.js');

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Checked ${files.length} JavaScript files.`);
