import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readBuiltinCountryStoredBytes} from '../../tools/builtin-country-bytes.mjs';
import {builtinCountryAssets} from '../../shared/frontend/js/modules/builtin-country-files.js';

const builtinRoot='assets/data/builtin-world/generated/v1/';
/** Verify existing input identities, reconstructing only one country at a time.
 * A logical country hash does not require its retired oversized physical file.
 * Stale hashes and unreferenced inputs still fail; no archive fallback is used. */
export function verifyPreparedInputHashes(inputHashes,read){
 let countries;
 for(const [path,expected] of Object.entries(inputHashes)){
  if(path.startsWith(builtinRoot+'transport/'))throw Error('Retired builtin aggregate input: '+path);
  let bytes;
  if(path.startsWith(builtinRoot+'countries/')){
   if(!countries){
    const index=JSON.parse(read(builtinRoot+'index.json'));
    builtinCountryAssets(index);
    countries=new Map(index.entities.map(row=>[builtinRoot+row.file,row]));
   }
   const country=countries.get(path);
   if(!country)throw Error('Unreferenced builtin country input: '+path);
   bytes=readBuiltinCountryStoredBytes(country,file=>read(builtinRoot+file));
  }else bytes=read(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),expected,'prepared input '+path);
 }
}
