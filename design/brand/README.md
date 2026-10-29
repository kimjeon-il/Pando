# 판도연구소 브랜드 원본

공유경계(A1 정제형), 코발트 `#315EDB`와 흰색. 2026-10-29 승인된 `pando-brand-v1.zip`의 최종 원본과 출력 바이트를 사용한다. Tauri 기본 아이콘이나 플러그인 임시 로고를 브랜드 근거로 사용하지 않는다.

## 소유권

- `symbol-black.svg` / `symbol-white.svg`: 48px 이상 일반형.
- `symbol-small-*.svg`: 16~32px의 넓어진 경계. 자동 축소로 대체하지 않는다.
- `app-icon*.svg`, `brand-tokens.json`: 승인 원본. 사용자 UI 강조색과 독립적이다.
- `shared/frontend/static/brand/`: 배포용 favicon SVG/ICO와 Apple Touch Icon.
- `shared/frontend/ui/fragments/brand-icons.html`: 공통 head 선언. `product-html.mjs`가 기존 빈 favicon 선언을 공통 fragment로 확장하며, 기존 frontend 빌드가 경로 수집과 assetRevision을 소유한다.
- `apps/editor/src-tauri/icons/`: Windows/네이티브 PNG·ICO. 기존 Tauri 설정이 이 경로를 사용한다.
- `apps/editor/src-tauri/android/`: Android 원본. `sync-android.mjs`로 `gen/android/`를 생성한다. 고유 리소스명 `pando_launcher`를 사용해 Tauri 재생성이 기본 `ic_launcher`를 복원해도 앱 아이콘은 바뀌지 않는다.

Android API 24~25는 VectorDrawable, 26~32는 전경·배경 Adaptive Icon, 33 이상은 단색 레이어를 추가로 사용한다. 원형 launcher는 구형 전용 원형 배경을 사용하며, adaptive 버전은 시스템 마스크에 맡긴다. 배경판이나 브랜드색을 단색 레이어에 포함하지 않는다.

`asset-hashes.json`은 승인된 출력 바이트와 현재 사용 파일을 연결한다. 원본을 수정하면 새로 검토한 출력과 해시를 함께 갱신한다. 과거 기본 mipmap 이미지는 Tauri scaffold 소유라 삭제하지 않으며 manifest에서 참조하지 않는다.

## 검사

```sh
node --test tests/unit/brand-icons.test.mjs
node apps/editor/src-tauri/sync-android.mjs --check
```

공통 HTML 합성, 하위 URL, 자산 소유권, ICO의 개별 PNG 크기, 승인 파일 해시, Android 리소스 연결과 재생성·drift 복구를 검사한다. 이 검사는 네이티브 컴파일, 실기기 런처 표시, 브라우저 아이콘 캐시 갱신을 대신하지 않는다. PWA·서비스워커·테마색·지도 기능·프로젝트 저장 형식은 변경하지 않는다. main 병합·제품 배포는 별도 단계다.
