import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the Windows executable explicitly enables its embedded asset protocol',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../../apps/editor/package.json',import.meta.url),'utf8'));
  const command=pkg.scripts['build:windows'];
  assert.match(command,/--features(?:=|\s+)custom-protocol(?:\s|$)/,
    'a successful Cargo build without custom-protocol produces an EXE without its packaged index.html');
});
