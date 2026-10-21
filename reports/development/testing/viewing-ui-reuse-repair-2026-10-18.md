# 웹 열람 UI 공유 누락 조사와 복원 검증

> 보고서 ID: `UI-VIEWING-REPAIR-20261018` · 상태: `verified-web-release / native-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-18
> 원문 최종 수정: 2026-10-18
> 조사 기준: 배포본 `2574f1e0e9b47b054e8c38d2c392aad8e79698c7`, `work/ui` 기준 `02a5c5baf569e9bf583e23febedb32baf848e7d2` 위 수정
> 원본·출처: 사용자 배포 화면, 같은 저장소의 앱 시작점과 실제 UI 소유자

## 대상과 기준일

웹의 편집 제거 과정에서 기존 UI를 재사용하지 않고 다시 만든 부분, 설정 누락, 지도 위 글자 가림, 이동 지연을 조사했다. 이전 제품 분리 보고서의 UI 재사용 설명은 아래 범위로 정정한다. 공통 엔진 사용은 사실이지만 모든 화면과 입력을 그대로 재사용한 상태는 아니었다.

## 공유 여부 대조

| 영역 | 발견한 차이 | 이번 수정과 현재 소유자 |
| --- | --- | --- |
| 설정 | 환경설정 진입점과 대화상자 누락 | 기존 대화상자 DOM 복원. 기존 바인딩을 `preferences-dialog.js`로 추출하여 앱/웹 함께 사용. 테마·강조색·상태표시줄·경계선 설정의 미리보기/취소/저장 공유 |
| 보기 | 별도 details 목록과 제한된 켜기/끄기 UI | 앱 `mapDisplaySurface`를 동일하게 사용. 기존 `app-map-settings.js`가 이름·깃발·경계·색·투명도·지명 언어·분포를 표시. 웹은 명시적 열람 상태 포트 사용 |
| 검색 | 텍스트 버튼 목록 재구현, 결과 아이콘·이동 버튼·지우기 누락 | 기존 `object-search-controller`, `object-search-model`, `search-toolbar-presentation`, `icon-utils` 사용. 동일 검색 패널 DOM |
| 날짜 | HTML month 입력으로 대체, 연/월 이동과 기원전 입력 누락 | 기존 `timeline-controls.js`와 동일 날짜 컨트롤 DOM. 앱의 ‘기준 편집’ 문구만 앱 호스트가 제공 |
| 객체 정보 | 임의 h2/dl 및 내부 종류 문자열 | 기존 객체 제목 표시를 `object-property-presentation.js`로 추출, 앱/웹 공유. 기존 정보 행 스타일과 surface-editor 배치 사용. 웹은 읽기 전용 필드 목록 조립 |
| 선택 색상 | 사용자 설정 대신 기본 스타일 고정 | 기존 `resolveMapInteractionStyle`에 현재 설정과 강조색 연결 |
| 카메라 이동 | 별도 감도·극점·경도 처리 | 기존 계산을 `camera-pan.js`로 추출해 양쪽 사용. 제품별 포인터/편집 제스처 등록은 별도 |
| 지명 글자 | 매 프레임 tspan 전부 삭제/생성 | 앱의 SVG 행 갱신을 `label-text-presentation.js`로 추출해 재사용. 다국어 행 간격과 클래스도 공유 |
| 내장 지명 | 조회 결과를 웹 호스트가 별도 보관 | 공통 place-runtime의 resolve/retained 소유자를 통해 선택 조회. 검색 결과 제한 표시 전달 |
| 지도 글자 가림 | 존재하지 않는 map-label-svg 클래스 | 기존 map-overlay-svg 적용. Canvas 위 SVG 적층 |
| 이동 부하 | 매 프레임 상세 국가 형상의 구면 중심 재계산 | geometry별 WeakMap 캐시. 이동 중 지명/수계 요청을 공통 런타임의 상호작용 상태로 보류하고 정지 후 갱신 |
| 모바일 시트 | 드래그·키보드 높이 조절 연결 누락 | 기존 앱 시트 계산/제스처를 `mobile-sheet-presentation.js`로 추출, 앱/웹 공유. 정보 닫기는 숨겨지는 시트 머리말에서 보이는 객체 제목 영역으로 이동 |
| 모바일 메뉴 | 데스크톱 상단 메뉴 강제 표시 | 기존 모바일 메뉴 구조와 공통 메뉴 배치 사용 |
| 버튼/패널 CSS | 웹 별도 패딩·정보 패널 강제 배치 | 해당 override 제거. 공통 컨트롤·대화상자·패널·검색 스타일 사용 |

공통 C++ 문서, 검증/읽기 Worker, GPU/Canvas 렌더러, 물리 자료 서비스, 지도 프레임, 라벨 충돌 배치, 영역/국기 스타일은 계속 같은 구현이다. `viewer-session`, `viewer-project-reader`, `viewer-map`, `viewer-scene-items`는 남아 있다. 각각 읽기 전용 문서 교체, 파일 읽기, 편집 서비스 없는 호스트 연결, 문서에서 표시 장면을 만드는 역할이다. 파일 메뉴 항목과 읽기 전용 상세 행 조립도 제품별이다. 전체 파일이나 모든 상호작용이 동일하다고 주장하지 않는다. 앱의 편집 도구·저장·자동저장·Undo 서비스는 웹에 등록하지 않는다.

## 근거와 방법

- 실제 사용자 화면과 배포본 DOM의 적층 순서를 확인했다. 수정본 회귀 검사는 `elementsFromPoint`에서 SVG가 Canvas 위인지 확인한다.
- 실제 이동에서 `d3.geo.centroid` 호출을 계측했다. 캐시 준비 후 확대/축소에서 재계산 0회를 확인했다.
- 기존/수정 CPU 샘플에서 반복 중심 계산이 사라진 것을 확인했다. 서로 다른 origin 및 동시 실행 조건이므로 85.8초/34.8초 값을 통제된 성능 개선율로 사용하지 않는다. 60fps, 메모리 감소, 모든 기기의 지연 해소는 미검증이다.
- 앱/웹의 보기·설정·검색·날짜 DOM 일치 검사를 추가했다. DOM 일치만으로 실제 동작 검증을 대신하지 않는다.
- 단위 검사: 날짜 3개, 검색 15개, 표시 장면/선택 색상 4개, 카메라 계산 1개, UI 계약 1개 통과. 추가 기존 앱 카메라 10개, 객체 정보 3개, 자산 그래프 4개 통과. 지명 실데이터 조회/선택/취소/이동 보류 5개 통과.
- 관련 ESLint, UI component/layering, 빌드 메타데이터 검사 통과.
- 공유 UI 브라우저 검사 1차: 실제 편집기 GeoPackage 열기·손상/취소/연속 열기 복구, 1280×800 및 640×360 검색·객체 정보·보기·문서 불변 총 3개 통과.
- 추가 최종 검사: 앱 복잡 시점 파일 열기/월 이동/자동저장 불변, 글자 적층/중심점 캐시, 웹 PC 기원전→서기 월 이동 통과.
- 모바일 재검사 중 숨겨진 닫기 버튼을 발견해 수정했다. 390×844·768×1024·1024×768·844×390에서 검색·정보·패널 닫기·보기·선택/문서 불변 및 시트 키보드 확장 검사 통과. 640×360의 검색·보기·기원전/서기 이동과 앱의 생성/보기/편집 시트 회귀도 통과(최종 재검사 3/3).
- 앱 staging 두 프로필 계약 7개 검사 통과. 실제 small-project staging도 919개 파일/56,166,131 bytes로 통과했다(격리 소스 export라 commit 필드는 unavailable). 네이티브 실행 결과는 아니다.

## 확인 결과와 한계

기존 UI를 기반으로 한다는 요청에 비해 첫 배포는 화면 연결을 지나치게 별도 구현했다. 이 보고서는 확인된 차이와 수정 범위를 기록하며 ‘모든 코드 공유’ 또는 ‘모든 UI가 픽셀 단위로 동일’하다는 확인서는 아니다. 실제 Windows 네이티브 창, Android 양방향 회전·폴더블·멀티윈도는 이번 수정에서 실행하지 않았다. 브라우저의 앱 시작점 검사를 네이티브 검증으로 간주하지 않는다.

## 데이터 반영 및 배포

GIS·지도 자료·C++/WASM 변경 없음. 미완성 프로젝트 설정·편집·Core 변경은 작업 트리에 보존하고, 수정 범위만 배포용 소스에서 선택해 커밋한다. 수정 소스 `4273bca1298c42fcb5a1bca8570b7b26387f3de8`를 main에 fast-forward 통합하고 main/work/ui push를 확인했다. Pages 배포 성공과 실서비스 검증까지 확인했다.

- 로컬 웹 staging: 2,162개 파일, 431,221,196 bytes. 앱 파일 103개 및 shared 소스 173개 제외.
- [Pages workflow 39127233612](https://github.com/kimjeon-il/Pando/actions/runs/39127233612): build 40초, deploy 21초로 성공.
- CI manifest의 2,162개 파일 경로·크기·Git blob·SHA-256이 로컬 staging과 모두 일치한다. Windows checkout의 CRLF 변환 표시 자체는 플랫폼 진단 값이므로 자산 동일성 비교에서 제외했다.
- 실서비스에서 시작 HTML/메타데이터/진입점/지도 및 조립 모듈/공통 모바일 시트/설정/공통 CSS/WASM 쌍 총 10개 HTTP 200 및 커밋 바이트 SHA-256 일치 확인.
- 편집 app.js/bootstrap.js/ui.bundle.css 및 앱 editor.html은 HTTP 404 확인.
- 실서비스 1280×800: 글자 SVG가 Canvas 위에 놓임, 기존 보기 메뉴, 환경설정 테마 미리보기와 취소, 실제 현재 GeoPackage 열기, 검색 선택 및 객체 정보 표시 확인.
- 실서비스 640×360: 모바일 메뉴·평면 투영·기원전 1년 12월→서기 1년 1월 이동·환경설정 접근 확인. 프로젝트 checkpoint 불변/Undo 없음. pageerror 및 console error 0개.
- [배포된 PC 보기 화면](../../images/viewer-editor/viewing-fixed-desktop.png), [배포된 휴대폰 가로 설정](../../images/viewer-editor/viewing-fixed-mobile-settings.png).
- 실제 실행 근거 원자료: 작업 트리 `.superpowers/viewing-repair-live.json`; CI manifest는 workflow artifact `pages-evidence-4273bca1298c42fcb5a1bca8570b7b26387f3de8`.
- 이 후속 증거는 work/ui 보고서 커밋으로 기록한다. 배포된 제품 소스 SHA는 위 4273bca1이며, 보고서 커밋 자체를 새 배포 성공으로 표시하지 않는다.

## 후속 공유 기준 조사

출력/등록 차이 외 모든 열람 책임을 같은 구현으로 공유한다는 후속 기준은 [UI-SHARING-AUDIT-20261018](shared-output-audit-2026-10-18.md)에서 다시 조사했다. 이 문서의 배포/기능 검사 결과는 유지하며, 잔존 viewer adapter를 제품별 연결로 허용한 설명은 후속 보고서의 통합 대상 판정으로 대체한다.

> 2026-10-21 정리 후속: 이 문서에서 언급한 완료된 작업의 일부 원시 증거는 외부로 옮겼다. 작성 당시의 결과는 변경하지 않았다. [브랜치별 원래 경로·SHA-256·보관 목록](/D:/dev/release-evidence/PandoLab/branch-cleanup-20261021/main-archive.json).
