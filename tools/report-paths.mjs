import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hydrateReports, libraryCheckout, libraryReportRoot, safeChild } from './library-data.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const mapping = JSON.parse(readFileSync(new URL('./report-paths.json', import.meta.url), 'utf8'));

export function reportPath(legacy, root = repo) {
  let target = mapping.files[legacy] ?? legacy;
  for (const [old, replacement] of Object.entries(mapping.directories)) {
    const recursive = old === 'assets/data/research/siachen';
    if (legacy === old || (recursive && legacy.startsWith(old + '/'))) {
      target = mapping.files[legacy] ?? replacement + legacy.slice(old.length);
      break;
    }
  }
  if (!target.startsWith('reports/')) throw Error(`Not a report path: ${legacy}`);
  const output = safeChild(libraryReportRoot(root), target.slice('reports/'.length));
  if ((!existsSync(output) || statSync(output).isDirectory()) && existsSync(resolve(libraryCheckout(root), '.git'))) hydrateReports({ root, path: target.slice('reports/'.length) });
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(reportPath(process.argv[2], process.argv[3] || repo));
