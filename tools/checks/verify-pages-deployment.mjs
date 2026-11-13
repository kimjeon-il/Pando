import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { terrainTileRequest } from '../../src/data/terrain-manifest.js';
import { createExternalRuntimeDataFetch } from '../../src/data/external-runtime-data.js';

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
  let terrainManifest = null, buildMeta = null;
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
      buildMeta = meta;
      if (meta?.sourceCommit !== evidence.sourceCommit || meta?.dataCommit !== evidence.dataCommit || !meta?.dataRevision) {
        throw new Error('Deployment build/data identity mismatch');
      }
      if (JSON.stringify(meta.terrainExternalSource || null) !== JSON.stringify(evidence.terrainExternalSource || null))
        throw new Error('Deployment terrain source identity mismatch');
      if (JSON.stringify(meta.externalRuntimeData || null) !== JSON.stringify(evidence.externalRuntimeData || null))
        throw new Error('Deployment external data identity mismatch');
    }
    if (file.path === evidence.terrainManifest) terrainManifest = JSON.parse(bytes);
  }
  let checkedExternalTiles = 0;
  let checkedExternalCatalogs = 0;
  if (evidence.externalRuntimeData) {
    const runtimeFetch=createExternalRuntimeDataFetch({meta:buildMeta,fetchFn});
    for (const path of new Set(Object.values(buildMeta.projectCatalogs).map(item=>item.catalog))) {
      const response=await runtimeFetch(new URL(path,baseUrl),{signal:AbortSignal.timeout(30000)});
      const bytes=Buffer.from(await response.arrayBuffer());
      if (path===evidence.terrainManifest) terrainManifest=JSON.parse(bytes);
      checkedExternalCatalogs++;
    }
  }
  if (evidence.terrainExternalSource) {
    if (!terrainManifest) throw new Error('Missing published terrain manifest');
    for (const spec of [{level:0,column:0,row:0}, {level:5,column:13,row:4}]) {
      const request = terrainTileRequest(spec, terrainManifest, { externalSource: evidence.terrainExternalSource });
      const response = await fetchFn(request.url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok || response.headers.get('access-control-allow-origin') !== '*')
        throw new Error(`External DEM tile unavailable or missing CORS: ${request.url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== request.bytes || createHash('sha256').update(bytes).digest('hex') !== request.sha256)
        throw new Error(`External DEM tile mismatch: ${request.url}`);
      checkedExternalTiles++;
    }
  }
  return { sourceCommit: evidence.sourceCommit, dataCommit: evidence.dataCommit, checkedFiles: selected.length, checkedExternalCatalogs, checkedExternalTiles };
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
