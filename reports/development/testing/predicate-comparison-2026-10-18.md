# main·지리 판정 실험 정확성 및 제한 성능 비교

> 보고서 ID: PERF-PREDICATE-20261018 · 상태: verified-bounded-comparison / keep-main · 지도 반영: not-applicable
> 최종 수정: 2026-10-18
> 기준: `bb48e2cbb729bed9a794c1f3f843b5cb028e1227` (작업 시작 시 HEAD, main, origin/main 동일)
> 증거: [수집 목록·해시](evidence/predicate-comparison-2026-10-18/index.json), [native 원본](evidence/predicate-comparison-2026-10-18/native.json), [1도 변형 원본](evidence/predicate-comparison-2026-10-18/native-main-1deg.json), [WASM 원본](evidence/predicate-comparison-2026-10-18/wasm.json)

## 결정

**제품에는 실험을 적용하지 않는다.** 확인한 실험 가운데 결과 보존과 주요 경로 성능 조건을 함께 만족하는 후보가 없었다. 현재 `shared/core/src/geometrypredicates.cpp`와 packaged WASM은 변경하지 않았다. 이번 변경은 재실행 도구, 고정 테스트 입력과 결과 보고서다.

브랜치 동기화 과정에서 실험 브랜치의 충돌 파일은 main 구현으로 통일되어 있었다. 따라서 현재 브랜치 파일끼리 비교하지 않고, Git 이력에 보존된 실험 원본 SHA의 계산 파일을 각각 main과 비교했다. 브랜치의 고유 커밋 수가 서로 다른 알고리즘 개수를 뜻하지는 않는다. 이번 비교 대상은 확인된 네 가지 원본과 main에서 파생한 작은 변형이다.

## 고정 소스와 방법

비교 파일은 모두 `shared/core/src/geometrypredicates.cpp`다. 각 실행 JSON에 SHA-256을 기록했다.

| 후보 | 원본 커밋 | Git source blob |
| --- | --- | --- |
| main 및 대조 실행 | `bb48e2cbb729bed9a794c1f3f843b5cb028e1227` | `a255376fde6b99643c322a5fde91b41f3033d8d2` |
| geo-containment-index | `0362f3ddda0475dc68fb78cf2647a3f804287371` | `de572dd0dda3a84de4a24a64e84a52e016efe12e` |
| geographic-2d-index | `c07acc763061900ea421f4d3104a5ecd36bfccae` | `125a8a2f7fc8319fbf8a99568af9a1ca5b96677c` |
| geographic-broadphase | `00b5616f2348a78b01dfe8188d3cab504d895cca` | `64ab11241a4d555ad21a50a8b3edd1c6c042fa9f` |
| geographic-direct-smoke | `2c24855ef49df249527389eaaaa55877cea93fd6` | `ad4220cd24aacd06b85e7be3ca60ad7831a4ae38` |
| main-1deg | main 파생: 위도 bucket 91→181, 간격 2°→1°, 최대 span 16→32 | 생성 소스 SHA-256은 별도 JSON |

현재 main은 이미 링별 위도 인덱스와 자식 영역의 조기 판정 경로를 갖고 있다. 과거 실험의 파일 전체 교체는 이 개선 일부를 잃는다. main-1deg는 긴 선분을 별도 처리하는 32° 기준을 유지하면서 인덱스 해상도만 바꾼 제한 조합 실험이다. 제품 파일을 수정하지 않고 임시 빌드 파일에서만 생성했다.

