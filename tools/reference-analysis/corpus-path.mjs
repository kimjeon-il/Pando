import {realpath} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';

export async function resolveCorpusPath(root,path){
  if(typeof path!=='string'||!path||isAbsolute(path)||path.split('/').includes('..'))throw Error('Corpus paths must stay inside corpus root');
  const base=await realpath(resolve(root)),result=await realpath(resolve(base,path)),rel=relative(base,result);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('Corpus symlink escapes root');return result;
}
