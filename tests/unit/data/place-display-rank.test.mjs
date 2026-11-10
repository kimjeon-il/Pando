import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLACE_RANK_MODEL, placeDistanceKm, displayNeighbourhoodCandidates,
  scorePlacePopulationAndSpacing, generateApprovedPlaceDisplayRanks,
} from '../../../tools/build/place-display-rank.mjs';

const city = (id, coordinates, population, featureCode='PPL') => ({
  id:'geonames:'+id, coordinates, population, featureCode,
});

test('the core population signal grows independently of administration code',()=>{
  const small=city('1',[0,0],50000),large=city('2',[0,0],10000000);
  const a=scorePlacePopulationAndSpacing(small,[small]);
  const b=scorePlacePopulationAndSpacing(large,[large]);
  assert.ok(b.populationScore>a.populationScore);
  assert.ok(b.priority>a.priority);
  assert.ok(b.tier<a.tier);
});

test('nearby competing cities penalize a dense city while remoteness rewards an equally populated one',()=>{
  const subject=city('1',[0,0],200000),surrounding=Array.from({length:12},(_,i)=>
    city(String(i+2),[(i%4)*0.08,Math.floor(i/4)*0.06],250000));
  const crowded=scorePlacePopulationAndSpacing(subject,[subject,...surrounding]);
  const remote=scorePlacePopulationAndSpacing(subject,[subject]);
  assert.ok(crowded.crowdingPenalty>remote.crowdingPenalty);
  assert.ok(crowded.isolationBonus<remote.isolationBonus);
  assert.ok(crowded.score<remote.score);
  assert.ok(crowded.tier>=remote.tier);
});

test('spatial distance is symmetric, date line safe and independent of modern administrative role',()=>{
  assert.equal(placeDistanceKm([127,37],[127,37]),0);
  assert.ok(Math.abs(placeDistanceKm([179.9,0],[-179.9,0])-22.24)<1);
  const rows=[
    city('1',[0,0],80000,'PPLC'),
    city('2',[2,0],80000,'PPL'),
    city('3',[3,0],0,'PPLA2'),
    city('4',[4,0],49999,'PPL'),
  ];
  assert.deepEqual(displayNeighbourhoodCandidates(rows).map(row=>row.id),
    ['geonames:1','geonames:2']);
  const left=scorePlacePopulationAndSpacing(rows[0],[rows[0]]);
  const right=scorePlacePopulationAndSpacing(rows[1],[rows[1]]);
  assert.equal(left.score,right.score,'the feature code must not directly decide the rank');
});

test('the five output zoom bands and release identity mapping are deterministic',()=>{
  const rows=[city('10',[0,0],12000000,'PPLA'),city('20',[4,0],1500000,'PPLC'),
    city('30',[50,0],60000,'PPL')];
  const published=rows.map(row=>({sourceId:row.id.split(':')[1]}));
  const a=generateApprovedPlaceDisplayRanks(published,rows,'f'.repeat(64));
  const b=generateApprovedPlaceDisplayRanks(published,rows,'f'.repeat(64));
  assert.deepEqual(a,b);
  assert.deepEqual(Object.keys(a.entries),['10','20','30']);
  assert.ok(Object.values(a.entries).every(row=>row.tier>=1&&row.tier<=5&&
    row.minZoom===PLACE_RANK_MODEL.tierMinZoom[row.tier-1]));
  assert.throws(()=>generateApprovedPlaceDisplayRanks([{sourceId:'999'}],rows,'f'.repeat(64)),
    /No source population/);
});
