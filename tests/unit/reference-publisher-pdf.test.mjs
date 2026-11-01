import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {inspectPublisherPdf,renderPublisherPdfLayers} from '../../tools/reference-analysis/native-publisher-pdf.mjs';

test('publisher layer renderer matches the frozen original PDF pixels',async()=>{
  const root=resolve('tests/fixtures/reference-publisher-layers');
  const path=resolve(root,'fixture.pdf'),input=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,'oracle.json'),'utf8'));
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha(input),oracle.sourceSha256);
  const info=await inspectPublisherPdf({path});
  assert.deepEqual(info.layers.map(layer=>layer.name),oracle.layers);
  assert.equal(info.pageCount,1);assert.equal(info.rotation,0);
  for(const row of oracle.renders){
    const rendered=await renderPublisherPdfLayers({path,enabled:row.enabled,maximumDimension:160});
    assert.equal(rendered.width,row.width);assert.equal(rendered.height,row.height);assert.equal(sha(rendered.rgb),row.sha256);
  }
  await assert.rejects(renderPublisherPdfLayers({path,enabled:['missing'],maximumDimension:160}),/layer/i);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:['International','International'],maximumDimension:160}),/layer/i);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:[],maximumDimension:16}),/dimension/i);
  assert.deepEqual(readFileSync(path),input);
});
