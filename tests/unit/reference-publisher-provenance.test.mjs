import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {validatePublisherProvenance} from '../../tools/reference-analysis/reviewed-corpus.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('publisher training provenance binds source bytes, rights and generator identity',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-publisher-proof-'));
  const pdf=join(root,'source.pdf'),metadataPath=join(root,'source.json');
  t.after(async()=>{await unlink(pdf);await unlink(metadataPath);await rmdir(root);});
  const source=Buffer.from('synthetic source');await writeFile(pdf,source);
  const sheet={id:'fixture',familyId:'family',source:{url:'https://example.test/map'}};
  const metadata={sha256:sha(source),rightsReviewed:true,materialKind:'publisher-layered-pdf',license:'fixture only',
    id:sheet.id,familyId:sheet.familyId,url:sheet.source.url};
  const metadataBytes=Buffer.from(JSON.stringify(metadata));await writeFile(metadataPath,metadataBytes);
  const script=await readFile(new URL('../../tools/reference-analysis/publisher.py',import.meta.url));
  const annotation={schemaVersion:1,reviewed:false,sourcePdf:'source.pdf',sourceMetadata:'source.json',
    sourceSha256:sha(source),sourceMetadataSha256:sha(metadataBytes),
    producer:{script:'tools/reference-analysis/publisher.py',sha256:sha(Buffer.from(script.toString('utf8').replaceAll('\r\n','\n'))),renderer:'PyMuPDF',rendererVersion:'fixture'}};
  const check=(changes={})=>validatePublisherProvenance({...annotation,...changes},sheet,root,{rendererVersion:'fixture'});
  await check();
  await assert.rejects(check({reviewed:true}),/review/i);
  await assert.rejects(check({producer:{...annotation.producer,sha256:'0'.repeat(64)}}),/identity/i);
  await assert.rejects(check({sourcePdf:'../outside.pdf'}),/corpus root/i);
  await writeFile(pdf,'changed');await assert.rejects(check(),/source hash/i);await writeFile(pdf,source);
  await writeFile(metadataPath,JSON.stringify({...metadata,rightsReviewed:false}));
  const changed=await readFile(metadataPath);await assert.rejects(check({sourceMetadataSha256:sha(changed)}),/provenance/i);
  for(const license of ['',[],{}]){
    await writeFile(metadataPath,JSON.stringify({...metadata,license}));
    const bytes=await readFile(metadataPath);await assert.rejects(check({sourceMetadataSha256:sha(bytes)}),/provenance/i);
  }
});
