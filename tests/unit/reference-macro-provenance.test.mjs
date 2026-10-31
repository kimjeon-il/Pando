import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rmdir,unlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {validateMacroProvenance} from '../../tools/reference-analysis/reviewed-corpus.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('macro training provenance binds source, scope, edition and renderer',async t=>{
  const root=await mkdtemp(join(tmpdir(),'pando-macro-proof-'));
  const pdf=join(root,'source.pdf'),metadataPath=join(root,'source.json');
  t.after(async()=>{await unlink(pdf);await unlink(metadataPath);await rmdir(root);});
  const source=Buffer.from('synthetic source');await writeFile(pdf,source);
  const sheet={id:'fixture',familyId:'family',editionId:'edition',duplicateGroup:'group',geographicScope:'country',scopeEvidence:'fixture',
    source:{url:'https://example.test/map',license:'fixture only'}};
  const metadata={...sheet,sha256:sha(source),url:sheet.source.url,license:sheet.source.license};
  const metadataBytes=Buffer.from(JSON.stringify(metadata));await writeFile(metadataPath,metadataBytes);
  const annotation={schemaVersion:1,reviewed:false,supervisionQuality:'source-derived-weak',sourcePdf:'source.pdf',sourceMetadata:'source.json',
    sourceSha256:sha(source),sourceMetadataSha256:sha(metadataBytes),
    producer:{script:'tools/reference-analysis/macro.py',sha256:'a'.repeat(64),renderer:'PyMuPDF',rendererVersion:'fixture'}};
  const check=(changes={})=>validateMacroProvenance({...annotation,...changes},sheet,root,{rendererVersion:'fixture'});
  await check();
  await assert.rejects(check({reviewed:true}),/provenance/i);
  await assert.rejects(check({producer:{...annotation.producer,sha256:'invalid'}}),/provenance/i);
  await assert.rejects(check({sourcePdf:'../outside.pdf'}),/corpus root/i);
  await writeFile(pdf,'changed');await assert.rejects(check(),/hash/i);await writeFile(pdf,source);
  await writeFile(metadataPath,JSON.stringify({...metadata,geographicScope:'invented'}));
  const changed=await readFile(metadataPath);await assert.rejects(check({sourceMetadataSha256:sha(changed)}),/scope/i);
});
