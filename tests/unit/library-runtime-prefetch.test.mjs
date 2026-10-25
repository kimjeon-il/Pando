import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {prefetchArchiveEntries} from '../../tools/library-data.mjs';

test('runtime preparation removes repeated fetched objects while preserving mixed-pack originals',t=>{
  const base=mkdtempSync(join(tmpdir(),'pando-prefetch-dedup-'));
  t.after(()=>rmSync(base,{recursive:true,force:true}));
  const remote=join(base,'remote'),checkout=join(base,'partial');mkdirSync(remote);
  const git=(cwd,args,input)=>execFileSync('git',['-c','core.autocrlf=false','-c','gc.auto=0',...args],{cwd,input,encoding:'utf8',env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:'pipe'}).trim();
  git(remote,['init','-q']);git(remote,['config','user.name','Test']);git(remote,['config','user.email','test@example.invalid']);
  mkdirSync(join(remote,'archive'));
  const a=randomBytes(256*1024),b=Buffer.concat([a,Buffer.from('new edition')]);
  writeFileSync(join(remote,'archive/a'),a);writeFileSync(join(remote,'archive/b'),b);
  git(remote,['add','.']);git(remote,['commit','-qm','delta-related originals']);git(remote,['repack','-adf']);
  git(remote,['config','uploadpack.allowFilter','true']);git(remote,['config','uploadpack.allowAnySHA1InWant','true']);
  git(base,['clone','--filter=blob:none','--no-checkout',pathToFileURL(remote).href,checkout]);
  const revision=git(checkout,['rev-parse','HEAD']),refs=git(checkout,['show-ref']);
  const unreachable=git(checkout,['hash-object','-w','--stdin'],'unreferenced original');
  for(const name of ['b','a'])prefetchArchiveEntries({checkout,revision,entries:[{stored:'archive/'+name,bytes:name==='a'?a.length:b.length}]});
  const packRoot=join(checkout,'.git/objects/pack');
  // A received pack may repeat existing bases and also contain unique objects.
  const oids=['a','b'].map(name=>git(checkout,['rev-parse',revision+':archive/'+name]));
  const pack=git(checkout,['pack-objects',join(packRoot,'pack')],[...oids,unreachable].join('\n')+'\n');
  writeFileSync(join(packRoot,'pack-'+pack+'.promisor'),'');
  assert.equal(prefetchArchiveEntries({checkout,revision,entries:[{stored:'archive/a',bytes:a.length}]}).fetched,0);
  const ids=readdirSync(packRoot).filter(n=>n.endsWith('.idx')).flatMap(n=>git(checkout,['show-index'],readFileSync(join(packRoot,n))).split('\n').map(line=>line.split(' ')[1]));
  assert.equal(ids.length,new Set(ids).size,'fetched delta bases already stored locally must not remain in another pack');
  assert.equal(git(checkout,['show-ref']),refs);
  assert.equal(git(checkout,['cat-file','-p',unreachable]),'unreferenced original');
  for(const [name,bytes] of [['a',a],['b',b]])assert.deepEqual(execFileSync('git',['--no-lazy-fetch','show',revision+':archive/'+name],{cwd:checkout}),bytes);
});
test('runtime preparation fetches pinned blobs together without hydrating reports or moving refs',t=>{const base=mkdtempSync(join(tmpdir(),'pando-prefetch-'));t.after(()=>rmSync(base,{recursive:true,force:true}));const remote=join(base,'remote'),checkout=join(base,'partial');mkdirSync(remote);const git=(cwd,...args)=>execFileSync('git',['-c','core.fsync=none',...args],{cwd,encoding:'utf8',stdio:'pipe'}).trim();git(remote,'init','-q');git(remote,'config','user.name','Test');git(remote,'config','user.email','test@example.invalid');mkdirSync(join(remote,'archive'));for(const name of ['one','two','report'])writeFileSync(join(remote,'archive',name),name);git(remote,'add','.');git(remote,'commit','-qm','fixture');git(remote,'config','uploadpack.allowFilter','true');git(remote,'config','uploadpack.allowAnySHA1InWant','true');git(base,'clone','--filter=blob:none','--no-checkout',pathToFileURL(remote).href,checkout);const revision=git(checkout,'rev-parse','HEAD'),oids=['one','two','report'].map(name=>git(remote,'rev-parse','HEAD:archive/'+name));const exists=oid=>spawnSync('git',['cat-file','-e',oid],{cwd:checkout,env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:'ignore'}).status===0;assert.equal(exists(oids[0]),false);const result=prefetchArchiveEntries({checkout,revision,entries:[{stored:'archive/one',bytes:3},{stored:'archive/two',bytes:3}]});assert.equal(result.fetched,2);assert.equal(exists(oids[0]),true);assert.equal(exists(oids[1]),true);assert.equal(exists(oids[2]),false);assert.equal(git(checkout,'rev-parse','HEAD'),revision);});
