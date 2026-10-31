import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {buildGermanModernCoast,selectModernCoastCountries} from '../../tools/gis/build-german-1914-base.mjs';

const geometry={type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,0]]]};
const countries=()=>({type:'FeatureCollection',features:['DEU','DNK','POL','RUS','LTU'].map(id=>({id,properties:{},geometry}))});

test('modern coast selection accepts original country aliases and requires all five',()=>{
  const input=countries();input.features[0]={id:'other',properties:{name:'Deutschland'},geometry};
  assert.equal(selectModernCoastCountries(input).length,5);
  input.features.pop();
  assert.throws(()=>selectModernCoastCountries(input),/incomplete/i);
});
test('preserved original inputs produce a protected, explicitly repaired candidate',
  {skip:!process.env.PANDO_GERMAN_COAST_SELECTED_ORACLE},t=>{
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const name='build-native/territorial-recipe/coast-rejected-'+randomUUID();
    const output=name+'.geojson',diagnostics=name+'.json';
    const result=buildGermanModernCoast({root,output,diagnostics});
    t.after(()=>{for(const path of [output,diagnostics])rmSync(resolve(root,path));});
    assert.equal(result.validation.geographicRepaired,true);
    assert.ok(result.validation.repairBoundaryDistanceMetres<0.01);
    assert.equal(result.historicalGeometryApproved,false);
    assert.equal(JSON.parse(readFileSync(resolve(root,output))).features[0].geometry.type,'MultiPolygon');
    assert.equal(JSON.parse(readFileSync(resolve(root,diagnostics))).validation.geographicRepaired,true);
    assert.throws(()=>buildGermanModernCoast({root,output,diagnostics}),/already exists/i);
  });
test('modern coast refuses existing and escaping candidate outputs before reading sources',()=>{
  const root=mkdtempSync(join(tmpdir(),'pando-modern-coast-'));
  try{
    const target=join(root,'existing.json');writeFileSync(target,'preserve');
    assert.throws(()=>buildGermanModernCoast({root,output:'existing.json',diagnostics:'diagnostics.json',binary:'unused'}),/already exists/i);
    assert.throws(()=>buildGermanModernCoast({root,output:'../escape.json',diagnostics:'diagnostics.json',binary:'unused'}),/escaped/i);
    assert.throws(()=>buildGermanModernCoast({root,output:'same.json',diagnostics:'same.json',binary:'unused'}),/coincide/i);
  }finally{rmSync(root,{recursive:true});}
});
