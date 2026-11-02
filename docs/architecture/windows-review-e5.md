# E5 — Windows 편집기 → 읽기 전용 검수기 전환

**코드 브랜치:** `work/ui` (2026-11-02) · [E1 공통 엔진](map-readonly-engine-e1.md) → [E2 이력](review-change-history-e2.md) → [E3 자동 변경 검출](review-revision-diff-e3.md) → [E4 웹 검수](web-review-e4.md)

## 완료 범위와 제품 결정

- **Windows 전용 Tauri 실행 창**은 기존 편집기 `index.html`이 아니라 `review.html`로 시작한다. `review.html`은 E4 공개 웹 뷰어의 동일 `snapshot.html.viewer`에서 생성되며, 별도 지도·검수 HTML을 중복 개발하지 않는다.
- 같은 읽기 전용 Viewer Core를 사용하지만 **Windows만 `flat` 투영**, 일반 웹사이트는 종전대로 `globe`를 쓴다. `productMode:"viewer"`와 `readOnly:true`는 고정이다. 데이터 변경 권한과 투영은 구별된다.
- Windows는 검수 패널을 최초 지도 준비 후 자동으로 열며, E4 파일 선택·국가별 검색·변경 전후 속성·국경 형상 2단 비교·근거 보고서 참조를 재사용한다.
- Windows 사용자는 수동으로 E3 변경 내역/검증 영수증/제안 JSON·해시 목록을 열고 원본 국가의 Git/SHA-256을 대조한다. 기존 검수 결과의 `pending`/`not-run`/`not-verified` 상태를 바꾸지 않는다.
- 현재 Git 커밋의 역사적 데이터 pin, C++/WASM, 프로젝트·GeoPackage 스키마, E2/E3의 자동 생성 산출물 형식 및 외부 데이터 저장소에는 변경이 없다.
- Android 네이티브 앱은 신규 개발·자동 빌드 대상이 아니며 E6까지 기존 코드를 보존한다. 모바일 웹 E4 검수 기능은 그대로 유지한다.

## 네이티브 격리·권한

- `apps/editor/src-tauri/src/lib.rs`는 Windows 창을 `review.html`로 생성하고, 기존 `index.html` 등 다른 최상위 내비게이션을 거부한다. 외부 페이지 이동·신규 창도 거부한다.
- 사용자 앱 capability `prototype-review`가 허용하는 동작은 **진단 기록** 및 **사용자가 저장 대상을 직접 고른 수정 요청서 JSON 저장** 두 가지뿐이다. 기존 프로젝트/GIS 쓰기·Undo/Redo·라이브러리 커밋·Git 동기화·문서 전송 쓰기 권한은 없으며, 노출된 Rust 등록 명령은 사용자 창에서 IPC 권한 검증에 의해 차단된다.
- `review_correction.rs`는 E4의 `pandolab-review-correction-draft`만 허용하며, `schemaVersion:1`, `status:local-draft`, 리비전 두 SHA, 국가 원본 ID, 사유 길이, JSON 최대 64KiB 등을 검사하고 Windows 사용자의 파일 저장 다이얼로그로만 출력한다. 외부 원본 GIS나 GitHub API에는 쓰지 않는다.
- 일반 웹에서는 기존 `Blob + <a download>` 방식의 수정 요청서 저장을 사용한다. Windows에서는 명시적 네이티브 파일 저장 명령으로 우회하고, 취소 시 취소 상태를 표시한다.
- 원본 국가/형상 비교 파일은 E4 코드가 고정된 두 Git SHA와 정본 객체 SHA를 확인한 다음에만 표시하며, Windows CSP에서도 `raw.githubusercontent.com` 읽기 연결만 추가된다.
- **외부 보고서 웹사이트를 새 창으로 여는 기능은 제한적**이다. 네이티브 창의 외부 내비게이션 거부는 보안 경계이며, 검수 보고서의 리비전 고정 URL 원문은 그대로 제공된다. 외부 브라우저 열기 관련 권한 증설은 포함하지 않았다.

## 패키징·개발 경계

- 기존 `apps/editor/stage.mjs`는 Windows 환경 변수 `PANDOLAB_NATIVE_REVIEW=1` 또는 `--windows-review`일 때 E4 `review.html`과 Viewer 전용 모듈/스타일을 추가한다. 기존 `index.html`은 E6까지 삭제하지 않는다.
- `apps/editor/native-producer.mjs`가 Windows 빌드에만 `prototype-review` capability, 검수 모드 및 필요한 읽기 CSP를 적용한다. `apps/editor/src-tauri/build.rs`는 Windows map-data 패키지 안에 검수 진입점이 있다는 근거 기록을 요구한다.
- 수정된 `nativeBuildSelection`은 공통 코드 수정 시 Windows만 자동 선택하고 Android 자동 빌드를 요청하지 않는다. Android 코드는 E6에서 분리·제거한다.
- E4 공개 웹의 지구본 화면과 원래 프로젝트 열기 회귀 경계는 그대로 남는다.

## 검증 조건

CI 워크플로: [.github/workflows/e5-windows-review-acceptance.yml](../../.github/workflows/e5-windows-review-acceptance.yml).

1. Ubuntu 계약 검사: 기존 C++ Core 선행 자산 확인, ESLint, 읽기 전용 Viewer/flat 투영·Tauri command capability·E2/E3/E4 연동 및 Android 자동 빌드 방침 테스트.
2. Chromium 브라우저 회귀: `/review.html`에서 Windows용 플래그를 주입한 실제 E4 검수 흐름(읽기 전용 평면 지도·자동 검수창·JSON 읽기·국가 필터·수정 초안 명령), 일반 `/`에서 웹 `globe` 유지, 기존 E4 검수 동등성.
3. **Windows 2022 네이티브 실제 실행:** Rust/MSVC Tauri 빌드·cargo test 후 `verify-review-windows.ps1`이 `--probe-auto` WebView2를 실행한다. `review-probe.js`는 **실제** 지도 준비, 검수 패널, `flat`, `canUndo:false`, Core `document-execute`의 `PL-PRODUCT-READONLY` 차단을 확인하고, Rust `finish_probe`로 진단 원문을 기록한 뒤 종료한다.
4. 최종 제품 WebView2 증거가 없는 상태에서는 자동 실행 계약 시험의 성공만으로 네이티브 UI 동작을 통과로 표시하지 않는다.

## 후속

E6: 남은 그래픽 편집·Android 네이티브 전용 화면/핸들러/권한/테스트를 실제 참조 확인 뒤 정리. E7: 웹 및 Windows 배포 모드 최종 회귀 검사. E5는 사용자가 직접 GitHub/GIS 자료를 수정할 수 있는 편집기 기능을 **복원하지 않는다**.
