import {test,expect} from '@playwright/test';

test.use({viewport:{width:1280,height:800},trace:'retain-on-failure'});

// The published historical world has one Serbia-Montenegro predecessor in
// 2005 and independent Serbia/Montenegro objects from 2006 onwards.
test('P4-4 actual country birth and extinction refresh map selection and open search',async({page})=>{
  test.setTimeout(170000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date(2026,9,31,12));
  await page.goto('/?debug=1');
  const ready=page.locator('#viewerStatus');
  await expect(ready).toHaveAttribute('data-ready','true',{timeout:100000});
  async function go(year){
    await page.locator('#timelineDateButton').click();
    await page.locator('#timelineYearInput').fill(String(year));
    await page.locator('#timelineGoBtn').click();
    await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.builtinMonth().month),
      {timeout:85000}).toBe(year+'-12');
    await expect(ready).toHaveAttribute('data-ready','true',{timeout:20000});
  }
  const ids=()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentSnapshot().territorialEntities.map(row=>row.id));
  await go(2005);
  expect(await ids()).toContain('state:yugoslavia');
  expect(await ids()).not.toContain('MNE');
  await page.locator('#objectSearchBtn').click();
  await page.locator('#objectSearchInput').fill('세르비아 몬테네그로');
  await expect(page.locator('#objectSearchResults [data-object-search-select][data-item-id="state:yugoslavia"]'))
    .toBeVisible({timeout:20000});
  await page.locator('#objectSearchResults [data-object-search-select][data-item-id="state:yugoslavia"]').click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.selectionSnapshot().items.map(item=>item.id)))
    .toContain('state:yugoslavia');

  await go(2006);
  const currentIds=await ids();
  expect(currentIds).not.toContain('state:yugoslavia');
  expect(currentIds).toContain('MNE');
  expect(currentIds).toContain('SRB');
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.selectionSnapshot().items.map(item=>item.id)))
    .not.toContain('state:yugoslavia');
  await page.locator('#objectSearchBtn').click();
  await expect(page.locator('#objectSearchResults [data-object-search-select][data-item-id="state:yugoslavia"]'))
    .toHaveCount(0,{timeout:20000});
  await page.locator('#objectSearchInput').fill('몬테네그로');
  const newRow=page.locator('#objectSearchResults [data-object-search-select][data-item-id="MNE"]');
  await expect(newRow).toBeVisible({timeout:20000});
  await newRow.click();
  await expect.poll(()=>page.evaluate(()=>window.__PANDOLAB_VIEWER__?.selectionSnapshot().items.map(item=>item.id)))
    .toContain('MNE');
  expect(await page.evaluate(()=>window.__PANDOLAB_VIEWER__.documentState().timelineCursor)).toBe('2006-12');
  expect(errors).toEqual([]);
});
