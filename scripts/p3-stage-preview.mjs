// Branch preview shares the production viewer dependency closure and adds its own identity.
import {writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {stageWebPages} from '../tools/stage-monorepo-pages.mjs';
import {previewSlug} from './p3-plan-remote.mjs';
export async function stagePreview({root,output,branch}){
 const slug=previewSlug(branch),evidenceFile=resolve(output)+'.evidence.json';
 const evidence=await stageWebPages(root,output,evidenceFile);
 const manifest={schema:'pando-branch-preview-v1',branch,slug,sourceCommit:evidence.sourceCommit,dataRepository:evidence.dataRepository,dataCommit:evidence.dataCommit,mode:'downloadable-static-snapshot',publicUrl:null,files:evidence.fileCount,bytes:evidence.bytes,included:evidence.files,excludes:['native/**','shared/**','reports/**','tests/**','tools/**']};
 renameSync(evidenceFile,join(output,'viewer-evidence.json'));
 writeFileSync(join(output,'preview-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),val=key=>args[args.indexOf(key)+1];
 if(!args.includes('--root')||!args.includes('--output')||!args.includes('--branch'))throw Error('Usage: --root REPOSITORY --output OUTPUT --branch work/ui');
 console.log(JSON.stringify(await stagePreview({root:val('--root'),output:val('--output'),branch:val('--branch')})));
}
