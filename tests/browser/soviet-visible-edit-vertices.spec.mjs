import { gotoEditor, setEditorMonth } from './helpers/editor-entry.mjs';
import { expect, test } from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

test.use({viewport:{width:1440,height:900},trace:'off'});

test('enumerate visible editable 1989 Soviet coastline vertices and nearby source geometry before choosing a valid UI test target',async({page})=>{
  test.setTimeout(180000);
  await gotoEditor(page, '/?debug=1&renderer=webgl2');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness','enhanced',{timeout:120000});
  await page.locator('#flatBtn').evaluate(button=>button.click());
  await setEditorMonth(page, '1989-06');
  await expect.poll(()=>page.evaluate(()=>!!window.PANDOLAB_TERRITORIAL.get('state:soviet-union')),
    {timeout:90000}).toBe(true);
  await page.evaluate(()=>window.PANDOLAB_TERRITORIAL.select('state:soviet-union'));
  await page.locator('#focusSelectedObjectBtn').evaluate(button=>button.click());
  await page.locator('#actionsTabBtn').evaluate(button=>button.click());
  await expect(page.locator('#editEntityCoastBtn')).toBeEnabled({timeout:60000});
  await page.locator('#editEntityCoastBtn').evaluate(button=>button.click());
  await expect(page.locator('#modePrimaryBtn')).toHaveAttribute('aria-label','수정 완료',{timeout:120000});
  await expect.poll(()=>page.locator('.country-vertex:not(.fixed-boundary-vertex)').count(),{timeout:90000}).toBeGreaterThan(0);
  const result=await page.evaluate(()=>{
    const geometry=window.PANDOLAB_TERRITORIAL.get('state:soviet-union').geometry;
    const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const viewport=document.querySelector('#map').getBoundingClientRect();
    const list=[...document.querySelectorAll('.country-vertex:not(.fixed-boundary-vertex)')];
    const samples=[];
    for(const node of list) {
      const b=node.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
      if(!b.width||x<viewport.left+10||x>viewport.right-10||y<viewport.top+20||y>viewport.bottom-20
        ||document.elementFromPoint(x,y)!==node)continue;
      const d=node.__data__,p=d?.coordinate;
      if(!Array.isArray(p))continue;
      const edges=(d.segments||[]).map(e=>{
        const other=e.start[0]===p[0]&&e.start[1]===p[1]?e.end:e.start;
        return {dx:other[0]-p[0],dy:other[1]-p[1],other};
      });
      const ring=polys[d.polygonIndex]?.[d.ringIndex];
      const idx=ring?.findIndex(v=>v[0]===p[0]&&v[1]===p[1]);
      let turn=null,sign=null,neighbors=null;
      if(ring?.length>3 && idx>=0) {
        const length=ring.length-1,a=ring[(idx-1+length)%length],b=ring[idx],c=ring[(idx+1)%length];
        const ab=[b[0]-a[0],b[1]-a[1]],bc=[c[0]-b[0],c[1]-b[1]];
        turn=ab[0]*bc[1]-ab[1]*bc[0];
        let area=0;for(let i=1;i<ring.length;i++)area+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];
        sign=Math.sign(area);
        neighbors=[a,c];
      }
      samples.push({coordinate:p,screen:[Math.round(x),Math.round(y)],
        polygonIndex:d.polygonIndex,ringIndex:d.ringIndex,vertexIndex:d.index,nodeKey:d.nodeKey,
        score:Math.min(...edges.map(e=>e.dx**2+e.dy**2)),
        turn,sign,convex:turn!=null&&sign!=null?turn*sign>0:null,
        neighbors});
    }
    const sea=samples.filter(s=>s.coordinate[0]>139&&s.coordinate[0]<178&&s.coordinate[1]>=42&&s.coordinate[1]<=70);
    const farEast=sea.filter(s=>s.coordinate[0]>=150&&s.coordinate[1]>=48&&s.coordinate[1]<=65);
    const sort=arr=>[...arr].sort((a,b)=>b.score-a.score);
    return {rendered:list.length,clickable:samples.length,seaCount:sea.length,farEastCount:farEast.length,
      currentWinner:sort(samples)[0],highScoreFarEast:sort(farEast).slice(0,30),
      highScoreSea:sort(sea).slice(0,30),
      longitudeClusters:Object.fromEntries(Array.from({length:9},(_,i)=>{
        const lo=125+i*6;return [lo+'..'+(lo+6),samples.filter(s=>s.coordinate[0]>=lo&&s.coordinate[0]<lo+6).length];
      }))};
  });
  await mkdir('test-results/soviet-coast-vertices',{recursive:true});
  await writeFile('test-results/soviet-coast-vertices/measurement.json',JSON.stringify(result,null,2)+'\n');
  console.log('OBJ098_VISIBLE_SEA_VERTICES',JSON.stringify(result));
  expect(result.clickable).toBeGreaterThan(30);
});
