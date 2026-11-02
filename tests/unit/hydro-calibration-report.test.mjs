import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {renderCalibrationReport,writeCalibrationReport} from '../../tools/gis/hydro-calibration-report.mjs';

const cases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-report-oracle.json',import.meta.url),'utf8'));
test('calibration report preserves Python results for pass and failure cases',()=>{
  for(const {input,expectedPrefix} of cases){
    const output=renderCalibrationReport(input);
    assert.equal(output.split('## 재현 방법')[0],expectedPrefix);
    assert.match(output,/node tools\/gis\/hydro-calibration-report\.mjs/);
    assert.doesNotMatch(output,/python tools\/calibrate-hydro\.py/i);
  }
});
test('report CLI renders results and refuses to overwrite existing evidence',t=>{
  const root=mkdtempSync(join(tmpdir(),'hydro-calibration-report-'));t.after(()=>rmSync(root,{recursive:true}));
  const input=join(root,'results.json'),output=join(root,'report.md');writeFileSync(input,JSON.stringify(cases[0].input));
  const args=['tools/gis/hydro-calibration-report.mjs','--input',input,'--output',output];
  const first=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  assert.equal(readFileSync(output,'utf8'),renderCalibrationReport(cases[0].input));
  const second=spawnSync(process.execPath,args,{encoding:'utf8'});assert.notEqual(second.status,0);
  assert.equal(readFileSync(output,'utf8'),renderCalibrationReport(cases[0].input));
});
test('calibration report refuses non-finite measurements instead of publishing them',()=>{
  const invalid=structuredClone(cases[0].input);invalid.worldEstimate.gzipMiB=NaN;
  assert.throws(()=>renderCalibrationReport(invalid),/finite/i);
});
test('report output cannot target runtime assets',t=>{
  const root=mkdtempSync(join(tmpdir(),'hydro-report-assets-'));t.after(()=>rmSync(root,{recursive:true}));
  const assets=join(root,'assets','data');mkdirSync(assets,{recursive:true});
  const input=join(root,'results.json');writeFileSync(input,JSON.stringify(cases[0].input));
  assert.throws(()=>writeCalibrationReport({root,input,output:join(assets,'report.md')}),/outside runtime assets/i);
});
