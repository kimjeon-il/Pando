import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';
const root=resolve('.');
const snapshot=await buildFrontendSnapshot({root});
createServer(async(req,res)=>{
 const path=resolve(root,`.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);
 if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 try{const generated=snapshot.assets.get(path.slice(root.length+1).replaceAll('\\','/'));const bytes=generated?generated.bytes:await readFile(path);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wasm':'application/wasm','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(bytes);}
 catch{res.writeHead(404).end();}
}).listen(4193,'127.0.0.1');
