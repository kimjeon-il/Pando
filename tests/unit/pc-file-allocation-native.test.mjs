import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,linkSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const windows=process.platform==='win32';
const binary=resolve(process.env.PANDO_PC_ALLOCATION_BINARY||'build-native/pc-allocation/Release/pando-pc-file-allocation.exe');
function setup(t){
  assert(existsSync(binary),'Build or download the native PC allocation tool first');
  const root=mkdtempSync(join(tmpdir(),'pando-native-allocation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const manifest=join(root,'manifest.json');
  const run=entries=>{writeFileSync(manifest,JSON.stringify({entries:entries.map(entry=>typeof entry==='string'?{root,path:entry,action:'delete'}:{root,...entry})}));return JSON.parse(execFileSync(binary,[manifest],{encoding:'utf8',windowsHide:true}));};
  return {root,run,manifest};
}
test('native allocation deduplicates hardlinks and excludes unselected links',{skip:!windows},t=>{
  const {root,run}=setup(t);const bytes=randomBytes(65536);writeFileSync(join(root,'a'),bytes);linkSync(join(root,'a'),join(root,'b'));
  const one=run(['a']),two=run(['a','b']),mixed=run([{path:'a',action:'delete'},{path:'b',action:'relocate'}]);
  assert.equal(one.reclaimableAllocation,0);assert.equal(one.sharedWithUnselectedAllocation,one.selectedUniqueAllocation);
  assert.equal(two.uniqueFileIds,1);assert.equal(two.reclaimableAllocation,two.selectedUniqueAllocation);assert(two.reclaimableAllocation>0);
  assert.equal(mixed.deleteOnlyReclaimableAllocation,0);assert.equal(mixed.reclaimableAllocation,two.reclaimableAllocation);
  assert.deepEqual(readFileSync(join(root,'a')),bytes);
});
test('native allocation handles extended Unicode paths and rejects duplicates or escapes',{skip:!windows},t=>{
  const {root,run}=setup(t),path='long/'.repeat(60)+'자료.bin';mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),randomBytes(4096));
  assert.equal(run([path]).files,1);assert.throws(()=>run([path,path]));assert.throws(()=>run(['../outside']));
  assert.throws(()=>run([{path,action:'unknown'}]));
});
test('native allocation refuses a junction in any selected path',{skip:!windows},t=>{
  const {root,run}=setup(t);mkdirSync(join(root,'real'));writeFileSync(join(root,'real','file'),'protected');
  symlinkSync(join(root,'real'),join(root,'linked'),'junction');
  assert.throws(()=>run(['linked/file']));assert.equal(readFileSync(join(root,'real','file'),'utf8'),'protected');
});
test('native allocation matches the existing Python oracle on selected real files',
  {skip:!windows||!process.env.PANDO_PC_ALLOCATION_ORACLE_PYTHON},t=>{
    const {root,run,manifest}=setup(t);writeFileSync(join(root,'file'),randomBytes(65536));linkSync(join(root,'file'),join(root,'link'));
    const actual=run([{path:'file',action:'delete'},{path:'link',action:'relocate'}]);
    const script=fileURLToPath(new URL('../../tools/pc-file-allocation.py',import.meta.url));
    const expected=JSON.parse(execFileSync(process.env.PANDO_PC_ALLOCATION_ORACLE_PYTHON,[script,manifest],{encoding:'utf8',windowsHide:true}));
    assert.deepEqual(actual,expected);
  });
