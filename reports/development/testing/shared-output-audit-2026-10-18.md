# 출력 외 전부 공유 기준의 추가 조사와 독립 코드 잔존 확인

> 보고서 ID: `UI-SHARING-AUDIT-20261018` · 상태: `audit-complete / follow-up-linked` · 지도 반영: `not-applicable` · 색인일: 2026-10-18
> 원문 최종 수정: 2026-10-18
> 조사 기준: 웹/앱 제품 코드 `4273bca1298c42fcb5a1bca8570b7b26387f3de8` · 보고서 작업 브랜치 `work/ui` 시작 `71afae2f0e0f4e64328ebf5e71a622bd1be58799`
> 요구 기준: 한쪽에만 출력/등록하는 기능을 제외하면 문서·탐색·검색·표시·설정·상태 규칙은 같은 소유자와 구현을 사용한다.

## 결론

독립 구현 삭제가 끝나지 않았다. 직전 수정은 기존 앱 함수 일부를 실제로 옮겼지만, 웹의 상위 실행/상태/렌더링/입력/문서 교체 경로를 유지한 채 작은 공통 함수를 연결한 상태다. 이전 보고서에서 제품별 연결로 설명했던 잔존 코드도 이번의 더 엄격한 기준에서는 상당 부분 통합 대상이다.
공통 함수를 호출한다는 사실과 같은 규칙·상태 소유자를 공유한다는 사실을 구분해야 한다. 실제로 숨긴 객체 검색과 콜론 포함 ID 선택에서 동작 차이를 재현했다. 검색 요구에 대한 최신 판단은 아래 정정 사항을 따른다.

## 구현 중 요구 정정 — 검색 대상

2026-10-18 사용자 확인: 검색 대상은 **선택한 연월에 존재하면서 표시가 켜진 객체 전체**다. 현재 화면 밖에 있다는 이유로 제외하지 않는다. 숨긴 객체까지 검색해야 한다는 이전 S07 권고는 철회한다. 숨긴 객체의 웹/앱 차이를 재현했다는 조사 사실은 유지하되, 그 차이에서 앱의 기존 동작을 정답으로 간주했던 판단을 정정한다.

S07의 구현 기준은 전체 객체 목록을 별도 검색 모델로 복제하는 것이 아니라, 공통 객체 조회에서 현재 연월의 존재 여부와 공통 표시 설정을 함께 판정하는 것이다. 전체 객체 목록은 편집 관리 용도로 유지할 수 있으며 검색 결과와 구분한다. 해당 기간이 아닌 지명·일반 객체·수계·분포도 검색에서 제외한다. 내장 지명의 시간 정보는 해당 자료가 제공하는 범위에서 사용하며, 자료에 없는 역사적 존재 사실을 추정하지 않는다.

## 코드 증감: 생성물과 원본을 구분한 결과

Git `2574f1e0..4273bca1` 비교. 수치는 파일의 공백·주석을 포함한 물리적 줄이며, 문자 수는 Git LF 원문 기준 UTF-16 code units다. 코드 품질을 줄 수만으로 판정하지 않지만, 이번에는 중복 경로가 남아 있는지도 함께 조사했다.

| 종류 | 추가 | 삭제 | 순증 |
| --- | ---: | ---: | ---: |
| JS 모듈 원본 | 639 | 510 | **+129** |
| CSS 원본 | 6 | 48 | -42 |
| 생성 CSS bundle | 440 | 4 | +436 |
| HTML과 생성 import map | 717 | 570 | +147 |
| 테스트 | 173 | 35 | +138 |
| 보고서 | 110 | 0 | +110 |
| 빌드 메타데이터/도구 설정 | 4 | 4 | 0 |

JS 모듈 원본은 **9,882문자 순증**했다. 전체 증가를 생성물·테스트 때문이라고 설명할 수 없다. 최초 분리 직전 `904a5cf6..4273bca1`을 비교하면 JS 모듈 42개에서 1,501줄 추가/600줄 삭제로 **+901줄**이다. 여기에는 필요한 읽기 전용 정책도 있으므로 전체를 불필요 코드로 분류한 수치는 아니다.

