import {buildFrontendIndex,emitFrontendModule,frontendGeneratedOwners} from './lib/frontend-layout.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJavaScript, walkJavaScript } from './lib/source-analysis.mjs';
import { runtimeDependencies, dynamicExpressions } from './lib/product-assets.mjs';

export const catalogPath = 'scripts/contracts/application-checks.json';

// Archived graphical-editor browser tests are indexed for traceability but
// must not be parsed as currently deployable Viewer runtime dependencies.
// Classification uses explicit retired entrypoints, not a blanket test ban.
export function retiredEditorBrowserReason(file,source='',availablePaths=null) {
  if(!file.startsWith('tests/browser/')||!file.endsWith('.spec.mjs'))return null;
  if(/(?:^|\/)(?:editor-[^/]+|draft-[^/]+|editing-[^/]+|map-editing-[^/]+|mobile-vertex-ui|phone-landscape-editor)\.spec\.mjs$/.test(file))
    return 'retired graphical-editor browser entrypoint';
  if(/(?:from|import)\s*['"][^'"]*helpers\/editor-entry\.mjs['"]/.test(source) ||
     /\b(?:gotoEditor|editorTestUrl)\s*\(/.test(source) ||
     /(?:\/__editor\/index\.html|products\.editor|renderProductHtml\([^)]+\)\.editor)/.test(source))
    return 'loads retired editor DOM or startup instead of the shipped Viewer';
  // An old browser fixture that imports a module/Worker outside the public
  // Viewer source graph tests the retired editor, not a released runtime.
  // Real Viewer and GIS tests with valid imports remain automatic.
  if(availablePaths)for(const match of source.matchAll(
    /(?:\bimport\s*\(|\bnew\s+Worker\s*\()\s*['"]\/(assets\/js\/[^'"?]+)[^'"]*['"]/g)) {
    const asset=match[1];
    if(!availablePaths.has(asset) && !frontendGeneratedOwners[asset] &&
       !asset.startsWith('assets/js/worker-runtime/'))
      return 'references a retired non-distributable browser module: '+asset;
  }
  return null;
}

const slash = path => path.replaceAll('\\', '/');
export function matchesPattern(file, pattern) {
  const tokens = pattern.split(/(\*\*|\*)/).map(part => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('^' + tokens.join('') + '$').test(file);
}
const matches = (file, patterns = []) => patterns.some(pattern => matchesPattern(file, pattern));
const executable = file => /\.[cm]?js$/.test(file) && !/\/(?:vendor|worker-runtime|fixtures|gen|target|dist)\//.test(file);
const product = file => /^(?:shared\/frontend\/js\/|apps\/(?:editor|viewer)\/)/.test(file);

export function loadRepository(root = process.cwd(), { catalog } = {}) {
  if (root instanceof URL) root = fileURLToPath(root);
  const exists = file => existsSync(resolve(root, file));
  const read = file => readFileSync(resolve(root, file), 'utf8');
  catalog ||= JSON.parse(read(catalogPath));
  if (catalog.schema !== 'pando-application-checks-v1') throw Error('Invalid application check catalog');
  function filesIn(directory) {
    if (!exists(directory)) return [];
    return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return /^(?:node_modules|target|dist|gen|worker-runtime|vendor|\.superpowers)$/.test(entry.name) ? [] : filesIn(file);
      return [file];
    });
  }
  const files = ['assets', 'apps/editor', 'apps/viewer', 'scripts', 'tools', 'tests', 'shared', 'contracts', 'config', '.github/workflows', '.github/actions']
    .flatMap(filesIn).concat(['index.html', 'package.json', 'playwright.config.js', 'eslint.config.js'].filter(exists)).sort();
  const tests = files.filter(file => /\.(?:test|spec)\.mjs$/.test(file) && /^tests\/(?:unit|browser)\//.test(file));
  const ids = new Set();
  for (const group of catalog.groups) {
    if (!group.id || ids.has(group.id)) throw Error('Duplicate check group: ' + group.id);
    ids.add(group.id);
    if (!['unit', 'browser', 'command'].includes(group.kind)) throw Error('Invalid check kind: ' + group.id);
    if (group.kind === 'command' && !Array.isArray(group.argv)) throw Error('Missing check command: ' + group.id);
    if (group.mode === 'manual' && !group.reason) throw Error('Manual check needs a reason: ' + group.id);
    for (const required of group.requires || []) if (!catalog.prerequisites?.[required] && !catalog.groups.some(row => row.id === required)) throw Error('Missing prerequisite: ' + required);
  }
  for (const command of [...catalog.groups, ...Object.values(catalog.prerequisites || {})]) {
    for (const argv of command.argv ? [command.argv] : []) {
      if (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string')) throw Error('Invalid check command');
      for (const arg of argv.slice(1)) if (/^(?:scripts|tools|tests|apps)\/.*\.(?:m?js|json)$/.test(arg) && !exists(arg)) throw Error('Missing check command input: ' + arg);
    }
    for (const input of command.inputs || []) if (!input.includes('*') && !exists(input)) throw Error('Missing registered check input: ' + input);
  }
  for (const check of catalog.externalChecks || []) if (!exists(check.workflow)) throw Error('Missing external check workflow: ' + check.workflow);
  const complete = new Set(), active = new Set();
  function checkPrerequisite(id) {
    if (active.has(id)) throw Error('Cyclic check prerequisite: ' + id);
    if (complete.has(id)) return;
    const entry = catalog.prerequisites?.[id] || catalog.groups.find(group => group.id === id);
    if (!entry) throw Error('Missing prerequisite: ' + id);
    active.add(id);
    for (const required of entry.requires || []) {
      const dependency = catalog.prerequisites?.[required] || catalog.groups.find(group => group.id === required);
      if (!dependency?.argv) throw Error('Prerequisite must be a command: ' + required);
      checkPrerequisite(required);
    }
    active.delete(id); complete.add(id);
  }
  [...catalog.groups.map(group => group.id), ...Object.keys(catalog.prerequisites || {})].forEach(checkPrerequisite);
  for (const specs of Object.values(catalog.manualScopes || {})) for (const spec of specs)
    if (!exists(spec)) throw Error('Missing focused browser spec: ' + spec);
  const frontendIndex = buildFrontendIndex(root);
  const owners = new Map(), retiredTests = new Map();
  for (const file of tests) {
    const group = catalog.groups.find(group => matches(file, group.testPatterns));
    if (!group) throw Error('Unregistered test: ' + file);
    const reason = retiredEditorBrowserReason(file, read(file), frontendIndex);
    if (reason) {
      retiredTests.set(file, reason);
      owners.set(file, { ...group, mode: 'retired', reason });
    } else owners.set(file, group);
  }
  for (const group of catalog.groups) for (const pattern of group.testPatterns || []) {
    if (!pattern.includes('*') && !owners.has(pattern)) throw Error('Missing registered test: ' + pattern);
  }
  const unitRequirements = new Map(tests.filter(file => file.startsWith('tests/unit/'))
    .map(file => [file, new Set(owners.get(file).requires || [])]));
  for (const binding of catalog.unitPrerequisites || []) {
    if (!Array.isArray(binding.tests) || !Array.isArray(binding.requires)) throw Error('Invalid unit prerequisite binding');
    for (const pattern of binding.tests) if (!pattern.includes('*') && !unitRequirements.has(pattern))
      throw Error('Missing registered unit prerequisite test: ' + pattern);
    for (const id of binding.requires) if (!catalog.prerequisites?.[id]?.argv)
      throw Error('Missing prerequisite: ' + id);
    for (const [file, required] of unitRequirements) if (matches(file, binding.tests))
      binding.requires.forEach(id => required.add(id));
  }
  function prerequisiteInputs(id) {
    const entry = catalog.prerequisites[id] || catalog.groups.find(group => group.id === id);
    return [...(entry.argv || []).filter(arg => /^(?:scripts|tools|apps|tests)\/.*\.[cm]?js$/.test(arg)),
      ...files.filter(file => matches(file, entry.inputs)), ...(entry.requires || []).flatMap(prerequisiteInputs)];
  }
  const publicBySource=new Map([...frontendIndex.values()].map(row=>[row.sourcePath,row.publicPath]));
  const sourcePath=path=>frontendGeneratedOwners[path]||frontendIndex.get(path)?.sourcePath||path;
  const dependencyCache = new Map();
  function dependencies(file) {
    if (dependencyCache.has(file)) return dependencyCache.get(file);
    const publicFile=publicBySource.get(file)||file;
    const found = new Set([...(runtimeDependencies[publicFile] || []).map(sourcePath),
      ...[...(unitRequirements.get(file) || [])].flatMap(prerequisiteInputs)]);
    dependencyCache.set(file, found);
    if (!executable(file) || !exists(file)) return [...found];
    const text=publicBySource.has(file)?emitFrontendModule(read(file),file,frontendIndex):read(file);
    const source = parseJavaScript(text, { filePath: file });
    const output = publicFile;
    function relativeTarget(value) {
      const target = posix.normalize(posix.join(posix.dirname(output), value.split(/[?#]/)[0]));
      if (target === '..' || target.startsWith('../')) throw Error('Dependency outside repository: ' + file);
      return target;
    }
    const bindings = new Map();
    walkJavaScript(source, node => { if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') bindings.set(node.id.name, node.init); });
    function specifier(node, visited = new Set()) {
      if (!node || visited.has(node)) return;
      visited.add(node);
      if (typeof node.value === 'string') return node.value;
      if (node.type === 'TemplateLiteral') {
        const start = node.quasis[0].value.cooked;
        if (!node.expressions.length || /[?#]/.test(start)) return start.split(/[?#]/)[0];
      }
      if (node.type === 'Identifier') return specifier(bindings.get(node.name), visited);
      if (node.type === 'MemberExpression') return specifier(node.object, visited);
      if (node.type === 'NewExpression' && node.callee.name === 'URL') {
        const value = specifier(node.arguments[0], visited);
        if (file.startsWith('tests/browser/') && node.arguments[1] && /location\.href$/.test(source.getText(node.arguments[1]))
          && value?.startsWith('../modules/')) return 'assets/js/modules/' + value.slice('../modules/'.length);
        return value;
      }
      if (node.type === 'CallExpression') {
        const callee = node.callee.type === 'SequenceExpression' ? node.callee.expressions.at(-1) : node.callee;
        const name = callee.name || callee.property?.name;
        if (/^(?:versionedAsset|versionedModuleUrl|versionedWorkerAssetUrl)$/.test(name)) {
          const value = specifier(node.arguments[0], visited);
          const base = catalog.runtimeBases?.[file] || catalog.runtimeHelperBases?.[name];
          return value && base ? posix.normalize(posix.join(base, value)) : value;
        }
      }
    }
    function add(value, strict = false, browserUrl = false) {
      if (typeof value !== 'string' || /^(?:https?:|data:|node:|#)/.test(value)) return;
      value = value.split(/[?#]/)[0].replace(/\/$/, '');
      if (browserUrl && file.startsWith('tests/browser/') && /^(?:\.\/|\/)assets\//.test(value)) value = value.replace(/^(?:\.\/|\/)/, '');
      let target;
      if (value.startsWith('.')) target = relativeTarget(value);
      else if (/^(?:assets|tests|scripts|tools|apps|shared|contracts|config)\//.test(value)) target = value;
      else return;
      if (target.startsWith('../')) throw Error('Dependency outside repository: ' + file);
      target=sourcePath(target);
      if (strict && !exists(target)) throw Error(`Missing dependency ${target} in ${file}`);
      if (exists(target)) found.add(target);
    }
    walkJavaScript(source, node => {
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) add(specifier(node.source), true);
      if (node.type === 'ImportExpression') {
        const value = specifier(node.source);
        if (value) add(value, true, true);
        else if (node.source.type === 'CallExpression' && node.source.arguments[0]?.type === 'BinaryExpression'
          && source.getAncestors(node).some(ancestor => {
            const list = ancestor.callee?.object, callback = ancestor.arguments?.[0], expression = node.source.arguments[0];
            if (ancestor.type !== 'CallExpression' || ancestor.callee.property?.name !== 'map' || list?.type !== 'ArrayExpression'
              || callback?.params?.[0]?.name !== expression.right.name || typeof expression.left.value !== 'string'
              || !list.elements.every(item => typeof item.value === 'string')) return false;
            list.elements.forEach(item => add(expression.left.value + item.value, true)); return true;
          })) { /* Literal array-map module identities were added above. */ }
        else if (product(file) && !(dynamicExpressions[publicFile] || []).includes(source.getText(node.source))) throw Error('Uncatalogued dynamic dependency in ' + file + ': ' + source.getText(node.source));
      }
      if (node.type === 'NewExpression' && node.callee.name === 'URL') {
        const input = specifier(node.arguments[0]), value = specifier(node);
        const target = value?.startsWith('.') ? relativeTarget(value) : value;
        const directory = input && (input.endsWith('/') || input === '.' || input === '..');
        const consumed = source.getAncestors(node).at(-1)?.callee?.name === 'readdirSync';
        if (!directory || target?.startsWith('tests/fixtures/') || consumed) add(value);
      }
      if (node.type === 'CallExpression') {
        if (node.callee.name === 'importScripts') for (const argument of node.arguments) {
          const value = specifier(argument);
          if (value) add(value.startsWith('.') ? value : './' + value, true);
          else if (argument.type === 'SpreadElement') {
            const call = argument.argument, list = call.callee?.object, callback = call.arguments?.[0];
            const statements = callback?.body?.body, declaration = statements?.[0]?.declarations?.[0];
            const init = declaration?.init;
            if (call.type !== 'CallExpression' || call.callee.property?.name !== 'map' || list?.type !== 'ArrayExpression'
              || !list.elements.every(item => typeof item.value === 'string' && /\.js$/.test(item.value))
              || init?.type !== 'NewExpression' || init.callee.name !== 'URL'
              || init.arguments[0].name !== callback.params[0]?.name || statements.length !== 3
              || !source.getText(statements[1]).startsWith(declaration.id.name + '.searchParams.set(')
              || statements[2].type !== 'ReturnStatement' || source.getText(statements[2].argument) !== declaration.id.name + '.href')
              throw Error('Uncatalogued dynamic dependency in ' + file);
            list.elements.forEach(item => add(item.value.startsWith('.') ? item.value : './' + item.value, true));
          } else throw Error('Uncatalogued dynamic dependency in ' + file);
        }
        if (['readFileSync', 'read', 'readSource'].includes(node.callee.name)) {
          const value = specifier(node.arguments[0]);
          add(value, typeof value === 'string' && /^(?:assets|tests\/fixtures|scripts|contracts)\//.test(value));
        }
      }
    });
    // Runtime data identities remain owned by the generated product metadata.
    if (file === 'assets/js/build-meta.js') return [...found];
    return [...found];
  }
  return { root: resolve(root), catalog, files, tests, owners, retiredTests, exists, read, dependencies, unitRequirements };
}

export function planApplicationChecks({ changedFiles = [], repository, groups: requestedGroups = [] }) {
  const repo = repository || loadRepository();
  const changed = [...new Set(changedFiles.map(slash))].sort();
  // A no-op diff has no affected consumers. The inventory was already validated
  // by loadRepository(), but retired, archived editor tests need not be parsed
  // as runnable production dependency graphs for a no-change plan.
  if (!changed.length && !requestedGroups.length) return {
    schema:'pando-application-check-plan-v1',changedFiles:[],
    unitTests:[],unitTestPrerequisites:{},browserSpecs:[],browserPrerequisites:[],
    externalChecks:[],commands:[],prerequisites:[],reasons:{},
    manualTests:[...repo.owners].filter(([,group])=>group.mode==='manual').map(([file])=>file).sort(),
    inventory:{unit:repo.tests.filter(file=>file.includes('/unit/')).length,
      browser:repo.tests.filter(file=>file.includes('/browser/')).length},
  };
  const reasons = {}, selected = new Set(), commands = [], prerequisites = new Set();
  const expand = patterns => repo.files.filter(file => matches(file, patterns));
  const entry = id => repo.catalog.prerequisites?.[id] || repo.catalog.groups.find(group => group.id === id);
  function implementationInputs(check, seen = new Set()) {
    if (seen.has(check)) return [];
    seen.add(check);
    const argvFiles = (check.argv ? [check.argv] : [])
      .flatMap(argv => argv.slice(1).filter(arg => /^(?:scripts|tools|apps|tests)\/.*\.[cm]?js$/.test(arg)));
    return [...argvFiles, ...(check.requires || []).flatMap(id => implementationInputs(entry(id), seen))];
  }
  const inputsFor = group => [...expand(group.inputs || []), ...implementationInputs(group)];
  const parents = new Map(), visited = new Set();
  const retiredFrontend = file => /^apps\/editor\/(?:frontend\/|templates\/)/.test(file);
  const queue = [...repo.tests.filter(file => repo.owners.get(file)?.mode !== 'retired'),
    ...repo.catalog.groups.flatMap(inputsFor).filter(file => !retiredFrontend(file)),
    ...(repo.catalog.bindings || []).flatMap(binding => expand(binding.inputs || [])).filter(file => !retiredFrontend(file))];
  for (let at = 0; at < queue.length; at++) {
    const file = queue[at];
    if (visited.has(file)) continue;
    visited.add(file);
    // Retired editor frontend is not a public runtime. Keep its direct source
    // identity for historical tests, but do not parse its orphaned worker graph.
    if (retiredFrontend(file)) continue;
    for (const dependency of repo.dependencies(file)) {
      if (!parents.has(dependency)) parents.set(dependency, new Set());
      parents.get(dependency).add(file);
      if (!retiredFrontend(dependency)) queue.push(dependency);
    }
  }
  const affectedBy = new Map();
  for (const change of changed) {
    const consumers = [change], seen = new Set();
    for (let dir = posix.dirname(change); dir !== '.'; dir = posix.dirname(dir)) consumers.push(dir);
    for (let at = 0; at < consumers.length; at++) {
      const file = consumers[at]; if (seen.has(file)) continue; seen.add(file);
      if (!affectedBy.has(file)) affectedBy.set(file, []);
      affectedBy.get(file).push(change);
      consumers.push(...(parents.get(file) || []));
    }
  }
  const affected = file => affectedBy.get(file) || [];
  const infrastructure = changed.some(file => matches(file, repo.catalog.infrastructure || []));
  const matchedProduct = new Set();
  const externalChecks = (repo.catalog.externalChecks || []).filter(check => changed.some(file => matches(file, check.inputs)));
  externalChecks.forEach(check => changed.filter(file => matches(file, check.inputs)).forEach(file => matchedProduct.add(file)));
  for (const group of repo.catalog.groups) {
    const members = [...repo.owners].filter(([,owner]) => owner.id === group.id && owner.mode !== 'retired').map(([file]) => file);
    const inputs = inputsFor(group);
    const groupReasons = [...new Set(inputs.flatMap(file => affected(file)))];
    // Deleted paths still match the input policy and select surviving consumers.
    for (const file of changed) if (matches(file, group.inputs)) groupReasons.push(file);
    if (requestedGroups.length && !requestedGroups.includes(group.id)) continue;
    if (group.mode === 'manual' && !requestedGroups.includes(group.id)) continue;
    if (group.kind === 'command') {
      if (requestedGroups.includes(group.id) || groupReasons.length) {
        commands.push(group.id); reasons[group.id] = [...new Set(groupReasons.length ? groupReasons : ['check infrastructure changed'])];
        groupReasons.forEach(file => matchedProduct.add(file));
        (group.requires || []).forEach(id => prerequisites.add(id));
      }
      continue;
    }
    for (const file of members) {
      const sources = affected(file);
      const bindings = (repo.catalog.bindings || []).filter(binding => matches(file, binding.tests));
      const linked = bindings.flatMap(binding => [
        ...changed.filter(file => matches(file, binding.inputs)),
        ...expand(binding.inputs).flatMap(input => affected(input))
      ]);
      const why = [...new Set([...sources, ...linked, ...groupReasons])];
      if (why.length || requestedGroups.includes(group.id) || (infrastructure && group.kind === 'unit')) {
        selected.add(file); reasons[file] = why.length ? why : ['check infrastructure changed'];
        why.forEach(path => matchedProduct.add(path));
        (group.requires || []).forEach(id => prerequisites.add(id));
      }
    }
  }
  for (const id of requestedGroups) if (!repo.catalog.groups.some(group => group.id === id)) throw Error('Unknown check group: ' + id);
  for (const file of changed) {
    if (!requestedGroups.length && matches(file, repo.catalog.productRoots) && !matchedProduct.has(file) && !infrastructure
      && !matches(file, repo.catalog.passiveInputs || []) && !repo.owners.has(file)) throw Error('Unclassified product change: ' + file);
  }
  const unitTests = [...selected].filter(file => file.includes('/unit/')).sort();
  const unitTestPrerequisites = Object.fromEntries(unitTests.map(file => [file,
    [...(repo.unitRequirements?.get(file) || [])].sort()]).filter(([, ids]) => ids.length));
  Object.values(unitTestPrerequisites).flat().forEach(id => prerequisites.add(id));
  const browserSpecs = [...selected].filter(file => file.includes('/browser/')).sort();
  const browserPrerequisites = [...new Set(browserSpecs.flatMap(file => repo.owners.get(file).requires || []))].sort();
  if (unitTests.some(file => file === 'tests/unit/core-document-world-wasm.test.mjs' ||
    (parents.get('shared/frontend/js/modules/temporal.js') && isConsumer(file, 'shared/frontend/js/modules/temporal.js'))) && repo.catalog.prerequisites?.core) prerequisites.add('core');
  function isConsumer(target, dependency, seen = new Set()) {
    if (target === dependency) return true;
    if (seen.has(dependency)) return false; seen.add(dependency);
    return [...(parents.get(dependency) || [])].some(parent => isConsumer(target, parent, seen));
  }
  return { schema: 'pando-application-check-plan-v1', changedFiles: changed, unitTests, unitTestPrerequisites, browserSpecs, browserPrerequisites,
    externalChecks, commands: commands.sort(), prerequisites: [...prerequisites].sort(), reasons,
    manualTests: [...repo.owners].filter(([, group]) => group.mode === 'manual').map(([file]) => file).sort(),
    inventory: { unit: repo.tests.filter(file => file.includes('/unit/')).length, browser: repo.tests.filter(file => file.includes('/browser/')).length } };
}
