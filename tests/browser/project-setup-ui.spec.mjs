import {test} from '@playwright/test';import {verifyProjectSetupUi} from './helpers/project-setup-ui.mjs';
test.use({hasTouch:true,viewport:{width:1440,height:900}});test('project setup preserves BCE settings, navigation range',async({page})=>{test.setTimeout(180000);await verifyProjectSetupUi(page,{url:'/?debug=1&demTerrain=raster'});});
