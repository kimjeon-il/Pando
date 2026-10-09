import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const path = p => new URL(p, root);
const json = p => JSON.parse(readFileSync(path(p), 'utf8'));

const base = 'tools/historical-library/sources/german-coastline/';
const catalog = json(base+'sh-wms-period-overlay-probe.json');
const audit = json(base+'sh-pre1914-era-screen-point-samples.json');
const coastBytes = readFileSync(path('tools/historical-library/working/german-empire-1914-base.geojson'));
const geometry = JSON.parse(coastBytes.toString('utf8')).features[0];
const workingSha = createHash('sha1').update(`blob ${coastBytes.length}\0`).update(coastBytes).digest('hex');
const largest = geometry.geometry.coordinates
  .map(p => p[0])
  .sort((a,b) => b.length-a.length)[0]; // working largest exterior ring, verified main coast

const pixelsPerDegree = audit.method.cssPixelsPerDegree;
const nearestPx = p => {
  const ax=p[0]*pixelsPerDegree,ay=p[1]*pixelsPerDegree;
  let best=Infinity;
  for(let i=1;i<largest.length;i++){
    const p0=largest[i-1],p1=largest[i];
    const x0=p0[0]*pixelsPerDegree,y0=p0[1]*pixelsPerDegree;
    const dx=(p1[0]-p0[0])*pixelsPerDegree,dy=(p1[1]-p0[1])*pixelsPerDegree;
    const n=dx*dx+dy*dy;
    const t=n?Math.max(0,Math.min(1,((ax-x0)*dx+(ay-y0)*dy)/n)):0;
    const delta=Math.hypot(ax-(x0+t*dx),ay-(y0+t*dy));
    if(delta<best)best=delta;
  }
  return best;
};

test('source rasters and all sample points never claim verified 1914 shoreline',()=>{
  assert.equal(geometry.properties.status,'working-base-modern-coast-not-final');
  assert.equal(catalog.independent1914ShorelineDigitized,false);
  assert.equal(catalog.actual1914PixelDisplacementMeasured,false);
  assert.equal(catalog.historicOverlayStopThresholdPassed,null);
  assert.equal(audit.independent1914DigitizedLine,false);
  assert.equal(audit.historicalAccuracyVerified,false);
  assert.equal(audit.actual1914MaxCssPx,null);
  assert.equal(audit.historicAccuracyStopCriterionPassed,null);
  assert.equal(audit.doNotChangeCountryGeometry,true);
  assert.ok(audit.visualPointSets.length>0);
  assert.ok(catalog.panels.length>0);
});

test('GIS source hashes, image BBOX and WMS provenance match the sample report',()=>{
  assert.equal(workingSha,audit.sourceGisModernGeometryBlobSha,
    'working modern coast changed: remeasure image points before reusing this report');
  assert.equal(catalog.ciRunId,audit.sourceGisRunId,
    'official map probe changed: recheck sample point provenance');
  for(const set of audit.visualPointSets){
    const panel=catalog.panels.find(x=>x.id===set.sector);
    assert.ok(panel,'missing WMS panel '+set.sector);
    assert.deepEqual(set.bboxLonLat,panel.bbox);
    const raster=panel.layerImages.find(x=>x.layerName===set.layerName);
    assert.ok(raster && raster.fetchStatus==='image-rendered');
    assert.equal(set.sourceWmsImageSha256,raster.sha256);
    assert.equal(set.sourceOriginalArtifact,raster.sourceImage);
    assert.equal(set.visualApproximationOnly,true);
    assert.equal(set.historical1914SheetDateVerified,false);
  }
});

test('sampled CSS px distances reproduce from actual working GeoJSON without fixed expected values',()=>{
  assert.ok(Math.abs(pixelsPerDegree-2560*64/360)<1e-6);
  for(const set of audit.visualPointSets){
    const {imageWidthPx,imageScale,topHeaderPx,rasterHeightPx}=set.referenceMapThumbnail;
    assert.equal(imageWidthPx,880);
    assert.ok(Math.abs(imageScale-880/1500)<1e-9);
    const bbox=set.bboxLonLat;
    let max=0;
    assert.ok(set.samples.length>0);
    for(const sample of set.samples){
      const [x,y]=sample.visualSampleThumbPx;
      const ll=[
        bbox[0]+x/imageWidthPx*(bbox[2]-bbox[0]),
        bbox[3]-(y-topHeaderPx)/rasterHeightPx*(bbox[3]-bbox[1])
      ];
      assert.ok(Math.abs(ll[0]-sample.approxLonLat[0])<1e-7);
      assert.ok(Math.abs(ll[1]-sample.approxLonLat[1])<1e-7);
      const value=nearestPx(ll);
      assert.ok(Math.abs(value-sample.distanceCssPx)<0.006,
        `stale sample ${set.sector}: ${value} vs ${sample.distanceCssPx}`);
      max=Math.max(max,value);
    }
    assert.ok(Math.abs(max-set.selectedMaximumCssPx)<0.011,
      'selected max must derive from inspected samples, not a fixed fabricated 1914 number');
  }
});
