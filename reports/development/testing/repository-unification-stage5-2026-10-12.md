# Web·App 저장소 통합 — 5단계 검증 (2026-10-12)

상태: 로컬 집중 검증 완료, 발견한 실패와 미검증 항목 기록. 통합 저장소의 전체 CI와 전체 Web↔App behavioral parity는 통과 판정하지 않는다.

## 고정 출처

| 항목 | 커밋·증거 |
| --- | --- |
| 통합 저장소 `main`과 `work/gis` 검증 기준 | `a934d2025ea8dc1f5c6a5afda8a8fca4c2f2cfc3` |
| 원본 App 백업 저장소 `main` | `f124fdb42d8cf2de5d0294b2b26d37d992f3774f` |
| 전체 parity의 최초 통합 실행 | [Linux/Windows 실행](https://github.com/kimjeon-il/Pando/actions/runs/38227225149), `608c72c8b70bc090cd907b8bfcb848be0900e8ab` |
| Web 공개본 | [GitHub Pages](https://kimjeon-il.github.io/Pando/) |

검증 전에 통합 저장소의 `main`·`work/gis`, 원본 App `main`의 추적·미추적 변경과 상설 워크트리를 확인했다. 세 체크아웃은 작업 시작 시 깨끗했다. 단계 4에서 푸시한 통합 코드와 원본 App 백업은 그대로 보존한다.

재실행한 집중 검사: `node tools/build-world-bundle.mjs --check`, `node --test`로 serializer·timeline persistence/project·selection channels·world bundle 5개 파일, Playwright `timeline-controls.spec.mjs` 및 각 역사 라이브러리·지도 선택 단일 사례, CTest `timeline_ui_tests`와 `native_geometry_pointer_route`, QtTest의 역사 월드 임시 자산 사례와 실제 Windows 창 사례. 앱 실행 확인은 `native/Pandoeditor-local.bat smoke`를 사용했다. 로컬 Qt 테스트 전용 빌드는 `build-native/stage5-qt`이며 포터블 산출물이 아니다.

## 확인된 결과

- Pages에 게시된 파일을 캐시 구분 URL로 다시 읽어 현재 `main`의 Git blob과 바이트 단위로 비교했다. `index.html`은 SHA-256 `26ea8905b239d1416e8f7c376135661f87f051228332077ee21aa15e3b42242c`, `world/current.json`은 `960e2f55964cbaebad10f6e397bf11fb5c4ad2464803ffe640f65b08bdcfb836`, 국명 기준점 객체는 `caeee3f0d05265cc564f68ef092b25ea8c5c4d6f1c36e2beb35a239551751512`로 각각 일치했다. 단계 4의 Pages 게시 검증은 웹 파일 4,580개, 제외한 `native/` 파일 2,278개와 지형·수계 manifest 일치를 기록한다. 이 확인은 웹 공개본에 관한 것이며 앱 패키징 증거가 아니다.
- Windows 체크아웃에서 월드 bundle의 `build-input.json`, `current.json`, content-addressed 국명 기준점 JSON이 CRLF로 풀렸다. 국명 기준점은 커밋 blob 13,826바이트·SHA-256 `caeee3f0d05265cc564f68ef092b25ea8c5c4d6f1c36e2beb35a239551751512`인데 로컬 파일은 14,864바이트·`8f1f8e2b24e73c6b0d9176739d721c56c8a3437fbf93b5ebec8c8258af9de059`였다. 브라우저 Worker의 실제 오류는 `국명 기준점 저장 크기가 올바르지 않습니다.`였다. `node tools/build-world-bundle.mjs --check`도 `Stale world/current.json`으로 실패했다. 해당 JSON의 LF 체크아웃 규칙을 `.gitattributes`에 추가하고, **변경이 없던 세 파일만** Git blob 바이트로 되돌린 뒤 동일 검사에서 월드 자산 5개가 통과했다. 제품 데이터와 계산 코드는 바꾸지 않았다.
- LF 복원 뒤 브라우저의 타임라인 월·연도 이동과 desktop/mobile 날짜 입력 테스트 2건이 통과했다. 앱의 기존 로컬 실행 파일 `native/Pandoeditor-local.bat smoke`는 종료 코드 0이었다. 포터블 폴더·압축파일은 만들지 않았다.
- 웹의 serializer·timeline 프로젝트/저장·선택·world bundle 관련 unit 검사 50건이 모두 통과했다. App Qt `timeline_ui_tests`도 통과해 desktop/mobile 시간대 입력을 실행했다.
- 역사 라이브러리의 실제 브라우저 테스트는 지도 초기화를 지나 객체 추가까지 실행됐고, 기존 테스트가 `validFrom: null`을 기대하여 실패했다. 현재 시간대 모델은 객체 추가 월부터 lifetime을 만들므로 결과는 `validFrom: "2026-10"`이었다. 테스트 기대값을 화면의 편집 월에서 읽도록 수정했다. 재실행은 객체 추가와 Undo까지 지났으나 Redo 버튼 클릭이 30초 제한에 걸려 실패했다. Redo 데이터 결과는 미검증으로 남긴다.
- 별도 지도 선택 브라우저 사례는 선택 동작 전에 GIS 가져오기가 실패했다. 기존 테스트가 독일 `DEU`를 새 권역의 부모로 지정하자 실제 검증기가 `TIMELINE_PARENT_INACTIVE: Inactive parent DEU for general-map-selection`을 반환했다. 화면에는 `파일을 불러오지 못했습니다.`가 표시됐고 지도에 새 shape이 생성되지 않았다. 선택 UI 자체의 통과/실패로 해석하지 않는다. 현재 시간대의 부모 선택 가능 목록과 검증 결과가 다른지 별도 제품 조사 대상으로 남긴다.
- App 역사 지도 UI 검사는 원본 App에서도 누락된 테스트 임시 월드의 `labelAnchors` 파일 때문에 생성자에서 예외가 발생했다. 임시 fixture에 고정 자산을 포함한 뒤 해당 사례 `unavailableCanonicalDoesNotLeaveModernPreview`만 재실행해 Qt 3 PASS·0 FAIL을 확인했다. 전체 역사 지도 UI CTest는 오래 걸려 중단했고 통과로 표시하지 않는다.
- 실제 Windows Qt 창 사례는 테스트 실행 파일의 QML 리소스에 `UiSwitch` 등 공통 컴포넌트가 없어 처음에는 화면을 열지 못했다. 제품 실행 파일에는 이미 포함된 리소스라 테스트 대상에도 같은 기존 `M32_PROPERTY_RESOURCES`와 폰트를 연결했다. 재빌드한 `nativeWindowShowsHistoricalWorld`는 Qt 3 PASS·0 FAIL로 2012-10 역사 상태, 우크라이나 선택과 Windows D3D11 창 캡처를 확인했다. 캡처는 `D:\dev\history-audit\stage5-live\captures\native-crimea-2012.png`에 보존했다. 별도 지도 포인터 입력 CTest `native_geometry_pointer_route` 1건도 30.57초에 통과했다. 이 캡처는 시각 진단 자료이며 독립 역사 경계와의 0.5 CSS px 정확도 검증은 아니다.

## Parity 및 CI의 남은 판정

최초 통합 전체 parity의 Linux 보고서는 23개 영역·291개 사례 중 PASS 228, FAIL 6, UNSUPPORTED 14, NOT_RUN 23, ERROR 20이었다. 변경 회귀와 전체 behavioral parity가 모두 `BLOCKED`다. 같은 Web/App 통합 커밋을 비교했지만, 승인된 Web 계약 핀과 후보 corpus의 5개 해시 차이가 남는다. 저장·지형 production 계약 실패, 5개 월 ResolvedWorld 관측 ID/개수 오류, 4개 교환 사례의 활성화 결과 차이, 라이브러리·로딩 출처 바이트 불일치가 대표 원인이다. Linux에서 실제 Qt UI 입력은 미실행으로 남았다. 기존 차이를 자동 승인하거나 PASS로 합치지 않았다.

원본 App에서도 실패하던 영토 카탈로그 컨트롤러 4건은 통합 후에도 실패했다. 통합 직전 Web에서도 Application Architecture CI가 실패했다. 반면 통합 후 App World Stage 4 게이트와 Pages 게시 검증은 성공했다. 전체 parity의 Windows 작업은 이 기록 작성 시 별도로 진행 중이었으며, 그 완료 전에는 실제 Qt 입력 5개를 포함한 UI parity를 완료로 표시하지 않는다.

## 이번 단계의 범위와 남은 검증

`work/gis`의 수정은 검증 보고서와 Windows 체크아웃 규칙, 낡은 웹·앱 테스트 fixture/리소스에 한정한다. 앱 제품 로직·역사 geometry·저장 형식은 수정하지 않았다. Android 실기기, 포터블 패키징, 전체 성능 측정은 이번 범위에서 실행하지 않았다. 전체 parity를 통과하려면 위 corpus 출처와 영역별 FAIL/ERROR/UNSUPPORTED/NOT_RUN을 별도 작업으로 해소해야 한다.

기존 Windows `main` 워크트리는 새 LF 규칙을 아직 포함하지 않으므로 그 경로의 로컬 브라우저 시작 오류는 `work/gis` 변경을 통합하고 JSON 세 파일을 원본 blob 바이트로 다시 풀기 전까지 남는다. 검증 중 `main` 파일을 임시로 원본 바이트로 되돌려 검사했고, 이후 원래 체크아웃 형식으로 복원하여 `main` 작업 트리를 깨끗하게 유지했다.
