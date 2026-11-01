import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {readLSIBDisputedShape} from '../../tools/gis/lsib-source-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const fixture=JSON.parse(await readFile(new URL('../fixtures/lsib-disputed-shape-oracle.json',import.meta.url),'utf8'));
const dbf=Buffer.from(fixture.dbfBase64,'base64'),shp=Buffer.from(fixture.shpBase64,'base64');
test('disputed SHP and DBF retain the Python properties, null rows and line coordinates',{skip:!binary},async()=>{
  const originalDbf=Buffer.from(dbf),originalShp=Buffer.from(shp);
  assert.deepEqual(await readLSIBDisputedShape({dbf,shp},{binary}),fixture.expected);
  assert.deepEqual(dbf,originalDbf);assert.deepEqual(shp,originalShp);
  await assert.rejects(readLSIBDisputedShape({dbf,shp},{binary:'missing-lsib-native'}),/native.*failed/i);
});
test('disputed SHP and DBF reject truncation, invalid types and invalid UTF-8',{skip:!binary},async()=>{
  await assert.rejects(readLSIBDisputedShape({dbf:dbf.subarray(0,40),shp},{binary}),/truncat|invalid/i);
  await assert.rejects(readLSIBDisputedShape({dbf,shp:shp.subarray(0,120)},{binary}),/truncat|invalid/i);
  const badShape=Buffer.from(shp);badShape.writeUInt32LE(5,108);
  await assert.rejects(readLSIBDisputedShape({dbf,shp:badShape},{binary}),/polyline/i);
  const badText=Buffer.from(dbf);badText[98]=255;
  await assert.rejects(readLSIBDisputedShape({dbf:badText,shp},{binary}),/utf.8/i);
});
test('DBF values use Python whitespace rules without discarding a UTF-8 BOM',{skip:!binary},async()=>{
  const spaced=Buffer.from(dbf);spaced[98]=0x1c;
  assert.equal((await readLSIBDisputedShape({dbf:spaced,shp},{binary}))[0].properties.NAME,'alpha');
  const bom=Buffer.from(dbf);bom.fill(0x20,98,108);Buffer.from('\ufeffalpha','utf8').copy(bom,98);
  assert.equal((await readLSIBDisputedShape({dbf:bom,shp},{binary}))[0].properties.NAME,'\ufeffalpha');
});
test('selected preserved Natural Earth disputed source matches the Python parser',{
  skip:!binary||!process.env.PANDO_LSIB_DISPUTED_ROOT||!process.env.PANDO_LSIB_DISPUTED_ORACLE
},async()=>{
  const root=process.env.PANDO_LSIB_DISPUTED_ROOT;
  const [dbf,shp,expected]=await Promise.all([readFile(join(root,'ne-disputed.dbf')),readFile(join(root,'ne-disputed.shp')),
    readFile(process.env.PANDO_LSIB_DISPUTED_ORACLE,'utf8').then(JSON.parse)]);
  assert.deepEqual(await readLSIBDisputedShape({dbf,shp},{binary}),expected);
});
