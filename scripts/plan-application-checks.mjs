import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { parseJavaScript, walkJavaScript } from './lib/source-analysis.mjs';

const workflowPath = '.github/workflows/application-architecture.yml';
const plannerPath = 'scripts/plan-application-checks.mjs';
const specPath = name => `tests/browser/${name}.spec.mjs`;

export const MANUAL_SCOPES = Object.freeze(['default', 'map-rendering', 'editor-diagnostics',
  'boundary-capture-comparison', 'boundary-native-capture', 'boundary-revision-comparison']);
export const FOCUSED_BROWSER_SPECS = Object.freeze({
  'map-rendering': ['country-map-substrate', 'interaction-unification'].map(specPath),
  'editor-diagnostics': ['gis-interchange', 'boundary-cut-snapping', 'hydro-metadata-edit',
    'library-header-layout'].map(specPath),
});
const smokeSpecs = ['boundary-cut-snapping', 'country-label-flags', 'generic-feature-independent-geometry',
  'hydro-metadata-edit', 'storage-protection', 'ui-components', 'gis-interchange'].map(specPath);

// Broad ownership patterns and non-import dependencies are explicit policy.
// Current job inputs come from YAML, and their imports are followed below so
// renamed modules or changed job inputs do not need a copied file-list update.
const scopePatterns = {
  "data_contracts": [
    "assets/js/*",
    "assets/data/*",
    "index.html",
    "README.md",
    "tools/*",
    "tests/fixtures/*",
    "scripts/*",
    "package.json",
    "pnpm-lock.yaml",
    ".github/workflows/application-architecture.yml"
  ],
  "visual_policy": [
    "assets/css/features/map-rendering.css",
    "assets/css/ui.bundle.css",
    ".github/workflows/application-architecture.yml"
  ],
  "scene_staging": [
    "assets/js/modules/gpu-upload-scheduler.js",
    "assets/js/modules/gpu-resource-budget.js",
    "tests/browser/server.mjs",
    "playwright.config.js",
    "package.json",
    "pnpm-lock.yaml",
    "eslint.config.js",
    ".github/workflows/application-architecture.yml"
  ],
  "preview_handoff": [
    "assets/js/modules/editing-render-packet.js",
    "assets/js/modules/map-render-coordinator.js",
    "assets/js/modules/app-interaction-packets.js",
    "assets/js/modules/selection-*",
    "assets/js/modules/render-channel-ownership.js",
    "assets/js/modules/map-visual-frame.js",
    "assets/js/modules/map-edit-*",
    "assets/js/modules/gpu-map-renderer.js",
    "assets/js/modules/gpu-canvas-worker.js",
    "assets/js/modules/gpu-interaction-pass.js",
    "assets/js/modules/gpu-stroke-renderer.js",
    "assets/js/workers/canvas-render-worker.js",
    "assets/js/workers/map-edit-worker.js",
    "tests/unit/edit-preview-*.test.mjs",
    "tests/unit/editing-*.test.mjs",
    "tests/helpers/production-geopackage.mjs",
    "tests/fixtures/timeline-exchange/static.json",
    "tests/browser/server.mjs",
    "playwright.config.js",
    "package.json",
    "pnpm-lock.yaml",
    "eslint.config.js",
    ".github/workflows/application-architecture.yml"
  ],
  "territorial_store": [
    "assets/js/*",
    "tests/unit/territorial-*.test.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "eslint.config.js",
    "scripts/check-territorial-storage.mjs",
    "scripts/lib/territorial-storage-audit.mjs",
    "scripts/contracts/territorial-storage-access.json",
    ".github/workflows/application-architecture.yml"
  ],
  "unit_suite": [
    "assets/js/*",
    "tests/unit/*",
    "tests/helpers/*",
    "tests/fixtures/*",
    "scripts/*",
    "tools/*.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "eslint.config.js",
    ".github/workflows/application-architecture.yml"
  ],
  "boundary_continuity": [
    "assets/js/modules/app-domain-assembly.js",
    "assets/js/modules/map-display-preparation.js",
    "assets/js/modules/map-edit-*",
    "assets/js/modules/boundary-*",
    "assets/js/modules/gpu-scene-*",
    "assets/js/modules/gpu-map-renderer.js",
    "assets/js/modules/gpu-canvas-worker.js",
    "assets/js/modules/gpu-base-scene-pass.js",
    "assets/js/modules/gpu-stroke-renderer.js",
    "assets/js/modules/gpu-scene.js",
    "assets/js/modules/map-visual-frame.js",
    "assets/js/modules/map-render-coordinator.js",
    "assets/js/modules/render-channel-ownership.js",
    "assets/js/workers/map-edit-worker.js",
    "assets/js/workers/canvas-render-worker.js",
    "tests/browser/server.mjs",
    "playwright.config.js",
    "package.json",
    "pnpm-lock.yaml",
    "eslint.config.js",
    ".github/workflows/application-architecture.yml"
  ],
  "terrain_rendering": [
    "assets/js/modules/gpu-*",
    "assets/js/modules/terrain-*",
    "assets/js/modules/map-visual-frame.js",
    "assets/js/modules/app-map-*",
    "assets/js/modules/app-physical-*",
    "tests/browser/terrain-*.spec.mjs",
    "tests/browser/server.mjs",
    "playwright.config.js",
    "package.json",
    "pnpm-lock.yaml",
    "eslint.config.js",
    ".github/workflows/application-architecture.yml"
  ]
};
export const APPLICATION_SCOPES = Object.freeze(Object.keys(scopePatterns));
const infrastructure = ['tests/browser/server.mjs', 'playwright.config.js', workflowPath, plannerPath,
  'package.json', 'pnpm-lock.yaml', 'eslint.config.js'];

