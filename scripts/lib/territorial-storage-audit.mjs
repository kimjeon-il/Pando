import { Linter } from 'eslint';

const fields = new Set(['territorialEntities']);
const mutators = new Set(['push', 'pop', 'splice', 'shift', 'unshift', 'sort', 'reverse', 'fill', 'copyWithin']);
const storeReads = new Set(['snapshot']);
const arrayReads = new Set(['find', 'findLast', 'filter', 'map', 'slice', 'at', 'forEach', 'some', 'every', 'flatMap']);
const unwrap = node => node?.type === 'ChainExpression' ? unwrap(node.expression)
  : node?.type === 'SequenceExpression' ? unwrap(node.expressions.at(-1)) : node;
const key = node => node?.computed ? node.property?.value : node?.property?.name;

export function unclassifiedTerritorialAccesses(entries, policy) {
  return entries.filter(entry => !policy.owners.some(item => item.file === entry.file
    && item.functions.includes(entry.function) && item.access.includes(entry.access)));
}

function functionName(node) {
  if (node.id?.name) return node.id.name;
  if (node.parent?.type === 'VariableDeclarator') return node.parent.id.name;
  if (node.parent?.type === 'Property' || node.parent?.type === 'MethodDefinition') {
    return node.parent.key.name || node.parent.key.value;
  }
  return null;
}

function ownerOf(node) {
  for (let cursor = node; cursor; cursor = cursor.parent) {
    if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(cursor.type)) {
      const name = functionName(cursor);
      if (name) return name;
    }
  }
  return '<module>';
}

/** Static inventory of physical storage reads and mutations through local aliases.
 * Detached JSON/structuredClone/deepClone copies are not canonical storage.
 * Calls across module boundaries still require the human-reviewed owner policy.
 */
