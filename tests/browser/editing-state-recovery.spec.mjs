import {test} from '@playwright/test';
import {verifyEditingRecovery} from './helpers/editing-state-recovery.mjs';
test.use({hasTouch:true,viewport:{width:1440,height:900}});
for (const renderer of ['webgl2','canvas']) test(renderer+' boundary draft preserves context, return, local Undo and atomic project recovery', async ({page}) => {
  test.setTimeout(180000);
  await verifyEditingRecovery(page, {url:'/?debug=1&demTerrain=raster&renderer='+renderer});
});
