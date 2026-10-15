# P6–P9 구현·검증 진행 기록

> 보고서 ID: `DEV-076` · 상태: `investigating` · 지도 반영: `not-applicable` · 색인일: 2026-10-16
> 원문 최종 수정: 2026-10-16
> 기준본: `8e22982616e3c9ba43eeb84baec17cd886267cfa` · 구현 브랜치: `work/objects`
> 검증된 WASM 결과 커밋: `68b5e122` · P7 생성물 결과 `989a249f`; 후속 정밀 검사 보강과 P9는 별도 검증 전

## 대상과 실행 원칙

승인된 P6–P9 계획을 기존 객체 워크트리에서 구현한다. `main` 병합·배포·다른 브랜치 반영은 수행하지 않는다. 중간 검사가 과도하다는 사용자 지시에 따라 2026-10-16부터 반복 기능·성능 검증을 중단하고 P6–P8 구현 후 P9에서 묶어 확인한다. 이미 얻은 증거는 재사용한다.

## 구현 상태

| 단계 | 구현 | 남은 확인 |
| --- | --- | --- |
| P6 | polygon-clipping 0.15.7 포트, 잘라내기·수계·참조이미지 공유 C++, Qt 직접 호출·웹 WASM 연결, 제품용 JS 번들과 필수 Node 빌드 경로 제거 | 최종 후보의 Qt lifecycle·웹 사용자 흐름·성능 |
| P7 | 기존 P2에 입력 그래프·선택 생성·임시 출력 검증·롤백·원격 SHA 보호·실제 결과 SHA 영수증 연결 | 최초 원격 생성/게시 통과; 후속 공유 정밀 검사 보강 반영 예정 |
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