삭제한 원본도 있다. 설정 바인딩, 모바일 시트의 계산/제스처, pan 계산, empty state, tspan 갱신, 객체 제목 표시 등은 앱의 기존 본문을 제거하고 공통 소유자로 이동했다. 다만 다음 웹 전용 실행 경로가 계속 동작한다.

| 잔존 파일 | LF 기준 줄 | 문자 |
| --- | ---: | ---: |
| `assets/js/viewer.js` | 8 | 373 |
| `assets/js/modules/viewer-composition.js` | 188 | 15712 |
| `assets/js/modules/viewer-map.js` | 279 | 22398 |
| `assets/js/modules/viewer-places.js` | 95 | 6185 |
| `assets/js/modules/viewer-scene-items.js` | 127 | 9549 |
| `assets/js/modules/viewer-project-reader.js` | 28 | 1519 |
| `assets/js/modules/viewer-session.js` | 44 | 1762 |
| 합계 | **769** | **57,498** |

이 769줄 전체가 삭제 대상이라는 단순 판정은 아니다. 8줄짜리 제품 시작점은 남을 수 있다. 나머지 파일의 책임을 아래 공통 소유자로 흡수한 뒤 독자 동작·상태·별칭을 제거해야 한다.

## 아직 공유하지 않는 책임

P1은 기본 열람 동작·상태/문서 일관성·공유 구조를 먼저 바로잡아야 하는 항목이다. 아래의 “소스 확인”을 브라우저/실기기 검증 통과라고 해석하지 않는다.

