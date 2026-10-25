import {buildFrontendIndex,frontendAsset,emitFrontendModule} from './lib/frontend-layout.mjs';
import {renderProductHtml} from './lib/product-html.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as versionContract from "../shared/frontend/js/modules/version-contract.js";
import { EXCHANGE_TARGETS, EXCHANGE_TARGET_DESCRIPTORS } from "../apps/editor/frontend/js/modules/exchange-adapter-registry.js";
import { parseJavaScript } from './lib/source-analysis.mjs';

const owner = 'assets/js/modules/version-contract.js';
const dependencyPath = (file, value) => path.posix.normalize(path.posix.join(path.posix.dirname(file), value.split(/[?#]/)[0]));

export function auditVersionDisplays({ version, readme, html }) {
  const failures = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) failures.push(`Invalid package.json app version: ${version}`);
  const readmeVersion = readme.match(/^# .*?v(\d+\.\d+\.\d+)/m)?.[1];
  if (readmeVersion !== version) failures.push('README display version differs from package.json');
  const htmlVersion = html.match(/\bdata-app-version\s*=\s*["']([^"']+)["']/)?.[1];
  if (htmlVersion !== version) failures.push('HTML display version differs from package.json');
  return failures;
}

export function auditSchemaOwners(sources, schemaNames) {
  const names = new Set(schemaNames), failures = [];
  if (!sources.has(owner)) failures.push(`Missing schema contract owner: ${owner}`);
  const modules = new Map([...sources].map(([file, source]) => {
    const ast = parseJavaScript(source, { filePath: file }).ast;
    const imports = new Map(), locals = new Map();
    for (const node of ast.body) {
      if (node.type === 'ImportDeclaration') for (const specifier of node.specifiers)
        imports.set(specifier.local.name, { source: dependencyPath(file, node.source.value),
          imported: specifier.imported?.name ?? specifier.imported?.value, namespace: specifier.type === 'ImportNamespaceSpecifier' });
      const declarations = node.type === 'VariableDeclaration' ? node.declarations : node.declaration?.declarations || [];
      for (const declaration of declarations) if (declaration.id.type === 'Identifier') locals.set(declaration.id.name, declaration.init);
    }
    return [file, { ast, imports, locals }];
  }));
  function origin(file, exported, visited = new Set()) {
    if (file === owner) return names.has(exported) ? owner : undefined;
    const key = `${file}:${exported}`;
    if (visited.has(key) || !modules.has(file)) return undefined;
    const nextVisited = new Set([...visited, key]);
    const { ast, imports, locals } = modules.get(file);
    const bindingOrigin = (local, seen = new Set()) => {
      if (seen.has(local)) return undefined;
      const imported = imports.get(local);
      if (imported) return origin(imported.source, imported.imported, nextVisited);
      const value = locals.get(local);
      if (value?.type === 'Identifier') return bindingOrigin(value.name, new Set([...seen, local]));
      if (value?.type === 'MemberExpression' && value.object.type === 'Identifier') {
        const namespace = imports.get(value.object.name);
        if (namespace?.namespace) return origin(namespace.source,
          value.computed ? value.property.value : value.property.name, nextVisited);
      }
      return file;
    };
    for (const node of ast.body) {
      if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration?.declarations?.some(declaration => declaration.id.name === exported)) return bindingOrigin(exported);
        for (const specifier of node.specifiers) if (specifier.exported.name === exported)
          return node.source ? origin(dependencyPath(file, node.source.value), specifier.local.name, nextVisited)
            : bindingOrigin(specifier.local.name);
      }
      if (node.type === 'ExportAllDeclaration') {
        const result = origin(dependencyPath(file, node.source.value), exported, nextVisited);
        if (result !== undefined) return result;
      }
    }
    return undefined;
  }
  for (const [file, { ast }] of modules) {
    if (file === owner) continue;
    const exported = new Set(ast.body.filter(node => node.type === 'ExportNamedDeclaration').flatMap(node => [
      ...(node.declaration?.declarations || []).map(declaration => declaration.id.name),
      ...node.specifiers.map(specifier => specifier.exported.name),
    ]));
    if (ast.body.some(node => node.type === 'ExportAllDeclaration'))
      for (const name of names) if (origin(file, name) !== undefined) exported.add(name);
    for (const name of exported) if (names.has(name) && origin(file, name) !== owner)
      failures.push(`${file} redefines ${name}; schema ownership belongs in version-contract.js`);
  }
  return failures;
}

export function checkVersionArchitecture(root) {
  const failures = [], sources = new Map();
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  failures.push(...auditVersionDisplays({ version: JSON.parse(read('package.json')).version,
    readme: read('README.md'), html: renderProductHtml(read).editor }));
  const index=buildFrontendIndex(root);
  for(const row of index.values())if(row.publicPath.startsWith('assets/js/modules/')&&row.publicPath.endsWith('.js'))sources.set(row.publicPath,emitFrontendModule(frontendAsset(root,row.publicPath,{index}).bytes.toString('utf8'),row.sourcePath,index));
  const schemaNames = Object.keys(versionContract).filter(name => name.endsWith('_SCHEMA_VERSION'));
  failures.push(...auditSchemaOwners(sources, schemaNames));
  for (const name of schemaNames) if (!Number.isInteger(versionContract[name])) failures.push(`${name} must be an integer`);
  if (versionContract.VERSION_POLICY.appVersionSource !== 'package.json') failures.push('App version owner must be package.json');
  if (versionContract.VERSION_POLICY.projectSchemaIndependentFromAppVersion !== true) failures.push('Project schema must remain independent from app version');
  for (const target of Object.values(EXCHANGE_TARGETS)) {
    if (!EXCHANGE_TARGET_DESCRIPTORS[target]?.domain) failures.push(`Missing exchange target domain: ${target}`);
  }
  if (EXCHANGE_TARGET_DESCRIPTORS.generic?.fallback !== true) failures.push('Generic exchange target must remain fallback-only');
  return failures;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkVersionArchitecture(fileURLToPath(new URL('../', import.meta.url)));
  if (failures.length) {
    failures.forEach(message => console.error(`- ${message}`));
    process.exitCode = 1;
  } else console.log('Version/schema ownership passed; serialization and rejection behavior are verified by the current contract tests.');
}
