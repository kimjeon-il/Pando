// On-demand, non-destructive repository dependency census. Never run as an always-on check.
// Product publication uses the existing frontend and worker closure builders.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Linter } from 'eslint';
import { parse as parseYaml } from 'yaml';
import { buildFrontendIndex } from '../../scripts/lib/frontend-layout.mjs';
import { runtimeDependencies, dynamicExpressions } from '../../scripts/lib/product-assets.mjs';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
const slash = value => value.replaceAll('\\', '/');
const tracked = git('ls-files', '-z').split('\0').filter(Boolean).map(slash).sort();
const trackedSet = new Set(tracked);
const blobEntries = git('ls-files', '--stage', '-z').split('\0').filter(Boolean);
const blobs = new Map(blobEntries.map(row => {
  const [header, path] = row.split('\t');
  return [slash(path), header.split(' ')[1]];
}));
const frontend = buildFrontendIndex(root);
const outputOwners = new Map([...frontend].map(([publicPath, entry]) => [publicPath, entry.sourcePath]));
const indexed = new Map(tracked.map(path => [path, { path, bytes: statSync(resolve(root, path)).size, blob: blobs.get(path) || null }]));
const imports = [];
const external = [];
const missing = [];
const dynamic = [];
const workerSites = [];
const parseFailures = [];
const seen = new Set();
const linter = new Linter();

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length;
}
function classifyTarget(from, raw) {
  if (typeof raw !== 'string') return null;
  const value = slash(raw.trim()).split(/[?#]/, 1)[0];
  if (!value || /^(?:node:|data:|blob:|https?:|npm:|file:|\/\/)/.test(value)) return null;
  let path;
  if (value.startsWith('./.github/')) path = value.slice(2);
  else if (value.startsWith('workers/')) path = outputOwners.get('assets/js/' + value) || value;
  else if (value.startsWith('assets/js/')) path = outputOwners.get(value) || value;
  else if (value.startsWith('/assets/')) path = outputOwners.get(value.slice(1)) || value.slice(1);
  else if (/^(?:src|tools|scripts|tests|assets|config|contracts|projects|docs|\.github|cmake|design)\//.test(value)) path = value;
  else if (value.startsWith('./') || value.startsWith('../')) {
    path = posix.normalize(posix.join(posix.dirname(from), value));
    // new URL(relative, import.meta.url) is sometimes authored for the
    // published frontend directory, not its source domain directory.
    if (!trackedSet.has(path)) {
      const published = [...frontend].find(([, item]) => item.sourcePath === from)?.[0];
      if (published) {
        const translated = posix.normalize(posix.join(posix.dirname(published), value));
        if (outputOwners.has(translated)) path = outputOwners.get(translated);
      }
    }
  }
  else return null;
  if (path.startsWith('assets/js/')) path = outputOwners.get(path) || path;
  if (!trackedSet.has(path) && trackedSet.has(path + '.js')) path += '.js';
  if (!trackedSet.has(path) && trackedSet.has(path + '.mjs')) path += '.mjs';
  return path;
}
function add(from, raw, kind, line = 0, certainty = 'exact') {
  const to = classifyTarget(from, raw);
  if (!to) {
    if (raw && /^(?:assets\/data\/|assets\/worker-runtime\/)/.test(raw)) external.push({ from, raw, kind, line });
    return;
  }
  const key = from + '\0' + to + '\0' + kind + '\0' + line;
  if (seen.has(key)) return;
  seen.add(key);
  const edge = { from, to, kind, line, certainty };
  if (trackedSet.has(to)) imports.push(edge);
  else if (/^(?:assets\/data\/|assets\/worker-runtime\/|assets\/js\/build-meta\.js$)/.test(to))
    external.push({ from, raw: to, kind, line });
  else if (existsSync(resolve(root, to)) && statSync(resolve(root, to)).isDirectory())
    external.push({ from, raw: to, kind: kind + '-directory', line });
  else if (/^\w+\/\.[\w.-]+\.tmp\.[cm]?js$/.test(to))
    external.push({ from, raw: to, kind: kind + '-generated-temporary', line });
  else missing.push(edge);
}
function stringsOf(node) {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral' && node.quasis?.length) {
    const prefix = node.quasis[0].value.cooked || '';
    if (node.expressions.length === 0) return [prefix];
    const beforeQuery = prefix.split('?', 1)[0];
    return /\.(?:[cm]?js|json|css|wasm)$/.test(beforeQuery) ? [beforeQuery] : [];
  }
  if (node.type === 'ConditionalExpression') return [...stringsOf(node.consequent), ...stringsOf(node.alternate)];
  if (node.type === 'LogicalExpression') return [...stringsOf(node.left), ...stringsOf(node.right)];
  return [];
}
function walk(node, sourceCode, visit) {
  if (!node || typeof node !== 'object' || !node.type) return;
  visit(node);
  for (const key of sourceCode.visitorKeys[node.type] || []) {
    const child = node[key];
    for (const next of Array.isArray(child) ? child : [child]) walk(next, sourceCode, visit);
  }
}
function scanJavaScript(path, source) {
  let sourceCode;
  try {
    const errors = linter.verify(source, { languageOptions: { ecmaVersion: 2024, sourceType: 'module', parserOptions: { range: true } } });
    const fatal = errors.find(error => error.fatal);
    if (fatal) throw Error(fatal.message);
    sourceCode = linter.getSourceCode();
  } catch (error) {
    parseFailures.push({ path, error: String(error.message || error) });
    scanTextPaths(path, source, false);
    return;
  }
  walk(sourceCode.ast, sourceCode, node => {
    const line = node.loc?.start?.line || lineOf(source, node.range?.[0] || 0);
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
      for (const value of stringsOf(node.source)) add(path, value, 'esm-static', line);
    }
    if (node.type === 'ImportExpression') {
      const list = stringsOf(node.source);
      if (list.length) for (const value of list) add(path, value, 'esm-dynamic-resolved', line);
      else dynamic.push({ path, line, kind: 'esm-dynamic-expression',
        expression: source.slice(node.source?.range?.[0] || node.range[0], node.source?.range?.[1] || node.range[1]).slice(0, 150),
        declaredByBuild: (dynamicExpressions[frontendPath(path)] || []).some(value =>
          source.slice(node.source?.range?.[0] || node.range[0], node.source?.range?.[1] || node.range[1]).trim() === value) });
    }
    if (node.type === 'NewExpression' && node.callee?.name === 'URL') {
      for (const value of stringsOf(node.arguments?.[0])) {
        // Directory-base URLs are not dependency files.
        if (/\.[a-z0-9]{1,8}(?:\?|$)/i.test(value)) add(path, value, 'new-url', line);
      }
    }
    if (node.type === 'NewExpression' && ['Worker', 'SharedWorker', 'WorkerClass'].includes(node.callee?.name)) {
      const expr = source.slice(node.range[0], Math.min(node.range[1], node.range[0] + 220));
      const matches = [...expr.matchAll(/['"]([^'"]+\.(?:[cm]?js|wasm)(?:\?[^'"]*)?)['"]/g)].map(match => match[1]);
      for (const value of matches) add(path, value, 'worker-constructor-literal', line, 'candidate');
      workerSites.push({ path, line, constructor: node.callee.name, expression: expr,
        staticTargets: matches.map(value => classifyTarget(path, value)).filter(Boolean) });
    }
    if (node.type === 'CallExpression') {
      const name = node.callee?.name || (node.callee?.type === 'MemberExpression' ? node.callee.property?.name : '');
      if (name === 'importScripts') {
        const targets = node.arguments.flatMap(stringsOf);
        for (const value of targets) add(path, value, 'worker-import-scripts', line);
        if (targets.length !== node.arguments.length) dynamic.push({ path, line, kind: 'worker-import-scripts-expression' });
      }
      if (name === 'require') for (const value of node.arguments.flatMap(stringsOf)) add(path, value, 'commonjs-require', line);
      if (name === 'createVerifiedCoreWorker') {
        workerSites.push({ path, line, constructor: 'createVerifiedCoreWorker', expression: source.slice(node.range[0], Math.min(node.range[1], node.range[0] + 260)),
          staticTargets: [] });
      }
    }
  });
  scanTextPaths(path, source, false);
}
function frontendPath(path) {
  for (const [publicPath, source] of outputOwners) if (source === path) return publicPath;
  return path;
}
const PATH_REF = /(?:^|[^A-Za-z0-9_./-])((?:src|tools|scripts|tests|assets|config|contracts|projects|docs|\.github|cmake)\/[A-Za-z0-9_.\/-]+\.(?:geojson|json|yaml|cpp|hpp|cjs|mjs|wasm|webp|gpkg|patch|html|woff2|yml|css|svg|png|txt|b64|tif|ps1|inc|md|sh|js|h))(?![A-Za-z0-9_.])/gm;
function scanTextPaths(path, source, includeDocs) {
  // Exact-root path strings supply evidence; they do not imply executable invocation.
  for (const match of source.matchAll(PATH_REF)) {
    if (match[1] === path) continue;
    add(path, match[1], includeDocs ? 'documentation-reference' : 'path-reference', lineOf(source, match.index), 'reference');
  }
}
function scanNative(path, source) {
  for (const match of source.matchAll(/^\s*#\s*include\s*["<]([^">]+)[">]/gm)) {
    const spec = match[1];
    if (spec.startsWith('pandoeditor/')) {
      const candidates = tracked.filter(p => p.endsWith('/native/include/' + spec));
      if (candidates.length === 1) add(path, candidates[0], 'native-include', lineOf(source, match.index));
      else if (candidates.length > 1) dynamic.push({ path, kind: 'native-header-ambiguous', spec, candidates });
    } else {
      const relative = posix.normalize(posix.join(posix.dirname(path), spec));
      if (trackedSet.has(relative)) add(path, relative, 'native-include', lineOf(source, match.index));
    }
  }
  scanTextPaths(path, source, false);
}
function scanCMake(path, source) {
  for (const match of source.matchAll(/(?:src|tests|tools|config|cmake)\/[A-Za-z0-9_.\/-]+\.(?:cpp|c|h|hpp|inc|cmake|json)/g))
    add(path, match[0], 'cmake-source', lineOf(source, match.index));
  // Native tools use both repository-root and CMake-file-relative sources.
  // Scan every explicit source file token; preserve optional CMake targets.
  for (const match of source.matchAll(/(?:^|[\s("'=])((?:\.\.\/|\.\/)?[A-Za-z0-9_.\/-]+\.(?:cpp|cc|c|h|hpp|inc))(?![A-Za-z0-9_.])/gm)) {
    const raw = match[1];
    const relative = raw.startsWith('src/') || raw.startsWith('tests/') || raw.startsWith('tools/')
      ? raw : './' + raw;
    add(path, relative, 'cmake-explicit-source', lineOf(source, match.index));
  }
  for (const match of source.matchAll(/add_subdirectory\(\s*([A-Za-z0-9_.\/-]+)/gmi))
    add(path, posix.normalize(posix.join(posix.dirname(path), match[1], 'CMakeLists.txt')), 'cmake-subdirectory', lineOf(source, match.index));
  for (const match of source.matchAll(/include\(\s*["']?([A-Za-z0-9_.\/-]+\.cmake)/gmi))
    add(path, match[1].startsWith('.') ? match[1] : './' + match[1], 'cmake-include', lineOf(source, match.index));
  if (/file\s*\(\s*GLOB(?:_RECURSE)?\b/i.test(source)) dynamic.push({ path, kind: 'cmake-glob', expression: 'CMake scans a variable source list' });
  scanTextPaths(path, source, false);
}
function scanCommands(path, source, kind) {
  const entry = /(?:^|[;&|\s('"])(?:node|nodejs|bun|tsx|bash|sh|pwsh|python3?|git\s+ls-files)\s+(?:(?:--[^\s;&|]+\s+)*)?((?:\.\/)?(?:src|tools|scripts|tests|\.github)\/[A-Za-z0-9_.\/-]+\.(?:mjs|cjs|js|sh|ps1|py))/gm;
  for (const m of source.matchAll(entry)) add(path, m[1], kind + '-execute', lineOf(source, m.index));
  for (const m of source.matchAll(/(?:^|[\s'"])(?:\.\/)?(\.github\/(?:workflows|actions)\/[A-Za-z0-9_.\/-]+(?:\.yml)?)/gm))
    add(path, m[1], kind + '-local-action', lineOf(source, m.index));
  for (const m of source.matchAll(/gh\s+workflow\s+(?:run|view)\s+([A-Za-z0-9_.\/-]+\.yml)/gm))
    add(path, '.github/workflows/' + m[1], kind + '-workflow-dispatch', lineOf(source, m.index));
  scanTextPaths(path, source, false);
}
function scanWorkflow(path, source) {
  let value;
  try { value = parseYaml(source); }
  catch (error) { parseFailures.push({ path, error: 'YAML: ' + String(error.message || error) }); return; }
  for (const job of Object.values(value?.jobs || {})) {
    if (typeof job?.uses === 'string' && job.uses.startsWith('./')) add(path, job.uses, 'workflow-reusable');
    for (const step of job?.steps || []) {
      if (typeof step?.uses === 'string' && step.uses.startsWith('./')) {
        const ref = step.uses.replace(/\/$/, '');
        add(path, ref.endsWith('.yml') ? ref : ref + '/action.yml', 'workflow-local-action');
      }
      if (typeof step?.run === 'string') scanCommands(path, step.run, 'workflow');
    }
  }
  scanTextPaths(path, source, false);
}
function scanPackage(path, source) {
  let p;
  try { p = JSON.parse(source); } catch { return; }
  for (const command of Object.values(p.scripts || {})) scanCommands(path, command, 'package-script');
}
function scanJson(path, source) {
  if (path === 'package.json') return scanPackage(path, source);
  let obj;
  try { obj = JSON.parse(source); } catch { scanTextPaths(path, source, false); return; }
  const visit = value => {
    if (typeof value === 'string') {
      const to = classifyTarget(path, value);
      if (to) add(path, value, 'json-resource-path');
    } else if (Array.isArray(value)) for (const v of value) visit(v);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) visit(v);
  };
  if (/^(?:config\/|projects\/|scripts\/contracts\/|contracts\/)/.test(path) &&
      !/(?:baseline|evidence|historical)/.test(path)) visit(obj);
  scanTextPaths(path, source, false);
}
function scanHtmlCss(path, source) {
  if (/\.html$/.test(path)) {
    for (const match of source.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g))
      add(path, match[1], 'html-asset', lineOf(source, match.index));
  }
  if (/\.css$/.test(path)) {
    for (const match of source.matchAll(/(?:url\(\s*["']?|@import\s+["'])([^"'()\s]+)["']?\s*\)?/g))
      add(path, match[1], 'css-asset', lineOf(source, match.index));
  }
  scanTextPaths(path, source, false);
}

for (const path of tracked) {
  const suffix = path.split('/').at(-1);
  const ext = suffix.split('.').at(-1).toLowerCase();
  if (/\.(?:png|jpg|jpeg|webp|wasm|zip|gpkg|tif|gz|woff2|pdf|raw|rgba|dbf|shp|shx|b64)$/.test(path)) continue;
  if (indexed.get(path).bytes > 2_000_000) continue;
  let source;
  try { source = readFileSync(resolve(root, path), 'utf8'); }
  catch (error) { parseFailures.push({ path, error: 'read: ' + String(error.message || error) }); continue; }
  if (source.includes('\0')) continue;
  if (/^(?:.*\/)?CMakeLists\.txt$/.test(path) || ext === 'cmake') scanCMake(path, source);
  else if (['cpp', 'cc', 'c', 'h', 'hpp', 'inc'].includes(ext)) scanNative(path, source);
  else if (['mjs', 'js', 'cjs', 'jsx'].includes(ext) && !path.startsWith('assets/js-vendor/')) scanJavaScript(path, source);
  else if (path.startsWith('.github/workflows/') && ['yml', 'yaml'].includes(ext)) scanWorkflow(path, source);
  else if (ext === 'json') scanJson(path, source);
  else if (['html', 'css'].includes(ext)) scanHtmlCss(path, source);
  else if (ext === 'md') scanTextPaths(path, source, true);
  else if (['sh', 'ps1', 'yml', 'yaml'].includes(ext)) scanCommands(path, source, 'script');
}
for (const [publicPath, deps] of Object.entries(runtimeDependencies)) {
  const from = outputOwners.get(publicPath) || publicPath;
  for (const dependency of deps) add(from, dependency, 'declared-runtime-dependency');
}
for (const path of tracked.filter(path => /^assets\/(?:vendor|fonts|wasm)\//.test(path)))
  add('scripts/lib/product-assets.mjs', path, 'published-assets-directory');
// Source directories used for source-to-output mapping are build inputs; not all
// indexed source modules are automatically shipped, so reachability is kept separate.
for (const [publicPath, entry] of frontend) if (entry.sourcePath.startsWith('src/ui/fragments/'))
  add('scripts/lib/frontend-layout.mjs', entry.sourcePath, 'build-fragment');
for (const path of tracked.filter(path => /^src\/ui\/fragments\/.*\.html$/.test(path)))
  add('scripts/lib/frontend-layout.mjs', path, 'build-fragment');
for (const path of tracked.filter(path => /^src\/ui\/css\//.test(path)))
  add('scripts/lib/frontend-layout.mjs', path, 'build-css-directory');
for (const path of tracked.filter(path => /^src\/.*\/native\/include\//.test(path)))
  add('tools/build/native/core/CMakeLists.txt', path, 'native-include-root');

const adjacency = new Map();
const inbound = new Map();
for (const edge of imports) {
  if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
  adjacency.get(edge.from).push(edge);
  if (!inbound.has(edge.to)) inbound.set(edge.to, []);
  inbound.get(edge.to).push(edge);
}
const evidenceOnly = new Set(['documentation-reference', 'path-reference']);
function reach(start) {
  const roots = start.filter(path => trackedSet.has(path)), seen = new Set(roots), queue = [...roots];
  for (let i = 0; i < queue.length; i++)
    for (const edge of adjacency.get(queue[i]) || []) {
      if (evidenceOnly.has(edge.kind) || edge.certainty === 'reference') continue;
      if (!seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
    }
  return seen;
}
const production = reach(['src/app/index.html', 'src/app/viewer.js']);
const toolRoots = ['package.json', 'CMakeLists.txt', ...tracked.filter(p => p.startsWith('.github/workflows/'))];
const operations = reach(toolRoots);
const tests = reach(tracked.filter(p => /^(?:tests\/(?:unit|browser|integration|native|cpp)\/)/.test(p) && /\.(?:mjs|js|cpp)$/.test(p)));
const byBlob = new Map();
for (const item of indexed.values()) if (item.blob) {
  if (!byBlob.has(item.blob)) byBlob.set(item.blob, []);
  byBlob.get(item.blob).push(item.path);
}
const duplicates = [...byBlob].filter(([, files]) => files.length > 1).map(([sha, files]) => ({ sha, files })).sort((a,b)=>b.files.length-a.files.length);
const entries = [...indexed.values()].map(item => {
  const incoming = inbound.get(item.path) || [];
  const executable = incoming.filter(e => !evidenceOnly.has(e.kind) && e.certainty !== 'reference');
  const scope = production.has(item.path) ? 'viewer-runtime' : operations.has(item.path) ? 'build-ci-tool' :
    tests.has(item.path) ? 'test-support' : /^docs\//.test(item.path) ? 'documentation' :
    /^tests\/fixtures\//.test(item.path) ? 'fixture-unconfirmed' : /^assets\//.test(item.path) ? 'asset-unconfirmed' :
    /^tools\/gis\//.test(item.path) ? 'gis-source-or-research-unconfirmed' : 'no-confirmed-executable-consumer';
  return { ...item, scope, directExecutableConsumers: executable.length,
    incoming: incoming.map(e => ({ from: e.from, kind: e.kind, line: e.line, certainty: e.certainty })) };
});
const counts = entries.reduce((acc, r) => { acc[r.scope] = (acc[r.scope] || 0) + 1; return acc; }, {});
const unresolved = entries.filter(r => r.scope === 'no-confirmed-executable-consumer' &&
  /^(?:src|scripts|tools)\//.test(r.path)).map(r => r.path);
const summary = {
  commit: git('rev-parse', 'HEAD').trim(), branch: git('branch', '--show-current').trim(),
  tracked: tracked.length, edges: imports.length, externalReferences: external.length,
  missingSourceReferences: missing.length, parseFailures: parseFailures.length,
  dynamicExpressions: dynamic.length, workerConstructorSites: workerSites.length,
  uniqueWorkerSiteFiles: new Set(workerSites.map(x => x.path)).size,
  duplicateBlobGroups: duplicates.length, scopeCounts: counts,
  unknownExecutableConsumerCandidates: unresolved.length,
  unresolvedCandidates: unresolved.slice(0, 90),
  missingRefs: missing.filter(m => m.kind !== 'path-reference').slice(0, 70),
  dynamicSamples: dynamic.slice(0, 50),
  workerSites: workerSites.slice(0, 75),
  duplicateExamples: duplicates.filter(x => x.files.some(p=>p.startsWith('src/'))).slice(0, 15)
};
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length)
  || process.env.PANDO_OWNERSHIP_OUTPUT || '';
const result = { schema: 'pando-repository-dependency-audit-v1', summary, entries, edges: imports, external, missing, dynamic, workerSites, parseFailures, duplicates,
  classificationPolicy: {
    product: 'Static/declared routes from real Viewer entry; not an executed-browser measurement.',
    operations: 'Static/declared routes from package, CMake and workflow roots; manual workflow is not necessarily scheduled.',
    tests: 'Test reachability is scoped independently and does not mean every test runs in CI.',
    unknown: 'No proven executable reverse edge is not proof of dead code; reflect dynamic scripts, external source mounts, glob inputs and generated assets.'
  } };
if (output) {
  mkdirSync(dirname(resolve(root, output)), { recursive: true });
  writeFileSync(resolve(root, output), JSON.stringify(result, null, 2) + '\n');
}
console.log('PANDO_STAGE1_SUMMARY=' + JSON.stringify(summary));
if (!output) console.log('Pass --output=<path> to retain full per-file reverse consumers.');
