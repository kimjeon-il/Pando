# 지도 렌더링 P0·P1 — 소유권, 기준선, 동적 벡터 LOD

기준: 2026-11-10 / `work/gis`. 이 문서는 지도 표시용 preview 폐기 계획의 P0·P1 작업 기록이다.
**메인 병합·배포·기존 preview 제거·DEM 전환은 이 작업에서 수행하지 않는다.**

## 1. P0 — 자료·프레임 계약

| 소유 영역 | 기존 실구현 | 정본·파생물 책임 |
| --- | --- | --- |
| 프로젝트 식별 및 자료 선택 | `src/data/map-project-manifest.js`, `map-project-runtime.js` | `projectId`, 카탈로그 역할과 SHA-256 영수증이 자료 정본을 선택. 기본 세계지도 URL을 다른 프로젝트에 임의 전용하지 않음 |
| 국경·해안·국가 편집 정본 | `src/document/project-state.js`, `src/geometry/geometry-version-store.js`, 국가 객체의 시간별 소유 데이터 | 저장·편집·면적·선택은 정본을 따름. 표시용 LOD 좌표를 역기록하지 않음 |
| 국가 메시 정본 식별 | `src/rendering/country-mesh-content-key.js`, `country-mesh-preparation.js`, `gpu-map-renderer.js` | 콘텐츠 해시, 기하 리비전과 프로젝트 세대를 구분. 완성된 canonical mesh는 렌더링 기준선 |
| 프레임 카메라·장면 | `map-visual-frame.js`, `map-render-publication.js`, `render-scene.js` | 불변 `MapVisualFrame`이 `projectGeneration`, 카메라, 투영, CSS scale, DPR, viewport를 고정. 공개 이미지 키는 장면·기하·색상 리비전을 포함 |
| 동적 벡터 표시 LOD | `render-lod.js`, `gpu-mesh-worker-jobs.js`, `workers/gpu-mesh-worker.js`, `gpu-map-renderer.js` | sourceKey와 화면 오차 버킷을 가진 폐기가능 파생 메시. Worker는 정본을 변경하지 않고 결과만 전달 |
| 프레임 자원/적응 예산 | `adaptive-render-quality.js`, `render-quality.js`, `runtime-performance-metrics.js` | CPU/GPU 업로드·캐시·프레임 예산과 벡터의 **기하 정확도**를 분리 |
| 지형·육지 마스크 | 현재 `physical-land/v1`·기존 terrain 경로 | P2/P3 대상. 이번 단계에서 기존 해안선 판정이나 DEM 구성 변경 없음 |

LOD 응답 키는 `projectGeneration:geometryRevision:sourceContent:meshAlgorithm:bucket:visibleCountryIds`의
결합으로 구분한다. 프로젝트·시점·정본 수정·배율 버킷 중 하나라도 바뀌면 이전 응답은
수용할 수 없다. 재생성 준비 중에는 이미 채택된 정식 canonical mesh가 표시를 담당한다.

### 미리보기 참조 그래프(폐기 대상 식별만 수행)

- `initial-land-preview` → 첫 화면 SVG 육지 레이어 → 정식 프레임 전환: **P5 삭제 예정**
- `previewCountries` / `previewMesh` → preview/canonical 품질·인증·GPU 변형 경로: **P5 삭제 예정**
- `terrain-preview/v0.13.3-p2` / `raster-rgba-v1` → 고정 RGB 지형 표시: **P3 대체 후 P5 삭제 예정**
- `canvasPreviewAtlas` 및 Canvas Worker의 독립 raster 경로 → **P4 통합 후 P5 삭제 예정**
- `physical-land/v1`, 편집용 임시선, 배포 QA preview: **삭제 대상 아님**
- 국가 메시의 `spatialBlocks` / 준비된 정점 중요도 인덱스: 정식 표시 파생물로 유지

파일명에 preview가 있다는 이유만으로 일괄 삭제하지 않는다.

## 2. P1 — 구현한 동적 벡터 LOD

1. 국가 Polygon/MultiPolygon 정점의 공유 edge graph와 연결된 arc에 대해 하나의
   중요도 순위를 생성한다. 서로 역방향으로 저장된 국경도 동일 arc 순위를 사용한다.
2. 지구본 3차원 chord와 평면 경위도 투영의 오차 중 큰 값을 적용한다. 목표 한도는
   **0.5 CSS px**이며, 화면 배율에 대해 **상향 반올림한 버킷**을 사용한다.
   정점 단순화뿐 아니라 C++ 메시 엔진에 전달하는 **내부 삼각형 최대 변 길이**도
   화면에서 보이는 구면 chord/sagitta 오차로 산정한다. 축소 시 더 긴 변을 허용하고
   확대 시 기본 최대 변 길이 0.499°를 향해 정밀해진다.
3. 확대 시 즉시 정밀도를 높이고 축소 시 15% 히스테리시스를 적용한다. 선택 객체는
   원본을 보존하고 인접 국가의 공유 경계 정점도 함께 보존한다.
4. 해안·국경 접합점, 세 국가 이상의 교차점, 날짜변경선·고위도, 구멍을 보호한다.
   유효 고리·방향 조건과 도출된 **공유 경계 구간의 양쪽 일치성**에 실패하면
   국가별 부분 폴백 대신 전체 파생 프레임을 폐기한다. C++ 메시 코어의
   validate 검사에 실패하더라도 이미 표시 중인 정본 메시를 계속 사용하며
   불필요한 전체 삼각분할은 수행하지 않는다.
