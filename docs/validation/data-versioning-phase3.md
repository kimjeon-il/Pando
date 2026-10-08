# 데이터 버전 관리 3단계 — 웹 런타임·캐시·검증기 전환

> 기준일: 2026-10-08. 적용 대상: 웹 `work/gis`만. 앱 소스·양쪽 `main` 구현·기존 Git 데이터 객체·구버전 자산은 변경/삭제하지 않음. 실제 배포는 별도 승인 대상.

## 1. 현행 Worker의 시작 경로 교체

- `assets/js/workers/data-loader-worker.js`: 기존 `world-preview-v${APP_VERSION}.json` 대신 `world/current.json` 로드.
- `assets/js/modules/world-bundle-manifest.js` 신규: `pandolab-world-bundle` schema 1, 정본 SHA 및 국가 수, 콘텐츠 SHA-256에 대응하는 **정확한** 파일명/경로, 압축·바이트 길이/바이너리 헤더, 국경선 캐시 경로 검증.
- `world/objects/*-sha256-*`의 실제 자산 URL은 버전 쿼리 없이 지정. 기존 SHA-256/크기/압축 검사는 `stored-asset-loader.js`가 계속 수행함.
- worker → `bootstrap.js`: 기존 `previewBaseline`, `labelAnchors` 및 staged preview/geometry/mesh 이벤트·프로젝트 로딩 순서를 유지. 별도 `sharedBoundaryCacheUrls`를 전달.
- 잘못된 세계지도 매니페스트/자산은 조용히 과거 데이터로 대체하지 않으며 기존 startup 오류 처리로 전달.

## 2. 데이터 캐시 분리

- `assets/js/modules/stored-asset-loader.js`: `cachePolicy: 'immutable'`을 사용하는 기본 세계지도 자산은 `pandolab-world-content-v1` Cache Storage를 사용.
- 기본 `cachePolicy: 'revision'` 경로는 이전과 같은 `pandolab-data-${dataRevision}`으로 유지해 `territorial-entity-loader.js` 역사 라이브러리 데이터의 독립 캐시를 보존.
- 같은 SHA-256 주소는 앱 프로그램 버전과 무관하게 재사용; 달라진 지리 자산만 새 URL로 다운로드한다.
- `cleanupOldCoreCaches`는 현재 catalog revision 캐시와 immutable world 캐시는 보존하고, 사용 종료된 구형 revision 캐시만 제거.
- Cache Storage 손상본은 삭제한 다음 재다운로드. 네트워크 오류 반복 요청은 HTTP 캐시 reload를 사용.
- bootstrap/GPU 렌더러의 보고용 `dataCacheName`도 실제 세계지도 콘텐츠 캐시를 가리키도록 정정.

## 3. 공유 국경선 캐시 하드코딩 제거

- `bootstrap.js` → `app-service-assembly.js` → `gpu-map-renderer.js`로 world manifest의 `compatibility.sharedBoundaries` 값을 전달해 캐시 URL을 구성.
- `tools/build-country-shared-boundaries.mjs`도 현재 world manifest의 preview source 및 국경선 캐시 출력을 읽음.
- 기존 `v0.34.0` 캐시 **파일은 유지**하며 바이트 수정 없이 호환. 무효/누락된 캐시는 기존 worker가 국가 geometry에서 재계산함.
- 이번 단계에서는 공유 국경선 캐시 자체를 콘텐츠 해시 이름으로 이동하지 않았다. 과거 배포에 대한 안전성·새 생성자 경로는 후속 검증 필요.

## 4. 데이터 파일명·앱 버전 분리 및 검증

- `scripts/generate-build-metadata.mjs`의 데이터 revision 계산 입력을 `world/current.json`으로 변경. 프로그램 release version은 UI/빌드 ID에만 사용.
- `tools/build-world-preview.mjs`는 더 이상 `package.json.version`을 자산 태그로 사용하지 않고 `world/build-input.json`의 고정 legacy 출력 기준으로 생성.
- `tools/build-world-mesh.mjs`는 현재 pinned legacy manifest에서 정밀 mesh 출력 경로를 읽음.
- `tools/validate-country-geometry.py`는 해당 pinned 입력의 preview를 검증.
- `scripts/check-version.mjs`는 버전별 네 파일 존재 검사 대신 세계지도 schema·불변 자산 경로 검사.
- `package.json`의 전체 지도 생성 순서는 `current-world → mesh → preview → world-bundle → shared-boundaries`. 원래 파일 바이트는 변경하지 않음.
- 지도 자산을 읽는 unit test helper·카리브해 지명/도형·국가 정본 parity·미리보기 정책·시작 성능 단위 검사 및 웹 브라우저 캐시/URL 시나리오와 Python runtime 경로 검사를 새 데이터 진입점에 맞춰 변경.

## 5. 검증 및 제한

- 기존 `assets/data/world/current.json`에 실제 schema 검증을 적용해 유효함을 확인. 변조된 트래버설 경로 거부를 확인.
- SHA-256 기반 다섯 세계지도 객체의 기존 바이트/Blob 동일성은 2단계 결과로 유지. 이번 단계에서 기존 바이너리를 다시 만들거나 변형하지 않음.
- 캐시 로더 모듈의 **실제 소스 코드**로 캐시 이름 선택 및 구형 캐시 정리 정책을 독립 평가했으며, immutable pool과 현재 catalog cache 보존을 확인.
- 새 manifest 계약의 분리된 로컬 Node 단위 검증: **2/2 통과**.
- 수정 후보 핵심 JS 파일 12건의 V8 구문 파싱 검사 **12/12 통과**(정적 parse 검사이며 실제 CI 구동을 뜻하지 않음).
- **최초 구현 당시 미실행**: `pnpm check:preview`, `pnpm test:unit`, Python 전체 검사, Web Worker/Playwright 실브라우저, 지도 GPU/Canvas 시각 회귀, GitHub CI와 실제 배포. **이후 실시한 집중 CI의 확인 결과는 아래 7절을 기준으로 한다.** 전체 Python·브라우저 회귀검사와 배포는 여전히 미실행.