- Windows x64, AMD Ryzen 5 3500 6-Core. Native: MinGW GNU 13.1.0, C++20 `-O2`. WASM: Emscripten 4.0.20 `-O3`, Node 24.21.0. 앱·브라우저·Qt·BAT를 실행하지 않았다.
- 계산 파일만 작은 C++ 프로그램으로 빌드했다. 같은 프로세스에서 main 함수를 별도 이름으로 링크하고, 후보와 같은 입력을 비교했다. 전체 core 빌드나 실제 세계 자료는 사용하지 않았다.
- 과거 고정 corpus의 1,262개 boolean 비교와 새 경계 corpus의 1,164개 비교를 분리했다. 좌표 비트 보존을 확인하며 반올림·오차 허용·결과 정규화는 하지 않았다. 기대 의미 검토를 위한 검사이며 모든 실제 형상의 정답을 증명하지는 않는다.
- 고정 corpus는 `00b5616f...:scripts/research/geographic-index-parity.cpp`의 원본 바이트다. SHA-256은 `59efe05f8b00b94c258f0def1c7f98c1f657e02d2a2b02014889b8fc558053c8`. 원본 probe가 출력하는 오래된 단회 timing은 채택 근거에서 제외했다.
- 새 입력은 bucket 경계·epsilon 양쪽·극지·날짜변경선·역방향 링·holes·다중 영역·긴 선분을 포함한다. dense parent 640정점 등 작은 합성 입력으로 성능을 제한했다.
- 성능은 동일 반복 수, main/후보 순서 교대, 5회 측정의 **쌍별 속도비 중앙값**이다. 반복 수는 느린 쪽 비용을 기준으로 목표 15ms, 최대 2,000회로 제한했다. child process마다 45초 제한을 뒀다. 다른 빌드나 성능 검사를 동시에 돌리지 않았다.
- 최초 native 실행은 8개 성능 입력이고, 이후 WASM 실행은 island-gap을 추가한 9개다. WASM에는 측정 전 선택된 반복 수만큼 양쪽을 동일하게 추가 warmup했다. 두 실행 조건을 섞어 절대시간을 비교하지 않았다.
- 원래 실행 JSON에는 실행 파일 및 harness 해시가 없다. 원본 JSON을 사후 수정하지 않았다. 수집 시점의 도구·최종 harness 해시는 index에 구분해 기록했다. 최종 재실행 도구는 실행 파일, WASM 로더/바이너리, harness 해시를 따로 남긴다.

## 정확성 결과와 배제 이유

| 후보 | 과거 1,262개 | 새 1,164개 | 판단 |
| --- | --- | --- | --- |
| main 대조 실행 | 동일 | 동일 | 측정 대조군 |
| geo-containment-index | 동일 | 동일 | native 일부 개선, WASM 주요 입력 회귀로 제외 |
| geographic-2d-index | 동일 | 동일 | dense containment 약 17.5배 느림 |
| geographic-broadphase | 동일 | **4개 불일치** | 정확성 미충족으로 제외 |
| geographic-direct-smoke | 동일 | 동일 | dense containment 약 15.9배 느림 |
| main-1deg | 동일 | 동일 | outside/hole containment 약 12~15% 느림 |

여기서 ‘동일’은 실행한 corpus에 한한다. native의 명확한 회귀나 정확성 실패로 배제된 후보는 WASM을 추가 실행하지 않았다. 이를 WASM 통과로 표시하지 않는다.

Broadphase는 `epsilon-184`, `epsilon-188`에서 significantOverlap을 main `false`, 실험 `true`로 반환했다. 피연산자 순서를 바꾼 두 경우를 합쳐 4개다. containment 결과와 입력 좌표 비트는 같았다.

재현 입력은 `y=-1e-20`, `delta=-1e-10`이며 parent는 `box(0,y-1e-4,1e-4,y,subdivisions)`에 원격 극지 component를 추가해 periodic 경로로 만든다. child는 `box(2e-5,y+delta,8e-5,y+delta+1e-12)`다. subdivisions 16 및 24(폐합점 포함 65/97점)에서 발생했다. 정확한 생성 코드는 `tests/cpp/geographic-predicate-comparison.cpp`에 있다. 기존 부동소수점 epsilon 계산의 연산 순서를 인덱스 조건으로 바꾸는 것이 안전하지 않다는 실행 증거다. 기존 차이를 허용하거나 알고리즘을 수정해 통과시키지 않았다.

## Native 성능

값은 `main ms / 후보 ms`. **1보다 크면 후보가 빠르다.** 반올림한 비율만 아래에 표시하며 판정 원본 값은 JSON에 있다.

| 후보 | dense 포함 | outside 포함 | hole 포함 | disjoint overlap | hole overlap | crossing overlap | small overlap | ordinary small |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main 대조 실행 | 1.016 | 1.059 | 1.039 | 0.993 | 0.987 | 1.015 | 0.997 | 1.007 |
| geo-containment-index | 1.099 | 1.029 | 0.990 | 0.990 | 0.990 | 0.996 | 0.980 | 1.007 |
| geographic-2d-index | 0.057 | 0.663 | 0.588 | 0.958 | 0.961 | 0.938 | 0.992 | 0.975 |
| geographic-broadphase | 0.171 | 1.017 | 0.988 | 5.340 | 5.953 | 0.118 | 0.595 | 0.999 |
| geographic-direct-smoke | 0.063 | 3.972 | 2.011 | 0.937 | 0.945 | 0.992 | 0.992 | 0.980 |
| main-1deg | 1.027 | 0.884 | 0.872 | 0.997 | 0.993 | 1.031 | 0.997 | 1.006 |

