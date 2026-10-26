#!/usr/bin/env node
/** SHA-verified C++ GEOS historical linework audit; no research source writes. */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyHistoricalLinework(file,expectedSha,
    binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY){
  if(!/^[a-f0-9]{64}$/i.test(String(expectedSha)))
    throw Error('Approved historical network SHA-256 required');
  const filename=resolve(file);
  const bytes=readFileSync(filename);
  const actual=digest(bytes);
  if(actual!==expectedSha.toLowerCase())
    throw Error('Approved historical network SHA-256 mismatch');
  if(!binary||!existsSync(binary))
    throw Error('Native GEOS/PROJ recipe executable unavailable');
  const run=spawnSync(binary,['--audit-linework',filename],{
    encoding:'utf8',maxBuffer:8*1024*1024,
  });
  if(run.error||run.status!==0)
    throw Error('Native GEOS linework audit failed: '+(run.stderr||run.error?.message||run.status));
  const result=JSON.parse(run.stdout);
  if(result?.schemaVersion!==1||!Number.isInteger(result.featureCount)
    ||!Array.isArray(result.nonEndpointCrossings)
    ||!Array.isArray(result.nonSimpleFeatures)||typeof result.passed!=='boolean')
    throw Error('Malformed native linework receipt');
  if(!result.passed||result.nonEndpointCrossings.length||result.nonSimpleFeatures.length)
    throw Error('Historical linework intersections rejected: '+JSON.stringify(result));
  if(digest(readFileSync(filename))!==actual)
    throw Error('Source was modified during native read-only audit');
  return {schema:'pando-historical-linework-native-v1',input:filename,
    sha256:actual,featureCount:result.featureCount,
    endpointTouchPairs:result.endpointTouchPairs,verified:true,
    sourceBytesUnchanged:true};
}
export function parseArguments(argv){
  const args={};
  for(let i=0;i<argv.length;i++){
    if(argv[i]==='--input'&&argv[i+1]&&!args.input)args.input=argv[++i];
    else if(argv[i]==='--expected-sha256'&&argv[i+1]&&!args.hash)args.hash=argv[++i];
    else if(argv[i]==='--binary'&&argv[i+1]&&!args.binary)args.binary=argv[++i];
    else throw Error('Usage: --input FILE --expected-sha256 HASH [--binary EXE]');
  }
  if(!args.input||!args.hash)throw Error('Source file and pinned SHA-256 required');
  return args;
}
export function main(argv=process.argv.slice(2)){
  const args=parseArguments(argv);
  const receipt=verifyHistoricalLinework(args.input,args.hash,args.binary);
  console.log(JSON.stringify(receipt));
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){console.error('historical-linework: '+error.message);process.exitCode=1;}
}
