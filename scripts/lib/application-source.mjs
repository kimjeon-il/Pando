import { Linter } from 'eslint';

import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildFrontendIndex,frontendAsset,emitFrontendModule} from './frontend-layout.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),index=buildFrontendIndex(root);
export function applicationModuleUrl(name){const entry=frontendAsset(root,'assets/js/modules/'+name,{index});return pathToFileURL(resolve(root,entry.sourcePath));}
const readModule=name=>{const entry=frontendAsset(root,'assets/js/modules/'+name,{index});return emitFrontendModule(entry.bytes.toString('utf8'),entry.sourcePath,index);};


/** Owner IDs come from real composition bindings, independently of file naming. */
export function applicationOwnerDefinitions(){
 const source=readModule('app-composition.js');
 const linter=new Linter();linter.verify(source,{languageOptions:{ecmaVersion:'latest',sourceType:'module'}});
 const ast=linter.getSourceCode()?.ast;if(!ast)throw new Error('Application composition does not parse');
 const nodes=[];
 function visit(node){if(!node||typeof node!=='object')return;if(node.type)nodes.push(node);
  for(const [key,value] of Object.entries(node)){if(['parent','tokens','comments','loc','range'].includes(key))continue;
   if(Array.isArray(value))value.forEach(visit);else if(value?.type)visit(value);
  }
 }
 visit(ast);
 const group=nodes.find(node=>node.type==='VariableDeclarator'&&node.id.type==='ArrayPattern'&&node.init?.argument?.callee?.property?.name==='all');
 if(!group)throw new Error('Versioned owner factory imports are required');
 const files=new Map(group.id.elements.map((binding,index)=>{
  const entry=group.init.argument.arguments[0].elements[index];
  const specifier=entry.source.arguments[0].quasis[0].value.cooked;
  return [binding.name,specifier.replace(/^\.\//,'').split('?')[0]];
 }));
 const editorOwners=nodes.filter(node=>node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&node.init?.type==='CallExpression'
  &&files.has(node.init.callee?.object?.name)&&node.init.callee.property?.name.startsWith('create')
  &&!files.get(node.init.callee.object.name).includes('capability-ports'))
  .map(node=>({owner:node.id.name,file:files.get(node.init.callee.object.name),factory:node.init.callee.property.name}));
 const commonSource=readModule('map-owner-composition.js');
 linter.verify(commonSource,{languageOptions:{ecmaVersion:'latest',sourceType:'module'}});
 const commonAst=linter.getSourceCode().ast,imports=new Map();
 for(const node of commonAst.body)if(node.type==='ImportDeclaration')for(const spec of node.specifiers)imports.set(spec.local.name,node.source.value.replace(/^\.\//,''));
 nodes.length=0;visit(commonAst);
 const commonOwners=nodes.filter(node=>node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&imports.has(node.init?.callee?.name)&&node.init.callee.name.startsWith('create'))
   .map(node=>({owner:node.id.name,file:imports.get(node.init.callee.name),factory:node.init.callee.name}));
 return [...editorOwners,...commonOwners];

}

// Source contracts name their real owners. Ignore only the explicit port access
// syntax so existing algorithm assertions do not depend on injection spelling.
export function readApplicationOwners(...owners) {
  const files=new Map(applicationOwnerDefinitions().map(row=>[row.owner,row.file]));
  return owners.map(owner => {const id=owner.replace(/-([a-z])/g,(_match,letter)=>letter.toUpperCase());
    const file=files.get(id);if(!file)throw new Error(`Unknown application owner: ${owner}`);return readModule(file);}).map(source=>source
    .replace(/\(0, dependencies\.[$\w]+\.([$\w]+)\)/g, '$1')
    .replace(/\bdependencies\.[$\w]+\.([$\w]+)/g, '$1')
    .replace(/\(0, dependencies\.([$\w]+)\)/g, '$1')
    .replace(/\bdependencies\./g, '')).join('\n');
}

// Negative architecture assertions must cover every implementation, not merely
// the now-small entry point. Connection files contain only forwarding accessors.
export function readApplicationImplementations() {
  return readApplicationOwners(...applicationOwnerDefinitions().map(row=>row.owner));
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
