import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectFeatures } from './registry.mjs';

export function classifyChangedPaths(paths) {
  const changed = { web: [], app: [] };
  for (const path of paths) {
    if (path.startsWith('native/')) changed.app.push(path.slice('native/'.length));
    // The native checkout root is native/, so shared sources are its sibling.
    // Preserve the real relative path; the registry is the ownership authority.
    else if (path.startsWith('shared/')) changed.app.push(`../${path}`);
    else changed.web.push(path);
  }
  return changed;
}

export function shouldRunParity(registry, changed) {
  const impact = selectFeatures(registry, changed);
  return impact.selected.length > 0 || impact.unclassifiedPaths.length > 0;
}

function treeContains(revision, path) {
  try {
    execFileSync('git', ['cat-file', '-e', `${revision}:${path}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.PARITY_BASE;
  const output = process.env.PARITY_CHANGES;
  if (!output) throw Error('PARITY_CHANGES output is required');
  let run = true;
  if (base && base !== '0'.repeat(40)) {
    if (!/^[0-9a-f]{40}$/.test(base)) throw Error('PARITY_BASE must be a full commit SHA');
    execFileSync('git', ['cat-file', '-e', `${base}^{commit}`]);
    if (!treeContains(base, 'native') && treeContains('HEAD', 'native')) {
      process.stdout.write('First native subtree import: run the complete registered parity corpus.\n');
    } else {
      const names = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'])
        .toString('utf8').split('\0').filter(Boolean);
      const changed = classifyChangedPaths(names);
      const registry = JSON.parse(readFileSync(new URL('../../tests/fixtures/portability/index.json', import.meta.url), 'utf8'));
      run = shouldRunParity(registry, changed);
      if (run) writeFileSync(output, JSON.stringify(changed) + '\n');
      else process.stdout.write('No registered parity feature or unclassified source changed; skip parity.\n');
    }
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
}
