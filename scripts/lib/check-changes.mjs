import { execFileSync } from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

/** One comparison for local, push and PR. Missing history is never a clean diff. */
export function collectChanges({ root = process.cwd(), event = process.env.GITHUB_EVENT_NAME || 'local',
  base = process.env.BASE_SHA || 'origin/main', head = process.env.HEAD_SHA || 'HEAD' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  if (!base || /^0+$/.test(base)) base = 'origin/main';
  const revision = (ref, label) => {
    try { return git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').trim(); }
    catch {
      if (event !== 'local' && /^[a-f0-9]{40}$/i.test(ref)) {
        try { git('fetch', '--no-tags', '--depth=1', 'origin', ref); return git('rev-parse', '--verify', ref + '^{commit}').trim(); }
        catch { /* The error below preserves the failed comparison, not a fallback diff. */ }
      }
      throw Error(`CHECK_HISTORY: unavailable ${label} ${ref}; fetch the comparison history first.`);
    }
  };
  const baseCommit = revision(base, 'base'), headCommit = revision(head, 'head');
  let from = baseCommit;
  if (event !== 'push') {
    try { from = git('merge-base', baseCommit, headCommit).trim(); }
    catch { throw Error('CHECK_HISTORY: comparison base has no available common ancestor'); }
  }
  const paths = output => output.split('\0').filter(Boolean).map(path => path.replaceAll('\\', '/'));
  const files = paths(git('diff', '--no-renames', '--name-only', '-z', from, headCommit));
  if (event === 'local') {
    files.push(...paths(git('diff', '--cached', '--no-renames', '--name-only', '-z', headCommit)),
      ...paths(git('diff', '--no-renames', '--name-only', '-z')),
      ...paths(git('ls-files', '--others', '--exclude-standard', '-z')));
  }
  return { event, base: from, requestedBase: base, head: headCommit, workingTree: event === 'local', files: [...new Set(files)].sort() };
}


/** Focused native compilation ownership for branch CI; generated WASM is
 * already compiled and published by the source-matched artifact workflow. */
export function selectNativeBuilds(paths, scope='auto') {
  if (!Array.isArray(paths) || paths.some(path=>typeof path !== 'string'))
    throw Error('Invalid native build change list');
  if (!['auto','native-core','native-gis','native-all'].includes(scope))
    throw Error('Unknown native build scope: '+scope);
  if (scope!=='auto')
    return {core:['native-core','native-all'].includes(scope),
      gis:['native-gis','native-all'].includes(scope),
      wasm:false};
  const filenames=paths.map(path=>path.replaceAll('\\','/'));
  const globalChange=filenames.some(path=>
    /^(?:CMakeLists\.txt|CMakePresets\.json|\.nvmrc|config\/toolchain-versions\.json|\.github\/workflows\/shared-core\.yml)$/.test(path));
  return {
    core:globalChange || filenames.some(path=>/^(?:shared\/(?:core|wasm|third_party|tests)\/|shared\/CMakeLists\.txt|tests\/native\/|tests\/unit\/(?:core-|native-|selection-|map-hover-|project-serializer|project-preview-policy))/.test(path)),
    gis:globalChange || filenames.some(path=>/^(?:tools\/cpp\/|tests\/unit\/(?:gis-.*native|hydro-.*native|p6-polygon-core|r4c-spatial-boundaries)\.test\.mjs)/.test(path)),
    // Source-matched WASM is produced once by generated-artifacts-p2.yml.
    wasm:false,
  };
}

export function pinnedToolchain(root=process.cwd(), nodeVersion=process.versions.node) {
  const pin=JSON.parse(readFileSync(resolve(root,'config/toolchain-versions.json'),'utf8'));
  const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
  const nvmrc=readFileSync(resolve(root,'.nvmrc'),'utf8').trim();
  if(pin.schema!=='pando-development-toolchain-v1' || pin.node!==nvmrc ||
      pkg.packageManager!=='pnpm@'+pin.pnpm)
    throw Error('PINNED_TOOLCHAIN_METADATA_MISMATCH');
  if(Number(nodeVersion.split('.')[0])!==Number(pin.node))
    throw Error('PINNED_TOOLCHAIN_NODE_MAJOR: '+nodeVersion);
  return pin;
}
