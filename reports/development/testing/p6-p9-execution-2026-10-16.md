# P6–P9 구현·검증 진행 기록

> 보고서 ID: `DEV-076` · 상태: `investigating` · 지도 반영: `not-applicable` · 색인일: 2026-10-16
> 원문 최종 수정: 2026-10-16
> 기준본: `8e22982616e3c9ba43eeb84baec17cd886267cfa` · 구현 브랜치: `work/objects`
> 최종 검증 후보: `98c24a6d20ac870404e4c67a408a4fba9d783d39` · WASM 결과 `8d268116` · P7 생성물 영수증 `3ff8598d`

## 대상과 실행 원칙

승인된 P6–P9 계획을 기존 객체 워크트리에서 구현한다. `main` 병합·배포·다른 브랜치 반영은 수행하지 않는다. 중간 검사가 과도하다는 사용자 지시에 따라 2026-10-16부터 반복 기능·성능 검증을 중단하고 P6–P8 구현 후 P9에서 묶어 확인한다. 이미 얻은 증거는 재사용한다.

## 구현 상태

| 단계 | 구현 | 남은 확인 |
| --- | --- | --- |
| P6 | polygon-clipping 0.15.7 포트, 잘라내기·수계·참조이미지 공유 C++, Qt 직접 호출·웹 WASM 연결, 제품용 JS 번들과 필수 Node 빌드 경로 제거 | 최종 후보의 Qt lifecycle·웹 사용자 흐름·성능 |
| P7 | 기존 P2에 입력 그래프·선택 생성·임시 출력 검증·롤백·원격 SHA 보호·실제 결과 SHA 영수증 연결 | 최종 선택 생성·검증·게시 38770678701 통과; 원본 GIS 재가공은 명시 실행 |
| P8 | P1/P2/P3 실행 책임 구분, 원본/봇 커밋 검증 순서, Qt 빌드 재사용, 일반 workspace의 Acorn 제거, 연구 재수집 수동화 | 최종 CI 계획과 실제 원격 연결 |
| P9 | 기준본과 반복 측정 도구 확보 | 최종 기능·성능·생성물 재현·실기기 검증 미완료 |

수계·지형 원본 GIS 재가공은 명시 작업이며 원본 경로·버전·해시가 없으면 중단한다. 자동 다운로드나 대체 자료로 통과시키지 않는다.

## 실제 실행한 증거

