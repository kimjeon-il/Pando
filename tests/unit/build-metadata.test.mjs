import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {frontendFixture} from '../helpers/frontend-build-fixture.mjs';
import {buildFrontendSnapshot} from '../../scripts/lib/frontend-build.mjs';

test('published metadata follows immutable pinned manifests and preserves unarchived runtime edits',async t=>{
 const f=frontendFixture(t),data=join(f.root,'.library-data/repository'),sha=b=>createHash('sha256').update(b).digest('hex');
 f.put('.library-data/repository/archive/index.json','{}');
 const git=(...args)=>execFileSync('git',['-c','core.fsync=none','-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:data,encoding:'utf8',stdio:'pipe'}).trim();git('init','-q');
 const pin=()=>{const files={};for(const [path,value]of Object.entries(f.metadata)){const bytes=Buffer.from(JSON.stringify(value));f.put('.library-data/repository/'+path,bytes);files[path]={stored:path,encoding:'identity',bytes:bytes.length,sha256:sha(bytes)};}f.put('.library-data/repository/archive/index.json',JSON.stringify({files}));git('add','.');git('commit','-qm','data pin');f.put('config/library-data.json',JSON.stringify({repository:'test/library',revision:git('rev-parse','HEAD'),mounts:['assets/data']}));};
 pin();const options={root:f.root,sourceCommit:'a'.repeat(40)},before=await buildFrontendSnapshot(options);
 f.put('assets/data/builtin-world/generated/v1/index.json','unfinished local edits');
 const same=await buildFrontendSnapshot(options);assert.equal(same.dataRevision,before.dataRevision);assert.equal(same.sourceSha256,before.sourceSha256);
 f.metadata['assets/data/builtin-world/generated/v1/index.json'].revision=2;pin();const after=await buildFrontendSnapshot(options);assert.notEqual(after.dataRevision,before.dataRevision);assert.notEqual(after.sourceSha256,before.sourceSha256);
 const entry=after.buildMeta.builtinWorld,bytes=Buffer.from(JSON.stringify(f.metadata['assets/data/builtin-world/generated/v1/index.json']));assert.equal(entry.sha256,sha(bytes));assert.equal(entry.decodedBytes,bytes.length);
 writeFileSync(join(data,'assets/data/world/current.json'),'changed'); // archived git objects remain canonical
 assert.equal((await buildFrontendSnapshot(options)).sourceSha256,after.sourceSha256);
});
