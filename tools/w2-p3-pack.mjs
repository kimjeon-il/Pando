import {readFileSync,writeFileSync,readdirSync,existsSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const base=realpathSync(process.env.PANDOLAB_W3_EVIDENCE||'');if(!base.replaceAll('\\','/').endsWith('/w2-p3-windows-gpu-final-2026-11-02'))throw Error('Only the explicitly selected task-owned evidence scope may be packed');
const digest=b=>createHash('sha256').update(b).digest('hex'),rows=[];
for(const entry of readdirSync(base,{withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith('.json'))){
 const file=resolve(base,entry.name),rel=relative(base,realpathSync(file));if(rel.startsWith('..')||isAbsolute(rel))throw Error('Outside evidence scope');
 const original=readFileSync(file);if(original.length<5*1024**2)continue;
 const packed=file+'.gz';if(existsSync(packed))throw Error('Preserve existing packed evidence '+packed);
 writeFileSync(packed,gzipSync(original,{level:9}),{flag:'wx'});const saved=readFileSync(packed);if(!gunzipSync(saved).equals(original))throw Error('Roundtrip failure');
 rows.push({original:entry.name,stored:entry.name+'.gz',originalBytes:original.length,storedBytes:saved.length,originalSha256:digest(original),storedSha256:digest(saved),reason:'Lossless compression with byte-for-byte roundtrip verified; the compressed file is the authoritative archival original.'});
 // The original generated copy is redundant only after the exact bytes are verified.
 unlinkSync(file);
}
const log=resolve(base,'compression-'+Date.now()+'.json');writeFileSync(log,JSON.stringify(rows,null,2));console.log(JSON.stringify(rows.map(r=>({name:r.original,bytes:r.originalBytes,packed:r.storedBytes}))));
