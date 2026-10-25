import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createDevelopmentAssets} from '../../apps/editor/stage.mjs';

test('editor development consumes the current source build rather than retired generated checkout files',async()=>{
 const {assets,evidence}=await createDevelopmentAssets();
 const metadata=assets.get('assets/js/build-meta.js').bytes.toString('utf8');
 const current=execFileSync('git',['rev-parse','--short=12','HEAD'],{encoding:'utf8'}).trim();
 assert.ok(metadata.includes(current));
 assert.ok(assets.get('index.html').bytes.toString('utf8').includes('shell/startup.js'));
 assert.ok(evidence.files.some(file=>file.sourcePath?.startsWith('shared/frontend/')));
 assert.ok([...assets.keys()].some(path=>path.startsWith('assets/worker-runtime/')));
 assert.ok(assets.has('assets/wasm/pandoeditor-core.wasm'));
});
