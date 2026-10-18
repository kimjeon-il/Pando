# 기존 동작을 유지하는 내부 명칭 정리

> 보고서 ID: DEV-NAMING-20261018 · 상태: verified-naming / baseline-test-failures · 지도 반영: not-applicable
> 최종 수정: 2026-10-18
> 기준: `bb48e2cbb729bed9a794c1f3f843b5cb028e1227` + `work/ui` 작업 변경

## 변경 범위

기능과 코드 경로를 제거하지 않고 승인된 내부 명칭만 바꾼다. UI 문구·정렬·검색 지연·확정/취소·계산·이력·저장 형식은 유지한다. 기존 보고서와 고정 fixture는 수정하지 않았다.

| 기존 명칭 | 현재 명칭 |
| --- | --- |
| `createLayerTreeController`, `createAppLayerTreeController` | `createObjectSearchController`, `createAppObjectSearchController` |
| `createLayerList`, `layerTreeItems` | `createObjectCatalog`, `listObjectCatalogItems` |
| `markLayerTreeDirty`, `layerTreeRevision` | `invalidateObjectPresentation`, `objectPresentationRevision` |
| `layerSearch*` | `objectSearch*` |
| `createLegacyMapHost`, `dragLegacyMapViewBy` | `createMapSurfaceHost`, `panMapViewBy` |
| `legacyGenericMetadata`, `legacyHydroStyle` | `captureSourceMetadata`, `combinedHydroStyle` |
| `initializeCountryGeometry` | `initializePolygonGeometry` |
| C++ `Layer`, `AddLayer`, `RemoveLayer`, `MoveLayer`, `SetLayerVisible`, `SetLayerLocked` | `UserLayer`, `AddUserLayer`, `RemoveUserLayer`, `MoveUserLayer`, `SetUserLayerVisible`, `SetUserLayerLocked` |

모듈은 `app-object-catalog.js`, `object-search-controller.js`, `object-search-model.js`, `map-surface-host.js`로 옮겼다. 관련 import·테스트 파일명·DOM ID·CSS 선택자·공통 앱/웹 입력 연결도 함께 갱신했다. CSS bundle은 원본 스타일에서 다시 생성했다. 이전 이름의 production alias는 추가하지 않았다.

객체 카탈로그의 새 provider 이름과 기존 상수 포트 이름이 겹치므로 상수 포트는 `objectDefinitions`로 구분했다. 카탈로그 조회 포트는 `objectCatalogView`, 표시 갱신 포트는 `objectDisplay`, 렌더 시 검색 갱신 콜백은 `objectSearch`다. 검색어와 표시 갱신 revision의 책임은 합치지 않았다.

C++ 사용자 레이어 조회·변경 API도 `userLayer`, `userLayers`, `addUserLayer`, `removeUserLayer`, `moveUserLayer` 등으로 통일했다. `MoveCountryToUserLayer`는 기존 소속 이동을 그대로 수행한다. `layer.add`, `layer.remove`, `layer.move`, `layer.visibility`, `layer.lock`, `country.move` 등 명령 ID와 모든 codec 문자열·저장 필드는 유지한다.

Native 프로필, 기존 codec과 레이어 명령, 지도 실행과 실패 시 재초기화, 수계 설정 변환, 폴더 모델의 기존 분기도 그대로 남아 있다. 실제 국가 자료의 `Country*`와 GIS·분포·GPU 레이어 이름은 변경하지 않았다. 과거 oracle의 export명·소스 경로는 그 원본을 불러오는 테스트 경계에서만 유지한다.

## 검증

