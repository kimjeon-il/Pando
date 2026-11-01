// Test-only preload: archived originals must not hide an obsolete country reader.
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const directory=new URL('../../assets/data/builtin-world/generated/v1/',import.meta.url);
const read=fs.readFileSync;
const index=JSON.parse(read(new URL('index.json',directory)));
const retired=new Set(index.entities.filter(row=>row.parts).map(row=>fileURLToPath(new URL(row.file,directory))));
const aggregate=fileURLToPath(new URL('transport/',directory));
fs.readFileSync=function(path,...args){
 const file=path instanceof URL?fileURLToPath(path):typeof path==='string'?resolve(path):null;
 if(file&&(retired.has(file)||file.startsWith(aggregate)))throw Error('Retired builtin country asset read: '+file);
 return read.call(this,path,...args);
};
syncBuiltinESMExports();