export function effectiveManualScope(eventName, browserScope) {
  const scope = eventName === 'workflow_dispatch' ? browserScope || 'default' : 'default';
  if (!MANUAL_SCOPES.includes(scope)) throw new Error(`Unsupported browser_scope: ${scope}`);
  return scope;
}

function matchesPattern(file, pattern) {
  const escaped = pattern.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`).test(file);
}

export function applicationScopes(changedFiles, manualScope = 'default', eventName = 'pull_request', repository) {
  const scopes = Object.fromEntries(APPLICATION_SCOPES.map(name => [name, false]));
  if (eventName === 'workflow_dispatch') {
    if (manualScope === 'default') for (const name of APPLICATION_SCOPES) scopes[name] = true;
    else if (manualScope === 'map-rendering') scopes.preview_handoff = true;
    return scopes;
  }
  const changed = new Set(changedFiles.map(file => file === plannerPath ? workflowPath : file));
  if (!changed.size) return scopes;
  for (const [name, patterns] of Object.entries(scopePatterns)) {
    const currentRoots = Object.values(repository?.workflow.jobs || {}).filter(job =>
      String(job.if || '').includes(`needs.changes.outputs.${name.replaceAll('_', '-')}`))
      .flatMap(job => (job.steps || []).flatMap(step => [...String(step.run || '')
        .matchAll(/(?:assets|tests|scripts|tools)\/[\w./-]+\.(?:m?js|css|json|py)\b/g)].map(match => match[0])));
    const roots = [...patterns, ...currentRoots];
    const directlyAffected = [...changed].some(file => roots.some(pattern => matchesPattern(file, pattern)));
    scopes[name] = directlyAffected || Boolean(repository && repository.sourceFiles.some(file =>
      roots.some(pattern => matchesPattern(file, pattern)) && consumesChangedFile(file, changed, repository)));
  }
  return scopes;
}

function consumesChangedFile(file, changed, repository, visited = new Set()) {
  if (changed.has(file)) return true;
  if (visited.has(file) || !repository.exists(file)) return false;
  visited.add(file);
  return repository.dependencies(file).some(dependency => consumesChangedFile(dependency, changed, repository, visited));
}

function titlesFromReport(suite) {
  return [...(suite.specs || []).map(spec => spec.title), ...(suite.suites || []).flatMap(titlesFromReport)];
}

// Whole-spec jobs are read from current YAML. For a matrix-filtered command,
// discovery must prove that the union of its filters covers every current case.
export function completeBrowserSpecs(workflow, listTests, candidates, scopes) {
  const covered = new Set();
  for (const job of Object.values(workflow.jobs || {})) {
    const scope = String(job.if || '').match(/needs\.changes\.outputs\.([\w-]+)/)?.[1];
    if (!scope || (scopes && !scopes[scope.replaceAll('-', '_')])) continue;
    for (const step of job.steps || []) {
      const command = String(step.run || '').match(/playwright\s+test\s+([^\n]+)/)?.[1];
      if (!command) continue;
      const specs = [...command.matchAll(/tests\/browser\/[\w.-]+\.spec\.mjs/g)].map(match => match[0])
        .filter(spec => !candidates || candidates.has(spec));
      if (!/--grep(?:[=\s]|$)/.test(command)) {
        for (const spec of specs) covered.add(spec);
        continue;
      }
      const matrixFilter = command.match(/--grep=['"]\$\{\{\s*matrix\.(\w+)\s*\}\} ([^'"]*)['"]/);
      const values = matrixFilter && job.strategy?.matrix?.[matrixFilter[1]];
      if (!Array.isArray(values) || !listTests) continue;
      const filters = values.map(value => new RegExp(`${value} ${matrixFilter[2]}`));
      for (const spec of specs) {
        const titles = listTests(spec);
        if (titles.length && titles.every(title => filters.some(filter => filter.test(title)))) covered.add(spec);
      }
    }
  }
  return covered;
}

export function browserContracts(changedFiles, manualScope, eventName, repository, scopes) {
  if (manualScope.startsWith('boundary-')) return [];
  if (FOCUSED_BROWSER_SPECS[manualScope]) {
    const selected = FOCUSED_BROWSER_SPECS[manualScope];
    for (const spec of selected) if (!repository.exists(spec)) throw new Error(`Missing focused browser spec: ${spec}`);
    return [...selected];
  }
  const changed = new Set(changedFiles);
  const selected = new Set(repository.browserSpecs.filter(file => changed.has(file)));
  const helpers = new Set([...changed].filter(file => file.startsWith('tests/helpers/') || file.startsWith('tests/browser/helpers/')));
  if (helpers.size) for (const spec of repository.browserSpecs) if (consumesChangedFile(spec, helpers, repository)) selected.add(spec);
  const fullyCovered = completeBrowserSpecs(repository.workflow, repository.listTests, selected, scopes);
  for (const spec of fullyCovered) selected.delete(spec);
  if (eventName === 'workflow_dispatch' || infrastructure.some(file => changed.has(file))
    || [...changed].some(file => file.startsWith('tests/fixtures/'))) {
    for (const spec of smokeSpecs) {
      if (!repository.exists(spec)) throw new Error(`Missing smoke browser spec: ${spec}`);
      selected.add(spec);
    }
  }
  return [...selected].sort();
}

export function loadRepository(root = process.cwd(), { listTests } = {}) {
  if (root instanceof URL) root = fileURLToPath(root);
  const exists = file => existsSync(resolve(root, file));
  const dependenciesByFile = new Map();
  const read = file => readFileSync(resolve(root, file), 'utf8');
  function relativeSource(node) {
    const literal = node?.value;
    if (typeof literal === 'string') return literal.split(/[?#]/)[0];
    if (node?.type !== 'TemplateLiteral') return undefined;
    const first = node.quasis[0].value.cooked;
    if (!node.expressions.length || /[?#]/.test(first)) return first.split(/[?#]/)[0];
    return undefined;
  }
  function dependencies(file) {
    if (dependenciesByFile.has(file)) return dependenciesByFile.get(file);
    if (!/\.[cm]?js$/.test(file)) return [];
    const dependencies = [];
    const source = parseJavaScript(read(file), { filePath: file });
    walkJavaScript(source, node => {
      let imported;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
        imported = relativeSource(node.source);
      } else if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL') {
        imported = relativeSource(node.arguments[0]);
      } else if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'importScripts') {
        for (const argument of node.arguments) {
          const relative = relativeSource(argument);
          if (typeof relative === 'string' && relative.startsWith('.')) {
            dependencies.push(posix.normalize(posix.join(posix.dirname(file), relative)));
          }
        }
      }
      if (typeof imported === 'string' && imported.startsWith('.')) dependencies.push(posix.normalize(posix.join(posix.dirname(file), imported)));
    });
    dependenciesByFile.set(file, dependencies);
    return dependencies;
  }
  function javascriptFiles(directory) {
    if (!exists(directory)) return [];
    return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? javascriptFiles(file) : /\.[cm]?js$/.test(file) ? [file] : [];
    });
  }
  return {
    exists, dependencies,
    workflow: parseYaml(read(workflowPath)),
    browserSpecs: javascriptFiles('tests/browser').filter(file => file.endsWith('.spec.mjs')),
    sourceFiles: [...javascriptFiles('assets/js/modules'), ...javascriptFiles('assets/js/workers'),
      ...javascriptFiles('tests/unit'), ...javascriptFiles('tests/helpers'), ...javascriptFiles('tests/browser')],
    listTests: listTests || (spec => {
      const report = JSON.parse(execFileSync(process.execPath,
        [resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', spec, '--list', '--reporter=json'],
        { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
      return (report.suites || []).flatMap(titlesFromReport);
    }),
  };
}

export function planApplicationChecks({ eventName = 'pull_request', browserScope, changedFiles = [], repository }) {
  const manualScope = effectiveManualScope(eventName, browserScope);
  const scopes = applicationScopes(changedFiles, manualScope, eventName, repository);
  return {
    scopes,
    browserSpecs: browserContracts(changedFiles, manualScope, eventName, repository, scopes),
  };
}

export function runApplicationPlanner({ env = process.env, gitDiff, repository, writeOutput } = {}) {
  const eventName = env.GITHUB_EVENT_NAME || 'pull_request';
  const manualScope = effectiveManualScope(eventName, env.BROWSER_SCOPE);
  const needsDiff = manualScope === 'default';
  const base = env.BASE_SHA && !/^0+$/.test(env.BASE_SHA) ? env.BASE_SHA : 'origin/main';
  const changedFiles = needsDiff ? (gitDiff || ((from, to) => {
    if (!to) throw new Error('HEAD_SHA is required to plan changed checks');
    return execFileSync('git', ['diff', '--name-only', '-z', from, to], { encoding: 'utf8' }).split('\0').filter(Boolean);
  }))(base, env.HEAD_SHA) : [];
  const plan = planApplicationChecks({ eventName, browserScope: manualScope, changedFiles,
    repository: repository || loadRepository() });
  const outputs = Object.entries(plan.scopes).map(([name, enabled]) => `${name}=${enabled}`);
  outputs.push(`current_browser_specs=${JSON.stringify(plan.browserSpecs)}`);
  if (writeOutput) writeOutput(`${outputs.join('\n')}\n`);
  else if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
  else console.log(JSON.stringify(plan, null, 2));
  return plan;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes('--github-output') && !process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  runApplicationPlanner();
}
