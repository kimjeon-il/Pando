# E7 — 웹·Windows 읽기 전용 제품 최종 회귀 검사

검증일: 2026-11-02 · 검증 코드 리비전: `1135f1e7164758f0a7739c2bf35c4dc11ad408e0`  
대상: `work/ui`의 E6 완료 후 Web Viewer + Windows Tauri 읽기 전용 검수기.  
선행: [E4 웹 검수기](web-review-e4.md) → [E5 Windows 검수기](windows-review-e5.md) → E6 구형 편집기·Android 네이티브 제거.

## 수용 결과

**E7 세 CI 작업 모두 성공.** 자동 테스트가 실행된 정확한 코드는 `1135f1e7164758f0a7739c2bf35c4dc11ad408e0`이다.

- [GitHub Actions E7 수용 실행 #41409255167](https://github.com/kimjeon-il/Pando/actions/runs/41409255167) — `success` (contract/browser/native).
- [E7 Windows 실제 WebView2 증거 ZIP](https://github.com/kimjeon-il/Pando/actions/runs/41409255167/artifacts/13125166629) — 생성 코드 SHA·프로파일·실행 결과·stdout/stderr 포함. 아티팩트 보존 기한: 2026-11-16.
- 수용 워크플로: [e7-final-readonly-regression.yml](../../.github/workflows/e7-final-readonly-regression.yml). 브랜치 `work/ui`의 변경과 수동 실행만 대상으로 하며, `main`을 자동 병합하거나 Pages를 자동 배포하지 않는다.

| 검수 영역 | 판정 | 범위 |
| --- | --- | --- |
| Node/C++ 기반 계약·소스 격리 | **93 passed / 0 failed** | E2/E3/E4/E5/E6, C++ temporal, immutable sidecar, 데이터 해시 검수, 앱 권한/패키징 |
| 실제 Chromium 회귀 | **8 passed / 0 failed** | E4 4개, E5 모의 Windows 2개, WebGL 국경 Worker 1개, 연도별 상태 전환 1개 |
| Windows 2022 Rust 네이티브 | **15 passed / 0 failed** | Rust/Tauri 앱·저장 계약 단위 테스트, 네이티브 실행 파일 재빌드 |
| 실제 Windows WebView2 | **passed** | 소스 SHA 고정 후 실제 WebView2 구동, 지도·패널·Core 편집 명령 차단 증명 |
| 배포 소스 경계 | **passed** | Viewer·공통 자산 768개, 편집기 진입점 0개, 편집용 Rust IPC 0개 |
| 자동 승인·역사 정확성 | **범위 밖** | 실제 데이터 수정·승인·영토 위상/출처 역사적 정답 판정 미실행 |

### 실제 Windows WebView2 진단 원문

`e7-windows/windows-review-probe.json`:

```json
{
  "schema": "pandolab-windows-review-probe",
  "phase": "read-only-map-ready",
  "ok": true,
  "observed": {
    "readOnly": true,
    "projection": "flat",
    "dataReady": true,
    "panelOpen": true,
    "hasReviewLoad": true,
    "editorDomAbsent": true,
    "canUndo": false,
    "mutationBlocked": true
  }
}
```

위에는 실제 원문에 있었던 진단 필드만 요약했다. 원문에는 `elapsedMs: 26263`, `embeddedBuild` 빌드 신원과 Windows 파일·실행 정보가 추가로 있다. `embeddedBuild.sourceCommit`과 `native-artifact.json.sourceCommit`은 모두 `1135f1e7164758f0a7739c2bf35c4dc11ad408e0`이다. 네이티브 입력 `nativeInputSha256`: `a9a49b6d193db3e291e091c713ddabaef801f6f3d926459a281a10532a337821`. 실제 실행 성공은 **Windows 2022 테스트 러너에서의 성공**이며 사용자 개인 PC의 실행 성공을 직접 확인한 것은 아니다.

### 브라우저 동작 검증

Chromium 8개 테스트는 재시도 없이 통과했다. Windows 검수용 플랫 지도 모의 브라우저 테스트와 별도로 일반 웹의 `globe` 투영, 모바일 검수 패널, 수정 요청서 JSON의 로컬 내보내기·무변경 정본, 출처·리비전 SHA-256 확인, 오류 후 안전한 복구를 확인했다. 추가로 실제 WebGL 지도에서 국경 Worker 준비·재사용, 빠른 연도 이동 시 최신 시점 우선 적용을 검증했다.

### E6 이후 테스트 실행 계획 정비

`scripts/contracts/application-checks.json`에서 원본 저장소의 별도 마운트 파일을 직접 요구하던 5개 입력을 `config/library-data.json` 데이터 리비전 소유 경계로 교정했다. 실시간 운영 회귀 `tests/browser/windows-review-e5.spec.mjs`는 활성 Viewer 그룹으로, P6-5/6/7 장시간 성능·메모리 측정은 기존 수동 `measurements` 그룹으로 명시 등록했다. 기존 테스트 코드는 삭제하지 않았다.

`scripts/plan-application-checks.mjs`는 변경사항이 0건인 경우 입력 및 테스트 목록 자체를 검증한 뒤 **빈 실행 계획을 반환**한다. 이때 제거된 편집기 모듈을 참조하는 보관용 테스트 전체의 동적 의존성 그래프를 강제로 순회하지 않는다. 변경사항이 있거나 특정 검사를 명시 지정한 경우의 엄격한 스케줄링을 삭제하지 않았다. 회귀 테스트: `tests/unit/e7-application-check-planner.test.mjs`.

### 유지한 제약 및 이후 검증 범위

- 기존 `config/library-data.json`의 데이터 pin `5eb7be55208efaafe39bd5a65ec2f111d70b9053` 유지.
- `main`·웹 Pages·외부 역사 라이브러리에 직접 쓰기 없음. E7은 `work/ui`에서 검증하며 승인 없는 병합 없음.
- E4 검수 화면은 읽기 전용, Windows의 수정 요청서 로컬 저장 외 별도 GIS 저장/Undo/Redo/편집 IPC 없음.
- 기존 편집기용 휴면 소스·과거 테스트 파일이 저장소에 남아 있을 수 있으나 Viewer와 Windows 제품 번들 그래프에 포함되지 않는다. 수용 기준은 소스 삭제 개수만이 아닌 **제품 그래프에서의 퇴역 코드 부재 및 실제 실행 동작**이다.
- E7은 새 일반 Windows NSIS 설치 파일을 배포하지 않았다. 본 Windows 수용 검증은 E7 테스트용 `verification` 빌드에서 수행했다.
- E7 외 `Application Architecture` 등 일부 오래된 프로젝트 범용 테스트/보고서가 편집기 전용 경로를 계속 검사할 수 있다. 이것을 E7의 성공 기록으로 대체하거나 해당 범용 CI까지 통과했다고 주장하지 않는다. 이후 해당 범용 CI가 퇴역 테스트에 의존하면 별도 정리해야 한다.

**판정:** E7에서 범위로 정한 Web Viewer와 Windows 읽기 전용 검수기의 코드·Chromium·Windows WebView2 최종 회귀 검사가 모두 통과했다. 사용자 승인 없는 `main` 병합은 수행하지 않는다.
