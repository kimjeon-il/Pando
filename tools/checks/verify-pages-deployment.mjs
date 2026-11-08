import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

// Transfer checks only: semantic data checks belong to the selected data task.
export async function verifyPagesDeployment({ baseUrl, evidence, fetchFn = globalThis.fetch }) {
  if (evidence?.schema !== 'pando-web-pages-staging'
    || !/^[a-f0-9]{40}$/.test(evidence.sourceCommit) || !/^[a-f0-9]{40}$/.test(evidence.dataCommit)) {
    throw new Error('Missing deployment identity');
  }
  const files = evidence.files;
  if (!Array.isArray(files) || files.some(file => !/^[\w./-]+$/.test(file.path)
    || file.path.startsWith('/') || file.path.split('/').some(part => !part || part === '.' || part === '..'))) {
    throw new Error('Invalid deployment artifact path');
  }
  const selected = files.filter(file => file.path === 'index.html' || file.path === 'assets/js/build-meta.js'
    || file.path.startsWith('assets/data/') && /\/(?:current|index|manifest)\.json$/.test(file.path));
  if (!selected.some(file => file.path === 'index.html') || !selected.some(file => file.path === 'assets/js/build-meta.js')) {
    throw new Error('Missing deployment identity files');
  }
  for (const file of selected) {
    const url = new URL(file.path, baseUrl);
    url.searchParams.set('deployment', evidence.sourceCommit);
    const response = await fetchFn(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Deployment HTTP ${response.status}: ${file.path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
      throw new Error(`Deployment asset mismatch: ${file.path}`);
    }
    if (file.path === 'assets/js/build-meta.js') {
      const meta = JSON.parse(bytes.toString().match(/Object\.freeze\(([\s\S]*)\);\s*$/)?.[1] || 'null');
      if (meta?.sourceCommit !== evidence.sourceCommit || meta?.dataCommit !== evidence.dataCommit || !meta?.dataRevision) {
        throw new Error('Deployment build/data identity mismatch');
      }
    }
  }
  return { sourceCommit: evidence.sourceCommit, dataCommit: evidence.dataCommit, checkedFiles: selected.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const at = process.argv.indexOf(name); return at < 0 ? null : process.argv[at + 1]; };
  const evidence = JSON.parse(readFileSync(arg('--manifest'), 'utf8'));
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await verifyPagesDeployment({ baseUrl: arg('--url'), evidence });
      if (arg('--output')) writeFileSync(arg('--output'), JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result));
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.error(`Deployment verification attempt ${attempt}: ${error.message}`);
      await setTimeout(10000);
    }
  }
}
