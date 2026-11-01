import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nativeBuildArguments} from '../../apps/editor/native-producer.mjs';

test('the Windows executable explicitly enables its embedded asset protocol',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../../apps/editor/package.json',import.meta.url),'utf8'));
  const command=pkg.scripts['build:windows'];
  assert.match(command,/packaged-artifacts\.mjs\s+--fetch\s+--platform=windows\s+--mode=offline(?:\s|$)/);
  const args=nativeBuildArguments('windows','offline');
  assert.ok(args[args.indexOf('--features')+1].split(',').includes('custom-protocol'),
    'a successful Cargo build without custom-protocol produces an EXE without its packaged index.html');
});

