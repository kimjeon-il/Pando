import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJavaScript, walkJavaScript } from './lib/source-analysis.mjs';

const rpcOwner = 'assets/js/modules/worker-rpc.js';
const hostOwner = 'assets/js/workers/worker-rpc-host.js';
const memberName = node => node?.type === 'MemberExpression'
  ? (node.computed ? node.property.value : node.property.name) : null;
const dependencyPath = (file, value) => path.posix.normalize(path.posix.join(path.posix.dirname(file), value.split(/[?#]/)[0]));

export function auditWorkerArchitecture(sources) {
  const failures = [];
  for (const owner of [rpcOwner, hostOwner]) if (!sources.has(owner)) failures.push(`Missing Worker transport owner: ${owner}`);
  for (const [file, source] of sources) {
    if (file === rpcOwner || file === hostOwner) continue;
    const code = parseJavaScript(source, { filePath: file });
    const consumesRpc = code.ast.body.some(node => node.type === 'ImportDeclaration'
      && dependencyPath(file, node.source.value) === rpcOwner);
    const transportPolicies = code.getAllComments().filter(comment => /@worker-transport\b/.test(comment.value));
    const ownsDedicatedTransport = transportPolicies.length === 1
      && /^\s*@worker-transport dedicated:\s*\S[^\n]*\s*$/.test(transportPolicies[0].value);
    if (transportPolicies.length && !ownsDedicatedTransport)
      failures.push(`${file} dedicated transport ownership must declare one reason`);
    if (ownsDedicatedTransport && consumesRpc)
      failures.push(`${file} cannot own a dedicated transport and a canonical RPC client together`);
    const containsHostDependency = node => {
      if (!node) return false;
      const literal = node.type === 'TemplateLiteral' ? node.quasis[0].value.cooked : node.value;
      if (typeof literal === 'string' && dependencyPath(file, literal) === hostOwner) return true;
      return (code.visitorKeys[node.type] || []).some(key => [node[key]].flat().some(containsHostDependency));
    };
    let usesHost = false, referencesHost = false;
    walkJavaScript(code, node => {
      const dependencies = node.type === 'NewExpression' && node.callee.name === 'URL' ? [node.arguments[0]]
        : node.type === 'ImportDeclaration' || node.type === 'ImportExpression' ? [node.source]
          : node.type === 'CallExpression' && node.callee.name === 'importScripts' ? node.arguments : [];
      if (dependencies.some(containsHostDependency)) referencesHost = true;
      if (memberName(node) === 'PandoLabWorkerRpc') usesHost = true;
      if (file.startsWith('assets/js/workers/') || ownsDedicatedTransport) return;
      if (node.type === 'AssignmentExpression' && ['onmessage', 'onmessageerror'].includes(memberName(node.left)))
        failures.push(`${file}:${node.loc.start.line} RPC consumer owns ${memberName(node.left)} dispatch`);
      if (node.type === 'CallExpression' && memberName(node.callee) === 'postMessage')
        failures.push(`${file}:${node.loc.start.line} RPC consumer bypasses transport with postMessage`);
      if (node.type === 'CallExpression' && memberName(node.callee) === 'addEventListener'
        && ['message', 'messageerror'].includes(node.arguments[0]?.value))
        failures.push(`${file}:${node.loc.start.line} RPC consumer owns message dispatch`);
    });
    if (file.startsWith('assets/js/workers/') && usesHost && !referencesHost)
      failures.push(`${file} uses the RPC host without loading its dependency`);
  }
  return failures;
}

export function checkWorkerArchitecture(root) {
  const sources = new Map();
  for (const directory of ['assets/js/modules', 'assets/js/workers']) {
    for (const name of fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith('.js')))
      sources.set(`${directory}/${name}`, fs.readFileSync(path.join(root, directory, name), 'utf8'));
  }
  return auditWorkerArchitecture(sources);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = checkWorkerArchitecture(fileURLToPath(new URL('../', import.meta.url)));
  if (failures.length) {
    failures.forEach(message => console.error(`- ${message}`));
    process.exitCode = 1;
  } else console.log('Worker transport boundaries passed; runtime behavior is verified by the Worker contract tests.');
}