대조 실행에도 작은 입력에서 약 6% 변동이 있다. 작은 차이만으로 개선을 확정하지 않는다. Broadphase의 일부 overlap 개선도 불일치 4건 및 crossing 회귀 때문에 적용할 수 없다.

## WASM 추가 확인

native에서 남은 geo-containment-index 후보와 main 대조군만 실행했다. 두 실행 모두 corpus 2,426개 및 9개 성능 입력의 결과·입력 비트 검사를 통과했다.

| 입력 | main 대조 실행 비율 | geo-containment-index 비율 |
| --- | ---: | ---: |
| island-gap containment | 0.995 | **0.910** |
| dense containment | 1.003 | **0.971** |
| outside containment | 0.997 | 1.019 |
| hole containment | 0.999 | 1.049 |
| disjoint overlap | 1.001 | 0.999 |
| hole overlap | 1.000 | 0.993 |
| crossing overlap | 0.997 | 1.006 |
| small periodic overlap | 1.002 | 0.984 |
| ordinary small | 0.970 | 0.986 |

후보는 WASM의 dense 입력에서 약 3%, island-gap에서 약 10% 느렸다. native의 약 10% dense 개선을 실제 실행 대상인 WASM 개선으로 일반화할 수 없다. island-gap은 두 작은 섬이 넓게 떨어진 MultiPolygon으로, 새 입력과 기존 main 경량 영역 검사의 차이를 드러낸다.

## 재실행

저장소 루트에서 실행한다. 타깃은 순수 계산 프로그램이며 앱을 띄우지 않는다. 필요한 compiler와 SDK는 기존 설치본을 사용한다. 결과·임시 빌드는 `build-native/predicate-comparison/`에 남고 소스는 변경하지 않는다.

```powershell
$taskMingw = 'C:/Users/taeeu/Qt/Tools/mingw1310_64/bin'
$env:PATH = "$taskMingw;$env:PATH"
node tools/compare-geographic-predicates.mjs --baseline bb48e2cbb729bed9a794c1f3f843b5cb028e1227 --cxx "$taskMingw/g++.exe"
```

Emscripten 4.0.20 환경이 활성화된 shell에서는 다음과 같다. 기존 Windows 측정에는 Python emxx wrapper를 사용했다. 재실행 시 compiler 문자열과 flags는 보고서에 기록된다.

```text
node tools/compare-geographic-predicates.mjs --baseline bb48e2cbb729bed9a794c1f3f843b5cb028e1227 --target wasm --cxx em++ --optimization=-O3 --only main-control,geo-containment-index --build build-native/predicate-comparison/wasm --out build-native/predicate-comparison/wasm.json
```

최종 도구는 native에도 9개 입력과 추가 warmup을 적용하므로 최초 native 기록의 소요시간을 비트 단위로 재현하는 도구는 아니다. 고정 입력·소스·결과 비교와 측정 조건을 재실행할 수 있다. Windows에서 em++가 batch wrapper라면 `--cxx <python.exe> --emxx-driver <existing-driver.py>` 경로도 제공한다.

## 확인 범위와 남은 제한

작은 non-GUI 계산 비교와 재실행 도구 정적 검토만 수행했다. 앱·브라우저·모바일 실행, 실제 전체 세계 자료, 실제 UI 지연 및 메모리 성능은 미검증이다. historical corpus에 있는 합성 dense 입력을 실제 국가 성능이라고 표시하지 않는다. Node WASM 결과도 WebView/브라우저 실측과 구분한다.

최종 도구 리뷰에서 benchmark 실패를 정확성 통과에서 배제하도록 보완하고 WASM 로더/실행 바이너리 해시를 분리했다. 측정 당시 모든 수록 benchmark는 exit 0이었으므로 기존 결과 판단은 바뀌지 않는다. 이 보완 이후 컴파일·측정을 반복하지 않고 JS 구문·해당 파일 lint·fixture와 증거 해시·제품 소스 미변경만 확인했다. 전체 테스트·전체 세계 성능·앱 실행·커밋·푸시·배포는 하지 않았다.
