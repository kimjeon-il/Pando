# P2 — C++ 생성물 자동화 실행·검증 결과 (2026-10-14)

> 보고서 ID: `DEV-073` · 상태: `implemented / scoped CI verified` · 지도 반영: `not-applicable`  
> 작업 브랜치: `work/objects` · 개발 원본 커밋: `0b64bee12c40448d721901e5213e2c339f078b27`  
> 자동화 수정: `c9b8a8089bd82cc1bea395890f5a07893fe772d7`, `9be6a0631f949d6b45e32e8b7d447aeabbf8ae54`  
> 생성물 게시: `2fdd2997c54794e5a9a12da6a266e4fd229a4e15` (GitHub Actions 봇).

## 범위와 구현

이 작업은 공통 C++ 코어를 웹용 WASM 및 네이티브 C++로 빌드·검증하고, 기존 Qt용 JavaScript 지오메트리·참조 계산 생성기를 삭제하지 않은 채 같은 원본·해시 추적 파이프라인에 연결한 것이다.

- `scripts/p2-artifact-plan.mjs`: `shared/**` 원본 지문 및 `assets/wasm` 쌍, Qt 지오메트리, Qt 참조 계산 번들의 독립적인 원본·생성물 해시를 점검해 필요한 생성기를 선택한다. 예상하지 못한 산출물 staging을 거부한다.
- `.github/workflows/generated-artifacts-p2.yml`: `work/objects`에서 변경을 감지해 기존 Emscripten/CMake, Qt 지오메트리, esbuild 생성기를 실행하고, 실제 컴파일된 JS/WASM의 ABI·소스 정체성·바이트 해시·선별된 단위 검사를 확인한다.
- `cmake/P2NativeBuildReceipt.cmake` 및 P1 원격 CI: 별도 Qt 설치 없이 네이티브 C++ core와 map-engine 아카이브의 바이너리 SHA-256/크기, 정확한 입력별 해시 및 명시된 의존 관계를 기록한다.
- `tests/unit/p2-artifact-plan.test.mjs`: C++ 소스 변경 시 WASM만 불일치 처리하는지, Qt 계산 소스 변경 및 참조 번들 변경이 서로 독립적인지, 잘못된 경로·예기치 않은 게시를 거부하는지 검사한다.
- `docs/development/generated-artifacts-p2.md`: 사용자·클라우드 개발자를 위한 실행 계약 및 후속 단계 기술.

## 실제 원격 실행 증거

| 실행 | 결과 | 의미 |
|---|---|---|
| [P1 경량 C++·GIS·웹/아카이브 영수증 #38539260600](https://github.com/kimjeon-il/Pando/actions/runs/38539260600) | **SUCCESS** | native-core·native-engine·GIS C++·web-smoke 성공. 실제 core/map-engine 정적 아카이브 SHA 기록 및 `p2-native-cpp-0b64bee…` 업로드 |
| [P2 초기 실행 #38539260616](https://github.com/kimjeon-il/Pando/actions/runs/38539260616) | FAIL | Emscripten 환경 활성화가 `EMSDK_VERSION` 환경변수를 지워 셸이 중단됨. 버전값 별도 보존으로 수정 |
| [P2 두 번째 실행 #38539886028](https://github.com/kimjeon-il/Pando/actions/runs/38539886028) | FAIL | 실제 WASM 빌드·매니페스트 SHA 확인까지 통과. `wasm-document-session.test.mjs`가 이전 출력 디렉터리 `build-native/wasm`을 하드코딩해 새 preset 출력 `build-native/p1/pando-wasm`을 찾지 못함. 명시적 `PANDOEDITOR_WASM_MODULE` 전달로 수정 |
| [P2 최종 실행 #38540821653](https://github.com/kimjeon-il/Pando/actions/runs/38540821653) | **SUCCESS** | 빌드·ABI·소스 해시·WASM 계약·Qt 두 생성기·최종 생성물 검증·경로 범위 제한·`work/objects` 게시 및 증거 업로드 성공 |
| [P1 독립 검증 #38540056151](https://github.com/kimjeon-il/Pando/actions/runs/38540056151) | **SUCCESS** | P2 적용 후 경량 원격 C++ 검증 정상 작동 확인 |

최종 P2 WASM 패키징의 소스 SHA-256은 `8d3bf212e85bba15b7284e1824862e445c2ccc10a592580ad2509ff22903b9e8`. 확인된 JS SHA-256은 `5b3e064cb559478e101defc668a7267525eed55048a445c76a38c723b017bd44`, WASM SHA-256은 `8f850efcdaa86ce12e19e9b1ac37217e9cb390daddf5670232ee743481ad1174`. 재빌드 결과가 기존 패키지 바이트와 같아 WASM 바이너리는 다시 커밋하지 않았다.

반면 Qt 지오메트리 6개 파일이 현재 정본 JS와 어긋나 재생성되었고, 검증을 통과한 `native/assets/geometry/current` 파일 6개만 봇 커밋 `2fdd299`로 반영되었다. 참조 계산 번들은 재생성 후 동일 바이트여서 추가 변경이 없었다.

## 보호·후속 검증 경계

- 생성물과 원본에 불일치가 남으면 CI가 실패한다. 자동 게시 대상은 `assets/wasm/`, `native/assets/geometry/current/`, `native/resources/current_geometry.qrc`, `native/app/reference-web/`의 선언된 출력만 허용한다. 작업 브랜치가 빌드 도중 이동하면 오래된 산출물을 강제 push하지 않는다.
- **P2 파이프라인 정상 작동과 기존 실패하던 Qt 지오메트리 생성물의 수정은 확인**했다. 다만 실제 제품의 C++ 소스를 이번에 임의 변경하여 "변경 → CI 자동 재컴파일 → WASM 게시" 전 과정을 반복하는 파괴적 검사는 수행하지 않았다. 이 변화 감지는 단위 계약과 기존 빌드의 실제 SHA 대조로 검증했다.
- 이 단계는 Qt 전체 앱 실행, GPU 결과, Windows/Android 실기기·성능, 전체 대형 GIS·지도 메시 생성기를 검증하지 않았다. 해당 사항은 P3/P7/P9에서 처리한다. 현재 JavaScript 계산 소스를 제거하거나 C++ 성능 구조를 바꾸지 않았다.
- `main` 병합과 웹 배포는 실행하지 않았다. P2 작업·검증·생성물 반영은 `work/objects` 브랜치에 한정한다.

검증 기준: 실제 GitHub Actions 성공과 생성물 커밋, 소스/컴파일러/ABI/해시가 일치한 매니페스트를 각각 확인한 범위에서만 성공으로 기록한다.
