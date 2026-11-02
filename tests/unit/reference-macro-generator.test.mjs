import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {prepareMacroCorpus} from '../../tools/reference-analysis/prepare-macro.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('macro generator preserves source, alternate editions and training-only evidence',async t=>{
  const root=mkdtempSync(join(tmpdir(),'pando-macro-generator-'));t.after(()=>rmSync(root,{recursive:true}));
  const sources=join(root,'sources');mkdirSync(sources);const pdf=join(sources,'fixture.pdf');copyFileSync('tests/fixtures/reference-macro-pdf/base.pdf',pdf);
  const original=readFileSync(pdf),metadata={id:'macro-fixture',format:'pdf',familyId:'family',editionId:'edition',duplicateGroup:'original',
    geographicScope:'country',scopeEvidence:'fixture only',language:'eng',script:'Latin',mapKind:'color',materialKind:'published-macro-pdf',
    rightsReviewed:true,license:'fixture only',url:'https://example.test/map.pdf',sha256:sha(original),
    supervision:{strategy:'country-fill-adjacency',radiusPixels:3,countryFillColors:[[.7,.5,.3],[.3,.5,.7]]}};
  writeFileSync(join(sources,'fixture.source.json'),JSON.stringify(metadata));
  const first=await prepareMacroCorpus({sources,maximumDimension:160}),manifest=readFileSync(first.manifest),sheet=JSON.parse(manifest).sheets[0];
  const annotation=JSON.parse(readFileSync(join(root,sheet.annotations))),before=readFileSync(join(root,sheet.image));
  assert.equal(annotation.producer.renderer,'MuPDF');assert.equal(annotation.reviewed,false);assert.equal(first.independentEvaluation,false);
  assert.deepEqual(await prepareMacroCorpus({sources,maximumDimension:160}),first);assert.deepEqual(readFileSync(first.manifest),manifest);
  const annotationPath=join(root,sheet.annotations),originalAnnotation=readFileSync(annotationPath);
  const historical={...annotation,producer:{script:'tools/reference-analysis/macro.py',sha256:'a'.repeat(64),renderer:'PyMuPDF',rendererVersion:'1.26.6'}};
  const recorded=Buffer.from(JSON.stringify(historical,null,2)+'\n');writeFileSync(annotationPath,recorded);
  assert.deepEqual(await prepareMacroCorpus({sources,maximumDimension:160}),first);assert.deepEqual(readFileSync(annotationPath),recorded);
  writeFileSync(annotationPath,JSON.stringify({...historical,width:historical.width+1}));
  await assert.rejects(prepareMacroCorpus({sources,maximumDimension:160}),/dimensions/i);writeFileSync(annotationPath,originalAnnotation);
  const recipes=join(root,'recipes');mkdirSync(recipes);writeFileSync(join(recipes,'fixture.source.json'),JSON.stringify({...metadata,id:'macro-fixture-r2',
    supervision:{...metadata.supervision,radiusPixels:4}}));
  const alternate=await prepareMacroCorpus({sources,maximumDimension:160,metadataDirectory:recipes,manifestName:'corpus.r2.json'});
  const revised=JSON.parse(readFileSync(alternate.manifest)).sheets[0];assert.notEqual(revised.annotations,sheet.annotations);assert.equal(revised.image,sheet.image);
  assert.deepEqual(readFileSync(first.manifest),manifest);assert.deepEqual(readFileSync(join(root,sheet.image)),before);assert.deepEqual(readFileSync(pdf),original);
  writeFileSync(join(recipes,'fixture.source.json'),JSON.stringify({...metadata,id:'macro-fixture-r2',duplicateGroup:'forged'}));
  await assert.rejects(prepareMacroCorpus({sources,maximumDimension:160,metadataDirectory:recipes,manifestName:'corpus.bad.json'}),/original identity/i);
  await assert.rejects(prepareMacroCorpus({sources,maximumDimension:160,manifestName:'../escape.json'}),/manifest/i);
});
