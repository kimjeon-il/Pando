// Temporary coverage for the remaining Python caller; retire with that caller.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import test from 'node:test';

const python=process.env.PANDO_HYDRO_CALIBRATION_PYTHON;
const cases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-chain-oracle.json',import.meta.url),'utf8'));
const script=String.raw`
import ast,json,pathlib,subprocess,sys,types
path=pathlib.Path('tools/calibrate-hydro.py').resolve()
parsed=ast.parse(path.read_text(encoding='utf-8'))
fn=next(n for n in parsed.body if isinstance(n,ast.FunctionDef) and n.name=='chain_rivers')
module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),fn],type_ignores=[])
ast.fix_missing_locations(module)
scope={'__file__':str(path),'Path':pathlib.Path,'json':json,'subprocess':subprocess}
exec(compile(module,str(path),'exec'),scope)
results=[]
for row in json.load(sys.stdin):
    features=[types.SimpleNamespace(source_id=x['id'],next_down=x['next'],assigned_stage=x['stage'],source_coordinate_count=x['coordinateCount']) for x in row['features']]
    results.append(scope['chain_rivers'](features))
print(json.dumps(results))
`;
test('remaining Python calibration caller uses source-matched native chain results',{skip:!python},()=>{
  const run=spawnSync(python,['-B','-c',script],{input:JSON.stringify(cases),encoding:'utf8',windowsHide:true,timeout:120000});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),cases.map(row=>row.expected));
  const missing=spawnSync(python,['-B','-c',script],{input:JSON.stringify([cases[1]]),encoding:'utf8',windowsHide:true,timeout:30000,
    env:{...process.env,PANDO_HYDRO_CALIBRATION_ARTIFACT:resolve('build-native/hydro-calibration/absent-artifact')}});
  assert.notEqual(missing.status,0);assert.match(missing.stderr,/Native Hydro calibration failed/i);
});

// Keep exercising the actual remaining Python score implementation until it is
// replaced, without importing the GIS libraries or scanning real source data.
test('remaining Python river score uses flow and upstream area fields',{skip:!python},()=>{
  const scoreScript=String.raw`
import ast,json,math,pathlib,types
path=pathlib.Path('tools/calibrate-hydro.py')
tree=ast.parse(path.read_text(encoding='utf-8'))
cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='LinearFeature')
fn=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='score')
module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),fn],type_ignores=[])
ast.fix_missing_locations(module)
scope={'math':math};exec(compile(module,str(path),'exec'),scope)
feature=types.SimpleNamespace(order=5,flow=100.0,upstream_area=1000.0)
print(json.dumps(scope['score'](feature,1.3,0.7)))
`;
  const run=spawnSync(python,['-B','-c',scoreScript],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(run.status,0,run.stderr);
  assert.ok(Math.abs(JSON.parse(run.stdout)-(5+1.3*Math.log10(100)+0.7*Math.log10(1000)))<1e-12);
});

const historicalReport=resolve('reports/hydro-calibration/results.json');
test('existing historical calibration report respects its river candidate floor',
  {skip:!existsSync(historicalReport)},()=>{
    const river=JSON.parse(readFileSync(historicalReport,'utf8')).formula.rivers;
    assert.ok(Math.min(...Object.values(river.thresholds))>=river.candidateFloor);
  });
