import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const dependencies = [
  read('../../../assets/js-vendor/d3.min.js'),
  read('../../../src/geometry/workers/geographic-boundary-core.js'),
  read('../../../src/rendering/workers/canvas-scene-composition-core.js'),
  read('../../../src/rendering/workers/canvas-terrain-dem-core.js'),
  read('../../../src/rendering/workers/terrain-tile-selection-core.js'),
  read('../../../src/runtime/resource-dependency-policy.js').replaceAll('export function ', 'function ')
    + '\nglobalThis.PandoLabResourceUpdatePolicy={resourceKey,resourceUpdate};',
].join('\n;\n');
// Expose a narrow synthetic tile fixture inside the real renderer closure. All
// conversion, projection, mask clipping and composition use production code.
const fixture = `self.paintNumericalFixture = async heightMeters => {
  canvas=new OffscreenCanvas(128,64); context=canvas.getContext('2d');
  terrainDemManifest={gutter:1};
  const encoded=heightMeters+12000,dem=new Uint8ClampedArray(6*4*4);
  for(let i=0;i<dem.length;i+=4) dem.set([encoded>>8,encoded&255,212,255],i);
  const colors=self.PandoLabCanvasTerrainDem.convertTile({dem,width:6,height:4});
  const tile={lastUsed:0,raw:dem,width:6,height:4};
  for(const channel of ['land','ocean','political']) tile[channel]=await createImageBitmap(new ImageData(colors[channel],6,4));
  demTiles.set('test',tile);
  const packet={role:'physical-land',polygonOffsets:new Uint32Array([0,1]),ringOffsets:new Uint32Array([0,5]),
    ringCoordinates:new Float64Array([-20,-20,-20,20,20,20,20,-20,-20,-20])};
  const projection=self.d3.geo.equirectangular().scale(128/(2*Math.PI)).translate([64,32]).center([0,0]);
  const message={projection:'flat',physicalSettings:{terrainVisible:true,terrainStyle:'physical'},scenePolygons:[packet]};
  const plan={terrainComplete:true,demLevel:{id:0},demSpecs:[{key:'test',bounds:[-180,90,180,-90],pixelWidth:4,pixelHeight:2}]};
  plan.drawSpecs=plan.demSpecs;
  for(const step of renderTerrain(message,projection,128,64,1,plan)) { }
  const pixel=(x,y)=>Array.from(context.getImageData(x,y,1,1).data);
  const result={land:pixel(64,32),ocean:pixel(30,32),beyondCoast:pixel(73,32),
    numericDestinationPixels:numericalPixels,
    expectedLand:Array.from(colors.land.slice(0,4)),expectedOcean:Array.from(colors.ocean.slice(0,4))};
  // Four adjacent numeric tiles meet off the pixel grid. White underneath
  // exposes any fractional edge hole independently of the DEM's own colors.
  context.setTransform(1,0,0,1,0,0);context.fillStyle='#ffffff';context.fillRect(0,0,128,64);
  projection.translate([63.25,31.25]);
  for(const bounds of [[-180,90,0,0],[0,90,180,0],[-180,0,0,-90],[0,0,180,-90]])
    drawFlatTerrainTile({bounds,pixelWidth:4,pixelHeight:2},tile.ocean,projection,1);
  result.seams=[[10,31],[63,10],[63,31],[64,32]].map(point=>pixel(...point));
  // Target-level colors must remain opaque over older cached coverage.
  drawFlatTerrainTile({bounds:[-180,90,0,0],pixelWidth:4,pixelHeight:2},tile.land,projection,1);
  result.promoted=pixel(62,30);
  return result;
};
`;
const renderer = read('../../../src/rendering/workers/canvas-render-core.js')
  .replace('self.onmessage = event => {', fixture + 'self.onmessage = event => {')
  .replace("if (typeof document === 'undefined' && typeof importScripts === 'function') {", 'if (false) {');

for (const mode of ['worker', 'inline']) {
  test(`numerical DEM uses physicalLand coverage in ${mode} Canvas`, async ({ page }) => {
    await page.goto('about:blank');
    const results = await page.evaluate(async ({ dependencies, renderer, mode }) => {
      const bootstrap = `const dispose=PandoLabCanvasRenderer.install({
        location:{href:'https://example.test/assets/js/workers/canvas-render-worker.js'},
        d3,OffscreenCanvas,PandoLabGeographicBoundary,PandoLabCanvasSceneComposition,
        PandoLabCanvasTerrainDem,PandoLabTerrainTileSelection,PandoLabResourceUpdatePolicy,
        postMessage() {},set onmessage(value) {},
        set paintNumericalFixture(value) { globalThis.paintFixture=value; }
      });`;
      if (mode === 'inline') {
        (0, eval)(dependencies + '\n;' + renderer + '\n;' + bootstrap
          + '\nglobalThis.disposeFixture=dispose;');
        try { const rows=[]; for (const height of [-4000,4000]) rows.push(await globalThis.paintFixture(height)); return rows; }
        finally { globalThis.disposeFixture(); }
      }
      const code = dependencies + '\n;' + renderer + '\n;' + bootstrap
        + '\n(async()=>{try {const rows=[];for(const h of [-4000,4000])rows.push(await paintFixture(h));postMessage({rows});}catch(error){postMessage({error:error.stack});}finally{dispose();}})();';
      const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url);
      try { return await new Promise((resolve,reject)=>{
        worker.onmessage=event=>event.data.error?reject(new Error(event.data.error)):resolve(event.data.rows);
        worker.onerror=event=>reject(new Error(event.message));
      }); } finally {worker.terminate();URL.revokeObjectURL(url);}
    }, { dependencies, renderer, mode });
    for (const result of results) {
      expect(result.numericDestinationPixels).toBeGreaterThan(0);
      expect(result.land).toEqual(result.expectedLand);
      expect(result.ocean).toEqual(result.expectedOcean);
      expect(result.beyondCoast).toEqual(result.expectedOcean);
      for(const pixel of result.seams)expect(pixel).toEqual(result.expectedOcean);
      expect(result.promoted).toEqual(result.expectedLand);
    }
  });
}
