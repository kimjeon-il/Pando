#!/usr/bin/env node
// Read the branch-pinned physical land once; rasterization is a display fixture only.
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {decodeArchiveEntry,libraryCheckout,libraryConfig} from '../../tools/data/library-context.mjs';

const [python,fixturePath,out]=process.argv.slice(2);
if(!python||!fixturePath||!out)throw Error('Expected existing Python executable, regional tile manifest, new output directory');
const root=process.cwd(),checkout=libraryCheckout(root),revision=libraryConfig(root).revision;
const index=JSON.parse(execFileSync('git',['-c','maintenance.auto=false','-c','gc.auto=0','show',`${revision}:archive/index.json`],
  {cwd:checkout,maxBuffer:16*1024*1024}));
const catalogPath='assets/data/physical-land/v1/manifest.json',catalog=JSON.parse(decodeArchiveEntry(checkout,index.files[catalogPath],revision));
const spec=catalog.asset;
if(catalog.schema!=='pando-physical-land-v3'||spec?.encoding!=='gzip'||!index.files[spec.url])throw Error('Invalid pinned physical-land asset');
const asset=decodeArchiveEntry(checkout,index.files[spec.url],revision),hash=createHash('sha256').update(asset).digest('hex');
if(asset.length!==spec.compressedBytes||hash!==spec.sha256)throw Error('Pinned physical-land identity mismatch');
const fixture=JSON.parse(await readFile(fixturePath,'utf8')),tiles=fixture.records.filter(row=>row.tileSize===1024);
if(tiles.length!==4)throw Error('Expected four regional 1024 tiles');
const x=Math.min(...tiles.map(row=>row.window[0])),y=Math.min(...tiles.map(row=>row.window[1]));
const child=spawn(python,['scripts/terrain-experiment/rasterize-land-mask.py',hash,String(x),String(y),resolve(out)],
  {cwd:root,env:process.env,stdio:['pipe','inherit','inherit'],windowsHide:true});
child.stdin.on('error',()=>{});child.stdin.end(asset);
await new Promise((yes,no)=>{child.once('error',no);child.once('close',code=>code===0?yes():no(Error('Regional land-mask generation failed: '+code)));});
