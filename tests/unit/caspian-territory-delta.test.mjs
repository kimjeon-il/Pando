import test from 'node:test';
import assert from 'node:assert/strict';
import '../../shared/frontend/js/vendor/polygon-clipping.min.js';
import {adjustGeometry,splitVersion} from '../../tools/gis/caspian-territory-delta.mjs';
const pc=globalThis.polygonClipping;
const box=(x,y,X,Y)=>({type:'Polygon',coordinates:[[[x,y],[X,y],[X,Y],[x,Y],[x,y]]]});
const mp=g=>g.type==='Polygon'?[g.coordinates]:g.coordinates;
const empty=(a,b)=>assert.deepEqual(pc.xor(mp(a),mp(b)),[]);
test('subtracts increased water and adds assigned exposed land in actual polygon',()=>{
 const result=adjustGeometry(box(0,0,4,4),box(2,0,4,4),box(4,0,5,4),null,pc);
 empty(result,{type:'MultiPolygon',coordinates:[box(0,0,2,4).coordinates,box(4,0,5,4).coordinates]});
});
test('removes only specified neighbor overlap and preserves detached pieces',()=>{
 const result=adjustGeometry(box(0,0,4,4),box(10,10,11,11),{type:'MultiPolygon',coordinates:[]},box(3,0,4,4),pc);
 empty(result,box(0,0,3,4));
});
test('splits an unbounded source around water and border windows',()=>{
 const old={versionId:'modern',validFrom:null,validTo:null,geometry:box(0,0,4,4),certainty:'high'};
 const result=splitVersion(old,[{from:'1922-01-01',to:'1929-12-31',tag:'water'},{from:'1922-12-30',to:'1925-05-12',tag:'border'}],(g,t)=>({...g,tags:t}));
 assert.deepEqual(result.map(v=>[v.validFrom,v.validTo,v.geometry.tags||[]]),[[null,'1921-12-31',[]],['1922-01-01','1922-12-29',['water']],['1922-12-30','1925-05-12',['water','border']],['1925-05-13','1929-12-31',['water']],['1930-01-01',null,[]]]);
 assert.equal(result.at(-1).versionId,'modern');
 assert.deepEqual(result.at(-1).geometry,old.geometry);
});
test('does not extend reviewed republic coverage or alter later geometry',()=>{
 const geometry=box(0,0,4,4);let calls=0;
 const input={versionId:'reviewed',validFrom:'1922-12-30',validTo:'1925-05-12',geometry};
 const output=splitVersion(input,[{from:'1922-01-01',to:'1929-12-31',tag:'water'}],g=>{calls++;return g;});
 assert.equal(output.length,1);assert.equal(calls,1);assert.equal(output[0].validFrom,input.validFrom);assert.equal(output[0].validTo,input.validTo);
 const late={...input,versionId:'late',validFrom:'1991-01-01',validTo:'1991-12-24'};
 assert.deepEqual(splitVersion(late,[{from:'1922-01-01',to:'1929-12-31',tag:'water'}],()=>{throw Error('must not modify late');}),[late]);
});
test('scoped source delta preserves existing compiled exclusions outside changed region',async()=>{
 const {regenerateGeometry}=await import('../../tools/gis/caspian-territory-delta.mjs');
 const result=regenerateGeometry(box(0,0,4,4),box(0,0,3,4),box(1,0,4,4),pc);
 empty(result,box(1,0,3,4));
});