| ID | 영역 | 우선순위 | 근거 | 확인한 차이 | 통합 소유자와 제거 대상 |
| --- | --- | --- | --- | --- | --- |
| S01 | 상위 실행·상태 | P1 | [composeViewer](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-composition.js#L24) / [독립 지도 상태](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-map.js#L29) | 앱 조립과 별도로 문서 교체·검색·상태·카메라·레이어·선택을 연결한다. 공통 함수 몇 개를 불러도 실행 흐름과 view state의 소유자가 분리되어 있다. | 기존 조립 경로에서 지도/문서/열람 공통 구성을 분리하고 편집 기능만 추가 등록. viewer-composition의 동작 구현과 viewer-map의 별도 상태 제거. |
| S02 | 장면 구성·표시 규칙 | P1 | [buildViewerSceneItems](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-scene-items.js#L13) / [기존 일반 객체 표시](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/rendering-domain.js#L647) | 영토·일반 객체·수계·지명·분포를 다시 순회해 fill/stroke/point/searchItems를 구성한다. renderer와 스타일 함수가 같아도 무엇을 어떤 순서로 그릴지는 별도 구현이다. | 기존 rendering-domain/scene 자원 소유자에서 편집 표시 확장만 분리. viewer-scene-items 전체와 별도 선택 stroke 조립 제거. |
| S03 | 투영·카메라·맞춤 이동 | P1 | [별도 프레임](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-map.js#L112) / [기존 시점 스냅샷](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-map-host.js#L50) / [기존 객체 맞춤](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-camera-navigation.js#L122) | 공유한 것은 pan delta 계산뿐이다. 웹은 단일 zoom 1–64, 앱은 globe 0.72–32/flat 0.75–64. 웹 focus는 중심+최소 zoom 3, 앱은 객체 범위와 패널 안전 영역으로 맞춘다. 프레임의 safe inset·투영 precision·resize 처리도 다르다. | 공통 view state, app-map-projection/map-host/camera-navigation의 열람 책임 사용. 웹의 projection 생성·zoom·fit·focus 계산 제거. |
| S04 | 입력·핀치·휠·단축키 | P1 | [웹 직접 이벤트](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-map.js#L195) / [기존 입력 소유자](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/map-input-controller.js#L1) | 웹 pointer/pinch/wheel 처리가 별도다. 기존 컨트롤러의 터치/마우스 이동 문턱, 좌표 고정 확대, 더블 탭, 가운데 버튼, 세션 revision/취소 정책을 그대로 쓰지 않는다. 웹 키보드는 주로 Escape만 별도 연결한다. | createMapInputController와 탐색 단축키를 양쪽 사용. 편집 stroke/도구 입력은 앱에서만 등록. 웹의 pointers/dragDistance/pinchDistance와 직접 listener 제거. |
| S05 | 선택 후보·겹친 객체·빈 배경 | P1 | [웹 pick 순서](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-map.js#L202) / [기존 후보 수집](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-object-picking.js#L102) | 웹은 label→overlay→hydro→country 경로로 직접 찾고 첫 객체를 선택한다. 기존 공간 인덱스·시각 순위·겹친 객체 선택 목록·빈 배경 선택 해제 경로와 다르다. | 기존 picking/선택 후보 규칙을 열람 공통 기능으로 분리. 웹의 선형 순회·우선순위·별도 hit dispatch 제거. |
| S06 | 선택 상태·ID·다중 선택·hover | P1 | [웹 select](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-map.js#L264) / [선택 소유자](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/selection-domain.js#L8) / [단일 선택 재구성](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-composition.js#L100) | 웹은 C++ 결과와 별도로 selected feature를 보관하고 검색 선택 상태를 한 개로 재구성한다. Ctrl/Shift 인자를 버리고 hover 정리는 no-op이다. objectKey.split(':')의 세 번째 값만 ID로 써서 콜론 ID가 잘린다. | selection-domain/selection-ui-controller 및 명시적 ref adapter 사용. selected mirror와 수동 key 분해·재구성 제거. 콜론 ID 선택 실패는 모델 수준 재현 완료. |
| S07 | 검색 대상·검색 메타데이터 | P1 | [웹 검색 모델](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-composition.js#L80) / [표시 대상 필터](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-scene-items.js#L20) / [기존 객체 목록](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-object-catalog.js#L53) | 검색 UI 컨트롤러만 공유한다. 웹 검색 목록은 현재 그려지는 sceneItems에서 가져오고, 앱은 canonical catalog를 쓴다. 숨긴 국가 검색 가능 여부가 다르고 상위 영역 검색 메타데이터도 축소되어 있다. | 같은 object catalog·정렬·ref·선택 adapter 사용. viewer searchFeature/model.items 및 표시 장면을 검색 저장소로 쓰는 경로 제거. 숨긴 객체 차이는 실제 양쪽 모델로 재현 완료. |
| S08 | 라벨 후보·앵커·크기·강조 | P1 | [웹 라벨 수집](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-map.js#L130) / [기존 라벨 정책](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-territorial-labels.js#L181) | tspan 출력과 충돌 함수만 공유한다. 기존 영토 앵커/화면 면적에 따른 글자 크기·작은 영역 생략·선택 우선·선택 지명 유지·모바일 간격·안전 영역을 웹이 똑같이 적용하지 않는다. | visibleLabelLayout/앵커·국기·사용자 지명 후보 생산을 공통 사용. 웹의 entities 라벨 loop와 독립 layout 조립 제거. |
| S09 | 내장 지명 수명·표시 설정 | P1 | [웹 place adapter](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-places.js#L23) / [기존 보호 ID/정지 콜백](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-territorial-labels.js#L312) | place-runtime 자체는 같지만 앱의 getProtectedIds/onSettled를 웹이 연결하지 않는다. 웹 draw는 내장 지명에 project snapshot+visibility만 전달하여 현재 열람용 layerPresentation 변경은 전달하지 않는다. 선택 지명 보호·이동 후 검색 재시도·내장 지명 스타일 반영 경로가 갈라져 있다. | 기존 지명 자원·선택 ref·라벨 정책을 공유. viewer-places의 수명/feature/labels adapter 제거. 설정 미전달은 소스 흐름 확인이며 이번에 브라우저 재현한 결과는 아니다. |
| S10 | 프레임 스케줄·품질·Worker 부하 | P1 | [단순 이동 상태 포트](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-map.js#L86) / [기존 업로드 입력 연결](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/rendering-domain.js#L62) / [프레임 품질 계측](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-map-host.js#L91) | 웹은 자체 rAF draw/scene revision/updateGeneration/settle timer를 쓴다. 같은 upload scheduler를 생성해도 앱의 입력 noteInput, dirty mask coordinator, adaptive render quality, 프레임 완료 계측·정지/해제 연결을 공유하지 않는다. | 기존 rendering-domain/coordinator·품질·mapWorkScheduler를 열람 공통 구성으로 사용. 독립 rAF/update/settle 소유자 제거. 성능 차이의 원인 후보이며 개선율은 미계측. |
| S11 | 내장 지도·파일 열기·문서 교체 | P1 | [웹 내장 읽기](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-project-reader.js#L4) / [웹 교체 coordinator](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-session.js#L2) / [기존 내장 loader](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/historical-world-loader.js#L3) / [기존 replace](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/project-domain.js#L404) | GPKG 테이블 읽기/패키지 자산 함수는 공유하지만 picker/Worker 요청/오류/프로젝트 교체가 별도다. 내장 지도는 웹에서 JSON decode 후 다시 JSON.stringify/load하고, 앱은 검증된 저장 원본과 Core baseline admission 경로를 쓴다. | 현재 포맷 reader, historical-world-loader, 문서 교체 트랜잭션을 공통 사용. native/browser fileAccess만 다르게 주입. viewer-project-reader/viewer-session과 composition의 별도 open 수명 제거. |
| S12 | 객체 상세 정보·상태 표시 | P2 | [웹 필드 조립](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-composition.js#L61) / [기존 지명 상세](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/object-property-controller.js#L282) / [기존 수계 상세](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/object-property-controller.js#L310) | 제목 presenter만 공유한다. 웹은 ID/상위/시작/종료/설명 여섯 항목을 직접 만들며 내장 지명의 출처·이름 시점 설명, 수계 대표명/출처, 기존 선택 상태 표시 등 열람용 정보 경로를 쓰지 않는다. | 객체 정보 모델·포맷팅·읽기 전용 presenter를 공통화하고 수정 입력/행동만 앱에 출력. 웹의 show 필드 배열/타입 추정/상태 텍스트 조립 제거. |
| S13 | 레이아웃·메뉴·뒤로 가기·수명 | P1 | [웹 width 분기](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-composition.js#L44) / [기존 layout detector](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/workspace-layout.js#L6) / [기존 시트 history](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-workspace-surfaces.js#L51) | surface/시트 함수는 공유하나 조립은 별도다. 웹 wide 기준 1280, 앱 1360. coarse/낮은 가로·입력 중 키보드 높이 정책도 다르다. 모바일/파일 메뉴 state, Escape, popstate, 포커스 복귀, resize와 pagehide 해제도 공통 lifecycle을 쓰지 않는다. | 공통 workspace/navigation/lifecycle에서 사용 가능한 메뉴/패널만 등록. 웹의 width 삼항식·fileOpen/mobileMenuOpen·직접 key/resize/pagehide binding 제거. 두 viewport의 모드 차이는 실제 함수로 재현 완료. |
| S14 | 테마·환경설정 적용·오류·준비 상태 | P2 | [웹 applyTheme](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/viewer-composition.js#L29) / [기존 설정→지도 스타일](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/assets/js/modules/app-environment.js#L86) | 대화상자/저장 규칙은 공유하지만 적용 순서·지도 invalidation·상태 표시와 오류 경계는 따로다. report()는 상태줄에 모든 오류를 쓰고 공통 준비/알림 소유자 대신 여러 callback을 no-op으로 연결한다. | 공통 appearance/readiness/notification owner에 출력 포트만 주입. 웹 applyTheme/report와 무효화/상태 no-op 연결 제거. |
| S15 | 같은 HTML 복사본·통과 기준 | P2 | [웹 검색 DOM](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/index.html#L240) / [웹 보기 DOM](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/index.html#L258) / [웹 설정 DOM](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/index.html#L387) | 메뉴·설정·검색·날짜는 현재 동일한 마크업을 두 시작 HTML에 복사한 상태다. 동일성 검사는 차이를 잡지만 한 소스를 공유하는 구조는 아니다. | 공통 UI 소유 마크업에서 웹/앱 HTML을 생성. 편집 블록은 앱 출력에만 포함. source fragment와 생성된 산출물을 구분해 중복 소스 제거. |
| S16 | 배포 의존성 경계 | P1 | [editorOnly 정규식](https://github.com/kimjeon-il/Pando/blob/4273bca1298c42fcb5a1bca8570b7b26387f3de8/scripts/lib/product-assets.mjs#L22) | app-* 이름은 일부 예외 외에 모두 편집 전용으로 거절한다. 지도 host/camera/catalog도 차단되며 rendering-domain은 editing-render-packet 정적 의존성 때문에 차단된다. 공통 소유자를 직접 사용할 수 없는 경계가 별도 웹 코드를 유지하게 한다. | 열람 공통 소유자와 편집 등록/계약을 먼저 분리한 뒤 실제 의존성 closure로 검사. 예외 whitelist나 forwarding helper를 추가하며 우회하는 방식은 중단. |

## 재현한 결과

1. **숨긴 국가 검색 차이.** 현재 GPKG fixture를 현재 C++ 문서로 열고 같은 repository를 사용했다. `countries=false`일 때 실제 앱 `createObjectCatalog.listObjectCatalogItems`에는 객체가 남고, 실제 `buildViewerSceneItems.searchItems`에서는 사라졌다. 웹 검색은 후자를 쓰므로 같은 검색 대상을 공유하지 않는다.
2. **콜론 ID 선택 실패.** fixture의 객체 ID를 `alpha:one`으로 바꿔 C++가 받아들이는 것을 확인했다. 배포 소스의 `select` 메서드를 AST로 그대로 추출해 실행하면 선택 결과가 빈 items/primary=null이다. 같은 C++ owner에 명시적 `{domain:territorial,type:entity,id:alpha:one}` ref를 주면 정상 선택된다. DOM/렌더링 callback만 대체했으므로 모델/명령 수준 재현이며 브라우저 클릭 재현은 아니다.
3. **레이아웃 판단 차이.** 실제 공통 detector와 웹 소스의 getLayout 표현식을 비교했다. 1300×800/일반 pointer: 앱 compact, 웹 wide. 844×390/coarse: 앱 phone-landscape, 웹 compact. 실제 화면/가상 키보드 동작 검증은 아니다.
4. **공통 소유자 import 차단.** 현재 collectViewerAssets에 검사용 entry만 주입했다. app-map-host/app-camera-navigation/app-object-catalog는 app-* 정규식으로, rendering-domain은 editing-render-packet 의존성으로 모두 실패한다. 실제 배포 source나 staging 계약을 변경하지 않았다.

두 문서/선택 재현에서 프로젝트 Undo는 생성되지 않았다. 실데이터의 역사 경계 형상·정확도나 실제 파일 내용은 수정/검증 대상이 아니다.

## 이미 같은 구현을 쓰는 부분과 허용할 제품 차이

- C++ 문서/검증, document-session/Core client/read model, Core worker runtime 및 product-mode-policy는 공통이다. Core Worker 두 시작점은 고정 productMode를 넘기는 동일한 runtime 등록 코드다. 읽기 전용 강제 경계는 유지해야 한다.
- GPU/Canvas renderer, render-scene builder, map-visual-frame, 라벨 충돌 함수, 물리 자료 서비스, place-runtime, 파일의 gpkg-read-core/project-package-assets 등 저수준 함수는 공통이다. 상위 조립/정책까지 공유됐다는 뜻은 아니다.
- 설정 대화상자, 보기 메뉴 컨트롤러, 검색 컨트롤러, 날짜 컨트롤러, 시트 제스처, pan 계산, 아이콘·스타일 규칙은 공통으로 이동한 부분이다. S03/S07/S13처럼 호출 포트나 상태 공급이 다르면 여전히 결과가 갈라질 수 있다.
- 앱의 편집 UI/명령/저장·자동저장·Undo 등록과 웹의 읽기 전용 정책 차이는 제품 요구다. 같은 프로젝트/선택/조회 규칙을 별도 구현할 이유는 아니다.
- HTML 결과에서 편집 블록을 앱에만 출력하는 것, native fileAccess 구현, Android Activity 방향·edge-to-edge 같은 플랫폼 binding은 제품/플랫폼별일 수 있다. 공통 파일 열기/오류/상태/탐색 책임은 그 위에서 공유해야 한다.

## 정리 순서와 완료 기준

1. 기존 앱 조립에서 문서/열람 상태·조회·파일 읽기/교체를 공통 구성으로 옮기고, 편집 등록을 별도 확장으로 둔다. 외부 파일/내장 원본은 같은 검증·교체 경로에 넣는다.
2. 기존 rendering-domain/map-host/투영/카메라/입력/객체 catalog/선택/picking/라벨·지명 책임에서 편집 의존성만 분리한다. 별도 viewer 구현을 보존한 채 helper를 추가하는 방식은 중단한다.
3. 양쪽 시작점을 같은 공통 구성에 연결하고, viewer-map/viewer-scene-items/viewer-places/viewer-session/viewer-project-reader/viewer-composition의 해당 구현·호출·상태·export를 함께 제거한다. 얇은 제품 설정 시작점만 유지한다.
4. 공통 UI source에서 제품 HTML을 생성하고, 편집 출력/등록만 앱에 포함한다. 같은 마크업의 두 수동 복사본을 공유 완료로 간주하지 않는다.
5. 공통/편집 의존성 graph를 제품 계약에 맞춰 검사한다. 웹 mutation 차단과 편집 자산 제외, 앱 기존 편집/저장 흐름은 유지한다. 앞의 세 동작 차이와 공통 탐색/표시/선택에 대해 같은 입력→같은 열람 결과를 검증한다.
완료 판정은 “공통 파일 수 증가”가 아니라 동일 책임의 소유자 1개, 독립 분기/상태/옛 API 제거, 현재 호출자/테스트 정합성, 실제 두 시작점 동작 일치로 한다. 생성물·테스트·보고서를 제외한 원본 코드 순증도 다시 공개해야 한다.

## 조사 범위·한계·데이터 반영

배포된 4273bca1의 웹 전용 진입점 7개와 직접 연결된 기존 앱 소유자를 대조했다. 작업 트리의 미완성 프로젝트 설정/비교/편집/Core 수정은 보존하고 조사 제품 기준에 혼입하지 않았다. 원격 main/work/ui가 조사 시작과 같은 SHA임을 확인했다.
이번 실행은 Git 증감/소스 및 의존성 확인, 실제 모델/명령 수준 세 재현과 자산 경계 probe다. 전체 브라우저 suite, 성능 benchmark, Windows/Android 네이티브 검사는 실행하지 않았다. 앞선 배포 smoke는 그때 실행한 범위의 기록으로 유지하며 이번의 전체 공유 검증으로 재사용하지 않는다.
제품 소스 변경·이번 조사에 따른 재배포 없음. 조사 결과를 reports와 색인에 저장한다. 미완성 수정과 상설 워크트리를 유지한다.

## 근거와 판본

- [기계 판독 증감·probe 결과](shared-output-audit-2026-10-18.evidence.json). 원시 재현 스크립트는 work/ui의 `.superpowers/audit-shared-product.mjs`, `probe-shared-product.mjs`, `probe-shared-layout.mjs`, `probe-shared-boundary.mjs`에 보존.
- [직전 기능 복원·배포 검증](viewing-ui-reuse-repair-2026-10-18.md): 기능 복원/당시 배포 근거는 유지한다. 공유 완결성 및 잔존 adapter의 정당성 판단은 본 보고서의 강화된 기준으로 대체한다.

## 후속 구현

2026-10-19: S01–S16과 사용자 요구 정정에 따른 구현·검증은 [UI-SHARING-REFACTOR-20261019](shared-output-refactor-2026-10-19.md)에 기록한다. 위 조사 표와 문자 수는 기존 배포본의 조사 근거이며 새 구현의 미해결 목록으로 재해석하지 않는다. 네이티브 실기기 검증은 후속 보고서에서도 별도로 구분한다.
