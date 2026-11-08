// Render the analysis report without changing any runtime Hydro assets.
import {pythonRound} from './hydro-numeric.mjs';
import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {basename,dirname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual,parseArgs} from 'node:util';
import {writeLibraryOutput} from "../data/library-runtime.mjs";
import {reportArgument} from "../data/report-paths.mjs";
import {calibrationAcceptance} from './hydro-calibration-metrics.mjs';

const stages=['6.0','6.7','7.0','7.5'];
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
function fixed(value,digits,{signed=false}={}){
  if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>=1e16)throw Error('Finite calibration measurement required');
  const rounded=pythonRound(value,digits),negative=rounded<0||Object.is(rounded,-0);
  return (negative?'-':signed?'+':'')+Math.abs(rounded).toFixed(digits);
}
function count(value){
  if(!Number.isSafeInteger(value)||value<0)throw Error('Non-negative calibration count required');
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g,',');
}
const ratio=value=>value===null?'—':fixed(value,3);
const percent=value=>fixed(value*100,1)+'%';

export function renderCalibrationReport(results){
  if(!results||!results.acceptance||!results.regions||!results.formula||!results.worldEstimate||!results.representativeChecks||
    Object.values(results.acceptance).some(value=>typeof value!=='boolean'))throw Error('Complete calibration results required');
  const passed=Object.values(results.acceptance).every(Boolean),decision=passed?'통과 · 전 세계 교체 후보로 사용할 수 있습니다.':'보류 · 현재 제약으로는 전 세계 교체에 사용할 수 없습니다.';
  const acceptance=Object.entries(results.acceptance).map(([name,ok])=>`- ${ok?'통과':'미통과'}: \`${name}\``).join('\n');
  const sections=Object.entries(results.regions).map(([id,metrics])=>{
    if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('Safe calibration region identifier required');
    const rows=stages.map(stage=>{const river=metrics.rivers[stage],lake=metrics.lakes[stage];
      return `| ${stage} | ${count(river.selectedCount)} | ${ratio(river.lengthRatio)} | ${ratio(river.pixelRatio)} | ${count(lake.selectedCount)} | ${ratio(lake.countRatio)} | ${ratio(lake.pixelAreaRatio)} |`;});
    return `### ${metrics.label}\n\n![${metrics.label} 비교](./${id}.png)\n\n`+
      '| min_zoom | 표시 강 수 | 강 길이 비 | 강 화면 비 | 표시 호수 수 | 호수 수 비 | 호수 화면 비 |\n'+
      '|---:|---:|---:|---:|---:|---:|---:|\n'+rows.join('\n')+
      `\n\n기본 수계 잔여 중복: 강 ${percent(metrics.riverBaseOverlapRatio)}, 호수 ${percent(metrics.lakeBaseOverlapRatio)}.\n`;
  }).join('');
  const river=results.formula.rivers,lake=results.formula.lakes,world=results.worldEstimate,chain=world.riverChaining;
  const thresholds=value=>stages.map(stage=>`${stage} → ${fixed(value[stage],4)}`).join(', ');
  const representatives=Object.entries(results.representativeChecks).map(([name,item])=>{
    if(!item||![true,false,null].includes(item.present))throw Error('Explicit representative source status required');
    return `- ${name}: ${item.present===true?'확인':item.present===null?'후속 전 세계 검증':'누락'}`;
  }).join('\n');
  return `# 판도연구소 수계 자료 캘리브레이션 보고서

이 보고서는 Natural Earth 전 세계 기본 수계를 유지한 상태에서 HydroRIVERS/HydroLAKES 보충 후보를 유럽·북미·호주의 Natural Earth 1:10m 보충 레이어와 같은 화면 밀도로 맞춘 분석 결과입니다. 판도연구소 실행 자산은 교체하지 않았습니다.

## 결론

**${decision}**

${acceptance}

세 기준 지역에 지역별 예외값을 두지 않고 같은 공식과 같은 단계 임계값을 사용했습니다. 비교 비율은 실제 표시 조합인 \`(Natural Earth 기본 + Hydro 보충) / (Natural Earth 기본 + Natural Earth 보충)\`이며 1.0에 가까울수록 같은 밀도입니다. 미통과 항목이 하나라도 있으면 런타임 자료를 교체하지 않습니다.

## ${passed?'확정된 공통 공식':'최적 탐색값 (합격 기준 미달)'}

- 강: \`ORD_STRA + ${fixed(river.flowWeight,2)} × log10(DIS_AV_CMS) ${fixed(river.upstreamAreaWeight,2,{signed:true})} × log10(UPLAND_SKM)\`
- 강 임계값: ${thresholds(river.thresholds)}
- 호수: \`${fixed(lake.areaWeight,2)} × log10(Lake_area) + ${fixed(lake.shorelineWeight,2)} × log10(Shore_len)\`
- 호수 임계값: ${thresholds(lake.thresholds)}
- 강 중복 판정: 기본 강 4 km 회랑과 중첩 길이, 주방향 유사도를 함께 사용했습니다.
- 호수 중복 판정: 기본 호수와의 IoU, 객체 면적 중첩률, 중심점 및 경계 거리를 함께 사용했습니다.

## 지역별 결과

${sections}

## 연결 체인과 전 세계 예상치

${passed?'아래 수치는 합격한 공식의 적용 예상치입니다.':'아래 수치는 현재 최적 탐색값을 적용한 참고치이며, 미통과 상태이므로 배포 용량 계획에 사용하면 안 됩니다.'}

- 기준 지역 최종 선택 reach: ${count(chain.selectedReachCount)}개
- 연결 후 체인: ${count(chain.chainCount)}개 (${fixed(chain.objectReductionPercent,1)}% 감소)
- 좌표: ${count(chain.sourceCoordinateCount)}개 → ${count(chain.coordinatesAfterChaining)}개 (삭제·단순화 없음)
- 전 세계 예상 reach: ${count(world.riverReachCount)}개
- 전 세계 예상 체인: ${count(world.riverChainCount)}개
- 전 세계 예상 강 좌표: ${count(world.riverCoordinateCount)}개
- 전 세계 예상 호수 객체: ${count(world.lakeFeatureCount)}개
- 예상 gzip 압축 용량: 약 ${fixed(world.gzipMiB,1)} MiB
- 최종 단계 렌더 부하는 현재 Natural Earth 지역 보충 수계 대비 강 ${fixed(world.riverRenderLoadRatio,2)}배, 호수 ${fixed(world.lakeRenderLoadRatio,2)}배로 추정합니다.

## 대표 수계 확인

${representatives}

## 재현 방법

다음 명령은 기존 \`results.json\`에서 보고서만 다시 만듭니다. 원본 수계 보정 계산이나 PNG 생성은 실행하지 않습니다.

\`\`\`powershell
node tools/gis/hydro-calibration-report.mjs \`
  --input <results.json> \`
  --output <새-보고서.md> --verify-acceptance
\`\`\`

\`results.json\`에는 공식, 단계별 원시 지표, 중복률, 입력 파일 정보가 들어 있습니다. 비교 PNG는 동일 범위·등거리 경위도 화면·동일 선폭으로 생성했습니다. 회색은 양쪽에 공통인 Natural Earth 기본 수계입니다. 한반도는 Natural Earth 지역 보충 자료가 없으므로 현재 전 세계 기본 수계를 왼쪽 기준으로 표시하며 최적화 목적함수에는 넣지 않았습니다.

## 적용 경계

이번 결과는 캘리브레이션 도구와 검증 자료뿐입니다. \`assets/data/hydro\`, 앱 버전, 내장 수계 잠금·편집용 복사 및 GeoPackage 구조는 변경하지 않았습니다. 실제 교체에 앞서 Natural Earth 지역 보충 자료 자체의 지역별 밀도 차이를 허용할지, 또는 전 세계 공통 절대 밀도 기준을 새로 정할지 결정해야 합니다.
`;
}

