import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('bundled Pretendard font bytes and OFL license remain immutable',()=>{
 const font=readFileSync(new URL('../../shared/frontend/static/fonts/pretendard-v1.3.9/PretendardVariable.woff2',import.meta.url));
 const digest=createHash('sha256').update(font).digest('hex');
 assert.equal(digest,'9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4');
 const license=readFileSync(new URL('../../shared/frontend/static/fonts/pretendard-v1.3.9/LICENSE.txt',import.meta.url),'utf8');
 assert.match(license.toUpperCase(),/SIL OPEN FONT LICENSE/);
});
