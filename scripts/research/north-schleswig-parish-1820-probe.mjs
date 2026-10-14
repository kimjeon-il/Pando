// One-off 1820 parish-boundary research probe: western-border candidates.\n// Not part of the UI validation pipeline; requires network access.
const base='https://raw.githubusercontent.com/christianvedels/A_perfect_storm/main/Data/sogne_shape/sogne.';
const [shpResp,dbfResp]=await Promise.all([fetch(base+'shp'),fetch(base+'dbf')]);
if(!shpResp.ok) throw new Error('SHP HTTP '+shpResp.status);
if(!dbfResp.ok) throw new Error('DBF HTTP '+dbfResp.status);
const shp=Buffer.from(await shpResp.arrayBuffer());
const dbf=Buffer.from(await dbfResp.arrayBuffer());
function readDbf(buf){
  const num=buf.readUInt32LE(4), headerLen=buf.readUInt16LE(8), recLen=buf.readUInt16LE(10);
  const fields=[];
  for(let off=32;off<headerLen-1;off+=32){
    if(buf[off]===0x0d) break;
    const raw=buf.subarray(off,off+11), z=raw.indexOf(0);
    const name=raw.subarray(0,z>=0?z:11).toString('latin1').trim();
    if(!name) break;
    fields.push({name,type:String.fromCharCode(buf[off+11]),len:buf[off+16]});
  }
  const rows=[];
  for(let i=0;i<num;i++){
    const start=headerLen+i*recLen;if(start+recLen>buf.length)break;
    if(buf[start]===0x2a){rows.push(null);continue;}
    let pos=start+1;const row={};
    for(const f of fields){const raw=buf.subarray(pos,pos+f.len).toString('latin1').trim();pos+=f.len;row[f.name]=(f.type==='N'||f.type==='F')?(raw===''?null:Number(raw)):raw;}
    rows.push(row);
  }
  return {fields,rows};
}
function readShp(buf){
  const shapes=[];let off=100;
  while(off+8<=buf.length){
    const bytes=buf.readInt32BE(off+4)*2,start=off+8;if(start+bytes>buf.length)break;
    const type=buf.readInt32LE(start);if(type===0){shapes.push(null);off=start+bytes;continue;}if(type!==5)throw new Error('shape type '+type);
    const bbox=[buf.readDoubleLE(start+4),buf.readDoubleLE(start+12),buf.readDoubleLE(start+20),buf.readDoubleLE(start+28)];
    const np=buf.readInt32LE(start+36), npt=buf.readInt32LE(start+40), ps=start+44;
    const parts=[];for(let i=0;i<np;i++)parts.push(buf.readInt32LE(ps+i*4));parts.push(npt);
    const p0=ps+np*4,pts=[];for(let i=0;i<npt;i++)pts.push([buf.readDoubleLE(p0+i*16),buf.readDoubleLE(p0+i*16+8)]);
    const rings=[];for(let i=0;i<np;i++)rings.push(pts.slice(parts[i],parts[i+1]));
    shapes.push({bbox,rings});off=start+bytes;
  }
  return shapes;
}
const D=readDbf(dbf),S=readShp(shp);
const keys=['vedsted','seem','ribe','høm','hoem','hvid','roager','spandet','farup','fårup','obbek','kalvslund'];
const candidates=[];
for(let i=0;i<Math.min(D.rows.length,S.length);i++){
  const p=D.rows[i],sh=S[i];if(!p||!sh)continue;
  const text=Object.values(p).join(' ').toLowerCase();
  if(!keys.some(k=>text.includes(k)))continue;
  if(sh.bbox[2]<8.55||sh.bbox[0]>9.05||sh.bbox[3]<55.20||sh.bbox[1]>55.45)continue;
  candidates.push({index:i,properties:p,bbox:sh.bbox,rings:sh.rings});
}
console.log('PARISH1820_FILTERED_BEGIN');
console.log(JSON.stringify({fields:D.fields.map(f=>f.name),count:candidates.length,candidates}));
console.log('PARISH1820_FILTERED_END');