export function writeCalibrationReport({input,output,verifyAcceptance=false,root=defaultRoot}){
  if(typeof input!=='string'||!input||typeof output!=='string'||!output)throw Error('Explicit calibration results and new report path required');
  if(typeof verifyAcceptance!=='boolean')throw Error('Explicit acceptance verification flag required');
  const source=resolve(reportArgument(input,{access:'read',siblings:true,root}));
  const target=resolve(reportArgument(output,{access:'write',root}));
  const actual=resolve(realpathSync(dirname(target)),basename(target)),assets=resolve(root,'assets/data');
  const roots=[assets,...(existsSync(assets)?[realpathSync(assets)]:[])];
  if(roots.some(base=>{const rel=relative(base,actual);return !rel||rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}))
    throw Error('Calibration report output must be outside runtime assets');
  const before=statSync(source);if(!before.isFile()||before.size>16*1024*1024)throw Error('Bounded calibration results file required');
  const text=readFileSync(source,'utf8'),after=statSync(source);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||before.dev!==after.dev)
    throw Error('Calibration results changed during reading');
  const results=JSON.parse(text);
  if(verifyAcceptance&&!isDeepStrictEqual(calibrationAcceptance(results),results.acceptance))throw Error('Calibration acceptance differs from stage measurements');
  const report=renderCalibrationReport(results);writeLibraryOutput(actual,report,{encoding:'utf8',flag:'wx'});
  return {output:actual,bytes:Buffer.byteLength(report)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const {values,positionals}=parseArgs({allowPositionals:true,options:{input:{type:'string'},output:{type:'string'},'verify-acceptance':{type:'boolean',default:false}}});
    if(positionals.length||!values.input||!values.output)throw Error('Explicit calibration results and new report path required');
    console.log(JSON.stringify(writeCalibrationReport({input:values.input,output:values.output,verifyAcceptance:values['verify-acceptance']})));
  }catch(error){console.error('hydro-calibration-report: '+error.message);process.exitCode=1;}
}
