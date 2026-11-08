import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEditorChild,cacheDirectories,assertOffline,sqliteProof,compactDatabase,discoverProfile,confirmRecovery,checkedConsumers} from '../../tools/pc-cleanup.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync,readFileSync,linkSync,symlinkSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditFileAllocation} from '../../tools/pc-file-allocation.mjs';
import {previewGeneratedCleanup,applyGeneratedCleanup} from "../../tools/data/worktree-generated.mjs";
import {contentHash} from "../../tools/data/library-content.mjs";
import {randomBytes} from 'node:crypto';

test('profile classification separates generated outputs, originals and keys',()=>{
 assert.equal(classifyEditorChild('android/user'),'preserve');
 assert.equal(classifyEditorChild('android/sdk'),'delete');
 assert.equal(classifyEditorChild('integration-cc1dae8-release-20261002/source'),'relocate');
 assert.equal(classifyEditorChild('integration-cc1dae8-release-20261002/build'),'delete');
 assert.equal(classifyEditorChild('integration-cc1dae8-release-20261002/test.log'),'relocate');
 assert.equal(classifyEditorChild('m91-source'),'preserve');
 assert.equal(classifyEditorChild('unexpected/new-source'),'preserve');
 assert.ok(cacheDirectories('C:/profile').every(p=>!/Cookies|IndexedDB|Local Storage|ms-playwright|codex-runtimes/.test(p)));
 assert.ok(cacheDirectories('C:/profile').some(p=>p.replaceAll('\\','/').endsWith('pandolab-release-20261021/native-profile-packaged/EBWebView/Default/Cache')));
 assert.ok(cacheDirectories('C:/profile').some(p=>p.replaceAll('\\','/').endsWith('Packages/OpenAI.Codex_2p2nqsd0c76g0/LocalCache/Roaming/Codex/Cache')));
});
test('offline guard rejects live Codex and Edge without stopping them',()=>{
 for(const Name of ['Codex.exe','codex.exe','msedge.exe'])assert.throws(()=>assertOffline([{Name,ProcessId:123}]),/Close/);
 assert.doesNotThrow(()=>assertOffline([{Name:'node.exe',ProcessId:456}]));
});
test('offline guard excludes only the verified Windows Search WebView process tree',()=>{
 const parent={Name:'SearchHost.exe',ProcessId:1,ExecutablePath:join(process.env.SystemRoot||'C:/Windows','SystemApps/MicrosoftWindows.Client.CBS_cw5n1h2txyewy/SearchHost.exe')};
 const profile=join(homedir(),'AppData/Local/Packages/MicrosoftWindows.Client.CBS_cw5n1h2txyewy/LocalState/EBWebView');
 const browser={Name:'msedgewebview2.exe',ProcessId:2,ParentProcessId:1,CommandLine:'msedgewebview2.exe --webview-exe-name=SearchHost.exe --user-data-dir="'+profile+'"'};
 const child={Name:'msedgewebview2.exe',ProcessId:3,ParentProcessId:2,CommandLine:'msedgewebview2.exe --type=renderer'};
 assert.doesNotThrow(()=>assertOffline([parent,browser,child]));
 for(const changed of [
  [{...parent,ExecutablePath:'C:/other/SearchHost.exe'},browser,child],
  [parent,{...browser,CommandLine:'msedgewebview2.exe --user-data-dir="C:/other"'},child],
  [parent,{...browser,ParentProcessId:99},child],
  [parent,browser,{...child,CommandLine:'msedgewebview2.exe --user-data-dir="C:/other"'}],
  [parent,browser,child,{Name:'msedgewebview2.exe',ProcessId:4,ParentProcessId:99}],
  [parent,browser,child,{Name:'Codex.exe',ProcessId:5}],
 ])assert.throws(()=>assertOffline(changed),/Close/);
});
test('discovery keeps active scopes, personal Temp files, Playwright installs and persistent browser data',t=>{
 const home=mkdtempSync(join(tmpdir(),'pc-policy-'));t.after(()=>rmSync(home,{recursive:true,force:true}));
 const put=path=>{mkdirSync(join(home,path,'..'),{recursive:true});writeFileSync(join(home,path),'bytes');};
 for(const path of ['AppData/Local/Temp/unknown.gpkg','AppData/Local/Temp/pando-viewer-assets-closed/x','AppData/Local/ms-playwright/chromium-1234/x','AppData/Roaming/Codex/web/Codex/Default/Cookies','AppData/Roaming/Codex/web/Codex/Default/Cache/x','AppData/Local/Pandoeditor/android/user/debug.keystore'])put(path);
 const policy=discoverProfile({home,library:join(home,'library'),offline:true,processes:[{Name:'node.exe',CommandLine:join(home,'AppData/Local/Temp/pando-viewer-assets-closed')}]});
 assert.ok(policy.preserved.some(p=>p.reason.includes('active process')));
 assert.equal(policy.requests.length,1);assert.ok(policy.requests[0].root.endsWith('Cache'));
});
test('incremental SQLite maintenance preserves schema, keys, rows and blob bytes; backup survives until restart confirmation',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-sqlite-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'sample.sqlite'),recovery=join(root,'backup.sqlite'),receipt=join(root,'receipt.json');
 const db=new DatabaseSync(path);db.exec('PRAGMA auto_vacuum=INCREMENTAL; VACUUM; PRAGMA journal_mode=WAL; CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, payload BLOB);');
 const insert=db.prepare('INSERT INTO t VALUES(?,?,?)');for(let i=0;i<1200;i++)insert.run(i,'한글'+i,Buffer.alloc(4096,i%255));
 db.exec('DELETE FROM t WHERE id>9; PRAGMA wal_checkpoint(TRUNCATE)');const before=sqliteProof(db);db.close();
 let interrupted=false;
 await assert.rejects(compactDatabase({path,recovery,receipt,guard:()=>{},afterBatch:()=>{if(!interrupted){interrupted=true;throw Error('interrupt');}}}),/interrupt/);
 const result=await compactDatabase({path,recovery,receipt,guard:()=>{}});
 assert.equal(result.proof.logicalSha256,before.logicalSha256);assert.ok(result.after.freePages<result.before.freePages);assert.ok(existsSync(recovery));
 const read=new DatabaseSync(path,{readOnly:true});assert.deepEqual(sqliteProof(read),before);read.close();
});
test('SQLite writer lock aborts without changing the original',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-sqlite-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'x.sqlite');
 const db=new DatabaseSync(path);db.exec('PRAGMA auto_vacuum=INCREMENTAL; VACUUM; PRAGMA journal_mode=WAL; CREATE TABLE x(id PRIMARY KEY); BEGIN IMMEDIATE; INSERT INTO x VALUES(1)');
 await assert.rejects(compactDatabase({path,recovery:join(root,'backup'),receipt:join(root,'receipt'),guard:()=>{}}),/locked|busy/i);db.exec('ROLLBACK');db.close();
});
test('changed recovery backup is rejected on resume with source bytes retained',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-sqlite-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const path=join(root,'x.sqlite'),recovery=join(root,'backup'),receipt=join(root,'receipt');
 const db=new DatabaseSync(path);db.exec('PRAGMA auto_vacuum=INCREMENTAL; VACUUM; CREATE TABLE x(a BLOB); INSERT INTO x VALUES(zeroblob(65536)); DELETE FROM x');db.close();
 await assert.rejects(compactDatabase({path,recovery,receipt,guard:()=>{},afterBatch:()=>{throw Error('interrupt');}}),/interrupt/);
 const source=readFileSync(path);writeFileSync(recovery,'altered backup');
 await assert.rejects(compactDatabase({path,recovery,receipt,guard:()=>{}}),/changed/);assert.deepEqual(readFileSync(path),source);
});
test('interruption after SQLite backup resumes the owned recovery copy',async t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-sqlite-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path=join(root,'x.sqlite'),recovery=join(root,'backup'),receipt=join(root,'receipt');
 const db=new DatabaseSync(path);db.exec('PRAGMA auto_vacuum=INCREMENTAL; VACUUM; CREATE TABLE x(id PRIMARY KEY); INSERT INTO x VALUES(42)');db.close();
 await assert.rejects(compactDatabase({path,recovery,receipt,guard:()=>{},afterBackup:()=>{throw Error('interrupt after backup');}}),/interrupt/);
 const result=await compactDatabase({path,recovery,receipt,guard:()=>{}});assert.equal(result.phase,'verified-awaiting-reopen');
});
test('NTFS allocation audit counts selected hardlink data once and retains outside links',{skip:process.platform!=='win32'},t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-allocation-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 writeFileSync(join(root,'a'),randomBytes(65536));linkSync(join(root,'a'),join(root,'b'));
 const manifest=join(root,'manifest.json'),audit=entries=>{writeFileSync(manifest,JSON.stringify({entries:entries.map(path=>({root,path,action:'delete'}))}));return auditFileAllocation(manifest);};
 const one=audit(['a']),two=audit(['a','b']);assert.equal(one.reclaimableAllocation,0);assert.equal(two.uniqueFileIds,1);assert.equal(two.reclaimableAllocation,two.selectedUniqueAllocation);assert.ok(two.reclaimableAllocation>0);
 const long='long/'.repeat(60)+'allocation.bin';mkdirSync(join(root,long,'..'),{recursive:true});writeFileSync(join(root,long),randomBytes(4096));assert.equal(audit([long]).files,1);
});
test('restarting an automation browser after online preview blocks saved Temp scopes',t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-owner-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const path='playwright-artifacts-finished/x';mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),'cache');
 const options={roots:[root],compilerScopes:[{root,kind:'pc-temp'}],requests:[{root,path:'playwright-artifacts-finished',action:'delete',reason:'ended automation output'}]},manifest=previewGeneratedCleanup(options);
 assert.throws(()=>applyGeneratedCleanup({...options,manifest,refreshConsumers:()=>checkedConsumers({policy:options,offline:false,processes:[{Name:'chrome.exe',CommandLine:'chrome.exe'}]})}),/browser|owner/i);assert.ok(existsSync(join(root,path)));
});
test('Codex restarted after offline preview blocks cache deletion without path arguments',t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-owner-'));t.after(()=>rmSync(root,{recursive:true,force:true}));writeFileSync(join(root,'cache'),'bytes');
 const options={roots:[root],compilerScopes:[{root,kind:'pc-cache'}],requests:[{root,path:'cache',action:'delete',reason:'closed app cache'}]},manifest=previewGeneratedCleanup(options);
 assert.throws(()=>applyGeneratedCleanup({...options,manifest,refreshConsumers:()=>checkedConsumers({policy:options,offline:true,processes:[{Name:'codex.exe',CommandLine:'codex.exe'}]})}),/Close/);assert.ok(existsSync(join(root,'cache')));
});
test('active Pando test server blocks retirement of its temporary fixtures',()=>{
 const policy={requests:[{root:'C:/Users/example/AppData/Local/Temp',path:'pando-viewer-assets-case'}]};
 assert.throws(()=>checkedConsumers({policy,offline:true,processes:[{Name:'node.exe',CommandLine:'node tests/browser/server.mjs'}]}),/test|owner/i);
});
test('Qt editor owner blocks its saved cache scope even when executable lives on D',()=>{
 const policy={requests:[{root:'C:/Users/example/AppData/Local/Pandoeditor',path:'cache'}]};
 assert.throws(()=>checkedConsumers({policy,offline:false,processes:[{Name:'Pandoeditor.exe',ExecutablePath:'D:/apps/Pandoeditor.exe'}]}),/Qt|owner/i);
});
test('backup confirmation rejects a junction even when original DB has matching bytes',t=>{
 const root=mkdtempSync(join(tmpdir(),'pc-confirm-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const directory=join(root,'maintenance'),originals=join(root,'originals');mkdirSync(directory);mkdirSync(originals);writeFileSync(join(originals,'state_5.sqlite'),'original DB');
 symlinkSync(originals,join(directory,'db-backups'),process.platform==='win32'?'junction':'dir');
 writeFileSync(join(directory,'state_5.sqlite.receipt.json'),JSON.stringify({phase:'verified-awaiting-reopen',recovery:join(directory,'db-backups/state_5.sqlite'),backupSha256:contentHash(Buffer.from('original DB'))}));
 assert.throws(()=>confirmRecovery(directory),/link|reparse/i);assert.equal(readFileSync(join(originals,'state_5.sqlite'),'utf8'),'original DB');
});
