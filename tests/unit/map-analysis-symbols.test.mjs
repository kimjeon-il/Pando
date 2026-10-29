import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferenceImagePlaceSeeds,
  buildReferenceImagePlaceSymbolCandidates,
  findReferenceImagePointSymbol,
  findReferenceImagePointSymbolNearTextBox,
  referenceImagePointRasterFromRgba,
} from '../../plugins/pando-map-tools/lib/analysis/symbols.mjs';

test('analysis RGBA pixels are converted to the point detector luminance contract',()=>{
  const width=120,height=100,data=new Uint8Array(width*height*4).fill(255);
  for(let y=40;y<=46;y++) for(let x=64;x<=70;x++) if((x-67)**2+(y-43)**2<=9) {const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=25;}
  const raster=referenceImagePointRasterFromRgba({width,height,data});
  const result=findReferenceImagePointSymbol(raster,[62/119,46/99],{searchRadiusPx:14});
  assert.ok(result);
  assert.ok(Math.abs(result.pixel[0]-67)<.2);
});

function makeRaster(width = 120, height = 100, background = 236) {
  return { width, height, luma: new Uint8Array(width * height).fill(background) };
}

function fillDisk(raster, cx, cy, radius, value) {
  for (let y = Math.max(0, cy - radius); y <= Math.min(raster.height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(raster.width - 1, cx + radius); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        raster.luma[y * raster.width + x] = value;
      }
    }
  }
}

test('point-symbol detector snaps from an approximate city position to a compact map dot', () => {
  const raster = makeRaster();
  fillDisk(raster, 67, 43, 3, 25);
  const expectedUv = [62 / (raster.width - 1), 46 / (raster.height - 1)];
  const result = findReferenceImagePointSymbol(raster, expectedUv, { searchRadiusPx: 14 });
  assert.ok(result);
  assert.ok(Math.abs(result.pixel[0] - 67) < 0.2);
  assert.ok(Math.abs(result.pixel[1] - 43) < 0.2);
  assert.ok(result.confidence > 0.55);
  assert.equal(result.polarity, 'dark');
});

test('point-symbol detector ignores elongated linework in the search window', () => {
  const raster = makeRaster();
  for (let x = 45; x <= 75; x += 1) raster.luma[50 * raster.width + x] = 20;
  const result = findReferenceImagePointSymbol(raster, [60 / 119, 50 / 99], { searchRadiusPx: 18 });
  assert.equal(result, null);
});

test('point-symbol detector separates a dark city dot from connected pale cartographic linework',()=>{
  const raster=makeRaster();
  for(let x=0;x<raster.width;x++)raster.luma[50*raster.width+x]=130;
  fillDisk(raster,60,50,3,20);
  const result=findReferenceImagePointSymbol(raster,[60/119,50/99],{searchRadiusPx:18});
  assert.ok(result);
  assert.ok(Math.hypot(result.pixel[0]-60,result.pixel[1]-50)<.3);
});

test('OCR symbol search excludes neighbouring labels as well as the current label',()=>{
  const raster=makeRaster(180,100,240);
  fillDisk(raster,61,49,3,70);
  fillDisk(raster,90,31,3,20); // A round glyph in another OCR line.
  const box=[68/179,40/99,46/179,18/99];
  const result=findReferenceImagePointSymbolNearTextBox(raster,box,{
    searchRadiusPx:18,textBoxes:[box,[85/179,26/99,12/179,12/99]],
  });
  assert.ok(result);assert.ok(Math.hypot(result.pixel[0]-61,result.pixel[1]-49)<.3);
});

test('OCR symbol search leaves a distant unrelated dot unresolved',()=>{
  const raster=makeRaster(180,100,240);
  fillDisk(raster,90,77,3,20);
  const result=findReferenceImagePointSymbolNearTextBox(raster,[68/179,40/99,46/179,18/99],{searchRadiusPx:32});
  assert.equal(result,null);
});

test('equally adjacent pale fragments do not outrank a high-contrast city dot',()=>{
  const raster=makeRaster(180,100,240);
  fillDisk(raster,61,49,3,20);
  fillDisk(raster,121,49,2,140);
  const result=findReferenceImagePointSymbolNearTextBox(raster,[68/179,40/99,46/179,18/99],{searchRadiusPx:24});
  assert.ok(result);assert.ok(Math.hypot(result.pixel[0]-61,result.pixel[1]-49)<.3);
});

