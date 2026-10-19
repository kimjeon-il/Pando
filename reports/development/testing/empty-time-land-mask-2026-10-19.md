# 객체가 없는 시점의 육지 소실 원인 조사

> 보고서 ID: `UI-EMPTY-TIME-LAND-20261019` · 상태: `reproduced / cause-confirmed / not-fixed / native-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-19
> 조사 기준: `work/ui`·main `264fff61b7f4138c9f19d56d2ef8bc917dce5730`, 게시 소스 `e401fa2980dad6662a915e4c9779206adcc2f0db`, build `0.36.0-build-da7b744937ec`
> 근거: 사용자 화면, 공개 사이트의 실제 시점 이동과 픽셀, [진단 JSON](empty-time-land-mask-2026-10-19.evidence.json), 공통 영토 읽기 모델과 두 렌더 경로

## 재현

별도의 소유 Edge 브라우저에서 공개 사이트를 열고 Canvas Worker를 강제했다. 사용자 브라우저는 조작하지 않았다. 지도 창은 1280×800 CSS px, 지구본 배율 16, 홍콩 중심이며 실제 육지 좌표 `[114.15,22.35]`를 비교했다. 원본 사이트의 Worker 소스나 응답을 바꾸지 않고 전달 메시지의 개수와 공개 디버그 상태를 관찰했다.

| 단계 | 육지 픽셀 RGBA | 루트 형상 수 | 해당 화면의 하위 영토 packet | 상세 지형 | 하단 상태 |
| --- | --- | --- | --- | --- | --- |
| 2026-10 | `[142,144,128,255]` | 207 | 4 | DEM 6개, terrainComplete=true | 객체 254개 |
| 2026-09 | `[106,166,207,255]` | 5 | 0 | DEM 6개, terrainComplete=true | 객체 254개 |
| 2026-10 복귀 | `[142,144,128,255]` | 207 | 4 | DEM 6개, terrainComplete=true | 객체 254개 |

9월에도 다른 지역의 루트 형상 5개가 남으므로 전 세계 객체가 모두 0개라고 해석하지 않는다. 제보 지역을 덮는 형상이 빠지는 것이 핵심이다. 모든 단계에서 document revision/checkpoint는 0, dirty/documentDirty/presentationDirty는 false였다. 시점 cursor만 10월→9월→10월로 바뀌고 다시 원래 육지가 복구됐다. runtime pageerror는 없었다. 지형 타일이 미완성이거나 문서가 삭제된 증거는 없다.

## 원인

육지 바탕과 지형의 육지/바다 선택 마스크가 물리 지형의 독립적인 육지 자료를 따르지 않고, 해당 시점에 표시되는 영토 객체 형상을 사용한다.

1. `territorial-entity-store.js`는 C++가 해당 시점으로 해석한 `documentModel.territorialViews()`를 제공한다. `territorial-entity-repository.js`와 `builtin-session.js:builtinTerritorialScene()`은 그 객체를 받아 루트·하위 표시 형상을 구성한다.
2. `viewer-map.js:update()`는 시점 변경 후 이 루트 목록으로 지도를 다시 준비한다. 9월에 목록이 207→5로 바뀌어 제보 지역을 덮는 영토와 하위 packet이 없어졌다.
3. Canvas의 `canvas-render-worker.js:renderTerrain()`는 색채 DEM의 ocean 이미지를 먼저 그린 뒤, `visibleLand`와 `territorial-fill` packet을 합친 clip 안에만 land 이미지를 덮는다. 해당 지역의 영토가 빠지면 land 덮기가 없어지고 ocean 이미지가 남는다.
4. `canvas-terrain-dem-core.js`의 ocean 변환은 고도 양수에서도 수심을 0으로 clamp해 얕은 바다색을 만든다. 음영 자체는 DEM에서 계속 계산하므로 산 모양이 남은 파란 대륙이 나타난다. WebGL의 `terrain-dem-shaders.js:seaColor()`도 같은 계산이다.
5. WebGL의 `gpu-base-scene-pass.js` 역시 현재 국가 mesh와 하위 territoryItems로 stencil을 만든 뒤 stencil 바깥에 ocean, 안에 land를 그린다. 따라서 같은 잘못된 의존성이 코드상 존재한다. 이번 실제 브라우저 재현은 Canvas이며 WebGL 및 네이티브 앱에서 시점 전환을 다시 실행한 결과로 확대하지 않는다.

이 관계는 직전 성능 최적화 이전 `f48aa402`의 Canvas 경로에도 이미 존재한다. 현재 substrate 캐시는 영토 목록 변화를 반영해 갱신되고, 복귀 시에도 정상 갱신됐다. 캐시가 오래된 육지 이미지를 붙잡는 현상으로 설명되지 않는다.

## 하단 개수 표시

`viewer-composition.js`의 시점 변경 처리는 cursor 변경→map.update→search 갱신으로 끝난다. 하단 개수는 파일 열기 완료 또는 selection presenter 해제 경로에서만 다시 기록된다. 그래서 표시 대상이 바뀌어도 기존 '객체 254개'가 그대로 남았다. 이는 현재 지형 마스크가 채워져 있다는 근거가 되지 않는다.

## 수정 방향과 범위

기본 물리 육지와 영토 객체의 시간별 표시를 분리해야 한다. 객체가 없거나 모두 숨겨진 경우에도 배경 육지/지형은 유지하고, 영토 색상·경계·이름만 현재 시점을 따라야 한다. 객체가 없을 때만 현대 국가 목록을 임시로 끼우는 fallback은 부분적으로 비는 지역과 숨김 상태를 일관되게 해결하지 못한다. 고도 0m 이상만 육지로 삼는 임시 판정도 간척지·해수면 아래 육지 등 실제 육지 자료와 같다고 볼 수 없다. 어떤 독립 물리 육지 자료를 정본으로 쓸지는 구현 시 기존 지형 자산 소유자에서 확인해야 한다.

이번 요청은 원인 조사이며 제품 코드·저장 데이터 수정, commit/push·추가 배포는 하지 않았다. 진단 자료와 보고서·색인만 추가했다. 기존 미커밋 작업과 결과 파일은 보존했다. 단위/전체 검사·네이티브/실기기 검사는 추가 실행하지 않았다.

## 구현 후속

이 조사의 구현·검증 후속은 [UI-SHARED-VIEWING-20261019](shared-viewing-cleanup-2026-10-19.md)에 기록한다. 이 문서의 당시 조사·배포 상태를 새 검증 결과로 소급 변경하지 않는다.