export function auditTerritorialStorage(source, file = '<source>') {
  const linter = new Linter();
  const messages = linter.verify(source, { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } });
  const parsed = linter.getSourceCode();
  if (!parsed || messages.some(message => message.fatal)) throw new Error(`${file} does not parse`);
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    for (const name of parsed.visitorKeys[node.type] || []) {
      const value = node[name];
      if (Array.isArray(value)) value.forEach(child => { if (child) visit(child); });
      else if (value) visit(value);
    }
  }
  visit(parsed.ast);
  const bindings = new Map();
  for (const scope of parsed.scopeManager.scopes) {
    for (const variable of scope.variables) {
      for (const identifier of variable.identifiers) bindings.set(identifier, variable);
      for (const reference of variable.references) bindings.set(reference.identifier, variable);
    }
  }

  function origin(value, seen = new Set()) {
    const node = unwrap(value);
    if (!node || seen.has(node)) return null;
    const nextSeen = new Set(seen).add(node);
    if (node.type === 'MemberExpression') {
      const name = key(node);
      if (fields.has(name)) return { field: name, via: 'raw', node, detachedArray: false };
      return origin(node.object, nextSeen);
    }
    if (node.type === 'Identifier') {
      const variable = bindings.get(node);
      const assignment = variable?.references.filter(reference => reference.isWrite() && reference.writeExpr
        && reference.identifier.range[0] < node.range[0]).at(-1);
      if (assignment && assignment.writeExpr !== node) {
        const definition = variable.defs.find(item => item.type === 'Variable');
        if (definition?.node.id.type !== 'ObjectPattern') return origin(assignment.writeExpr, nextSeen);
      }
      for (const definition of variable?.defs || []) {
        if (definition.type === 'Variable') {
          if (definition.node.id.type === 'ObjectPattern') {
            for (let cursor = definition.name; cursor && cursor !== definition.node; cursor = cursor.parent) {
              if (cursor.type !== 'Property') continue;
              const name = cursor.key?.name || cursor.key?.value;
              if (fields.has(name)) return { field: name, via: 'destructured', node: definition.node, detachedArray: false };
            }
          }
          const result = origin(definition.node.init, nextSeen);
          if (result) return result;
        }
        if (definition.type === 'Parameter') {
          const callback = definition.node;
          const call = callback.parent;
          const callee = unwrap(call?.callee);
          if (call?.type === 'CallExpression' && callee?.type === 'MemberExpression'
            && arrayReads.has(key(callee)) && callback.params[0] === definition.name) {
            const result = origin(callee.object, nextSeen);
            if (result) return { ...result, detachedArray: false };
          }
        }
      }
      for (const definition of variable?.defs || []) {
        const loop = definition.node.parent?.parent;
        if (loop?.type === 'ForOfStatement') {
          const result = origin(loop.right, nextSeen);
          if (result) return { ...result, detachedArray: false };
        }
      }
      return null;
    }
    if (node.type === 'CallExpression') {
      let callee = unwrap(node.callee);
      if (callee?.type === 'Identifier') {
        const variable = bindings.get(callee);
        const definition = variable?.defs.find(item => item.type === 'Variable');
        if (definition?.node.init?.type === 'MemberExpression') callee = definition.node.init;
        const fn = variable?.defs.find(item => item.type === 'FunctionName')?.node;
        if (fn) {
          const returned = nodes.filter(item => item.type === 'ReturnStatement' && ownerOf(item) === functionName(fn));
          for (const statement of returned) {
            const result = origin(statement.argument, nextSeen);
            if (result) return result;
          }
        }
      }
      const name = callee?.type === 'MemberExpression' ? key(callee) : callee?.name;
      if (['deepClone', 'structuredClone', 'parse'].includes(name)) return null;
      if (callee?.type === 'Identifier' && file.endsWith('/territorial-entity-store.js') && storeReads.has(name)) {
        return { field: name, via: 'store', node, detachedArray: false };
      }
      if (callee?.type === 'MemberExpression') {
        const receiver = parsed.getText(callee.object);
        if (/\b(?:entityStore|territorialEntityStore|store)\b/.test(receiver) && storeReads.has(name)) {
          return { field: name, via: 'store', node, detachedArray: false };
        }
        if (/\b(?:entityRepository|territorialEntityRepository|repository)\b/.test(receiver)
          && ['get', 'list', 'children', 'parent', 'siblings', 'ancestors', 'descendants', 'root', 'administrativeCountry'].includes(name)) {
          return { field: 'entity', via: 'repository', node, detachedArray: false };
        }
        if (arrayReads.has(name)) {
          const result = origin(callee.object, nextSeen);
          if (!result) return null;
          if (name === 'map' || name === 'flatMap') {
            const callback = node.arguments[0];
            // Mapping to primitives/new objects does not publish raw entities.
            if (callback?.body?.type !== 'Identifier') return null;
          }
          return { ...result, detachedArray: ['slice', 'filter', 'map', 'flatMap'].includes(name) };
        }
      }
    }
    if (node.type === 'LogicalExpression' || node.type === 'ConditionalExpression') {
      return origin(node.left || node.consequent, nextSeen) || origin(node.right || node.alternate, nextSeen);
    }
    if (node.type === 'SequenceExpression') return origin(node.expressions.at(-1), nextSeen);
    if (node.type === 'ArrayExpression') {
      for (const item of node.elements) {
        if (item?.type === 'SpreadElement') {
          const result = origin(item.argument, nextSeen);
          if (result) return { ...result, detachedArray: true };
        }
      }
    }
    return null;
  }

  const records = new Map();
  function record(node, access, resolved = origin(node)) {
    if (!resolved) return;
    const entry = { file, function: ownerOf(node), line: node.loc.start.line,
      access, field: resolved.field, via: resolved.via, expression: parsed.getText(node) };
    records.set(`${entry.line}:${node.range[0]}:${access}`, entry);
  }
  for (const node of nodes) {
    if (node.type === 'MemberExpression' && fields.has(key(node))) record(node, 'read');
    if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern') {
      for (const property of node.id.properties) {
        const name = property.key?.name || property.key?.value;
        if (fields.has(name)) record(node, 'read', { field: name, via: 'destructured' });
      }
    }
    if (node.type === 'AssignmentExpression' || node.type === 'UpdateExpression') {
      const target = unwrap(node.left || node.argument);
      if (target?.type === 'MemberExpression') record(node, 'write', origin(target));
    }
    if (node.type === 'UnaryExpression' && node.operator === 'delete') record(node, 'write', origin(node.argument));
    if (node.type === 'CallExpression') {
      const callee = unwrap(node.callee);
      if (callee?.type !== 'MemberExpression') continue;
      if (mutators.has(key(callee))) {
        const resolved = origin(callee.object);
        if (resolved && !resolved.detachedArray) record(node, 'write', resolved);
      }
      if (['Object', 'Reflect'].includes(callee.object?.name) && ['assign', 'defineProperty', 'set', 'deleteProperty'].includes(key(callee))) {
        record(node, 'write', origin(node.arguments[0]));
        if (key(callee) === 'assign') {
          for (const argument of node.arguments.slice(1)) {
            for (const property of argument.properties || []) {
              const name = property.key?.name || property.key?.value;
              if (fields.has(name)) record(node, 'write', { field: name, via: 'raw' });
            }
          }
        }
      }
    }
  }
  return [...records.values()].sort((a, b) => a.line - b.line || a.access.localeCompare(b.access));
}
