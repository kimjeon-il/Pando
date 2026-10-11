# 데이터 버전 관리 1단계 — 웹 GIS 자산 및 참조 기준선

> 정적 인벤토리: 2026-10-08. 기준 저장소 `kimjeon-il/Pando`, 고정 Git tree [`2b79bcbe48c2b725624a576c7746607771875a93`](https://github.com/kimjeon-il/Pando/tree/2b79bcbe48c2b725624a576c7746607771875a93) (`work/gis` 조사 시점).
> 이 문서는 조사 결과이며 자산·프로그램 코드·생성기·매니페스트를 변경하지 않는다. 개별 파일의 Git Blob ID와 크기는 고정 tree의 `git ls-tree -rl`로 다시 검증 가능하다.

## 1. 범위·현황

- `assets/data/**` 추적 자산 3,094개, 1,131,699,945 bytes. `assets/data/research/**`를 포함한 `work/gis` 기준이다.
- Git tree의 파일 목록은 생략·절단되지 않았음(`truncated=false`). 파일 크기와 Git Blob SHA는 GitHub git-tree API 기준.
- 구형 자산은 **삭제 대상 확정이 아닌 분류 대상**. 현재 실행 경로, 과거 배포 접근성, 회귀 fixture/원본 보관 여부를 먼저 구분한다.

| 자산군 | 파일 수 | 추적 파일 크기 합계 (bytes) |
|---|---:|---:|
| 미리보기 GeoJSON (8 버전) | 8 | 6,422,571 |
| 미리보기 GPU 메시 (8 버전) | 8 | 12,652,797 |
| 정밀 국가 패킷 (5 버전) | 5 | 25,610,209 |
| 세계지도 시작 manifest (8 버전) | 8 | 69,657 |
| 정밀 GPU 메시 (2 버전) | 2 | 29,245,643 |
| 공유 국경선 캐시 (preview/canonical) | 2 | 1,019,910 |
| 구형 지형 v0.12.0 | 335 | 374,094,147 |
| 현행 raster 지형 v0.12.6 | 335 | 367,620,868 |
| 구형 수계 v0.12.2–v0.12.6 | 1,769 | 153,982,948 |
| 수계 v0.13.0 (v0.13.1에서 참조) | 7 | 12,045,791 |
| 수계 v0.13.1 | 2 | 782,600 |
| 국가별 계보 소스 | 262 | 71,074,786 |
| 계보 스냅샷 소스 | 2 | 5,368 |
| 국가별 생성 catalog v2 | 285 | 6,908,449 |
| 현재 세계지도 생성본 | 1 | 12,415,783 |
| 연구용 GIS 자료 (work/gis) | 54 | 23,264,055 |

## 2. 현재 기본 세계지도 manifest의 주요 자산

`0.36.0` 시작 manifest(`assets/data/world-preview-v0.36.0.json`)는 현재 프로그램 버전을 파일명에 사용한다. 검증 대상 아래 Git Blob ID는 **SHA-1 Git 객체 ID**이며 manifest의 SHA-256과 혼동하지 않는다.

| 파일 (assets/data 기준) | 크기 (bytes) | Git Blob SHA |
|---|---:|---|
| `territorial-entities/generated/current-world.geojson` | 12,415,783 | `563cb4b45da28eb9367abf23bf111b1636b85c97` |
| `countries-ne-5.1.1.geojson` | 12,415,783 | `563cb4b45da28eb9367abf23bf111b1636b85c97` |
| `countries-preview-v0.36.0.geojson.gz` | 917,549 | `f043224745b737e1759729acc03bb1ea499da853` |
| `world-mesh-preview-v0.36.0.bin.gz` | 1,733,548 | `caff1ab319706f6bf90635ed5a992ffbf4f2a84a` |
| `countries-canonical-v0.36.0.pcg.gz` | 5,122,041 | `e9905b9d6a03ab71d49fb67199e9e37fa3ff78ce` |
| `world-mesh-v0.12.6.bin.gz` | 14,619,043 | `8c73420b92e89ab64cbe75dcc5016efe2c0a22b6` |
| `country-label-anchors-v0.10.1.json` | 13,826 | `c29a00e0b991e922a9d09ee1ea5bfcda476c0ba8` |
| `countries-preview-shared-v0.34.0.json.gz` | 176,957 | `5833b02680c528a428cec4e1cff496b1dcb7d790` |
| `countries-canonical-shared-v0.34.0.json.gz` | 842,953 | `c545fbd480ef4be992064644085468474e268f81` |
| `hydro/v0.13.1/manifest.json` | 52,975 | `9a9cdb719351e51d2ff509c410cae8741ac36a0a` |
| `hydro/v0.13.1/metadata-core.json.gz` | 729,625 | `625ce46f50ae0c0fccee1c878cf8f36280dba7f4` |
| `terrain/v0.12.6/manifest.json` | 2,024 | `6821c49315ffd381758f81dfe4d83b6b574f0ad4` |
| `places/manifest.json` | 108 | `03871489b601b2e1bc0900aec0116ab938ab6936` |
| `territorial-entities/generated/v2/index.json` | 557,000 | `8419714e5fbe8f95fec3a19fb550d261641f3d84` |

정본 계보 출처: `territorial-entities/source/countries/` → `tools/build-territorial-current-world.mjs` → `generated/current-world.geojson` → `tools/build-world-preview.mjs`(미리보기/PCG/미리보기 메시) · `tools/build-world-mesh.mjs`(정밀 메시) · `tools/build-country-shared-boundaries.mjs`(국경 캐시) → 시작 manifest → Worker/renderer. 데이터/알고리즘 변경 시 의존 산출물 전체 재검증 필요.

## 3. 참조 관계 및 갱신 경로

| 역할 | 코드·설정 | 현행 계약 / 위험 |
|---|---|---|
| 시작·로더 | `assets/js/workers/data-loader-worker.js` | `world-preview-v${APP_VERSION}.json` 불러오기; manifest의 `version === APP_VERSION` 요구 |
| 파일 생성 | `tools/build-world-preview.mjs` | `package.json` 버전으로 preview/PCG/mesh/manifest 파일명 구성 |
| 정밀 메시 생성 | `tools/build-world-mesh.mjs` | `world-mesh-v0.12.6.bin.gz` 고정 기본 출력 |
| 국경 캐시 생성 | `tools/build-country-shared-boundaries.mjs` | `countries-preview-v0.34.0.geojson.gz` 입력 / `*-shared-v0.34.0` 출력 고정 |
| 국경 캐시 실행 | `assets/js/modules/gpu-map-renderer.js` | `countries-{preview|canonical}-shared-v0.34.0.json.gz` 참조. 런타임 정렬/재계산 로직 보존 필수 |
| 기본 데이터 캐시 | `assets/js/modules/stored-asset-loader.js` | 전역 `dataRevision`으로 Cache Storage namespace 구성; SHA-256/길이 무결성 검사 유지 |
| build metadata | `scripts/generate-build-metadata.mjs` | 현재 `world-preview-v${appVersion}.json` 경로를 데이터 해시 입력에 포함 |
| 파일 존재 검증 | `scripts/check-version.mjs` | 앱 버전별 패킷·preview·mesh·manifest 필수 존재 검사 |
| 도형 검증 | `tools/validate-country-geometry.py` | 앱 버전별 미리보기 파일 선택, 258개·ID/순서·폴리곤 검증 |
| CI | `.github/workflows/application-architecture.yml` | `pnpm check:preview` / 데이터·아키텍처 검증. 새 경로를 도입하면 함께 이전 |
| Raster 지형 | `assets/js/modules/terrain-manifest.js` | `terrain/v0.12.6/manifest.json` 현행 fallback. 기존 v0.12.0은 보관 후보 |
| DEM 지형 | `assets/js/modules/app-environment.js` | 외부 `world-map-terrain-v0.13.0`에서 DEM `v0.13.3` 로딩. raster와 버전 계약 다름 |
| 수계 | `assets/data/hydro/v0.13.1/manifest.json` | v0.13.0 바이너리 참조. 단계 1에서 v0.13.0 제거 금지 |
| 지명·계보 | `assets/data/places/manifest.json`, `territorial-entities/generated/v2/index.json` | 도메인별 매니페스트/지연 로딩. 국가 시작 시 catalog 전체를 동시 로드하지 않음 |

### 수계 v0.13.1의 실제 참조 확인

| 용도 | 실제 파일 경로 (assets/data 기준) | Git tree 크기 확인 |
|---|---|---|
| index | `hydro/v0.13.0/index.bin.gz` | 존재·크기 일치 |
| core metadata | `hydro/v0.13.1/metadata-core.json.gz` | 존재·크기 일치 |
| detail metadata | `hydro/v0.13.0/metadata-detail.json.gz` | 존재·크기 일치 |
| shard 0 | `hydro/v0.13.0/shards/s0.bin` | 존재·크기 일치 |
| shard 1 | `hydro/v0.13.0/shards/s1.bin` | 존재·크기 일치 |
| shard 2 | `hydro/v0.13.0/shards/s2.bin` | 존재·크기 일치 |

검사한 활성 파일: 웹 시작 manifest의 5개 엔트리 모두 경로·압축 저장 크기 일치. 수계 참조 6개 모두 경로·크기 일치. 2개 현행 manifest의 SHA-256 값을 재계산한 바이트 무결성 실험이나 브라우저 네트워크 회귀를 수행한 것은 아니다.

## 4. 동일 내용 중복 및 교차 저장소 비교

- `assets/data/**` 내 동일 Git Blob이 2회 이상 존재하는 그룹 68개; 첫 복사본을 제외한 파일 크기 합 79,047,853 bytes. Git 객체 저장은 동일 Blob을 내부적으로 재사용할 수 있으므로 이를 곧바로 원격 Git 절감량으로 간주해서는 안 된다.
- 0.30/0.31 미리보기 GPU 메시: Git Blob 동일
- 0.33–0.36 미리보기 GPU 메시: Git Blob 동일
- 0.34–0.36 정밀 국가 패킷: Git Blob 동일
- 원본 국가 GeoJSON / generated current-world: Git Blob 동일
- 지형 `v0.12.0`와 `v0.12.6` 타일 335쌍 중 같은 Blob 60쌍(약 44.3 MB), 다른 Blob 275쌍. 지형 버전 간 단순 동일 파일로 간주하지 말 것.
- 앱 `assets/world` 6개 고정 자산 Blob은 대응하는 웹 버전별 파일과 일치(앱의 정밀 패킷은 v0.33.0, 웹 활성은 v0.36.0).
- 앱 국명 anchors Blob과 웹 anchors Blob 동일; 앱 hydro v0.13.1 manifest Blob과 웹 manifest Blob 동일.
- 웹 `territorial-entities/generated/v2/`와 앱 `territorial-library-v2/`는 동명 파일 285개, 동일 Blob 194개, 상이 Blob 91개. gzip 바이트 차이인지 실질 자료 차이인지 **미판정**.

## 5. 위험 구분·후속 이관

| 구분 | 예시 | 1단계 판단 |
|---|---|---|
| 현재 사용 중 (절대 임의 삭제 금지) | v0.36.0 패킷/preview/mesh, 정밀 v0.12.6, 국명 anchors, 공유 경계 v0.34.0 | 실제 실행 참조 유지 |
| 다른 버전이 참조하는 자산 | hydro v0.13.0 (v0.13.1의 참조 대상), raster v0.12.6 (DEM fallback) | 삭제 금지 |
| 내용 동일 중복 후보 | v0.33–0.36 preview mesh, v0.34–0.36 PCG | 2~3단계에서 콘텐츠 기반 공통화 |
| 현재 실행 경로와 별도인 과거 데이터 | raster v0.12.0, hydro v0.12.2–0.12.6, 예전 시작 manifest | CI·과거 배포·재현 참조 확인 후 6단계 보관/정리 |
| 출처/생성물 역할 구분 필요 | `countries-ne-5.1.1.geojson`와 `generated/current-world.geojson` 동일 Blob | 정본 source와 generated의 의미 보존 |
| 불변 검증 재료 | `tests/fixtures/**`, `reports/**` | 이 단계에서 제거 금지 |

## 6. 기준선 검사 및 제한

- 조사 방법: GitHub API의 고정 Git tree 파일명·Git Blob SHA·바이트 크기, 실제 manifest JSON과 소스 코드 경로 읽기.
- 웹 5/5 현재 시작 자산, 앱 6/6 고정 자산, 수계 참조 6/6: **정적 메타데이터 교차 검사 17/17 통과**.
- 도형 자체의 좌표 동등성, 데이터 압축 해제 결과, 앱/웹 수계 셰이프 동등성, GPU/Canvas 화면, 로컬 성능, CI 회귀는 이번 단계에 새로 수행하지 않았다.
- 웹 소스 `package.json`(프로그램 버전)과 데이터 자산 저장을 분리하되 현행 매니페스트와 파일을 병행 검증한 뒤 교체한다. 중복 내용 파일 삭제는 6단계까지 보류한다.
