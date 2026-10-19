import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, posix, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { Linter } from 'eslint';
import { runtimeDependencies, dynamicExpressions } from './product-assets.mjs';

const slash = path => path.replaceAll('\\', '/');
const fixedImports = source => source.replace(/\bimport\s*\(\s*`([^`$?]+)\?[^`]*`\s*\)/g,
  (_, path) => `import(${JSON.stringify(path)})`);
const parser = new Linter();

function classicDependencies(source, path, moduleUrls, add) {
  if (!source.includes('importScripts')) return;
  parser.verify(source, { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
  const ast = parser.getSourceCode()?.ast;
  if (!ast) throw Error(`Worker dependency source does not parse: ${path}`);
  const text = node => source.slice(node.range[0], node.range[1]);
  const script = node => node?.type === 'Literal' && typeof node.value === 'string' && /\.js(?:[?#].*)?$/.test(node.value);
  const reject = node => { throw Error(`Uncatalogued dynamic Worker dependency in ${path}: ${text(node)}`); };
  function argument(node) {
    if (script(node)) { add(node.value); return; }
    if (moduleUrls.has(text(node))) return;
    if (node.type === 'CallExpression' && node.callee.name === 'versionedWorkerAssetUrl'
      && node.arguments.length === 1 && script(node.arguments[0])) { add(node.arguments[0].value); return; }
    // The Canvas bootstrap versions a literal list without changing its identities.
    if (node.type === 'SpreadElement') {
      const call = node.argument, list = call.callee?.object, callback = call.arguments?.[0];
      if (call.type === 'CallExpression' && call.callee.property?.name === 'map' && list?.type === 'ArrayExpression'
        && list.elements.every(script) && call.arguments.length === 1 && callback?.type === 'ArrowFunctionExpression'
        && callback.params.length === 1 && callback.params[0].type === 'Identifier') {
        const statements = callback.body.body;
        const declaration = statements?.[0]?.declarations?.[0];
        const init = declaration?.init;
        if (init?.type === 'NewExpression' && init.callee.name === 'URL' && init.arguments.length === 2
          && init.arguments[0].name === callback.params[0].name && text(init.arguments[1]) === 'self.location.href'
          && statements.length === 3 && text(statements[1]).startsWith(`${declaration.id.name}.searchParams.set(`)
          && statements[2].type === 'ReturnStatement' && text(statements[2].argument) === `${declaration.id.name}.href`) {
          list.elements.forEach(item => add(item.value)); return;
        }
      }
    }
    reject(node);
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'importScripts')
      node.arguments.forEach(argument);
    for (const [key, value] of Object.entries(node)) {
      if (['parent', 'tokens', 'comments', 'loc', 'range'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit); else if (value?.type) visit(value);
    }
  }
  visit(ast);
}

/** Immutable execution closure. Preserve module boundaries and classic initialization order. */
export async function buildWorkerAsset({ root, entry, readSource = path => readFileSync(resolve(root, path), 'utf8') }) {
  root = resolve(root);
  const sources = new Map();
  const local = (path, importer) => slash(relative(root, resolve(dirname(resolve(root, importer)), path.split(/[?#]/)[0])));
  await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
    plugins: [{ name: 'worker-execution-closure', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => {
        if (args.path === '../../../tools/load-node-core.mjs') return { path: args.path, external: true };
        const path = args.kind === 'entry-point' ? slash(relative(root, resolve(root, args.path)))
          : local(args.path, slash(relative(root, args.importer)));
        if (!path.startsWith('assets/')) throw Error(`Worker dependency outside assets: ${path}`);
        return { path: resolve(root, path) };
      });
      builder.onLoad({ filter: /\.js$/ }, args => {
        const path = slash(relative(root, args.path));
        if (path === 'assets/js/build-meta.js') return { contents: '', loader: 'js' };
        const original = readSource(path).replace(/\r\n?/g, '\n').trimEnd() + '\n';
        sources.set(path, original);
        if (!path.startsWith('assets/js/') || /\/vendor\//.test(path)) return { contents: '', loader: 'js' };
        let source = fixedImports(original).replace(/\bimport\(versionedWorkerAssetUrl\([^)]*\)\)/g, 'Promise.resolve({})');
        const dependencies = new Set((runtimeDependencies[path] || []).filter(value => value.endsWith('.js')));
        const moduleUrls = new Set([...original.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*new URL\(['"][^'"]+\.js['"]/g)]
          .flatMap(match => [match[1], `${match[1]}.href`]));
        // Classic importScripts and versioned URL helpers are not ESM edges.
        classicDependencies(original, path, moduleUrls, specifier => dependencies.add(local(specifier, path)));
        for (const match of original.matchAll(/['"]((?:\.\.?\/)[^'"`]+\.js)['"]/g)) dependencies.add(local(match[1], path));
        if (original.includes("'../modules/' + name")) {
          for (const match of original.matchAll(/['"]([\w-]+\.js)['"]/g)) dependencies.add(`assets/js/modules/${match[1]}`);
        }
        // Known computed module identities belong to the existing asset catalog.
        source = source.replace(/\bimport\s*\(\s*(?!['"\s])([^)]*)\)/g, (call, expression) => {
          if (moduleUrls.has(expression.trim()) || (dynamicExpressions[path] || []).includes(expression.trim())) return 'Promise.resolve({})';
          throw Error(`Uncatalogued dynamic Worker dependency in ${path}: ${expression}`);
        });
        if (/\bimport\s*\(\s*`/.test(source)) throw Error(`Uncatalogued dynamic Worker dependency in ${path}`);
        for (const dependency of dependencies) {
          if (dependency === path || !dependency.startsWith('assets/js/')) continue;
          source += `\nimport ${JSON.stringify('./' + slash(relative(dirname(args.path), resolve(root, dependency))))};`;
        }
        return { contents: source, loader: 'js' };
      });
    } }],
  });
  const digest = createHash('sha256').update('pando-worker-closure-v2\0')
    .update(readFileSync(new URL(import.meta.url), 'utf8').replaceAll('\r\n', '\n')).update(entry);
  for (const [path, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) digest.update('\0' + path + '\0' + source);
  const prefix = `assets/worker-runtime/${digest.digest('hex').slice(0, 32)}/`;
  const files = new Map();
  for (const [path, source] of sources) {
    const output = prefix + path;
    // Executable relatives stay inside the immutable tree. Non-code resources
    // keep their canonical data/WASM owners instead of creating a second copy.
    const rewritten = source.replace(/new URL\((['"])([^'"]+)\1,\s*(import\.meta\.url|self\.location\.href)\)/g,
      (call, _quote, specifier, base) => {
        if (!specifier.startsWith('.')) return call;
        const target = local(specifier, path);
        if (sources.has(target)) return call;
        return `new URL(${JSON.stringify(posix.relative(posix.dirname(output), target) + (specifier.endsWith('/') ? '/' : ''))}, ${base})`;
      }).replace(/(['"`])(\.\.?\/[^'"`?]+\.js)(?=[?'"`])/g, (call, quote, specifier) =>
        local(specifier, path) === 'assets/js/build-meta.js'
          ? quote + posix.relative(posix.dirname(output), 'assets/js/build-meta.js') : call);
    files.set(output, rewritten);
  }
  return { url: prefix + entry, files };
}
