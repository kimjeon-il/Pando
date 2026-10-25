import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {ANCHORS,UNRESOLVED_BANKS,decimalDegrees,baikonurReference,writeReference}
 from '../../tools/gis/baikonur-official-reference.mjs';

test('treaty reference preserves 31 verified anchors and 29 unambiguous straight segments',()=>{
 const result=baikonurReference(),anchors=result.features.filter(x=>x.properties.kind==='official-anchor'),
   lines=result.features.filter(x=>x.properties.kind==='treaty-straight-segment');
 assert.equal(ANCHORS.length,31);
 assert.equal(anchors.length,31);
 assert.equal(lines.length,29);
 assert.deepEqual(anchors[0].geometry.coordinates,[63.01805556,45.70277778]);
 assert.deepEqual(anchors[16].geometry.coordinates,[63.72916667,45.73472222]);
 assert.deepEqual(anchors[30].geometry.coordinates,[63.21944444,45.6]);
 for(const [from,to] of UNRESOLVED_BANKS)
   assert.ok(!lines.some(x=>x.properties.fromPoint===from&&x.properties.toPoint===to));
 assert.ok(result.features.every(x=>['Point','LineString'].includes(x.geometry.type)));
});
test('original datum, treaty limitations and right bank remains explicitly unresolved',()=>{
 const p=baikonurReference().properties;
 assert.equal(p.openStreetMapDataUsed,false);
 assert.match(p.status,/INCOMPLETE/);
 assert.equal(p.sourceUrls.length,2);
 assert.equal(p.originalCoordinateDatum,'not explicitly verified');
 assert.deepEqual(p.rightBankNotReconstructed.map(x=>[x.fromPoint,x.toPoint]),[[17,18],[31,1]]);
 assert.equal(p.remaining.length,3);
});
test('DMS parser refuses invalid coordinates without guessing a datum',()=>{
 assert.equal(decimalDegrees('45 42 10'),45.70277778);
 for(const s of ['45 60 10','45 10 60','invalid','45 -1 1'])
   assert.throws(()=>decimalDegrees(s),/Invalid DMS/);
});
test('output is write-once and --check never modifies the original',t=>{
 const dir=mkdtempSync(join(tmpdir(),'baikonur-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'original.json');
 writeReference(file);
 const before=readFileSync(file,'utf8');
 assert.equal(writeReference(file,{check:true}).checked,true);
 assert.equal(readFileSync(file,'utf8'),before);
 assert.throws(()=>writeReference(file),/EEXIST/);
});
