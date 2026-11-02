import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {validateMacroProvenance} from '../../tools/reference-analysis/reviewed-corpus.mjs';
import {assertMacroMetadata,verifiedMacroTrainingSource} from '../../tools/reference-analysis/macro-training-source.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('macro training provenance binds source, scope, edition and renderer',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-macro-proof-'));
  const pdf=join(root,'source.pdf'),metadataPath=join(root,'source.json');
  t.after(async()=>{await unlink(pdf);await unlink(metadataPath);await rmdir(root);});
  const source=Buffer.from('synthetic source');await writeFile(pdf,source);
  const sheet={id:'fixture',familyId:'family',editionId:'edition',duplicateGroup:'group',geographicScope:'country',scopeEvidence:'fixture',
    source:{url:'https://example.test/map',license:'fixture only'}};
  const metadata={...sheet,sha256:sha(source),url:sheet.source.url,license:sheet.source.license,
    rightsReviewed:true,materialKind:'published-macro-pdf'};
  const metadataBytes=Buffer.from(JSON.stringify(metadata));await writeFile(metadataPath,metadataBytes);
  const annotation={schemaVersion:1,reviewed:false,supervisionQuality:'source-derived-weak',sourcePdf:'source.pdf',sourceMetadata:'source.json',
    sourceSha256:sha(source),sourceMetadataSha256:sha(metadataBytes),
    producer:{script:'tools/reference-analysis/macro.py',sha256:'a'.repeat(64),renderer:'PyMuPDF',rendererVersion:'fixture'}};
  const check=(changes={})=>validateMacroProvenance({...annotation,...changes},sheet,root,{rendererVersion:'fixture'});
  await check();
  assertMacroMetadata(metadata,annotation,sheet,{requireTraining:true});
  assert.throws(()=>assertMacroMetadata({...metadata,rightsReviewed:false},annotation,sheet,{requireTraining:true}),/provenance/i);
  assert.throws(()=>assertMacroMetadata({...metadata,materialKind:'other'},annotation,sheet,{requireTraining:true}),/provenance/i);
  await assert.rejects(check({reviewed:true}),/provenance/i);
  await assert.rejects(check({producer:{...annotation.producer,sha256:'invalid'}}),/provenance/i);
  await assert.rejects(check({sourcePdf:'../outside.pdf'}),/corpus root/i);
  await writeFile(pdf,'changed');await assert.rejects(check(),/hash/i);await writeFile(pdf,source);
  await writeFile(metadataPath,JSON.stringify({...metadata,geographicScope:'invented'}));
  const changed=await readFile(metadataPath);await assert.rejects(check({sourceMetadataSha256:sha(changed)}),/scope/i);
});

test('macro-only training refuses relabelled nonmacro origins and unsupported scope',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-macro-scope-'));
  t.after(()=>rm(root,{recursive:true}));
  const pdf=Buffer.from('source'),placeholder=Buffer.from('raster');
  for(const [name,bytes] of [['source.pdf',pdf],['map.png',placeholder],['mask.png',placeholder],['valid.png',placeholder]])
    await writeFile(join(root,name),bytes);
  const sheet={id:'fixture',split:'train',familyId:'family',editionId:'edition',duplicateGroup:'group',geographicScope:'country',
    scopeEvidence:'complete country map',sha256:sha(placeholder),source:{url:'https://example.test/map',license:'CC0'},
    mapKind:'color',script:'Latin',language:'eng',image:'map.png',annotations:'labels.json'};
  const metadata={...sheet,url:sheet.source.url,license:sheet.source.license,sha256:sha(pdf),
    rightsReviewed:true,materialKind:'published-macro-pdf'};
  const metadataBytes=Buffer.from(JSON.stringify(metadata));await writeFile(join(root,'source.json'),metadataBytes);
  const annotation={origin:'macro-vector-supervision',reviewed:false,supervisionQuality:'source-derived-weak',sourcePdf:'source.pdf',
    sourceMetadata:'source.json',sourceSha256:sha(pdf),sourceMetadataSha256:sha(metadataBytes),
    raster:{path:'mask.png',sha256:sha(placeholder)},validRaster:{path:'valid.png',sha256:sha(placeholder)}};
  const check=(row=sheet)=>verifiedMacroTrainingSource(root,{schemaVersion:1,trainingOnly:true,sheets:[row]},'fixture');
  await writeFile(join(root,'labels.json'),JSON.stringify(annotation));assert.equal((await check()).sheet.id,'fixture');
  for(const origin of ['publisher-layer-export','semap-human-mask-export']){
    await writeFile(join(root,'labels.json'),JSON.stringify({...annotation,origin}));
    await assert.rejects(check(),/macro training evidence/i);
  }
  await writeFile(join(root,'labels.json'),JSON.stringify(annotation));
  for(const changes of [{geographicScope:'city'},{scopeEvidence:''},{geographicScope:'unknown'}])
    await assert.rejects(check({...sheet,...changes}),/macro training source/i);
});
