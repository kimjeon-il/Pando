// P3: classify remote preview/browser/Qt work with no third-party dependencies.
// The planner must not treat a skipped native build on a Web-only branch as a pass.
import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedPaths } from './p1-plan-remote-checks.mjs';

export const root=fileURLToPath(new URL('../',import.meta.url));
const present=(dir,path)=>existsSync(resolve(dir,path));

export function classifyP3(paths,{native,web}={},scope='auto') {
  if(!['auto','all','preview','browser','qt','off'].includes(scope))
    throw Error('P3_INVALID_SCOPE: '+scope);
  const availableWeb=web ?? present(root,'index.html');
  const availableNative=native ?? (present(root,'native/CMakeLists.txt')
    && present(root,'native/app/CMakeLists.txt')
    && present(root,'CMakePresets.json'));
  const infra=paths.some(path=>[
    '.github/workflows/remote-preview-p3.yml',
    'scripts/p3-plan-remote.mjs','scripts/p3-stage-preview.mjs',
    'tests/unit/p3-remote-plan.test.mjs','tests/browser/p3-remote-preview.spec.mjs',
    'CMakePresets.json','config/toolchain-versions.json'
  ].includes(path));
  const webTouched=infra||paths.some(p=>/^(assets\/|index\.html$|\.nojekyll$|contracts\/|tests\/browser\/|playwright\.config\.js$|shared\/)/.test(p));
  const nativeTouched=infra||paths.some(p=>/^(native\/|shared\/|CMakeLists\.txt$|CMakePresets\.json$|cmake\/|config\/toolchain-versions\.json$)/.test(p));
  const preview=availableWeb && scope!=='off' && (scope==='all'||
    scope==='preview'||scope==='browser'||(scope==='auto'&&webTouched));
  const browser=availableWeb && scope!=='off' && (scope==='all'||
    scope==='browser'||(scope==='auto'&&webTouched));
  const qt=availableNative && (scope==='all'||scope==='qt'||(scope==='auto'&&nativeTouched));
  return {preview,browser,qt,availableWeb,availableNative,infra,
    webTouched,nativeTouched,scannedPaths:paths.length,scope};
}

export function previewSlug(branch) {
  if(!/^work\/(ui|objects|gis|places)$/.test(branch))
    throw Error('P3_UNSUPPORTED_PREVIEW_BRANCH: '+branch);
  return branch.replace('/','-');
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const change=changedPaths({base:process.env.PANDO_P3_BASE_SHA||''});
  const branch=process.env.PANDO_P3_BRANCH||'work/objects';
  const slug=previewSlug(branch);
  const result=classifyP3(change.paths,{},process.env.PANDO_P3_SCOPE||'auto');
  if(process.argv.includes('--github-output')) {
    if(!process.env.GITHUB_OUTPUT)throw Error('GITHUB_OUTPUT missing');
    appendFileSync(process.env.GITHUB_OUTPUT,
      [['preview',result.preview],['browser',result.browser],['qt',result.qt],
       ['slug',slug]].map(([k,v])=>k+'='+String(v)).join('\n')+'\n');
  }
  console.log(JSON.stringify({branch,slug,changed:change.paths,fallBackDiff:change.fallback,...result},null,2));
}
