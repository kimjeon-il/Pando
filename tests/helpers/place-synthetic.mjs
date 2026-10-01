import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizePlace, comparePlaces } from '../../assets/js/modules/place-contract.js';
import { encodePlaceTile } from '../../assets/js/modules/place-codec.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Offline fixture generator. It streams fine tiles; never holds a million objects. */
export async function buildSyntheticPlaces(count, directory) {
  await mkdir(directory,{recursive:true});
  const stages=[{id:0,minZoom:0,columns:2,rows:1},{id:1,minZoom:2,columns:8,rows:4},{id:2,minZoom:5,columns:32,rows:16},{id:3,minZoom:10,columns:128,rows:64}];
  const manifest={version:1,revision:`synthetic-${count}`,stages,tiles:{},shards:{},search:{sy:[]}};
  const coarse=stages.slice(0,3).map(()=>new Map()); let nextId=0;
  async function writeTile(stage,x,y,records) {
    const key=`${stage.id}/${x}-${y}`, file=`tile-${stage.id}-${x}-${y}.bin`, bytes=encodePlaceTile(records);
    await writeFile(join(directory,file),new Uint8Array(bytes));
    manifest.shards[key]={url:file,bytes:bytes.byteLength};
    const row={shard:key,offset:0,length:bytes.byteLength,sha256:sha256(new Uint8Array(bytes))}; manifest.tiles[key]=row; return row;
  }
  const fine=stages[3], cells=fine.columns*fine.rows;
  for (let cell=0;cell<cells;cell++) {
    const length=Math.floor(count/cells)+(cell<count%cells?1:0); if (!length) continue;
    if (length>512) throw new RangeError('Synthetic fine tile capacity exceeded');
    const x=cell%fine.columns,y=Math.floor(cell/fine.columns), records=[];
    for (let j=0;j<length;j++) {
      const id=nextId++, capital=id%997===0;
      records.push(normalizePlace({source:'synthetic',sourceId:String(id),name:`Synthetic ${String(id).padStart(7,'0')}`,kind:capital?'capital':'city',countryCode:'ZZ',
        coordinates:[-180+(x+0.1+0.8*(j+1)/(length+1))*360/fine.columns,90-(y+0.1+0.8*((j*37)%length+1)/(length+1))*180/fine.rows],
        priority:capital?90:70,population:count-id,minZoom:capital?0:1.25}));
    }
    const row=await writeTile(fine,x,y,records);
    manifest.search.sy.push({...row,first:records[0].name.toLowerCase(),last:records.at(-1).name.toLowerCase()});
    stages.slice(0,3).forEach((stage,index)=>{
      const px=Math.floor(x*stage.columns/fine.columns),py=Math.floor(y*stage.rows/fine.rows),key=`${px}:${py}`;
      const candidates=[...(coarse[index].get(key)||[]),...records.filter(record=>record.minZoom<=stage.minZoom)].sort(comparePlaces).slice(0,128);
      coarse[index].set(key,candidates);
    });
  }
  for (let i=0;i<3;i++) for (const [key,records] of coarse[i]) if (records.length) { const [x,y]=key.split(':').map(Number); await writeTile(stages[i],x,y,records); }
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));
  return manifest;
}