test('a rejected distant dot cannot hide a valid adjacent lower-contrast symbol',()=>{
  const raster=makeRaster(180,100,240);
  fillDisk(raster,61,49,3,100);
  const box=[68/179,40/99,46/179,18/99],options={searchRadiusPx:32,minimumConfidence:.4};
  assert.ok(findReferenceImagePointSymbolNearTextBox(raster,box,options));
  fillDisk(raster,52,49,3,20);
  const result=findReferenceImagePointSymbolNearTextBox(raster,box,options);
  assert.ok(result);assert.ok(Math.hypot(result.pixel[0]-61,result.pixel[1]-49)<.3);
});

test('place candidate builder de-duplicates two place seeds that snap to the same symbol', () => {
  const raster = makeRaster();
  fillDisk(raster, 40, 45, 3, 30);
  fillDisk(raster, 85, 55, 3, 35);
  const seeds = [
    { id: 'berlin', name: 'Berlin', expectedUv: [38 / 119, 44 / 99], coordinate: [13.4, 52.5], priority: 90, kind: 'capital' },
    { id: 'berlin-duplicate', name: 'Berlin alt', expectedUv: [42 / 119, 46 / 99], coordinate: [13.41, 52.51], priority: 20, kind: 'city' },
    { id: 'leipzig', name: 'Leipzig', expectedUv: [82 / 119, 57 / 99], coordinate: [12.37, 51.34], priority: 70, kind: 'city' },
  ];
  const result = buildReferenceImagePlaceSymbolCandidates(raster, seeds, {
    searchRadiusPx: 12,
    dedupeRadiusPx: 5,
  });
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.some(candidate => candidate.id === 'berlin'));
  assert.ok(result.candidates.some(candidate => candidate.id === 'leipzig'));
  assert.ok(result.misses.some(item => item.reason === 'duplicate-symbol'));
});

test('point-symbol detector can also find a compact light symbol on a dark local background', () => {
  const raster = makeRaster(90, 90, 28);
  fillDisk(raster, 45, 48, 3, 230);
  const result = findReferenceImagePointSymbol(raster, [43 / 89, 45 / 89], { searchRadiusPx: 12 });
  assert.ok(result);
  assert.equal(result.polarity, 'light');
  assert.ok(result.confidence > 0.5);
});


test('place seed builder ranks supported city kinds and converts map positions into image UVs', () => {
  const places = [
    { id: 'village', name: 'Village', kind: 'region', coordinates: [9, 49], priority: 99, population: 1000 },
    { id: 'berlin', name: 'Berlin', kind: 'capital', coordinates: [13.4, 52.5], priority: 90, population: 3_000_000 },
    { id: 'leipzig', name: 'Leipzig', kind: 'city', coordinates: [12.37, 51.34], priority: 70, population: 600_000 },
    { id: 'town', name: 'Town', kind: 'town', coordinates: [11, 50], priority: 20, population: 20_000 },
  ];
  const seeds = buildReferenceImagePlaceSeeds(places, {
    projectCoordinate: coordinate => [coordinate[0] * 2, coordinate[1] * 2],
    hitTestUv: screen => [screen[0] / 40, screen[1] / 120],
    maximumSeeds: 2,
  });
  assert.deepEqual(seeds.map(seed => seed.id), ['berlin', 'leipzig']);
  assert.ok(seeds.every(seed => seed.expectedUv.every(value => value > 0 && value < 1)));
});


test('OCR text-box refinement finds an adjacent city symbol rather than a glyph inside the label', () => {
  const raster = makeRaster(180, 100, 240);
  // Fake text strokes inside the OCR box.
  for (let x = 70; x <= 110; x += 4) {
    for (let y = 42; y <= 55; y += 1) raster.luma[y * raster.width + x] = 30;
  }
  // Actual city dot just left of the label.
  fillDisk(raster, 61, 49, 3, 20);
  const box = [68 / 179, 40 / 99, 46 / 179, 18 / 99];
  const result = findReferenceImagePointSymbolNearTextBox(raster, box, { searchRadiusPx: 18 });
  assert.ok(result);
  assert.ok(Math.abs(result.pixel[0] - 61) < 0.3);
  assert.ok(Math.abs(result.pixel[1] - 49) < 0.3);
});
