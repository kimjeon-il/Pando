import {createHash} from 'node:crypto';
import {closeSync,fstatSync,openSync,readFileSync,readSync,statSync} from 'node:fs';

export function readTrainingBounded(path,limit){const info=statSync(path);if(!info.isFile()||info.size>limit)throw Error('Training input exceeds its byte budget');return readFileSync(path);}
export function trainingFileIdentity(path){const fd=openSync(path,'r');try{const before=fstatSync(fd);
  if(!before.isFile()||before.size>1024**3)throw Error('Expected bounded checkpoint or evidence file');
  const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let total=0,count;
  while((count=readSync(fd,buffer,0,buffer.length,null))>0){total+=count;hash.update(buffer.subarray(0,count));}
  const after=fstatSync(fd);if(total!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino||after.dev!==before.dev)
    throw Error('Checkpoint or evidence changed while hashing');return hash.digest('hex');
}finally{closeSync(fd);}}
