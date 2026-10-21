import {expect} from '@playwright/test';

/** Identical public UI workflow in Web and packaged WebView; no route overrides. */
export async function verifyKoreanBoundaryWorkflow(page,{screenshotPath}={}) {
  page.setDefaultTimeout(20000);
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120000});
  const lifetimes=[];
  for(const [id,from] of [['KOR','1948-08-15'],['PRK','1948-09-09']]){
    expect(await page.evaluate(id=>window.PANDOLAB_TERRITORIAL.select(id),id)).toBe(true);
    await expect(page.locator('#entityPeriodInput')).toHaveValue(`${from} ~`);
    lifetimes.push({id,from,displayed:await page.locator('#entityPeriodInput').inputValue()});
  }
  const before=await page.evaluate(()=>JSON.stringify(window.PANDOLAB_TERRITORIAL.get('KOR')));
  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#territorialLibraryModal')).toBeVisible();
  const search=page.locator('#territorialLibrarySearchInput');
  const date=page.locator('#territorialLibraryReferenceDateInput');
  const preview=page.locator('#territorialLibraryPreview [data-geometry-version-id]');
  const versions=[];
  for(const [id,name,start,cases] of [
    ['state:KOR','대한민국','1948-08-15',[
      ['1953-07-26','state:KOR:38th-parallel-1948'],['1953-07-27','state:KOR:armistice-1953']]],
    ['state:PRK','조선민주주의인민공화국','1948-09-09',[
      ['1953-07-26','state:PRK:38th-parallel-1948'],['1953-07-27','state:PRK:armistice-1953'],
      ['1964-03-19','state:PRK:armistice-1953'],['1964-03-20','state:PRK:sino-korean-protocol-1964']]],
  ]){
    await date.fill('');await search.fill(name);
    const row=page.locator(`[data-library-entity-id="${id}"]`);
    await row.click();
    await date.fill(start);
    await expect(preview).toHaveAttribute('data-geometry-version-id',cases[0][1]);
    await date.fill(start==='1948-08-15'?'1948-08-14':'1948-09-08');
    await expect(preview).toHaveCount(0);
    await expect(page.locator('#territorialLibraryAddBtn')).toBeDisabled();
    for(const [referenceDate,versionId] of cases){
      await date.fill(referenceDate);await row.click();
      await expect(preview).toHaveAttribute('data-geometry-version-id',versionId);
      const actual=await page.evaluate(async({id,referenceDate})=>{
        const {selectGeometryVersion}=await import('/assets/js/modules/territorial-library.js');
        const {createRingHitTester}=await import('/assets/js/modules/ring-hit-test.js');
        const source=await window.PANDOLAB_TERRITORIAL_LIBRARY.get(id);
        const version=selectGeometryVersion(source,referenceDate),rings=createRingHitTester(r=>r);
        const polygons=version.geometry.type==='Polygon'?[version.geometry.coordinates]:version.geometry.coordinates;
        const owns=point=>polygons.some(p=>rings.contains(point,p[0])&&!p.slice(1).some(h=>rings.contains(point,h)));
        return {id,referenceDate,versionId:version.versionId,gaeseong:owns([126.554,37.971]),
          sokcho:owns([128.59,38.2]),evidence:version.historicalProvenance};
      },{id,referenceDate});
      const pre=referenceDate<'1953-07-27';
      expect(actual.gaeseong).toBe(id==='state:KOR'?pre:!pre);
      expect(actual.sokcho).toBe(id==='state:KOR'?!pre:pre);
      expect(actual.versionId).toBe(versionId);
      if(id==='state:PRK')await expect(page.locator('#territorialLibraryPreview')).toContainText(
        referenceDate<'1964-03-20'?'북쪽 경계는 미복원 상태':'영토 차이는 미복원 상태');
      versions.push(actual);
    }
  }
  expect(await page.evaluate(()=>JSON.stringify(window.PANDOLAB_TERRITORIAL.get('KOR')))).toBe(before);
  if(screenshotPath)await page.screenshot({path:screenshotPath});
  return {url:page.url(),lifetimes,versions,projectPreserved:true,sourceOverrides:false};
}
