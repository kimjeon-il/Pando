const fail=(condition,message)=>{if(!condition)throw Error(message);};
const gitSha=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);

function isGitTree(tree){
  return !!(tree&&tree.truncated===false&&Array.isArray(tree.tree));
}
export function normalizeGitTree(input){
  fail(isGitTree(input),'Full non-truncated Git tree required');
  const result=new Map();
  for(const item of input.tree){
    if(item.type!=='blob')continue;
    fail(typeof item.path==='string'&&gitSha(item.sha)&&Number.isSafeInteger(item.size)&&item.size>=0,
      'Invalid Git tree metadata: '+item.path);
    fail(!result.has(item.path),'Duplicate tracked Git path '+item.path);
    result.set(item.path,{sha:item.sha,bytes:item.size});
  }
  return result;
}
