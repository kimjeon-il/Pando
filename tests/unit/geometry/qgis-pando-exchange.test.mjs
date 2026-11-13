import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import test from 'node:test';
import {createNodeCoreProject} from "../../helpers/core-project.mjs";
import {startupDocument} from "../../helpers/core-startup.mjs";
import {normalizeGenericFeatureSemantics} from "../../../src/document/generic-feature-normalization.js";
import { qgisFixture as original } from "../../fixtures/qgis/pando.mjs";

test('QGIS JSON fields reach the actual Core with atomic Undo and preserved source geometry', async t => {
  const foreign = structuredClone(original);
  for (const feature of foreign.features) feature.properties.source = JSON.stringify(feature.properties.source);
  const folder = mkdtempSync(join(tmpdir(), 'pando-qgis-test-'));
  try {
    const input = join(folder, 'qgis.geojson'), output = join(folder, 'pando.geojson');
    writeFileSync(input, JSON.stringify(foreign));
    execFileSync(process.execPath, ['tools/qgis/normalize.mjs', input, '--output', output], { stdio: 'pipe' });
    const collection = JSON.parse(readFileSync(output));
    let count = 0;
    const f=await createNodeCoreProject(startupDocument());
    t.after(()=>f.dispose());
    const features=collection.features.map(feature=>normalizeGenericFeatureSemantics({...feature,id:'00000000-0000-4000-8000-'+String(++count).padStart(12,'0')}));
    const ack=await f.project.executeCommand({commandId:'generic.import',targets:features.map(({id})=>({domain:'generic',id})),payload:{features}});
    assert.equal(ack.ok,true,JSON.stringify(ack.error));
    const imported = f.documentModel.list('generic');
    assert.equal(imported.length, 2);
    for (let i = 0; i < imported.length; i++) {
      assert.notEqual(imported[i].id, original.features[i].id);
      assert.deepEqual(imported[i].geometry, original.features[i].geometry);
      assert.equal(imported[i].properties.source.sourceId, original.features[i].properties.source.sourceId);
      assert.deepEqual(imported[i].properties.source.details, original.features[i].properties.source.details);
    }
    assert.equal(await f.project.undo(), true);
    assert.equal(f.documentModel.list('generic').length, 0);
    assert.equal(await f.project.redo(), true);
    assert.equal(f.documentModel.list('generic').length, 2);
  } finally {
    const child = relative(resolve(tmpdir()), resolve(folder));
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
    rmSync(folder, { recursive: true });
  }
});