5. 메인 스레드가 아닌 별도 LOD Worker에서 메시 준비·공간 블록 분할·Stroke 생성을
   수행한다. 화면에 보이는 국가만 위상 인덱스·삼각분할 대상으로 삼되,
   정본 국가 슬롯 순서를 유지한다. 정본은 Worker에 **소스당 한 번만** 전송하고
   이후 확대·이동은 버킷·가시 국가 집합만 전달한다. 120ms 지연으로 잦은 휠·
   이동 요청을 묶으며 불필요한 Worker 재시작을 줄인다.
6. WebGL 메시 변형은 `canonical`과 `lod`로 구분해 유지한다. 실제 픽킹·편집·
   선택 경계/Stroke는 canonical, 표시는 조건이 충족된 경우에만 lod. GPU 버퍼가
   완전히 준비되기 전에는 교체하지 않는다. 새 LOD가 정본보다 크거나 메모리
   예산을 초과하면 업로드하지 않고 기존 정식 메시를 유지한다.
7. 국경 스트로크의 정본 출처·공유 경계 작업은 LOD에서 canonical의 identity를
   계속 사용하며, 새 LOD 수용 시 기존 색상/장면 캐시를 무효화한다.
8. Worker 실패·유효성 검증 실패·동일 버킷에서 정점 감소 없음·프로젝트 변경 시에는
   canonical 표시로 복구한다.

**대형 국가 내부 증분 처리(추가):** 기존 canonical triangle BVH에서
현재 프레임에 보이는 leaf의 지리적 포락선을 추출한다.
정식 메시에서 12,000개 이상의 삼각형을 가진 일반적인 국가에 한하여
그 포락선이 걸치는 전 지구 **5° 격자**를 선택한다. 512개 leaf/
국가당 96개 tile/전체 192개 tile 안전 예산을 초과하거나 고위도·날짜변경선을
다루는 형상은 기존 정식 메시로 되돌린다. Viewer의 프레임 키에 지역 타일 키를
포함하므로 **같은 국가 ID·동일 배율에서 이동해도 새 타일은 반드시 다시 준비**한다.

Worker는 C++ `polygonOperation('intersection')`으로 지역 내 해당 폴리곤을
잘라 표시 전용으로 삼각분할하며, 기존 `country-mesh-preparation.js`가
타일별 digest·정점 버퍼를 개별 캐시한다. 같은 국가의 다수 타일을
**국가 슬롯 한 개**로 조립한다. 이동 중 기존 타일·타국의 결과를 재사용하고,
오래된 뷰는 버린다. 타일 실패나 부정합은 수용하지 않고 canonical GPU
프레임을 유지한다. 이는 **국가 전체 재삼각분할을 줄이도록 구현한 기능**이며
아직 실제 세계 국가에서 성공적으로 렌더링했음을 인증하지는 못한다.

**범위 한계:** 위상 검수와 실기기 결과가 통과하기 전까지 P1의 최종
완료 판정을 보류한다. 기존 Canvas Worker·Canvas2D의 동일 LOD 소비는 P4 범위다.



### 현재 검증 범위

별도 위상 감사·성능 benchmark 실행기는 유지하지 않는다. Viewer 표시·fallback·context 복구는 [핵심 검증 정책](../policies/validation.md)을 따른다. 실제 GIS 정확성은 승인된 자료 변경과 필요한 입력만 검토하며 화면 표시 통과를 원자료 검증으로 해석하지 않는다.

## 3. 과거 측정의 한계

과거 장비·시나리오의 성능 수치는 현재 통과 조건이 아니다. Viewer 동작 검증에 별도 성능 측정 실행기를 유지하지 않는다.

## 4. 집중 검증 및 완료 보류

- 단위 계약: `tests/unit/rendering/screen-geometry-lod.test.mjs` — 역방향
  공유 국경, 오차, 확대·축소, 선택 객체, 구멍/날짜변경선, 입력 불변성,
  가시 국가 스코프와 국가 슬롯 보존
- 기하 단위 테스트에는 구면 chord/sagitta 오차와 배율별 메시 분할 한도 검사도 포함한다.
- 가시성·전송: `tests/unit/rendering/visible-country-lod.test.mjs`,
  `tests/unit/rendering/gpu-mesh-transfer.test.mjs` — 평면/지구본,
  최초 정본 전송·Worker 재사용·취소·오래된 프레임 거부
- 실 화면 회귀: `tests/browser/rendering/map-vector-lod.spec.mjs`
  — 프로젝트 프레임 수용, 지역 이동, 새 가시성 키, 정본 유지
- 브라우저 실측: 위 옵트인 벤치마크 + WebGL2/1, 한국·독일 고배율,
  역사 시점·프로젝트 전환 중 프레임 무결성
- 진행 단계 P2~P6 범위는 여기서 다루지 않는다.
- P1 최종 승인 보류 사항: 실제 세계 정본의 공유 국경·해안선 위상 검증,
  공간 타일 클리핑의 실제 WebGL 프레임 검수, 실기기 성능 비교.
  Canvas와 공통 LOD 정책·타일 선택의 완전한 통합은 P4 범위.
- 검증 구분: 현재 JS 동작 자체 검사는 화면 오차·국경·가시성·Worker 재사용의
  **합성 자료 기반 자가검사**다. 이 결과를 실제 브라우저 실측 또는 전세계
  GIS 정본의 검수 완료라고 표기하지 않는다.
