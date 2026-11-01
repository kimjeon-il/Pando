// Temporary integration coverage while the original Python producer remains.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const python=process.env.PANDO_HYDRO_CONNECTIVITY_PYTHON;
const native=process.env.PANDO_HYDRO_CONNECTIVITY_BINARY;
const integration=String.raw`
import copy,importlib.util,json,os,pathlib,sys
from unittest.mock import patch
tools=pathlib.Path('tools').resolve();sys.path.insert(0,str(tools))
import hydro_connectivity as connector
spec=importlib.util.spec_from_file_location('hydro_test_builder',tools/'build-hydro-tiles.py')
builder=importlib.util.module_from_spec(spec);sys.modules[spec.name]=builder;spec.loader.exec_module(builder)
parts={1:[dict(fid=1,part=0,points=[[0,0],[1,0]],aligned=False,system='10')],
       2:[dict(fid=2,part=0,points=[[1.002,0],[2,0]],aligned=True,system='10')],
       3:[dict(fid=3,part=0,points=[[0,1],[1,0]],aligned=False,system='10')]}
raw={1:dict(region='eu',next=2,start=[0,0],end=[1,0]),2:dict(region='eu',next=0,start=[1,0],end=[2,0]),
     3:dict(region='eu',next=2,start=[0,1],end=[1,0])}
original=copy.deepcopy(raw)
assert len(connector.audit_parts(parts,raw)['issues'])==2
reversed_parts=dict(reversed(list(copy.deepcopy(parts).items())))
reversed_raw=dict(reversed(list(raw.items())))
assert connector.repair_connections_native(reversed_parts,reversed_raw,'as')==[]
connector.repair_connections_native(reversed_parts,reversed_raw,'eu')
with patch.dict(os.environ,{},clear=True):
    try: connector.audit_parts(parts,raw);raise AssertionError('missing binary accepted')
    except RuntimeError as error: assert 'PANDO_HYDRO_CONNECTIVITY_BINARY' in str(error)
with patch.object(connector,'run_native',return_value={'regions':{n:{} for n in connector.ORDER},'issues':[{'source':999}]}):
    try: connector.audit_parts(parts,raw);raise AssertionError('invalid issue accepted')
    except ValueError as error: assert 'issue' in str(error)
def reach(source):
    return builder.RiverReach(source,raw[source]['next'],10,0,5,100,1000,1,1,
        [copy.deepcopy(parts[source][0]['points'])],border_pair=('A','B') if source==2 else None)
chains=[[reach(1)],[reach(2)],[reach(3)]]
report=builder.normalize_network_connections(chains,raw,'eu')
assert report['changedPorts']==2 and report['remaining']==[]
assert chains[0][0].parts[0][-1]==chains[1][0].parts[0][0]
assert len(connector.repair_connections_native(parts,raw,'eu'))==2
assert parts==reversed_parts
assert not connector.audit_parts(parts,raw)['issues'] and not connector.repair_connections_native(parts,raw,'eu')
assert raw==original
print(json.dumps({'generatorConnected':True,'originalsPreserved':True}))
`;
test('remaining Python generator uses the native connector and rejects invalid results',{skip:!python||!native},()=>{
  const run=spawnSync(python,['-B','-c',integration],{encoding:'utf8',windowsHide:true,timeout:120000});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),{generatorConnected:true,originalsPreserved:true});
});
