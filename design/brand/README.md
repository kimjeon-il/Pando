# 판도연구소 브랜드 원본

공유경계 심벌과 코발트 `#315EDB`를 유지한다. 현재 사용 플랫폼은 Windows(투명 심벌)와 PC·모바일 웹(소형 배지)이다. 과거 Android 적응형 아이콘은 운영 자산에서 제외되었다. Tauri 기본 아이콘은 디자인 근거로 사용하지 않는다.

## 원본과 파생본

- `symbol-black.svg` / `symbol-white.svg`: 일반형 정본. 경로는 변경하지 않는다.
- `symbol-small-*.svg`: 16~32px용 넓은 경계. 일반형의 단순 축소로 대체하지 않는다.
- `windows.svg` / `windows-small.svg`: 대응하는 검정 정본의 경로를 그대로 둔 코발트 파생본. 배경판, 그림자, 마스크, 추가 변형이 없다.
- `app-icon*.svg`: 배경판이 있는 정적 합성 원본. Windows에 사용하지 않는다.
- `brand-tokens.json`: 공통 팔레트와 플랫폼별 합성 규칙. 사용자 UI 강조색과 독립적이다.
- `asset-hashes.json`: 현재 검토한 파생 자산의 SHA-256. 출력 수정 시 함께 갱신한다.

## 플랫폼별 합성

| 대상 | 심벌과 배경 | 외곽 처리 |
| --- | --- | --- |
| Windows | 투명 RGBA 캔버스 + 코발트 심벌. 내부 경계도 투명 | 배경판 없음 |
| Web favicon | 흰 배경판 + 코발트 소형 심벌 | 기존 SVG/ICO 유지 |

Windows의 `apps/editor/src-tauri/icons/icon.png`는 256px다. `icon.ico`는 16/24/32px 소형형과 48/64/128/256px 일반형을 각각 렌더한 PNG 7개를 담는다. 기존 Tauri 설정이 이 두 경로를 사용한다. 16px에서 위 통로 x=6,7, 아래 통로 x=8,9의 두 픽셀 폭을 유지한다. 재출력은 대응하는 `windows*.svg`를 크기별 투명 RGBA로 렌더한 뒤 ICO로 묶는다.

Android 네이티브 아이콘 소스·생성 스크립트는 폐기되어 현재 저장소에 없다. 필요하면 과거 Git 기록을 참조하되 앱 실행·브랜딩 테스트에서 다시 생성하지 않는다.

웹 배포 자산은 `shared/frontend/static/brand/`, 공통 head 선언은 `shared/frontend/ui/fragments/brand-icons.html`이 소유한다. 기존 HTML 빌드의 자산 수집과 assetRevision을 유지한다. Windows 교체를 웹에 자동 전파하지 않는다.

## 검사와 재출력 규칙

```sh
node --test tests/unit/brand-icons.test.mjs tests/unit/brand-platforms.test.mjs
```

파일 헤더·해시뿐 아니라 실제 Windows PNG/ICO 프레임을 디코딩해 불투명 색상, 투명 여백·경계, alpha 32/128/224에서 두 영역 분리를 검사한다. 파생 SVG와 정본 경로 일치 및 웹 배경판을 검사한다.

하나의 사각 이미지를 모든 플랫폼에 복사하거나 전체 Tauri 아이콘 재생성으로 광학 크기·Android 원본을 덮어쓰지 않는다. 이 검사는 Windows 네이티브 빌드, 실제 WebView2 실행 및 브라우저 아이콘 캐시 검증을 대신하지 않는다. main 통합과 공개 배포는 별도 승인 범위다.
