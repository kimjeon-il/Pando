import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
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
test('preserved original inputs with invalid WGS84 topology cannot be written as candidates',
  {skip:!process.env.PANDO_GERMAN_COAST_SELECTED_ORACLE},()=>{
    const root=fileURLToPath(new URL('../../',import.meta.url));
    const name='build-native/territorial-recipe/coast-rejected-'+randomUUID();
    const output=name+'.geojson',diagnostics=name+'.json';
    assert.throws(()=>buildGermanModernCoast({root,output,diagnostics}),/invalid after WGS84 transformation/i);
    assert.equal(existsSync(resolve(root,output)),false);
    assert.equal(existsSync(resolve(root,diagnostics)),false);
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
