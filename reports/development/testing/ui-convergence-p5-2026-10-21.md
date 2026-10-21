# UI 구조 통일 P5 — 참조 이미지 선 보강·자동 추적 Action 통합

> 보고서 ID: `UI-CONVERGENCE-P5-20261021` · 상태: `implemented / isolated-unit-verified / browser-native-unverified` · 지도 반영: `not-applicable` · 색인일: 2026-10-21  
> 원문 최종 수정: 2026-10-21  
> 수정 기준: `work/ui`의 `6fc982bfe1b3f13c0ce9988af0a73d1358f0be2b` (P4 `979028ba690c4ed1d22dfeed88959106a02527d5` 포함)  
> 근거: [P0 구조 조사](ui-convergence-p0-audit-2026-10-20.md), [P4 Surface 정리](ui-convergence-p4-2026-10-21.md), [UI 공통 구조](../../../docs/architecture/ui-architecture.md)

> 후속 검증: [UI-SYNC-CLEANUP-20261021](ui-sync-test-cleanup-2026-10-21.md)에서 실제 탭 전환 회귀를 수정하고 Node 단위 검사·모바일 브라우저 검사를 실행했다. 아래 결과는 원래 P5 작성 당시의 기록이다.

## 범위와 구조

P5의 대상은 `reference-image-line-refine-controller.js`, `reference-image-live-wire-controller.js`에서 중복되던 도구 버튼 생성 및 요약 영역과 본문 사이의 DOM 이동이다. P4에서 완성된 참조 이미지 Surface를 Action 렌더러의 단일 소유자로 사용한다.

- `reference-image-ui.js`: 최초 생성한 `surface-footer` 아래에 고정된 `data-ref-auxiliary-actions`와 두 도구 그룹을 배치한다. 두 그룹과 고유 `data-ref-*-actions`의 부모는 화면 크기나 작업 단계에 따라 이동하지 않는다.
- `reference-image-surface.js`: 공통 Action 정의(선 보강: 시작·적용·다시 그리기·취소, 자동 추적: 시작·완료·마지막 점 취소·적용·다시 그리기·취소)와 단일 버튼 렌더러를 사용한다. 기존 워크플로·이미지 편집 상태와 충돌하지 않도록 footer 그룹의 노출만 변경한다.
- `reference-image-surface-port.js`: 상태·명령 실행 책임은 도구에 유지하면서 Surface로 표시 전용 projection을 전달한다.
- 두 도구 컨트롤러: `ensureActionRow`, `summary.appendChild(row)`, `insertAdjacentElement('afterend', row)`를 제거했다. 단계·잠금·다른 도구 실행 상태·미리보기/적용 조건만 계산한다. 기존 명령 이벤트, 미리보기, 취소, 도형 편집 draft 적용은 수정하지 않는다.
- `layout/reference-images.css`: 모바일 요약 및 확장 상태 모두에서 같은 footer Action을 표시하고, 활성 도구가 없거나 다른 작업이 우선하면 숨긴다. 공통 버튼 `ui-button` 외형은 유지한다.

## 검증 결과

| 검사 | 결과 | 한계 |
| --- | --- | --- |
| 변경 JS와 테스트의 구문 검사 | 통과 | 함수 본문을 분리한 V8 구문 검사. 실제 프로젝트 전체 번들·ESM 검사는 아님 |
| Surface 관련 모의 DOM 검사 | **10/10 통과** | 실제 테스트 소스와 변경 구현을 V8에서 실행하고, import와 브라우저 API를 검사용 stub으로 대체함. 정식 `node --test` 실행이 아님 |
| 고정 부모·버튼 동일성·상태 표시 회귀 테스트 | 테스트 작성, 모의 DOM 통과 | `tests/unit/reference-image-surface.test.mjs`의 P5 시나리오 |
| 모바일 선 보강·자동 추적 회귀 테스트 | 테스트 갱신, 미실행 | `tests/browser/reference-image-auxiliary-surface.spec.mjs`에서 부모·버튼 identity, 요약/확장 전환, 적용 전 원본 보존을 검사하도록 갱신 |
| 관련 Playwright, `pnpm check:ui`, 실제 저장·Undo 및 앱 staging | 미실행 | 해당 검증을 실행할 저장소 체크아웃과 브라우저 테스트 환경에 접근하지 못함 |
| Tauri·Android 실제 WebView | 미실행 | P6에서도 별도 검증 필요 |

따라서 이번 변경은 코드 통합 및 검사 작성까지 반영된 상태이며, 실제 브라우저·앱 회귀 통과를 주장하지 않는다. 특히 선 추적 시작→미리보기→적용의 실제 결과, 터치 환경에서 버튼 가시성, 앱 WebView 실행은 다음 검증에서 확인해야 한다. 신규 계산 알고리즘·저장 모델·지도 데이터에는 변경이 없다.

## 후속 확인

```bash
node --test tests/unit/reference-image-surface.test.mjs tests/unit/reference-image-ui.test.mjs tests/unit/reference-image-workflow-cancel.test.mjs
pnpm check:ui
pnpm exec playwright test tests/browser/reference-image-auxiliary-surface.spec.mjs tests/browser/reference-image-line-refine.spec.mjs tests/browser/reference-image-live-wire.spec.mjs
node scripts/generate-build-metadata.mjs --check
```

변경 후 생성된 HTML import map, JS build meta, CSS·앱 staging 자산은 저장소의 정식 생성·검증 절차로 갱신해야 한다. 웹 viewer와 편집기 앱 결과를 혼동하지 않는다. `main` 병합 및 배포는 P5 작업 범위에 포함하지 않는다.
