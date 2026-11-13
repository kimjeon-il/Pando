import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('polar coverage permits only numerical epsilon and rejects nodata, outliers and nonfinite values',()=>{
  const path=fileURLToPath(new URL('../../../tools/gis/build-natural-observed-preview.py',import.meta.url));
  const code=`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('natural_preview',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
check=m.check_polar_coverage_bounds
valid=[check(0.0,1.0,True),check(-1e-8,1+1.1920928955078125e-7,True)]
rejected=0
for values in [(0,255,True),(-0.01,1,True),(0,1.001,True),(float('nan'),1,False),(0,float('inf'),False)]:
 try:check(*values)
 except ValueError:rejected+=1
assert rejected==5
print(json.dumps({'valid':len(valid),'rejected':rejected,'epsilon':valid[0]['roundoffTolerance']}))`;
  const result=JSON.parse(execFileSync('python3',['-c',code,path],{encoding:'utf8',timeout:10000}));
  assert.deepEqual(result,{valid:2,rejected:5,epsilon:1e-6});
});