- 카메라 API의 새 이름을 기존 검사에 먼저 적용해 실패를 확인한 뒤, 구현 변경 후 10개 통과.
- 연결 포트 및 지도 호스트 계약 11개 통과. 실제 앱이나 지도 화면은 시작하지 않았다.
- 최종 읽기 전용 검토에서 검색 렌더 콜백의 producer/consumer 이름 불일치를 발견했다. 기존 렌더 순서 기대값을 먼저 고쳐 실패를 확인했고, 연결을 맞춘 후 16개 통과. 렌더 구조 검사도 통과했다.
- UI component 검사(28 primitives, 145 static/dynamic buttons), 정보 구조 검사, 관련 Python 경계 검사 13개 통과.
- 수정 JS 101개 파일의 scoped ESLint 통과. 현행 JS 345개 파일의 구문과 정적 import 대상도 확인했다.
- 첫 명칭 변환 대상 115개 파일은 승인된 치환으로 원본에서 재현됨을 확인했다. 이후 렌더 콜백 3개 파일의 연결 이름만 보완했다.
- 변경 C++ 9개 파일은 새 식별자를 역치환하면 원본과 일치한다. 명령 ID·codec 필드·문자열·계산식·조건·variant 순서가 보존된다.
- Emscripten 4.0.20의 단일 작업 C++/WASM 빌드, package 및 실제 소스/ABI/컴파일러/바이너리 해시 검증이 통과했다. 계산 모듈은 같은 소스에서 다시 생성했으며 pin만 수동 변경하지 않았다.
- 검색·카탈로그·조립·UI controller 관련 6개 파일의 45개 검사에서 최초 40개 통과, 5개 실패했다. 동일 기준 main의 원래 테스트 이름으로 재실행해 5개 모두 같은 실패임을 확인했다.
- 이름을 바꾼 카탈로그 검사는 현재 timeline schema 2 입력을 과거 schema 1 oracle에 직접 전달하던 기존 오류였다. 테스트 경계에만 복사본 변환을 추가했다. property bindings가 비어 있음을 먼저 엄격히 확인하고 lifetime/geometry/parent 배열은 그대로 전달한다. 고정 fixture나 원본 oracle을 수정하지 않았으며, 이 검사 1개는 재실행해 통과했다.
- 남은 4개는 수정하지 않은 `ui-state-controllers.test.mjs`의 기존 저장 상태 테스트다. C++ 문서 상태를 읽는 필수 `getDocumentState` 포트 없이 옛 방식으로 controller를 생성해 실패한다. 제품 로직·이름 변경과 무관하며 그대로 기록한다. 이번 범위를 전체 검사 통과로 표시하지 않는다.

생성된 core 소스 pin은 `b126bdbbbd1a9fdcea482cf0d359cb50299dc79125103198e4cd57a0ed6ee5d4`다. JS SHA-256은 `2bfd9f4865b051d67d090fe36c284ed9e5f6ecade088416a11a2263563cd019b`, WASM SHA-256은 `638a1dd328b5cb8b02817430d9e6270158542c7814f1e20d20755dc15feb1bf7`이며 정본 기록은 `assets/wasm/pandoeditor-core.manifest.json`이다. 실행은 미커밋 작업본의 로컬 검증이며 배포 증거가 아니다.

주요 재실행 명령(정상적인 의존성 연결 환경 기준):

```text
node --test --test-concurrency=1 tests/unit/application-composition.test.mjs tests/unit/object-search-model.test.mjs tests/unit/object-search-controller.test.mjs tests/unit/core-object-catalog-wasm.test.mjs tests/unit/ui-controllers.test.mjs
node --test tests/unit/camera-navigation.test.mjs tests/unit/map-render-coordinator.test.mjs tests/unit/map-host.test.mjs tests/unit/capability-ports-contract.test.mjs
node scripts/check-core-prerequisite.mjs
```

pnpm junction 일부가 이전 워크트리 경로를 가리키는 기존 환경 문제는 고치지 않았다. 검사가 필요한 프로세스에서만 이미 설치된 동일 버전 패키지의 실제 위치로 연결하는 임시 loader를 사용했다(`node --import ./build-native/internal-naming/test-dependencies.mjs ...`). `node_modules`·프로젝트 의존성·checked-in 테스트 도구에 우회나 대체 구현을 추가하지 않았다.

## 범위 밖

앱·Qt·BAT·포터블·브라우저 화면·전체 세계 자료·전체 테스트는 실행하지 않는다. 로컬 core 빌드와 작은 fixture는 실제 화면 검증이나 배포 성공을 뜻하지 않는다. main 병합·커밋·푸시·배포는 포함하지 않는다. 다른 상설 워크트리의 미커밋 코드와 이전 조사 보고서는 보존한다.
