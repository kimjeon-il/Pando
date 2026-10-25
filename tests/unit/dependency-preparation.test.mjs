import test from 'node:test';
import assert from 'node:assert/strict';
import {dependencyPreparationArguments} from '../../tools/worktree-storage.mjs';
test('dependency preparation uses graph sharing while preserving separate project links',()=>{
 const args=dependencyPreparationArguments({root:'D:/dev/worktrees/ui',store:'D:/build/cache/pandolab/pnpm/store'});
 assert.ok(args.includes('--config.enableGlobalVirtualStore=true'));assert.ok(args.includes('--store-dir=D:/build/cache/pandolab/pnpm/store'));assert.ok(args.includes('--frozen-lockfile'));assert.equal(args.includes('--ignore-workspace'),false);
});
