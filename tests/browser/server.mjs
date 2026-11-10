import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
import {developmentAssets} from '../../scripts/frontend-dev-server.mjs';
import {createP3PreviewServer} from '../../scripts/p3-preview-server.mjs';
import {prepareLibraryData} from "../../tools/data/library-runtime.mjs";
import {libraryRuntimeLeasePath} from "../../tools/data/library-context.mjs";

const root=resolve(process.cwd()),port=Number(process.env.PANDOLAB_TEST_PORT||4173);
const projectId=process.env.PANDOLAB_TEST_PROJECT_ID||'default-world';
const prepared=prepareLibraryData({root,projectId}),snapshot=await buildFrontendSnapshot({root,projectId});
const {assets}=await developmentAssets({repository:root,product:'viewer',prepared,snapshot});
for(const [path,asset]of snapshot.assets)if(snapshot.viewerPaths.has(path))assets.set(path,{bytes:asset.bytes});
assets.set('review.html',{bytes:Buffer.from(snapshot.html.viewer.replace('<title>판도연구소</title>',
  '<title>판도연구소 — 검수기</title>'))});
const lease=libraryRuntimeLeasePath(root,'verification');
mkdirSync(dirname(lease),{recursive:true});
writeFileSync(lease,JSON.stringify({pid:process.pid,root,product:'verification',materialized:[prepared.materialized]}));
const server=createP3PreviewServer(root,{assets:()=>assets,reports:true});
server.listen(port,'127.0.0.1',()=>console.log(`PandoLab test server: http://127.0.0.1:${port}`));
const release=()=>{try{unlinkSync(lease);}catch(error){if(error.code!=='ENOENT')throw error;}};
process.once('exit',release);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>process.exit(0)));
