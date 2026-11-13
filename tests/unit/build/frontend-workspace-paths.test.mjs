import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {root,defaultRecipe} from '../../../tools/build/build-territorial-geometry.mjs';
import {parseArgs} from '../../../tools/gis/inspect-world-data.mjs';
const repository=fileURLToPath(new URL('../../../',import.meta.url));
test('moved geometry tool resolves recipe from checkout instead of tools directory',()=>{
 assert.equal(root,resolve(repository));
 assert.equal(defaultRecipe,resolve(repository,'tools/historical-library/east-germany-1989.recipe.json'));
 assert.ok(existsSync(resolve(root,'config/library-data.json')));
});
test('world inspector default data directory is the checkout data mount',()=>{
 assert.equal(parseArgs(['--country','DEU']).dataDir,resolve(repository,'assets/data'));
});
