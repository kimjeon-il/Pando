import fs from 'node:fs';
import { Linter } from 'eslint';

const directory = new URL('../../assets/js/modules/', import.meta.url);

// Source contracts name their real owners. Ignore only the explicit port access
// syntax so existing algorithm assertions do not depend on injection spelling.
export function readApplicationOwners(...owners) {
  return owners.map(owner => fs.readFileSync(new URL(`app-${owner}.js`, directory), 'utf8')
    .replace(/\(0, dependencies\.([$\w]+)\)/g, '$1')
    .replace(/\bdependencies\./g, '')).join('\n');
}

// Negative architecture assertions must cover every implementation, not merely
// the now-small entry point. Connection files contain only forwarding accessors.
export function readApplicationImplementations() {
  return readApplicationOwners(...fs.readdirSync(directory)
    .filter(name => /^app-.*\.js$/.test(name) && !/^app-(?:connect-|composition\.)/.test(name))
    .map(name => name.slice(4, -3)));
}

export function applicationFunctionSource(source, name) {
  const linter = new Linter();
  linter.verify(source, { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
  const ast = linter.getSourceCode()?.ast;
  if (!ast) throw new Error('Application owner source does not parse');
  let found;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id.name === name) { found = node; return; }
    for (const [key, value] of Object.entries(node)) {
      if (['parent', 'tokens', 'comments', 'loc', 'range'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value?.type) visit(value);
    }
  }
  visit(ast);
  if (!found) throw new Error(`Missing application function: ${name}`);
  return source.slice(...found.range);
}
