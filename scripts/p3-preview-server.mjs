// Read-only, branch-local HTTP preview for GitHub Codespaces.
// Nothing outside index.html and assets/ is exposed by the forwarded port.
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot=fileURLToPath(new URL('../', import.meta.url));
const MIME=Object.freeze({
  '.html':'text/html; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png',
  '.jpg':'image/jpeg',
  '.jpeg':'image/jpeg',
  '.webp':'image/webp',
  '.ico':'image/x-icon',
  '.woff':'font/woff',
  '.woff2':'font/woff2',
  '.ttf':'font/ttf',
  '.wasm':'application/wasm',
  '.bin':'application/octet-stream',
  '.gz':'application/gzip',
});
function contained(root,file) {
  const rel=relative(root,file);
  return rel!=='' && rel!=='..' && !rel.startsWith('..'+sep) && !rel.startsWith('/') && !rel.startsWith('\\');
}
function readOnlyResponse(req,res,root) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET' && req.method!=='HEAD') {
    res.writeHead(405,{'Allow':'GET, HEAD'}).end('Method not allowed');
    return;
  }
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url||'/', 'http://localhost').pathname); }
  catch { res.writeHead(400).end('Invalid URL'); return; }
  if(pathname==='/__p3_health') {
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});
    if(req.method==='HEAD')res.end();
    else res.end('{"ok":true,"preview":"pando-p3"}');
    return;
  }
  const filename=pathname==='/'?'index.html':pathname.slice(1);
  if(filename!=='index.html' && !/^assets\/[A-Za-z0-9._/-]+$/.test(filename)) {
    res.writeHead(404).end('Not found');return;
  }
  if(filename.split('/').some(part=>part==='.'||part==='..'||!part)) {
    res.writeHead(403).end('Forbidden');return;
  }
  let file,stats;
  try {
    file=realpathSync(resolve(root,filename));
    if(!contained(root,file)) {res.writeHead(403).end('Forbidden');return;}
    stats=statSync(file);
    if(!stats.isFile()) {res.writeHead(404).end('Not found');return;}
  } catch {res.writeHead(404).end('Not found');return;}
  res.writeHead(200,{
    'Content-Type':MIME[extname(file).toLowerCase()]||'application/octet-stream',
    'Content-Length':stats.size,
  });
  if(req.method==='HEAD'){res.end();return;}
  const stream=createReadStream(file);
  stream.on('error',()=>{if(!res.headersSent)res.writeHead(500).end('Read error');else res.destroy();});
  res.on('close',()=>stream.destroy());
  stream.pipe(res);
}

export function createP3PreviewServer(root=sourceRoot) {
  const resolved=realpathSync(resolve(root));
  return createServer((req,res)=>readOnlyResponse(req,res,resolved));
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PANDOLAB_PREVIEW_PORT||4173);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PANDOLAB_PREVIEW_PORT');
  createP3PreviewServer().listen(port,'0.0.0.0',()=>{
    console.log('P3 branch preview ready at http://127.0.0.1:'+port+'/');
  });
}
