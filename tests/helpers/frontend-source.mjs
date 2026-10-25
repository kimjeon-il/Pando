import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildFrontendIndex,frontendAsset,frontendModuleReferences} from '../../scripts/lib/frontend-layout.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),index=buildFrontendIndex(root);
export const repositoryFrontendUrl=path=>pathToFileURL(resolve(root,frontendAsset(root,path,{index}).sourcePath));

let snapshot;export const repositoryFrontendSnapshot=()=>snapshot??=buildFrontendSnapshot({root});

// Node supplies module transport; Worker logic and public script bytes stay production-owned.
export function nodeWorkerScript(snapshot,path){let source=snapshot.assets.get(path).bytes.toString('utf8');
 const refs=frontendModuleReferences(source).filter(r=>r.kind==='import'&&r.specifier.startsWith('.'));
 for(const ref of refs.sort((a,b)=>b.start-a.start)){const url=repositoryFrontendUrl(new URL(ref.specifier,'https://fixture.invalid/'+path).pathname.slice(1)).href;source=source.slice(0,ref.start)+(ref.template?url:JSON.stringify(url))+source.slice(ref.end);}return source;
}
