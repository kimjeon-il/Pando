import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';
import {extractPublisherPdfText,inspectPublisherPdf,renderPublisherPdfLayers} from '../../tools/reference-analysis/native-publisher-pdf.mjs';

test('publisher layer renderer matches the frozen original PDF pixels',async()=>{
  const root=resolve('tests/fixtures/reference-publisher-layers');
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
  for(const [file,manifest] of [['fixture.pdf','oracle.json'],['rotated-glyphs.pdf','rotated-glyphs.json']]){
  const path=resolve(root,file),input=readFileSync(path),oracle=JSON.parse(readFileSync(resolve(root,manifest),'utf8'));
  assert.equal(sha(input),oracle.sourceSha256);
  const info=await inspectPublisherPdf({path});
  // MuPDF enumerates OCGs in a different order from the PDF layer UI.
  // Selection is by name, while the UI order preserves parent relationships.
  assert.deepEqual(info.layers.map(layer=>layer.name).sort(),[...oracle.layers].sort());
  assert.deepEqual(info.ui.map(layer=>layer.text),oracle.layers);
  assert.equal(info.pageCount,1);assert.equal(info.rotation,0);
  for(const row of oracle.renders){
    const rendered=await renderPublisherPdfLayers({path,enabled:row.enabled,maximumDimension:oracle.text.maximumDimension});
    assert.equal(rendered.width,row.width);assert.equal(rendered.height,row.height);assert.equal(sha(rendered.rgb),row.sha256);
  }
  const text=await extractPublisherPdfText({path,maximumDimension:oracle.text.maximumDimension});
  assert.equal(sha(text.mask),oracle.text.maskSha256);assert.equal(sha(text.credits),oracle.text.creditSha256);
  assert.equal(text.characters,oracle.text.characters);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:['missing'],maximumDimension:160}),/layer/i);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:['International','International'],maximumDimension:160}),/layer/i);
  await assert.rejects(renderPublisherPdfLayers({path,enabled:[],maximumDimension:16}),/dimension/i);
  assert.deepEqual(readFileSync(path),input);
  }
});
