import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root=new URL('../../',import.meta.url);
const parse=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const dir='tools/historical-library/';
const source=parse(dir+'sources/german-coastline/cecilienkoog-1905-dyke-manual-source.json');
const catalogue=parse(dir+'sources/german-coastline/change-events.json');
const probe=parse(dir+'sources/german-coastline/sh-coast-microtile-source-probe.json');
const geo=parse(dir+'working/german-empire-1914-cecilienkoog-1905-seaward-dyke-candidate.geojson');
const qa=parse(dir+'working/german-empire-1914-cecilienkoog-1905-seaward-dyke-candidate.qa.json');

test('source images, traced LINE and measurement QA share real provenance',()=>{
  const tile=probe.tiles.find(x=>x.id===source.source.microtileId);
  assert.ok(tile);
  const layer=tile.layers.find(x=>x.layer===source.source.layerName);
  assert.ok(layer);
  assert.deepEqual(tile.bbox,source.source.bboxLonLat);
  assert.equal(layer.rasterSha256,source.source.imageSha256);
  assert.equal(layer.status,'raster-obtained');
  assert.equal(source.manualRasterPoints.length,geo.features[0].geometry.coordinates.length);
  assert.equal(geo.features[0].geometry.type,'LineString');
  assert.equal(qa.sourceOriginalRasterSha256,layer.rasterSha256);
  assert.equal(qa.traceVertexCount,geo.features[0].geometry.coordinates.length);
  assert.ok(qa.traceApproxLengthMetres>0);
  const w=source.traceImageFrame.thumbnailWidthPx,h=source.traceImageFrame.thumbnailHeightPx;
  const [west,south,east,north]=tile.bbox;
  for(let i=0;i<source.manualRasterPoints.length;i++){
    const [x,y]=source.manualRasterPoints[i];
    assert.ok(x>=0 && x<w && y>=0 && y<h);
    const ll=[west+x/(w-1)*(east-west),north-y/(h-1)*(north-south)];
    const out=geo.features[0].geometry.coordinates[i];
    assert.ok(Math.abs(out[0]-ll[0])<5e-9 && Math.abs(out[1]-ll[1])<5e-9,
      'candidate must be derived from raster source pixels, not manually changed GEOJSON');
  }
});

test('independent chronology does not promote WMS dyke to historical legal coastline',()=>{
  const c=catalogue.events.find(x=>x.id==='cecilienkoog-1903-1905');
  const n=catalogue.events.find(x=>x.id==='soenke-nissen-koog-1924-1926');
  const g=catalogue.events.find(x=>x.id==='galmsbuell-summer-koog-1913');
  const winter=catalogue.events.find(x=>x.id==='galmsbuell-winter-dyke-1933-1939');
  assert.ok(c&&n&&g&&winter);
  assert.ok(c.datedWorks.endYear<1914);
  assert.ok(n.datedWorks.startYear>1914);
  assert.ok(g.datedWorks.startYear<=1914 && winter.datedWorks.startYear>1914);
  assert.ok(c.evidence.sourceIds.includes('reussenkoege-cecilien'));
  assert.ok(n.evidence.sourceIds.includes('reussenkoege-sonke'));
  for(const x of [c,n,g,winter]){
    assert.equal(x.geometry.status,'not-digitized');
    assert.equal(x.datedWorks.exactCoastlineSwitchDate,null);
  }
  assert.equal(geo.features[0].properties.notAHistoricalLegalSeaCoast,true);
  assert.equal(geo.features[0].properties.doNotPromote,true);
  assert.equal(geo.features[0].properties.isNotCountryPolygon,true);
  assert.equal(source.validation.actual1914TideDefinedShorelineDigitized,false);
  assert.equal(source.validation.independentlyKnown1914MapSheetRevision,false);
  assert.equal(qa.historicallyVerified1914Geometry,false);
  assert.equal(qa.screenSpace.notFullBidirectionalShorelineHausdorff,true);
  assert.equal(qa.screenSpace.notMeasured1914ToPresentShorelineDeviation,true);
  assert.equal(qa.shouldUpdateMasterOrTimeline,false);
});
