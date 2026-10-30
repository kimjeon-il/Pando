import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { summarizeTerrainAssets } from '../../tools/gis/terrain-dem-assets.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest();
test('DEM asset summary uses level and row order and the original binary hashes', async t => {
  const root=mkdtempSync(join(tmpdir(),'pando-dem-assets-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'0'));mkdirSync(join(root,'1'));
  const files=[['0/0-0.webp','a'],['0/1-0.webp','bb'],['0/0-1.webp','ccc'],['0/1-1.webp','dddd'],['1/0-0.webp','eeeee']];
  for(const [path,bytes] of files)writeFileSync(join(root,path),bytes);
  writeFileSync(join(root,'tint.webp'),'tint');
  const aggregate=createHash('sha256');for(const [path,bytes] of files)aggregate.update(path).update(digest(bytes));
  aggregate.update(digest('tint'));
  assert.deepEqual(await summarizeTerrainAssets(root,[{id:0,columns:2,rows:2},{id:1,columns:1,rows:1}]), {
    assetsSha256:aggregate.digest('hex'),reports:[{level:0,tileCount:4,bytes:10,maxTileBytes:4},{level:1,tileCount:1,bytes:5,maxTileBytes:5}],
  });
  await assert.rejects(summarizeTerrainAssets(root,[{id:'../other',columns:1,rows:1}]), /level/i);
  await assert.rejects(summarizeTerrainAssets(root,[{id:2,columns:1,rows:1}]), /ENOENT/);
});
