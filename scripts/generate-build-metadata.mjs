import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildFrontendSnapshot,selectFrontendProduct} from './lib/frontend-build.mjs';
import {installFrontendSnapshot} from '../tools/worktree-storage.mjs';
import {prepareLibraryData} from '../tools/library-data.mjs';
import {contentHash} from '../tools/library-content.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let snapshot=await buildFrontendSnapshot({root});
const product=process.argv.find(arg=>arg.startsWith('--product='))?.slice(10);
if(product){const library=prepareLibraryData({root});snapshot=selectFrontendProduct(snapshot,product,{readRuntimeAsset(path){const spec=library.files[path],bytes=readFileSync(resolve(library.materialized,path));if(!spec||bytes.length!==spec.bytes||contentHash(bytes)!==spec.sha256)throw Error('Pinned runtime asset changed: '+path);return bytes;}});}
const directory=process.argv.includes('--check')?null:installFrontendSnapshot({root,snapshot});
console.log(JSON.stringify({sourceCommit:snapshot.sourceCommit,product:snapshot.product||'common',frontendInputSha256:snapshot.sourceSha256,assets:snapshot.assets.size,directory}));
