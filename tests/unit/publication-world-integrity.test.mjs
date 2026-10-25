import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseVerifiedWorldBundle } from "../../shared/frontend/js/modules/world-bundle-manifest.js";

const bytes = readFileSync(new URL('../../assets/data/world/current.json', import.meta.url));
const spec = { sha256: createHash('sha256').update(bytes).digest('hex'), compressedBytes: bytes.length,
  decodedBytes: bytes.length, encoding: 'identity' };

test('published world manifest is admitted only when its exact bytes match the release receipt', async () => {
  const admitted = await parseVerifiedWorldBundle(bytes, spec);
  assert.equal(admitted.countryCount, 258);
  await assert.rejects(parseVerifiedWorldBundle(Buffer.concat([bytes, Buffer.from(' ')]), spec), /무결성|크기/);
});
