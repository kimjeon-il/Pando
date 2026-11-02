// Temporary producer coverage; remove the Python invocation when the generator is migrated.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';

const python=process.env.PANDO_HYDRO_NAME_PYTHON;
const aliasPath='assets/data/hydro/hydronym-ko-overrides.json';
const script=String.raw`
import ast,json,pathlib,re,sys
path=pathlib.Path('tools/build-hydro-tiles.py');tree=ast.parse(path.read_text(encoding='utf-8'))
names={'HYDRONYM_SUFFIX_RE','HYDRONYM_DUPLICATE_SUFFIX_RE','HYDRONYM_ENGLISH_SUFFIX_RE'}
assignments=[n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets)]
function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='normalize_hydronym')
module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*assignments,function],type_ignores=[])
ast.fix_missing_locations(module);scope={'re':re};exec(compile(module,str(path),'exec'),scope)
print(json.dumps([scope['normalize_hydronym'](row['name'],row['category'],row['overrides']) for row in json.load(sys.stdin)],ensure_ascii=False))
`;
function evaluate(rows){
  const run=spawnSync(python,['-X','utf8','-B','-c',script],{input:JSON.stringify(rows),encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);
}
test('remaining Python producer preserves Korean spacing, suffixes and placeholders',{skip:!python},()=>{
  const aliases={'사우스아랄씨':'남아랄해','노스아랄씨':'북아랄해','사우스아랄씨호':'남아랄해','노스아랄씨호':'북아랄해'};
  const rows=[...Object.keys(aliases).map(name=>({name,category:'lake',overrides:aliases,expected:aliases[name]})),
    {name:'세인트 폴 강',category:'river',overrides:{},expected:'세인트폴강'},
    {name:'레이크 위니페고시스',category:'lake',overrides:{},expected:'레이크위니페고시스호'},
    {name:'조지아 만',category:'lake',overrides:{},expected:'조지아만'},
    {name:'비스툴라 석호',category:'lake',overrides:{},expected:'비스툴라석호'},
    {name:'브라마푸트라강 / 얄룽창포강',category:'river',overrides:{},expected:'브라마푸트라강/얄룽창포강'},
    {name:'Example River',category:'river',overrides:{},expected:'Example'},
    {name:'미명명 수계 4',category:'river',overrides:{},expected:'미명명 수계 4'},
    {name:'Example',category:'river',overrides:{Example:'산타 마리아강'},expected:'산타마리아강'}];
  assert.deepEqual(evaluate(rows),rows.map(row=>row.expected));
});
test('remaining Python producer uses the mounted canonical Aral aliases',{skip:!python||!existsSync(aliasPath)},()=>{
  const overrides=JSON.parse(readFileSync(aliasPath,'utf8')).aliases;
  const pairs=[['사우스아랄씨','남아랄해'],['노스아랄씨','북아랄해'],['사우스아랄씨호','남아랄해'],['노스아랄씨호','북아랄해']];
  const rows=pairs.map(([name])=>({name,category:'lake',overrides}));
  assert.deepEqual(evaluate(rows),pairs.map(([,expected])=>expected));
});
