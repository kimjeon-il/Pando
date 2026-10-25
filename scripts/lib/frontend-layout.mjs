import {existsSync,lstatSync,readdirSync,readFileSync} from 'node:fs';
import {resolve,posix} from 'node:path';
import {Linter} from 'eslint';

export const frontendTemplates=Object.freeze({web:'apps/viewer/templates/index.html',editor:'apps/editor/templates/index.html'});
export const frontendFragmentRoot='shared/frontend/ui/fragments';
export const frontendWasmRoot='shared/frontend/static/wasm';
const generatedModulePaths=new Set(['assets/js/build-meta.js','assets/js/workers/resource-update-policy-core.js']);

// Source ownership is independent of the deployed URL namespace.
export const frontendRoots=Object.freeze([
 {sourcePath:'shared/frontend/js',publicPath:'assets/js',product:'shared'},
 {sourcePath:'shared/frontend/css',publicPath:'assets/css',product:'shared'},
 {sourcePath:'shared/frontend/static',publicPath:'assets',product:'shared'},
 {sourcePath:'apps/viewer/js',publicPath:'assets/js',product:'viewer'},
 {sourcePath:'apps/viewer/css',publicPath:'assets/css',product:'viewer'},
 {sourcePath:'apps/editor/frontend/js',publicPath:'assets/js',product:'editor'},
 {sourcePath:'apps/editor/frontend/css',publicPath:'assets/css',product:'editor'},
 {sourcePath:'apps/editor',publicPath:'shell',product:'editor',shallow:true},
]);
const slash=path=>path.replaceAll('\\','/');
function validPublicPath(path){
 if(typeof path!=='string'||!path||/[?#\\]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..')||!(/^(?:assets|shell)\//.test(path)))throw Error('Invalid or private frontend public path: '+path);
 return path;
}
export function buildFrontendIndex(root){
 const index=new Map();
 for(const owner of frontendRoots){
  const base=resolve(root,owner.sourcePath);if(!existsSync(base))continue;
  const scan=(folder,prefix='')=>{
   if(lstatSync(folder).isSymbolicLink())throw Error('Linked frontend source or junction: '+folder);
   for(const entry of readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=prefix+entry.name,file=resolve(folder,entry.name);
    if(entry.isSymbolicLink()||lstatSync(file).isSymbolicLink())throw Error('Linked frontend source or junction: '+file);
    if(entry.isDirectory()){if(!owner.shallow)scan(file,relative+'/');continue;}
    if(!entry.isFile())throw Error('Non-file frontend source: '+file);
    if(owner.shallow&&!entry.name.endsWith('.js'))continue;
    const publicPath=validPublicPath(owner.publicPath+'/'+relative),sourcePath=owner.sourcePath+'/'+relative;
    if(index.has(publicPath))throw Error('Duplicate frontend public ownership: '+publicPath);
    index.set(publicPath,{sourcePath,publicPath,product:owner.product});
   }
  };scan(base);
 }
 return index;
}
export function frontendAsset(root,publicPath,{index=buildFrontendIndex(root),product='editor'}={}){
 validPublicPath(publicPath);const entry=index.get(publicPath);
 if(!entry)throw Error('Missing frontend source: '+publicPath);
 if(product==='viewer'&&entry.product==='editor')throw Error('Viewer reaches editor product source: '+publicPath);
 return {...entry,bytes:readFileSync(resolve(root,entry.sourcePath))};
}
const parser=new Linter();
export function frontendModuleReferences(source){
 const errors=parser.verify(source,{languageOptions:{ecmaVersion:2024,sourceType:'module',parserOptions:{range:true}}});
 if(errors.some(e=>e.fatal))throw Error('Frontend module does not parse: '+errors.find(e=>e.fatal).message);
 const code=parser.getSourceCode(),references=[];
 const add=(node,kind)=>{
  if(node?.type==='Literal'&&typeof node.value==='string')references.push({start:node.range[0],end:node.range[1],specifier:node.value,kind,template:false});
  else if(node?.type==='TemplateLiteral'&&node.quasis.length){const text=node.quasis[0].value.cooked,path=text.split('?')[0];if(/\.(?:m?js)$/.test(path))references.push({start:node.range[0]+1,end:node.range[0]+1+path.length,specifier:path,kind,template:true});}
 };
 const visit=node=>{
  if(!node||typeof node!=='object')return;
  if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type))add(node.source,'import');
  if(node.type==='ImportExpression')add(node.source,'import');
  if(node.type==='NewExpression'&&node.callee.type==='Identifier'&&node.callee.name==='URL'&&node.arguments[1]?.type==='MemberExpression'&&node.arguments[1].object.type==='MetaProperty')add(node.arguments[0],'url');
  for(const key of code.visitorKeys[node.type]||[])for(const child of Array.isArray(node[key])?node[key]:[node[key]])visit(child);
 };visit(code.ast);return references;
}
export function emitFrontendModule(source,sourcePath,index){
 sourcePath=slash(sourcePath);const sourceEntry=[...index.values()].find(e=>e.sourcePath===sourcePath);
 if(!sourceEntry)throw Error('Unmapped frontend module source: '+sourcePath);
 const bySource=new Map([...index.values()].map(e=>[e.sourcePath,e]));const changes=[];
 for(const reference of frontendModuleReferences(source)){
  if(!reference.specifier.startsWith('.'))continue;
  const at=reference.specifier.search(/[?#]/),file=at<0?reference.specifier:reference.specifier.slice(0,at),suffix=at<0?'':reference.specifier.slice(at);
  if(reference.kind==='url'&&!/\.m?js$/.test(file))continue;
  const targetPath=posix.normalize(posix.join(posix.dirname(sourcePath),file));
  const target=bySource.get(targetPath)||(reference.kind==='url'?index.get(posix.normalize(posix.join(posix.dirname(sourceEntry.publicPath),file))):null);
  let publicPath;
  if(target){
   if(target.product!=='shared'&&target.product!==sourceEntry.product)throw Error('Frontend product ownership violation: '+sourcePath+' -> '+target.sourcePath);
   publicPath=target.publicPath;
  }
  else if(generatedModulePaths.has(targetPath))publicPath=targetPath;
  else if(targetPath==='tools/load-node-core.mjs'&&sourceEntry.publicPath==='assets/js/modules/temporal.js')publicPath=targetPath;
  else throw Error('Private or unmapped frontend import: '+sourcePath+' -> '+reference.specifier);
  let specifier=posix.relative(posix.dirname(sourceEntry.publicPath),publicPath);if(!specifier.startsWith('.'))specifier='./'+specifier;
  changes.push({...reference,text:reference.template?specifier:JSON.stringify(specifier+suffix)});
 }
 for(const change of changes.sort((a,b)=>b.start-a.start))source=source.slice(0,change.start)+change.text+source.slice(change.end);
 return source;
}
