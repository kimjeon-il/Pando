// P1: deterministic, dependency-free change classification for every work/* branch.
// New test/CI files may be copied to older Web-only branches without copying native.
import { collectChanges } from './lib/check-changes.mjs';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const has = path => existsSync(resolve(root, path));

export function pinnedVersions() {
  const pin = JSON.parse(readFileSync(resolve(root, 'config/toolchain-versions.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  if (pin.schema !== 'pando-development-toolchain-v1' ||
      readFileSync(resolve(root, '.nvmrc'), 'utf8').trim() !== pin.node ||
      readFileSync(resolve(root, '.python-version'), 'utf8').trim() !== pin.python ||
      pkg.packageManager !== 'pnpm@' + pin.pnpm) {
    throw Error('P1_TOOLCHAIN_VERSION_CONTRACT');
  }
  if (Number(process.versions.node.split('.')[0]) !== Number(pin.node)) {
    throw Error('P1_NODE_MAJOR_MISMATCH: expected ' + pin.node + ', found ' + process.versions.node);
  }
  return pin;
}

export function changedPaths({base = '', head = 'HEAD'} = {}) {
  const change = collectChanges({ root, base: base || 'origin/main', head,
    event: process.env.GITHUB_EVENT_NAME || 'push' });
  return { paths: change.files, fallback: false };
}

const infrastructure = p => [
  'CMakeLists.txt', 'CMakePresets.json', '.nvmrc', '.python-version',
  'config/toolchain-versions.json', '.github/workflows/remote-development-p1.yml',
  'scripts/p1-plan-remote-checks.mjs', 'tests/unit/p1-remote-scopes.test.mjs'
].includes(p);

export function classifyPaths(paths, capability = {}, manual = 'auto') {
  const available = {
    core: capability.core ?? has('shared/CMakeLists.txt'),
    gisTools: capability.gisTools ?? has('tools/cpp/CMakeLists.txt'),
    web: capability.web ?? has('shared/frontend/js/modules/temporal.js'),
  };
  const out = { ui:false, objects:false, gis:false, places:false,
    core:false, wasm:false, gisTools:false, python:false,
    infra:false, files:paths.length };
  const mark = flag => { out[flag]=true; };
  if (manual !== 'auto') {
    if (!['all','ui','objects','gis','places','core','wasm'].includes(manual))
      throw Error('P1_INVALID_SCOPE: ' + manual);
    if (manual === 'all') {
      for (const key of ['ui','objects','gis','places','core','wasm','gisTools','python']) mark(key);
    } else if (manual === 'ui') mark('ui');
    else if (manual === 'objects') { mark('objects'); mark('core'); }
    else if (manual === 'gis') { mark('gis'); mark('gisTools'); mark('python'); }
    else if (manual === 'places') mark('places');
    else if (manual === 'core') { mark('core'); mark('wasm'); }
    else mark('wasm');
  } else {
    for (const path of paths.map(p=>p.replaceAll('\\','/'))) {
      if (path.endsWith('.md')) continue;
      if (infrastructure(path)) {
        out.infra=true;
        for (const key of ['ui','objects','gis','places','core','wasm','gisTools']) mark(key);
      }
      if (/^shared\/(?:core|wasm|tests|third_party)\/|^shared\/CMakeLists\.txt$/.test(path)) { mark('core'); mark('wasm'); }
      if (/^tools\/cpp\//.test(path)) {mark('gis');mark('gisTools');}
      if (/^(apps\/(?:editor|viewer)\/|shared\/frontend\/|playwright\.|tests\/browser\/)/.test(path)) mark('ui');
      if (/^((?:shared\/frontend\/js|apps\/editor\/frontend\/js)\/modules\/(project|object|timeline|temporal|territorial|editing|distribution|generic)|contracts\/objects\/|tests\/unit\/(project|object|timeline|temporal|territorial))/.test(path)) mark('objects');
      // Python research edits are handled by the independent GIS Python CI.
      if (!path.endsWith('.py') && /^(assets\/data\/(territorial|hydro|terrain|historical|world)|tools\/(build-(world|terrain|country|territorial|historical|hydro)|.*(gis|hydro|terrain))|tests\/python\/)/.test(path)) mark('gis');
      if (/^(assets\/data\/places\/|contracts\/places\/|reports\/places\/|tools\/(build-place|place-)|tests\/unit\/place-)/.test(path)) mark('places');
      if (/^(tests\/unit\/|tests\/helpers\/|scripts\/check-|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$)/.test(path)) {
        if (!/(p1-remote-scopes)/.test(path)) mark('ui');
      }
      if (/\.py$/.test(path) && /^(tools\/|scripts\/|tests\/)/.test(path)) mark('python');
    }
  }
  out.core &&= available.core;
  out.wasm &&= available.core;
  out.gisTools &&= available.gisTools;
  out.ui &&= available.web;
  out.objects &&= available.web;
  out.gis &&= available.web;
  out.places &&= available.web;
  out.web = out.ui || out.objects || out.gis || out.places;
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pin = pinnedVersions();
  const manual = process.env.PANDO_P1_SCOPE || 'auto';
  const change = changedPaths({base:process.env.PANDO_P1_BASE_SHA || ''});
  const plan = classifyPaths(change.paths, {}, manual);
  const result = {...plan,manual,fallBackDiff:change.fallback,
    paths:change.paths,branch:process.env.GITHUB_REF_NAME || 'local'};
  if (process.argv.includes('--github-output')) {
    if (!process.env.GITHUB_OUTPUT) throw Error('GITHUB_OUTPUT required');
    const pairs = {web:plan.web,core:plan.core,wasm:plan.wasm,
      gis_tools:plan.gisTools,python:plan.python,
      ui:plan.ui,objects:plan.objects,gis:plan.gis,places:plan.places,
      cmake_version:pin.cmake,emscripten_version:pin.emscripten,
      emsdk_ref:pin.emsdkCommit};
    appendFileSync(process.env.GITHUB_OUTPUT,
      Object.entries(pairs).map(([k,v])=>k+'='+String(v)).join('\n')+'\n');
  }
  console.log(JSON.stringify(result,null,2));
}