- [공통 C++ 비교 38751895746](https://github.com/kimjeon-il/Pando/actions/runs/38751895746): 폴리곤 241, 잘라내기 6, 정규화/날짜변경선 63, 수계 18 사례와 참조이미지 frozen fixture 통과.
- [최적화 후 공통 C++ 38755218968](https://github.com/kimjeon-il/Pando/actions/runs/38755218968): 공유 구현 비교 통과. WASM 바인딩 컴파일 증거와 구분한다.
- [WASM 생성 38756134022](https://github.com/kimjeon-il/Pando/actions/runs/38756134022): 실제 Emscripten 컴파일·산출물 해시·ABI·연결된 계산 어댑터 검사 통과. 봇 결과 `68b5e122`를 로컬로 fast-forward했다.
- [이전 Qt 실행 38752939754](https://github.com/kimjeon-il/Pando/actions/runs/38752939754): Windows/Linux 앱 빌드는 성공. Linux fixture 경로와 Windows 단일 중첩 QJsonArray 입력 구성에서 실패를 확인하여 수정했다. 성공한 앱 빌드와 실패한 CTest를 구분한다.
- [Qt 실행 38756271115](https://github.com/kimjeon-il/Pando/actions/runs/38756271115): Linux 12/13 통과, split lifecycle의 과거 정규화 기대값 2건 실패. 과거 fixture를 삭제하지 않고 현행 canonical 형상으로 비교하도록 수정했으며 재실행은 P9에 포함한다. Windows도 12/13 통과했으며 같은 lifecycle 항목이 남았다.
- P2 그래프/게시 모의 저장소 검사: 변경 없음, 하위 갱신, 손상, 원본 누락, 동시 원격 갱신 거부와 로컬 WASM→웹→앱 커밋 순서 확인. 실제 전체 자산 생성 완료를 의미하지 않는다.
- P1/P3 분류 검사: UI·공통 C++·네이티브·문서 변경과 원본/결과 SHA 실행 순서 확인. 실제 최종 CI 성공과 구분한다.

- [P7 생성·게시 38758885726](https://github.com/kimjeon-il/Pando/actions/runs/38758885726): 9개 웹 계열을 임시 위치에서 생성·검증한 뒤 웹 커밋 `57820b04`, 네이티브 동등 바이트 커밋 `989a249f`를 로컬에서 만들고 최종 결과를 한 번에 push했다. 실제 원격 게시가 확인되었다. 앞선 38758008881은 잔존 Python/Shapely 호출 때문에 중단되었고 산출물을 게시하지 않았다. 해당 경로는 웹과 공유하는 검사로 교체했다.

## 성능과 미검증 범위

최초 Node 계산 어댑터 비교에서 폴리곤·수계·참조이미지 회귀를 확인했다. WASM 좌표 일괄 전달, 수계 공간 인덱스 조회, 참조이미지 준비 계수/메시 배열 전달을 수정했다. 수정 후 성능 수용 판정은 P9에서 실시한다. 초기 수치를 해결된 문제처럼 기록하지 않는다.

이 Node 도구는 브라우저 프레임·Qt 화면·실기기를 측정하지 않는다. 최종 후보의 사용자 흐름, 원격 반복 측정, 실제 GPU·Windows 화면·Android 터치 검증은 아직 완료되지 않았다. 실기기가 없으면 해당 항목을 미검증으로 남기며 전체 P9 완료로 표시하지 않는다.

## 판본

본 기록은 진행 중 증거이다. 과거 조사 파일을 이동하거나 덮어쓰지 않았다. 최종 수용 여부는 동일 후보 SHA의 후속 결과로 갱신한다.

## P9 후보 5298b062 결과와 필요한 수정

- P7 후속 38760364502에서 엄격한 공유 미리보기 검사로 선택 자산을 생성·검증하고 최종 결과 5298b062를 게시했다.
- P9 38761625563: Web snapshot 성공. Linux Qt 앱 빌드 및 기본 CTest 13/13 성공, hydro 4/5 성공. river selection의 fixture 경로가 재현 빌드 prefix-map에 영향을 받아 기존 CMake fixture 경로를 사용하도록 수정했다. Windows는 이 기록 시점 실행 중이다.
- Web 계약 두 실패는 WASM 결과의 객체 참조 동일성을 요구한 과거 기대값이었다. 값의 동일성·입력 보존을 검사하도록 변경했다. Worker 계약 66개 성공, 넓은 원본에서 새 국가를 만든 사례 1개 실패. 긴 평면 경도를 나누기 전에 구면 방향을 정하던 공통 정규화 순서를 수정했다. 과거 baseline 파일을 보존하고 넓은 외곽/구멍 두 사례의 현행 기대값을 별도로 명시했다.
- 같은 runner의 교대 성능 비교: cut 중앙값 13.1923→6.5372ms, polygon 166.715→137.355ms, max RSS 359420→265228KB. river 8.6504→16.8101ms는 범위 중첩으로 미확정, reference 19.162→46.107ms는 회귀. 참조이미지 중복 보정 계산·메시 배열 재생성과 JSON 임시 문자열/정수 변환 비용을 줄였다. 수정 후 성능 통과는 아직 주장하지 않는다.
- 후속 실행은 완료된 Web 계약·GPU/경계 검사·자산 snapshot·hydro 네 검사를 재실행하지 않는다. 변경된 공통 계산과 실패한 사례, 아직 실행되지 않은 사용자 흐름, river/reference 성능만 확인한다. 공통 C++가 바뀌므로 두 OS의 최종 앱 빌드와 관련 CTest는 필요하다.

### P9 수정 후 중간 결과 f1db6cf5

- WASM 및 자산 갱신 38763979326 성공: WASM 7be5ce1d, 생성물 영수증 f1db6cf5. 고정 자산의 바이트는 바뀌지 않았고 새 WASM 및 해당 의존 지문을 반영했다.
- 실제 wide-source new-country Worker 회귀 사례 통과. polygon-geometry 16개와 reference-shared-runtime 6개 통과. 새 winding 계약을 적용하자 baseline의 wrap long-edge 사례도 같은 잘못된 방향을 가지고 있음을 확인했다. 세 변경 모두 이전 출력의 canonical 실패→현재 성공, 평면 면적 동일을 확인하여 별도 현행 correction fixture로 기록했다. 과거 baseline은 변경하지 않았다.
- 동일 Windows/Node 환경의 river/reference 한정 교대 비교: river 중앙 8.63085→15.10245ms, reference 13.9045→22.5133ms. 한 차례 추가 측정 후에도 각각 미확정·회귀다. 범위 및 반복 데이터는 build-native/p9/calculation-performance-f1db6cf5-windows.json에 남겼다. 통과로 처리하지 않았다.
- 후속 최소 수정: 수계 원본 수치/ID 요청당 준비, 소유권이 끝난 후보 이동; 정확한 정수 토큰의 빠른 수치 파싱; 참조 좌표·계수 재사용 및 WASM 보정/준비 통합. 원본 수치 알고리즘·오차·메시 불변성은 유지한다. 후속 WASM은 먼저 이 두 성능 항목만 확인하며, 불필요한 고정 자산 재생성은 최종 계산 후보 확정 뒤에 시행한다.
- Windows 기본 실패의 원인은 fixture reader의 임시 QJsonObject에 대한 QJsonValueRef 수명 오류였다. 값을 소유하도록 고쳤으며 expected geometry는 그대로다.

### WASM 예외 처리 비용 확인

- 38767156038 WASM 빌드 성공, 결과 69ec57c0. 폴리곤·참조·수계 관련 24개 검사 통과.
- 참조 경로의 짧은 CPU 측정에서 보정/준비 62%, C++ 메시/전달 17%, JS 조립 16%, 점 투영 5%였다. WASM→JS 및 invoke_* 프레임이 46 self samples 중 최소 8개였다. 짧은 계측 표본이며 전체 회귀의 원인 비율로 확정하지 않는다.
- 기존 CMake는 JS 예외 에뮬레이션(-fexceptions, DISABLE_EXCEPTION_CATCHING=0)을 전체 C++에 적용했다. [Emscripten 공식 설명](https://emscripten.org/docs/porting/exceptions.html)은 이 모드의 비용과 -fwasm-exceptions의 낮은 비용을 명시한다. 고정 SDK 4.0.20의 [설정 원본](https://github.com/emscripten-core/emscripten/blob/4.0.20/src/settings.js)도 확인했다.
- 계산 규칙을 더 바꾸기 전에 코어와 바인딩 모두 native WASM 예외 처리로 전환한다. 컴파일·링크에 같은 모드를 쓰고 JS 에뮬레이션 옵션을 제거한다. 네이티브 Qt 빌드에는 영향이 없다. 성능·현재 오류 계약·브라우저 실행은 새 산출물에서 확인하며, 미지원 WASM 엔진이나 실기기 통과를 가정하지 않는다.

- Native WASM 예외 빌드 38768464589 성공, 결과 3a2b4ad8. WASM 크기는 3,415,952→2,809,068바이트였다.
- 다른 검사를 동시에 실행하지 않은 Windows 교대 비교에서 reference 중앙 13.7792→13.7352ms로 no-regression, river 8.31695→9.32335ms로 uncertain이었다. 참조 회귀는 이 조건에서 해소됐으며 수계는 아직 통과로 표시하지 않는다.
- 수계의 남은 식별자 생성에서 좌표 정수 문자열의 printf 기반 변환과 FNV 결과의 iostream/locale 구성을 제거한다. 동일한 정수/고정8자리 소문자16진수 표현으로 직접 인코딩하며, 좌표 양자화·FNV 연산·후보 키·수치 순서는 유지한다.

### 최종 계산 후보 8d268116

- WASM 빌드 38769615226 성공, 결과 8d268116. 수계 문자열 변환 수정 후 같은 Windows 조건의 준비1회+5회교대에서 baseline 중앙8.3811ms, candidate8.2518ms로 no-regression이었다. 참조는 앞선 동일 계산 소스의3a2b4ad8 비교13.7792→13.7352ms 결과를 재사용한다.
- 현행WASM의 polygon/reference/river24개와 문서의 원자 명령·전체 history·batch/draft2개 통과. 정상 결과, 오류코드와 오류 이후의 사용, 입력 보존, 구멍/날짜변경선,동결 계약을 확인했다. 전체 suite나 역사 전체 저장검사는 반복하지 않았다.
- P9후속은 기존 러시아 실제 대형 영역 생성/Undo/편집취소 및 선준비 취소 두 검사를 선택한다. 원본 정점 개수는고정숫자 대신현행build-input manifest의canonicalSource를사용한다.
- 웹표시/편집준비/RUS초점프레임p95/JS힙교대비교를추가했다. 한 번에앱페이지하나만 실행하고양쪽HTTP캐시조건을맞춘다. 실제GPU,Qt성능,Android터치,대형편집프레임교대비교와전체Worker/WASM/GPU메모리는별도미검증으로명시한다.

## 최종 후보 98c24a6d의 P9 실행

- [최종 선택 생성·게시 38770678701](https://github.com/kimjeon-il/Pando/actions/runs/38770678701) 성공. 계산 소스가 확정된 뒤 기존 P2 경로로 검증했고, 고정 자산 출력은 동일하여 영수증 `3ff8598d`만 갱신했다.
- [P9 38771905633](https://github.com/kimjeon-il/Pando/actions/runs/38771905633)은 최종 후보 `98c24a6d20ac870404e4c67a408a4fba9d783d39`를 검증한다. 앞서 통과한 snapshot과 변경되지 않은 검사는 재사용하고, 관련 Qt 계산·명령·저장 검사 및 아직 실행되지 않은 브라우저 사용자 흐름을 수행한다.
- 같은 Linux runner·Node 버전·입력·캐시 조건에서 준비 1회 후 기준본/후보를 교대로 5회 측정했다. river 중앙값 **7.084694→6.786544ms**, reference **10.683611→9.478370ms**로 두 항목 모두 도구의 `no-regression` 판정이다. 추가 측정은 하지 않았다. 이 결과는 Node 계산 어댑터의 범위이며 Qt·GPU·브라우저 프레임 성능을 대신하지 않는다.
- 웹 계약 검사도 성공했다. 이 기록 시점에는 브라우저 흐름과 Windows/Linux Qt 작업이 진행 중이므로 그 결과를 통과로 표시하지 않는다.
- 최종 후보의 잘라내기·폴리곤은 별도 Windows/Node 조건에서 준비 1회+5회 교대로 확인했다. cut 중앙값 **10.059700→2.450300ms**, polygon **155.679700→108.435700ms**, 모두 `no-regression`이다. Linux 수계/참조 수치와 서로 다른 환경이므로 직접 합산하지 않는다.
- Linux 앱 빌드 성공. 관련 CTest 8개 중 7개 성공이며, 정규화 테스트 안의 4개 기대값이 웹에 이미 반영한 `wrapping-corrections.json`을 사용하지 않아 실패했다(67개 사례 성공). Qt도 같은 correction 파일을 읽고 과거 baseline은 보존하도록 갱신한다. 수정된 사례마다 과거 canonical 실패·현재 성공·평면 면적 보존을 확인한다. 제품 계산 소스는 변경하지 않는다.
- Windows도 최종 앱 빌드와 같은 7개 CTest가 성공했고, 같은 정규화 기대값 4개만 실패했다. 수계/참조/잘라내기/형상 lifecycle의 Windows 결과도 재사용한다.
- 후속 Qt 실행은 정규화 1개와 앞선 실패 때문에 실행되지 않은 명령/저장 6개, Windows에서 아직 실행되지 않은 hydro 4개만 선택한다. 이전에 통과한 계산 검사는 반복하지 않는다. CI는 독립 검사와 캡처를 선행 CTest 실패 뒤에도 수집하고 실패 상태는 유지하도록 수정했다.
- 첫 좁은 Qt 후속 38773827318은 `project_codec_tests`가 native 구성에 등록되지 않아 실행 전 중단됐다. 이미 존재하는 공유 테스트 CMake를 native에 연결하고, 남아 있던 Node 설치 여부에 따른 oracle 등록을 기존 명시 원격 parity 옵션 안으로 옮겼다. 다시 시작한 좁은 실행은 [38774529675](https://github.com/kimjeon-il/Pando/actions/runs/38774529675)이다.
- 브라우저는 10개 중 1개 성공, 9개가 편집 전 같은 `data-readiness=error`로 실패했다. 9개의 독립 편집 결함으로 보지 않으며 공통 시작 원인을 별도로 수정한다. 후속은 시작 확인을 먼저 수행하고 명시적 error 상태면 즉시 실패하도록 바꿔 같은 오류를 9번 대기하지 않게 한다.

### 남은 Qt 성능·실기기 제약

기존 `ui_tests nativePerformanceProbe`와 `native/tools/run-native-performance.ps1`을 확인했다. 추적 중인 저장소에는 필요한 version 2 성능 fixture manifest 및 네 종류의 고정 프로젝트/뷰/입력·자산 묶음이 없다. 현재 원격 산출물에도 해당 probe 실행 파일은 없다. 새 임의 fixture나 소프트웨어 화면을 실기기 근거로 대체하지 않는다.

기존 preflight의 과거 지명 SHA 하드코딩은 fixture가 선언한 `productionPlace {path, sha256, revision}`을 읽어 사본과 실제 앱 manifest를 모두 비교하도록 교체했다. 누락·변조·revision 불일치·`empty-v1` 차단 및 실행 전후 해시 확인은 유지한다. 직접 계약 10개만 실행하여 통과했으며 Qt 실행·성능 측정을 한 것으로 기록하지 않는다. Qt 성능, 실제 GPU·Windows 화면·Android 터치는 미검증이다.

### 최종 계산 반복 측정 분포

모든 값은 ms이며 준비 실행을 제외한 실제 측정 순서다. 양쪽 모두 Node `v24.21.0`, 같은 입력을 사용했다. Linux는 AMD EPYC 9V45 원격 runner, Windows는 AMD Ryzen 5 3500 로컬 PC다. 각 행의 기준본/후보는 같은 장비에서 교대 실행했다. 서로 다른 장비의 행끼리는 비교하지 않는다. 최종 제품 소스는 `98c24a6d`; 이후 `3f89ff4c`까지의 변경은 테스트·CI·성능 도구·문서뿐이다.

| 연산 / 환경 | 기준본 5회 | 후보 5회 | 판정 |
| --- | --- | --- | --- |
| river / Linux | 7.084694, 11.869592, 13.960312, 4.638918, 5.223331 | 6.734554, 6.786544, 11.001441, 6.698511, 6.823259 | no-regression |
| reference / Linux | 11.014160, 15.799069, 8.838173, 10.606945, 10.683611 | 17.630535, 9.478370, 10.128632, 9.245989, 9.344818 | no-regression |
| cut / Windows | 9.622000, 10.285300, 10.618600, 9.757000, 10.059700 | 2.450300, 2.384400, 2.421300, 2.525300, 2.758400 | no-regression |
| polygon / Windows | 165.435000, 155.679700, 153.189900, 154.415600, 170.017400 | 108.649000, 116.711200, 108.401600, 107.222300, 108.435700 | no-regression |

이 판정은 중앙값과 범위를 이용하는 도구의 단순 비교이며 통계적 유의성을 주장하지 않는다. 초기 후보의 최대 RSS 개선 수치는 초기 후보에만 해당한다. 최종 전체 프로세스/Worker/WASM/GPU 메모리를 측정한 것으로 확대하지 않는다.

### 브라우저 공통 시작 원인과 수정

원격 trace는 `[PL-GEOMETRY-APPLY-001]` 역사 지도 manifest와 `[PL-MESH-PREPARE]` 준비 메시 manifest의 무결성 불일치를 보였다. P7이 자산을 갱신한 뒤 `assets/js/build-meta.js`가 이전 해시를 유지한 것이 원인이다. 계산 알고리즘이나 무결성 검사를 완화하지 않았다.

기존 `generate-build-metadata.mjs`를 P2 그래프의 최종 웹 조립 계열로 연결했다. `--check`는 게시된 빌드 식별자를 보존하면서 실제 manifest 바이트와 모듈 목록/해시를 비교한다. 해시 대상 생성 JSON은 LF로 고정했다. 현재 계획은 `build-metadata` 한 계열만 선택하고 다른 자산·네이티브 산출물은 갱신하지 않는다.

직접 회귀 1건 및 실제 metadata 검사가 통과했다. 로컬 Chromium WebGL2 단일 시작은 `enhanced` / `canonical-ready`, geometry/mesh 오류 없음, 콘솔·페이지 오류 없음이었다. 원격 게시와 남은 브라우저 사용자 흐름·프레임/힙 비교는 후속 결과로 기록한다. 이미 통과한 child cut은 재실행하지 않는다.