## 6. 후속 이관

- 4단계 앱 동기화 전에 웹 `work/gis` 새 데이터 계약의 실제 빌드/브라우저 스모크와 국경선 캐시 재생성 동일성, 소스 변경시 레거시 번들 생산/보관 정책을 검증해야 한다.
- 앱은 `worldMapCommit`/SHA를 고정한 오프라인 사본으로 계속 실행하므로 새 웹 manifest가 있다고 자동 갱신하거나 대체하지 않는다.
- 수계 v0.13.0의 실제 의존 파일, 구버전 raster, 과거 릴리스의 `world-preview-v*` 등의 삭제는 6단계까지 보류한다.
- 공통 진행 기록은 현재 웹·앱 모든 브랜치에 갱신; 구현 코드는 웹 `work/gis`에 한정한다.

## 7. 실제 GitHub Actions 통합검증 (2026-10-09)

- 대상: 웹 `work/gis`, 최종 [검증 실행 #37804486287](https://github.com/kimjeon-il/Pando/actions/runs/37804486287), 원본 커밋 `dcc296ae80eb5d3f1db013962629358804e98846`.
- 상시 회귀 장치: [`.github/workflows/world-dataset-stage3-gate.yml`](https://github.com/kimjeon-il/Pando/blob/work/gis/.github/workflows/world-dataset-stage3-gate.yml). `work/gis`의 관련 소스/데이터 변경 시 검사한다. 현재 메인으로 코드 병합/배포는 하지 않음.
- 환경: GitHub Actions `ubuntu-24.04`, Node.js 22, pnpm 11.19.0, Python 3.11 + Shapely 2.1.2, Playwright Chromium.
- 구형 `terrain/v0.12.0`, `hydro/v0.12.2`~`v0.12.6`, GIS 연구 자료 등은 검증 전용 sparse checkout에서 제외. 국가 정본, 현재 패킷/미리보기/라벨, 필요한 수계, 현행 지형 manifest는 유지. 테스트에 필요한 오래된 소스의 존재 자체를 코드에서 제거하거나 소스 데이터 파일을 삭제한 것은 아님.

### 최종 실행의 실제 결과

| 검사 | 명령·범위 | 결과 |
|---|---|---|
| 국가 소스 및 정본 검사 | `pnpm check:country-schema` | 통과 |
| 미리보기 재생성·기존 결과 대조 | `pnpm check:preview` | 통과 |
| 공유 국경선 결과 대조 | `pnpm check:country-shared-boundaries` | 통과 |
| 불변 국가 번들 경로/해시 대조 | `pnpm check:world-bundle` | 통과 |
| 빌드 메타데이터 검증 | `pnpm generate:build-meta`, `pnpm check:version` | 통과 |
| JavaScript 구문 검사 | `pnpm check:js` (818개 JavaScript 파일) | 통과 |
| 변경 영역 ESLint | 생성기·Worker·매니페스트·캐시·대상 테스트 파일 | 통과 |
| 국가 번들·도형·공유 경계·캐시 단위검사 | 8개 대상 단위검사 파일, `node --test` | **33 통과 / 0 실패** |
| UI 빌드 | `pnpm build:ui-bundle` | 통과 |
| 실제 브라우저 검증 | Chromium: 모바일 DPR 제한, 캐시 재사용, 캐시 손상 후 복구 | **3 통과 / 0 실패** |

- GitHub Actions의 두 작업(`dataset-contract` / `chromium-smoke`) 모두 **success**. 데이터 검사와 실제 브라우저는 같은 최종 커밋을 체크아웃해 실행했다.
- 최초 실행 [#37802544830](https://github.com/kimjeon-il/Pando/actions/runs/37802544830)의 데이터 작업은 `tests/unit/stored-asset-content-cache.test.mjs`의 ESLint `TextDecoder no-undef`로 중단됨. 제품 코드 문제가 아닌 테스트 코드에서 Node `TextDecoder`를 import하지 않은 문제로, [`56256c515a04`](https://github.com/kimjeon-il/Pando/commit/56256c515a04e7a4908fef8313d1788b77341a2a)로 교정 후 통과했다.
- 대용량 레거시 파일이 체크아웃을 지연시키는 문제에 대응하여 sparse checkout을 적용. 설정 충돌(`filter` 입력이 `sparse-checkout`을 덮어씀)을 제거한 최종 커밋에서 두 검증 작업이 모두 통과한 것을 확인했다.

### 한계 및 4단계 인계

이 검증은 **3단계 변경에 직접 영향받는 대상 검사**다. 전체 `pnpm test` 및 Playwright 전체 브라우저 스위트, 별도의 장시간 GPU 부하·성능 벤치마크, 앱 Qt 빌드/오프라인 패키지 동작, OS 간 압축 재현성 전체 검사는 포함하지 않는다. `v0.34.0` 공유 경계 캐시 경로는 과도기적 호환 참조이며, 수계 `v0.13.0` 의존 파일도 유지해야 한다. 4단계 앱 데이터 동기화를 시작할 때 웹 데이터 묶음 SHA를 별도로 승인·고정하고 앱 포맷 호환성을 검사할 것.
