import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {libraryOwnerId} from '../../tools/library-data.mjs';
test('independent toolkit explicitly owns its reports without borrowing Pando main ownership',()=>{
  const root=mkdtempSync(join(tmpdir(),'map-owner-'));
  try{
    mkdirSync(join(root,'config'));mkdirSync(join(root,'.git'));
    writeFileSync(join(root,'config/library-data.json'),JSON.stringify({reportOwner:'map-toolkit'}));
    assert.equal(libraryOwnerId(root),'map-toolkit');
    writeFileSync(join(root,'config/library-data.json'),JSON.stringify({reportOwner:'../ui'}));
    assert.throws(()=>libraryOwnerId(root),/owner/i);
  }finally{rmSync(root,{recursive:true,force:true});}
});
