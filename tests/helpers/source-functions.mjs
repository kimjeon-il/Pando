import {Linter} from 'eslint';

export function assertProjectLifecycleFacade(source){
  const facade=source.slice(source.lastIndexOf('return Object.freeze({'));
  for(const method of ['createProject','load','save','undo','redo'])
    if(!new RegExp(`\\b${method}\\s*[,:(]`).test(facade))throw new Error(`ProjectDomain must own project lifecycle: ${method}`);
}

export function applicationFunctionSource(source,name){
  const linter=new Linter();
  linter.verify(source,{languageOptions:{ecmaVersion:'latest',sourceType:'module'}});
  const ast=linter.getSourceCode()?.ast;
  if(!ast)throw new Error('Application owner source does not parse');
  let found;
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionDeclaration'&&node.id.name===name){found=node;return;}
    for(const [key,value]of Object.entries(node)){
      if(['parent','tokens','comments','loc','range'].includes(key))continue;
      if(Array.isArray(value))value.forEach(visit);
      else if(value?.type)visit(value);
    }
  }
  visit(ast);
  if(!found)throw new Error(`Missing application function: ${name}`);
  return source.slice(...found.range);
}
